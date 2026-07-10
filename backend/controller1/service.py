from __future__ import annotations

import asyncio
import os
import subprocess
import time
from pathlib import Path
from typing import Any, Awaitable, Callable

from .devices import DeviceManager
from .engine import MappingEngine
from .models import AxisCalibration, Binding, InputRef, Profile
from .outputs import VirtualOutputs
from .store import ProfileStore

Emitter = Callable[..., Awaitable[None]]


class ControllerService:
    def __init__(
        self,
        settings_dir: str,
        emit: Emitter,
        logger: Any,
    ) -> None:
        self.emit = emit
        self.logger = logger
        self.store = ProfileStore(settings_dir)
        self.evdev: Any | None = None
        self.outputs: VirtualOutputs | None = None
        self.engine: MappingEngine | None = None
        self.devices: DeviceManager | None = None
        self.dependency_error: str | None = None
        self.learning = False
        self.learn_baseline: dict[str, int] = {}
        self.learn_thresholds: dict[str, int] = {}
        self.learn_started = 0.0
        self.last_raw_emit = 0.0
        self.calibrating: set[str] = set()
        self.calibration_samples: dict[str, dict[str, int]] = {}
        self.emit_tasks: set[asyncio.Task[None]] = set()

    async def start(self) -> None:
        self.store.load()
        self._ensure_uinput()
        try:
            import evdev

            self.evdev = evdev
        except ImportError as error:
            self.dependency_error = (
                f"python-evdev is not packaged correctly: {error}. "
                "Rebuild the plugin's py_modules bundle."
            )
            self.logger.error(self.dependency_error)
            return
        self.outputs = VirtualOutputs(self.evdev)
        self.engine = MappingEngine(self.outputs, self.logger)
        self.engine.set_profile(self.store.active_profile)
        self.devices = DeviceManager(
            self.evdev,
            self._on_input,
            self._on_devices_changed,
            self._on_disconnect,
            self.logger,
        )
        await self.devices.start()
        if self.store.state["enabled"]:
            try:
                await self._activate(self.store.active_profile.device_id)
            except (OSError, ValueError) as error:
                self.logger.error(f"Could not restore Controller1: {error}")
                self.store.state["enabled"] = False
                self.store.save()
                if self.outputs:
                    self.outputs.close()

    async def stop(self) -> None:
        if self.engine:
            self.engine.release_all()
        if self.devices:
            await self.devices.stop()
        if self.outputs:
            self.outputs.close()
        for task in self.emit_tasks:
            task.cancel()
        await asyncio.gather(*self.emit_tasks, return_exceptions=True)
        self.emit_tasks.clear()

    async def get_status(self) -> dict[str, Any]:
        devices = list(self.devices.devices.values()) if self.devices else []
        active_path = self.devices.active_device.path if self.devices and self.devices.active_device else None
        for device in devices:
            device["active"] = device["path"] == active_path
        return {
            "enabled": bool(self.store.state["enabled"]),
            "activeProfileId": self.store.state["activeProfileId"],
            "profiles": [profile.to_dict() for profile in self.store.profiles],
            "devices": devices,
            "dependencyError": self.dependency_error,
            "learning": self.learning,
        }

    async def refresh_devices(self) -> list[dict[str, Any]]:
        if self.dependency_error:
            raise RuntimeError(self.dependency_error)
        if not self.devices:
            raise RuntimeError("Controller1 device scanner is unavailable")
        try:
            return await self.devices.scan()
        except Exception as error:
            self.logger.error(f"Device refresh failed: {error}")
            raise RuntimeError(f"Device refresh failed: {error}") from error

    async def set_enabled(self, enabled: bool, device_id: str | None = None) -> dict[str, Any]:
        if enabled and self.dependency_error:
            raise RuntimeError(self.dependency_error)
        profile = self.store.active_profile
        if device_id is not None:
            profile.device_id = device_id
            self.store.replace_profile(profile)
        if enabled:
            try:
                await self._activate(profile.device_id)
            except (OSError, ValueError):
                self.store.state["enabled"] = False
                self.store.save()
                await self._deactivate()
                raise
            self.store.state["enabled"] = True
        else:
            self.store.state["enabled"] = False
            self.store.save()
            await self._deactivate()
            return await self.get_status()
        self.store.save()
        await self.emit("status_changed", await self.get_status())
        return await self.get_status()

    async def set_profile(self, profile_id: str) -> dict[str, Any]:
        profile = self.store.set_active(profile_id)
        if self.engine:
            self.engine.set_profile(profile)
        if self.store.state["enabled"]:
            await self._activate(profile.device_id)
        await self.emit("status_changed", await self.get_status())
        return await self.get_status()

    async def create_profile(self, name: str) -> dict[str, Any]:
        profile = self.store.add_profile(name)
        if self.engine:
            self.engine.set_profile(profile)
        if self.store.state["enabled"]:
            await self._activate(profile.device_id)
        await self.emit("status_changed", await self.get_status())
        return profile.to_dict()

    async def delete_profile(self, profile_id: str) -> dict[str, Any]:
        self.store.delete_profile(profile_id)
        return await self.set_profile(self.store.state["activeProfileId"])

    async def save_binding(self, profile_id: str, value: dict[str, Any]) -> dict[str, Any]:
        profile = self._profile(profile_id)
        binding = Binding.from_dict(value)
        profile.bindings = [item for item in profile.bindings if item.id != binding.id]
        profile.bindings.append(binding)
        self._save_and_reload(profile)
        return binding.to_dict()

    async def delete_binding(self, profile_id: str, binding_id: str) -> dict[str, Any]:
        profile = self._profile(profile_id)
        profile.bindings = [item for item in profile.bindings if item.id != binding_id]
        self._save_and_reload(profile)
        return profile.to_dict()

    async def start_learning(self) -> None:
        if not self.devices or not self.devices.active_device:
            raise RuntimeError("enable and select a controller before learning")
        self.learning = True
        self.learn_baseline.clear()
        self.learn_thresholds.clear()
        device = self.devices.active_device
        e = self.evdev.ecodes
        for code in device.capabilities(absinfo=False).get(e.EV_ABS, []):
            info = device.absinfo(code)
            key = f"{e.EV_ABS}:{code}"
            self.learn_baseline[key] = int(info.value)
            self.learn_thresholds[key] = max(2, round((info.max - info.min) * 0.02))
        for code in device.active_keys():
            self.learn_baseline[f"{e.EV_KEY}:{code}"] = 1
        self.learn_started = time.monotonic()
        await self.emit("learning_changed", True)

    async def stop_learning(self) -> None:
        self.learning = False
        await self.emit("learning_changed", False)

    async def begin_calibration(self, inputs: list[dict[str, Any]]) -> None:
        self.calibrating = {InputRef.from_dict(item).key for item in inputs}
        self.calibration_samples = {}

    async def finish_calibration(
        self, profile_id: str, centers: dict[str, int] | None = None
    ) -> dict[str, Any]:
        profile = self._profile(profile_id)
        centers = centers or {}
        for key, sample in self.calibration_samples.items():
            center = int(centers.get(key, self.engine.raw_state.get(key, 0) if self.engine else 0))
            if sample["max"] <= sample["min"]:
                continue
            previous = profile.calibrations.get(key, AxisCalibration())
            profile.calibrations[key] = AxisCalibration(
                minimum=sample["min"],
                center=center,
                maximum=sample["max"],
                deadzone=previous.deadzone,
                invert=previous.invert,
                expo=previous.expo,
            )
        self.calibrating.clear()
        self.calibration_samples.clear()
        self._save_and_reload(profile)
        return profile.to_dict()

    async def set_calibration(
        self, profile_id: str, input_value: dict[str, Any], value: dict[str, Any]
    ) -> dict[str, Any]:
        profile = self._profile(profile_id)
        input_ref = InputRef.from_dict(input_value)
        profile.calibrations[input_ref.key] = AxisCalibration.from_dict(value)
        self._save_and_reload(profile)
        return profile.to_dict()

    async def _activate(self, device_id: str | None) -> None:
        if not self.outputs or not self.devices:
            return
        self.outputs.open()
        await self.devices.select(device_id)

    async def _deactivate(self) -> None:
        if self.engine:
            self.engine.release_all()
        if self.devices:
            await self.devices.select(None)
        if self.outputs:
            self.outputs.close()
        await self.emit("status_changed", await self.get_status())

    def _on_input(self, event: Any) -> None:
        if self.engine:
            self.engine.process(int(event.type), int(event.code), int(event.value))
        key = f"{event.type}:{event.code}"
        if key in self.calibrating:
            sample = self.calibration_samples.setdefault(
                key, {"min": int(event.value), "max": int(event.value)}
            )
            sample["min"] = min(sample["min"], int(event.value))
            sample["max"] = max(sample["max"], int(event.value))
        if self.learning:
            self._observe_learning(event)
        now = time.monotonic()
        if now - self.last_raw_emit >= 1 / 30:
            self.last_raw_emit = now
            self._schedule_emit(
                "raw_input",
                {
                    "eventType": int(event.type),
                    "code": int(event.code),
                    "value": int(event.value),
                    "name": self._event_name(int(event.type), int(event.code)),
                },
            )

    def _observe_learning(self, event: Any) -> None:
        key = f"{event.type}:{event.code}"
        value = int(event.value)
        e = self.evdev.ecodes
        candidate = False
        if event.type == e.EV_KEY and value == 1:
            candidate = True
        elif event.type == e.EV_ABS:
            baseline = self.learn_baseline.setdefault(key, value)
            threshold = self.learn_thresholds.get(key, 32)
            candidate = abs(value - baseline) >= threshold
        if candidate:
            self.learning = False
            self._schedule_emit(
                "learned_input",
                {
                    "eventType": int(event.type),
                    "code": int(event.code),
                    "name": self._event_name(int(event.type), int(event.code)),
                    "value": value,
                },
            )
            self._schedule_emit("learning_changed", False)

    def _on_devices_changed(self, devices: list[dict[str, Any]]) -> None:
        self._schedule_emit("devices_changed", devices)

    def _on_disconnect(self) -> None:
        if self.engine:
            self.engine.release_all()

    def _event_name(self, event_type: int, code: int) -> str:
        if not self.evdev:
            return str(code)
        name = self.evdev.ecodes.bytype.get(event_type, {}).get(code, str(code))
        return name[0] if isinstance(name, list) else str(name)

    def _schedule_emit(self, event: str, *args: Any) -> None:
        task = asyncio.get_running_loop().create_task(self.emit(event, *args))
        self.emit_tasks.add(task)
        task.add_done_callback(self._finish_emit)

    def _finish_emit(self, task: asyncio.Task[None]) -> None:
        self.emit_tasks.discard(task)
        if task.cancelled():
            return
        error = task.exception()
        if error:
            self.logger.warning(f"Decky event emission failed: {error}")

    def _profile(self, profile_id: str) -> Profile:
        profile = next((item for item in self.store.profiles if item.id == profile_id), None)
        if not profile:
            raise ValueError("unknown profile")
        return profile

    def _save_and_reload(self, profile: Profile) -> None:
        self.store.replace_profile(profile)
        if self.engine and profile.id == self.store.state["activeProfileId"]:
            self.engine.set_profile(profile)

    def _ensure_uinput(self) -> None:
        if Path("/dev/uinput").exists() or os.name != "posix":
            return
        try:
            subprocess.run(
                ["/usr/bin/modprobe", "uinput"],
                check=False,
                timeout=5,
                capture_output=True,
            )
        except (OSError, subprocess.SubprocessError) as error:
            self.logger.warning(f"Could not load uinput module: {error}")
