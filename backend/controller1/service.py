from __future__ import annotations

import asyncio
import json
import os
import stat
import subprocess
import time
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Awaitable, Callable

from .devices import DeviceManager
from .engine import MappingEngine
from .models import AxisCalibration, Binding, CalibrationRun, InputRef, Profile
from .outputs import VirtualOutputs
from .store import ProfileStore

Emitter = Callable[..., Awaitable[None]]


class DiagnosticLogger:
    def __init__(self, logger: Any, sink: Callable[..., None]) -> None:
        self.logger = logger
        self.sink = sink

    def __getattr__(self, level: str) -> Callable[[Any], None]:
        def write(message: Any) -> None:
            self.sink("component_log", level=level, message=str(message))
            target = getattr(self.logger, level, None)
            if target:
                target(message)

        return write


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
        self.live_values: dict[str, int] = {}
        self.last_live_snapshot_emit = 0.0
        self.live_snapshot_revision = 0
        self.live_snapshot_task: asyncio.Task[None] | None = None
        self.calibration_active = False
        self.calibration_profile_id: str | None = None
        self.calibration_device_id: str | None = None
        self.calibrating: set[str] = set()
        self.calibration_samples: dict[str, dict[str, int]] = {}
        self.calibration_values: dict[str, int] = {}
        self.calibration_pressed_buttons: set[str] = set()
        self.last_snapshot_emit = 0.0
        self.calibration_snapshot_task: asyncio.Task[None] | None = None
        self.calibration_persist_task: asyncio.Task[None] | None = None
        self.emit_tasks: set[asyncio.Task[None]] = set()
        self.debug_started = time.time()
        self.debug_lifecycle: deque[dict[str, Any]] = deque(maxlen=100)
        self.debug_inputs: deque[dict[str, Any]] = deque(maxlen=80)
        self.debug_outputs: deque[dict[str, Any]] = deque(maxlen=80)
        self.input_event_count = 0
        self.output_event_count = 0
        self.dropped_output_count = 0
        self.component_logger = DiagnosticLogger(logger, self._debug)

    async def start(self) -> None:
        self._debug("service_start")
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
        self.outputs = VirtualOutputs(
            self.evdev,
            self.store.state["outputGamepadName"],
            self.store.state["outputKeyboardName"],
            self._on_output_emit,
        )
        self.engine = MappingEngine(self.outputs, self.component_logger)
        self.engine.set_profile(self.store.active_profile)
        self.devices = DeviceManager(
            self.evdev,
            self._on_input,
            self._on_devices_changed,
            self._on_disconnect,
            self.component_logger,
            self._on_connection_changed,
        )
        await self.devices.start()
        if self.store.state["enabled"]:
            try:
                await self._activate(self.store.active_profile.device_id)
            except (OSError, RuntimeError, ValueError) as error:
                self.logger.error(f"Could not restore Controller1: {error}")
                self.store.state["enabled"] = False
                self.store.save()
                if self.outputs:
                    self.outputs.close()

    async def stop(self) -> None:
        self._debug("service_stop")
        if self.calibration_active:
            await self._persist_calibration_progress()
        await self._cancel_calibration_persist()
        if self.engine:
            self.engine.release_all()
        if self.devices:
            await self.devices.stop()
        if self.outputs:
            self.outputs.close()
        if self.calibration_snapshot_task:
            self.calibration_snapshot_task.cancel()
            await asyncio.gather(self.calibration_snapshot_task, return_exceptions=True)
            self.calibration_snapshot_task = None
        await self._cancel_live_snapshot()
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
            "connected": bool(
                self.store.state["enabled"]
                and self.devices
                and self.devices.active_device
            ),
            "activeProfileId": self.store.state["activeProfileId"],
            "profiles": [profile.to_dict() for profile in self.store.profiles],
            "devices": devices,
            "dependencyError": self.dependency_error,
            "learning": self.learning,
            "calibrating": self.calibration_active,
            "outputGamepadName": self.store.state["outputGamepadName"],
            "outputKeyboardName": self.store.state["outputKeyboardName"],
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
            except (OSError, RuntimeError, ValueError):
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

    async def set_output_names(
        self, gamepad_name: str, keyboard_name: str
    ) -> dict[str, Any]:
        gamepad_name = self._validate_output_name(gamepad_name, "gamepad")
        keyboard_name = self._validate_output_name(keyboard_name, "keyboard")
        old_gamepad_name = self.store.state["outputGamepadName"]
        old_keyboard_name = self.store.state["outputKeyboardName"]
        enabled = bool(self.store.state["enabled"])
        active_device_id = self.store.active_profile.device_id

        if enabled:
            if not self.outputs or not self.devices:
                raise RuntimeError("Controller1 virtual outputs are unavailable")
            if self.engine:
                self.engine.release_all()
            await self.devices.select(None)
            self.outputs.close()
            self.outputs.gamepad_name = gamepad_name
            self.outputs.keyboard_name = keyboard_name
            try:
                self.outputs.open()
                await self.devices.select(active_device_id)
            except (OSError, RuntimeError, ValueError):
                self.outputs.close()
                self.outputs.gamepad_name = old_gamepad_name
                self.outputs.keyboard_name = old_keyboard_name
                try:
                    self.outputs.open()
                    await self.devices.select(active_device_id)
                except (OSError, RuntimeError, ValueError) as restore_error:
                    self.logger.error(f"Could not restore virtual outputs: {restore_error}")
                raise
        elif self.outputs:
            self.outputs.gamepad_name = gamepad_name
            self.outputs.keyboard_name = keyboard_name

        self.store.state["outputGamepadName"] = gamepad_name
        self.store.state["outputKeyboardName"] = keyboard_name
        self.store.save()
        status = await self.get_status()
        await self.emit("status_changed", status)
        return status

    async def get_output_catalog(self) -> dict[str, list[dict[str, str]]]:
        if not self.outputs:
            if self.dependency_error:
                raise RuntimeError(self.dependency_error)
            raise RuntimeError("Controller1 virtual outputs are unavailable")
        return self.outputs.catalog()

    async def get_debug_report(self) -> dict[str, str]:
        profile = self.store.active_profile
        active_device = self.devices.active_device if self.devices else None
        report = {
            "generatedAt": self._timestamp(),
            "service": {
                "uptimeSeconds": round(time.time() - self.debug_started, 1),
                "enabled": bool(self.store.state["enabled"]),
                "dependencyError": self.dependency_error,
                "activeProfile": {
                    "id": profile.id,
                    "name": profile.name,
                    "deviceId": profile.device_id,
                    "bindingCount": len(profile.bindings),
                    "calibrationCount": len(profile.calibrations),
                },
                "selectedDeviceId": getattr(self.devices, "selected_id", None),
                "activeDevicePath": getattr(active_device, "path", None),
                "readerTask": self._task_state(
                    getattr(self.devices, "reader_task", None)
                ),
                "scanTask": self._task_state(
                    getattr(self.devices, "scan_task", None)
                ),
            },
            "virtualOutputs": {
                "gamepad": self._describe_virtual_output(
                    getattr(self.outputs, "gamepad", None)
                ),
                "keyboardMouse": self._describe_virtual_output(
                    getattr(self.outputs, "keyboard", None)
                ),
            },
            "physicalDevices": list(self.devices.devices.values()) if self.devices else [],
            "eventCounters": {
                "physicalRead": self.input_event_count,
                "virtualEmitted": self.output_event_count,
                "virtualDropped": self.dropped_output_count,
            },
            "recentLifecycle": list(self.debug_lifecycle),
            "recentPhysicalInput": list(self.debug_inputs),
            "recentVirtualOutput": list(self.debug_outputs),
        }
        return {"text": json.dumps(report, indent=2, sort_keys=True)}

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
        if not self.devices or not self.devices.active_device or not self.evdev:
            raise RuntimeError("enable and select a controller before calibrating")
        await self._cancel_live_snapshot()
        await self._cancel_calibration_snapshot()
        await self._cancel_calibration_persist()
        profile = self.store.active_profile
        if not profile.device_id:
            raise RuntimeError("the active profile has no controller")
        self.calibration_profile_id = profile.id
        self.calibration_device_id = profile.device_id
        profile.calibration_runs[self.calibration_device_id] = CalibrationRun()
        self._save_and_reload(profile)
        self.calibration_active = True
        self.calibrating = {InputRef.from_dict(item).key for item in inputs}
        self.calibration_samples = {}
        self.calibration_values = {}
        self.calibration_pressed_buttons = set()
        device = self.devices.active_device
        e = self.evdev.ecodes
        capabilities = device.capabilities(absinfo=False)
        for code in capabilities.get(e.EV_ABS, []):
            info = device.absinfo(code)
            key = f"{e.EV_ABS}:{code}"
            value = int(info.value)
            self.calibration_values[key] = value
            self.calibration_samples[key] = {"min": value, "max": value}
        for code in capabilities.get(e.EV_KEY, []):
            self.calibration_values[f"{e.EV_KEY}:{code}"] = 0
        for code in device.active_keys():
            key = f"{e.EV_KEY}:{code}"
            self.calibration_values[key] = 1
            self.calibration_pressed_buttons.add(key)
        self.last_snapshot_emit = time.monotonic()
        await self.emit("input_snapshot", self._calibration_snapshot())
        await self.emit("status_changed", await self.get_status())

    async def finish_calibration(
        self, profile_id: str, centers: dict[str, int] | None = None
    ) -> dict[str, Any]:
        profile = self._profile(profile_id)
        centers = centers or {}
        await self._cancel_calibration_snapshot()
        await self._cancel_calibration_persist()
        if self.calibration_active:
            await self.emit("input_snapshot", self._calibration_snapshot())
        for key, sample in self.calibration_samples.items():
            if key not in self.calibrating:
                continue
            center = int(
                centers.get(
                    key,
                    self.calibration_values.get(
                        key, self.engine.raw_state.get(key, 0) if self.engine else 0
                    ),
                )
            )
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
        if self.calibration_device_id:
            profile.calibration_runs[self.calibration_device_id] = CalibrationRun(
                axis_ranges={
                    key: {"min": sample["min"], "max": sample["max"]}
                    for key, sample in self.calibration_samples.items()
                },
                pressed_buttons=set(self.calibration_pressed_buttons),
            )
        self.calibration_active = False
        self.calibration_profile_id = None
        self.calibration_device_id = None
        self.calibrating.clear()
        self.calibration_samples.clear()
        self.calibration_values.clear()
        self.calibration_pressed_buttons.clear()
        self._save_and_reload(profile)
        await self.emit("status_changed", await self.get_status())
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
        self._debug("activate_begin", deviceId=device_id)
        self.outputs.open()
        await self.devices.select(device_id)
        self._debug(
            "activate_ready",
            deviceId=device_id,
            activePath=getattr(self.devices.active_device, "path", None),
            gamepadPath=self._virtual_path(getattr(self.outputs, "gamepad", None)),
        )
        self._configure_default_calibrations()
        self._seed_live_values()
        await self.emit("input_snapshot", self._live_snapshot())

    async def _deactivate(self) -> None:
        self._debug("deactivate")
        await self._cancel_live_snapshot()
        self.live_values.clear()
        if self.engine:
            self.engine.release_all()
        if self.devices:
            await self.devices.select(None)
        if self.outputs:
            self.outputs.close()
        await self.emit("status_changed", await self.get_status())

    def _on_input(self, event: Any) -> None:
        self.input_event_count += 1
        self.debug_inputs.append(
            {
                "at": self._timestamp(),
                "type": int(event.type),
                "code": int(event.code),
                "name": self._event_name(int(event.type), int(event.code)),
                "value": int(event.value),
            }
        )
        if self.engine:
            self.engine.process(int(event.type), int(event.code), int(event.value))
        key = f"{event.type}:{event.code}"
        value = int(event.value)
        self.live_values[key] = value
        if self.calibration_active:
            self.calibration_values[key] = value
            e = self.evdev.ecodes
            if event.type == e.EV_KEY and value:
                self.calibration_pressed_buttons.add(key)
            if event.type == e.EV_ABS:
                sample = self.calibration_samples.setdefault(
                    key, {"min": value, "max": value}
                )
                sample["min"] = min(sample["min"], value)
                sample["max"] = max(sample["max"], value)
            self._queue_calibration_snapshot()
            self._queue_calibration_persist()
        else:
            self._queue_live_snapshot()
        if self.learning:
            self._observe_learning(event)

    def _live_snapshot(self) -> dict[str, Any]:
        return {
            "values": dict(self.live_values),
            "axisRanges": {},
            "pressedButtons": [],
        }

    def _queue_live_snapshot(self) -> None:
        self.live_snapshot_revision += 1
        if self.live_snapshot_task:
            return
        self.live_snapshot_task = asyncio.get_running_loop().create_task(
            self._emit_live_snapshots(),
            name="controller1-live-snapshot",
        )

    async def _emit_live_snapshots(self) -> None:
        try:
            while True:
                delay = max(
                    0.0,
                    (1 / 60) - (time.monotonic() - self.last_live_snapshot_emit),
                )
                if delay:
                    await asyncio.sleep(delay)
                revision = self.live_snapshot_revision
                self.last_live_snapshot_emit = time.monotonic()
                await self.emit("input_snapshot", self._live_snapshot())
                if revision == self.live_snapshot_revision:
                    break
        finally:
            self.live_snapshot_task = None

    async def _cancel_live_snapshot(self) -> None:
        if not self.live_snapshot_task:
            return
        self.live_snapshot_task.cancel()
        await asyncio.gather(self.live_snapshot_task, return_exceptions=True)
        self.live_snapshot_task = None

    def _seed_live_values(self) -> None:
        self.live_values.clear()
        if not self.devices or not self.devices.active_device or not self.evdev:
            return
        device = self.devices.active_device
        e = self.evdev.ecodes
        capabilities = device.capabilities(absinfo=False)
        for code in capabilities.get(e.EV_ABS, []):
            try:
                self.live_values[f"{e.EV_ABS}:{code}"] = int(device.absinfo(code).value)
            except (AttributeError, OSError, TypeError, ValueError):
                continue
        for code in capabilities.get(e.EV_KEY, []):
            self.live_values[f"{e.EV_KEY}:{code}"] = 0
        for code in device.active_keys():
            self.live_values[f"{e.EV_KEY}:{code}"] = 1

    def _configure_default_calibrations(self) -> None:
        if not self.engine:
            return
        calibrations: dict[str, AxisCalibration] = {}
        if not self.devices or not self.devices.active_device or not self.evdev:
            self.engine.set_default_calibrations(calibrations)
            return

        device = self.devices.active_device
        e = self.evdev.ecodes
        trigger_codes = {
            int(getattr(e, name))
            for name in ("ABS_Z", "ABS_RZ")
            if isinstance(getattr(e, name, None), int)
        }
        for code in device.capabilities(absinfo=False).get(e.EV_ABS, []):
            try:
                info = device.absinfo(code)
                minimum = int(info.min)
                maximum = int(info.max)
            except (AttributeError, OSError, TypeError, ValueError):
                continue
            if maximum <= minimum:
                continue
            center = (
                minimum
                if int(code) in trigger_codes and minimum >= 0
                else round((minimum + maximum) / 2)
            )
            calibrations[f"{e.EV_ABS}:{int(code)}"] = AxisCalibration(
                minimum=minimum,
                center=center,
                maximum=maximum,
            )
        self.engine.set_default_calibrations(calibrations)

    def _calibration_snapshot(self) -> dict[str, Any]:
        return {
            "values": dict(self.calibration_values),
            "axisRanges": {
                key: {"min": sample["min"], "max": sample["max"]}
                for key, sample in self.calibration_samples.items()
            },
            "pressedButtons": sorted(self.calibration_pressed_buttons),
        }

    def _queue_calibration_snapshot(self) -> None:
        if not self.calibration_active:
            return
        delay = max(0.0, (1 / 60) - (time.monotonic() - self.last_snapshot_emit))
        if delay == 0:
            self.last_snapshot_emit = time.monotonic()
            self._schedule_emit("input_snapshot", self._calibration_snapshot())
        elif not self.calibration_snapshot_task:
            self.calibration_snapshot_task = asyncio.get_running_loop().create_task(
                self._emit_calibration_snapshot_after(delay),
                name="controller1-calibration-snapshot",
            )

    async def _emit_calibration_snapshot_after(self, delay: float) -> None:
        try:
            await asyncio.sleep(delay)
            if self.calibration_active:
                self.last_snapshot_emit = time.monotonic()
                await self.emit("input_snapshot", self._calibration_snapshot())
        finally:
            self.calibration_snapshot_task = None

    async def _cancel_calibration_snapshot(self) -> None:
        if not self.calibration_snapshot_task:
            return
        self.calibration_snapshot_task.cancel()
        await asyncio.gather(self.calibration_snapshot_task, return_exceptions=True)
        self.calibration_snapshot_task = None

    def _queue_calibration_persist(self) -> None:
        if not self.calibration_active or self.calibration_persist_task:
            return
        self.calibration_persist_task = asyncio.get_running_loop().create_task(
            self._persist_calibration_progress_after(0.5),
            name="controller1-calibration-persist",
        )

    async def _persist_calibration_progress_after(self, delay: float) -> None:
        try:
            await asyncio.sleep(delay)
            await self._persist_calibration_progress()
        finally:
            self.calibration_persist_task = None

    async def _persist_calibration_progress(self) -> None:
        if not self.calibration_profile_id or not self.calibration_device_id:
            return
        profile = self._profile(self.calibration_profile_id)
        profile.calibration_runs[self.calibration_device_id] = CalibrationRun(
            axis_ranges={
                key: {"min": sample["min"], "max": sample["max"]}
                for key, sample in self.calibration_samples.items()
            },
            pressed_buttons=set(self.calibration_pressed_buttons),
        )
        self._save_and_reload(profile)

    async def _cancel_calibration_persist(self) -> None:
        if not self.calibration_persist_task:
            return
        self.calibration_persist_task.cancel()
        await asyncio.gather(self.calibration_persist_task, return_exceptions=True)
        self.calibration_persist_task = None

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
        self._debug(
            "devices_changed",
            count=len(devices),
            devices=[
                {"id": item["id"], "name": item["name"], "path": item["path"]}
                for item in devices
            ],
        )
        self._schedule_emit("devices_changed", devices)

    def _on_disconnect(self) -> None:
        self._debug("physical_disconnect")
        if self.engine:
            self.engine.release_all()
        if self.calibration_active:
            self._schedule_calibration_persist_now()

    def _on_connection_changed(self) -> None:
        self._schedule_status_changed()

    def _schedule_calibration_persist_now(self) -> None:
        if self.calibration_persist_task:
            return
        self.calibration_persist_task = asyncio.get_running_loop().create_task(
            self._persist_calibration_progress_after(0),
            name="controller1-calibration-persist",
        )

    def _event_name(self, event_type: int, code: int) -> str:
        if not self.evdev:
            return str(code)
        name = self.evdev.ecodes.bytype.get(event_type, {}).get(code, str(code))
        return name[0] if isinstance(name, list) else str(name)

    def _on_output_emit(
        self, kind: str, code: str, value: int, emitted: bool
    ) -> None:
        if emitted:
            self.output_event_count += 1
        else:
            self.dropped_output_count += 1
        self.debug_outputs.append(
            {
                "at": self._timestamp(),
                "kind": kind,
                "code": code,
                "value": value,
                "emitted": emitted,
            }
        )

    def _debug(self, event: str, **details: Any) -> None:
        self.debug_lifecycle.append(
            {"at": self._timestamp(), "event": event, **details}
        )

    def _timestamp(self) -> str:
        return datetime.now(timezone.utc).isoformat(timespec="milliseconds")

    def _task_state(self, task: asyncio.Task[Any] | None) -> str:
        if task is None:
            return "missing"
        if task.cancelled():
            return "cancelled"
        if task.done():
            error = task.exception()
            return f"failed: {error}" if error else "completed"
        return "running"

    def _virtual_path(self, output: Any | None) -> str | None:
        return getattr(getattr(output, "device", None), "path", None)

    def _describe_virtual_output(self, output: Any | None) -> dict[str, Any]:
        if output is None:
            return {"open": False}
        device = getattr(output, "device", None)
        path = getattr(device, "path", None)
        details: dict[str, Any] = {
            "open": True,
            "configured": {
                "name": getattr(output, "name", None),
                "phys": getattr(output, "phys", None),
                "bus": getattr(output, "bustype", None),
                "vendor": getattr(output, "vendor", None),
                "product": getattr(output, "product", None),
                "version": getattr(output, "version", None),
            },
            "devnode": path,
        }
        if device is not None:
            info = getattr(device, "info", None)
            details["kernel"] = {
                "name": getattr(device, "name", None),
                "phys": getattr(device, "phys", None),
                "bus": getattr(info, "bustype", None),
                "vendor": getattr(info, "vendor", None),
                "product": getattr(info, "product", None),
                "version": getattr(info, "version", None),
            }
            try:
                details["capabilities"] = device.capabilities(absinfo=False)
            except (OSError, TypeError, ValueError) as error:
                details["capabilitiesError"] = str(error)
        if path:
            details["node"] = self._describe_device_node(path)
        return details

    def _describe_device_node(self, path: str) -> dict[str, Any]:
        result: dict[str, Any] = {}
        try:
            node = os.stat(path)
            result.update(
                {
                    "mode": stat.filemode(node.st_mode),
                    "modeOctal": oct(stat.S_IMODE(node.st_mode)),
                    "uid": node.st_uid,
                    "gid": node.st_gid,
                }
            )
        except OSError as error:
            result["statError"] = str(error)
        try:
            import pyudev

            udev_device = pyudev.Devices.from_device_file(pyudev.Context(), path)
            result["udev"] = {
                str(key): str(value)
                for key, value in udev_device.properties.items()
                if key.startswith("ID_INPUT")
                or key in {"DEVNAME", "DEVPATH", "TAGS", "CURRENT_TAGS"}
            }
        except (ImportError, OSError, ValueError) as error:
            result["udevError"] = str(error)
        getfacl = Path("/usr/bin/getfacl")
        if getfacl.exists():
            try:
                completed = subprocess.run(
                    [str(getfacl), "-cp", path],
                    check=False,
                    timeout=2,
                    capture_output=True,
                    text=True,
                )
                result["acl"] = completed.stdout.strip() or completed.stderr.strip()
            except (OSError, subprocess.SubprocessError) as error:
                result["aclError"] = str(error)
        return result

    def _schedule_emit(self, event: str, *args: Any) -> None:
        task = asyncio.get_running_loop().create_task(self.emit(event, *args))
        self.emit_tasks.add(task)
        task.add_done_callback(self._finish_emit)

    def _schedule_status_changed(self) -> None:
        task = asyncio.get_running_loop().create_task(self._emit_status_changed())
        self.emit_tasks.add(task)
        task.add_done_callback(self._finish_emit)

    async def _emit_status_changed(self) -> None:
        await self.emit("status_changed", await self.get_status())

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

    def _validate_output_name(self, value: str, label: str) -> str:
        if not isinstance(value, str):
            raise ValueError(f"{label} output name must be a string")
        name = value.strip()
        if not name:
            raise ValueError(f"{label} output name cannot be empty")
        if len(name) > 80:
            raise ValueError(f"{label} output name cannot exceed 80 characters")
        return name

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
