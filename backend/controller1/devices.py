from __future__ import annotations

import asyncio
import hashlib
from collections.abc import Callable
from typing import Any


class DeviceManager:
    def __init__(
        self,
        evdev_module: Any,
        on_event: Callable[[Any], None],
        on_devices_changed: Callable[[list[dict[str, Any]]], None],
        on_disconnect: Callable[[], None],
        logger: Any | None = None,
    ) -> None:
        self.evdev = evdev_module
        self.on_event = on_event
        self.on_devices_changed = on_devices_changed
        self.on_disconnect = on_disconnect
        self.logger = logger
        self.devices: dict[str, dict[str, Any]] = {}
        self.selected_id: str | None = None
        self.active_device: Any | None = None
        self.reader_task: asyncio.Task[None] | None = None
        self.scan_task: asyncio.Task[None] | None = None
        self.wake = asyncio.Event()
        self.observer: Any | None = None
        self.running = False
        self.selection_generation = 0
        self.attach_lock = asyncio.Lock()

    async def start(self) -> None:
        self.running = True
        self._start_udev_observer()
        await self.scan()
        self.scan_task = asyncio.create_task(self._scan_loop(), name="controller1-hotplug")

    async def stop(self) -> None:
        self.running = False
        if self.observer:
            self.observer.stop()
            self.observer = None
        if self.scan_task:
            self.scan_task.cancel()
            await asyncio.gather(self.scan_task, return_exceptions=True)
            self.scan_task = None
        await self._detach()

    async def select(self, device_id: str | None) -> None:
        self.selection_generation += 1
        self.selected_id = device_id
        await self._detach()
        if device_id:
            await self._attach_selected(self.selection_generation)

    async def scan(self) -> list[dict[str, Any]]:
        discovered: dict[str, dict[str, Any]] = {}
        for path in self.evdev.list_devices():
            device = None
            try:
                device = self.evdev.InputDevice(path)
                if self._is_candidate(device):
                    info = self._describe(device)
                    discovered[info["id"]] = info
            except OSError:
                continue
            finally:
                if device:
                    device.close()
        changed = discovered != self.devices
        self.devices = discovered
        if changed:
            self.on_devices_changed(list(discovered.values()))
        if self.selected_id and not self.active_device:
            await self._attach_selected(self.selection_generation)
        elif self.active_device and self.selected_id not in discovered:
            await self._detach()
        return list(discovered.values())

    def _is_candidate(self, device: Any) -> bool:
        if device.name.startswith("Controller1 Virtual"):
            return False
        if device.phys == "controller1/virtual":
            return False
        caps = device.capabilities()
        e = self.evdev.ecodes
        keys = set(caps.get(e.EV_KEY, []))
        has_gamepad_keys = any(
            getattr(e, "BTN_JOYSTICK", 0x120)
            <= code
            < getattr(e, "BTN_DIGI", 0x140)
            for code in keys
        )
        joystick_axes = {
            getattr(e, name)
            for name in (
                "ABS_X", "ABS_Y", "ABS_Z", "ABS_RX", "ABS_RY", "ABS_RZ",
                "ABS_THROTTLE", "ABS_RUDDER", "ABS_WHEEL", "ABS_GAS", "ABS_BRAKE",
                "ABS_HAT0X", "ABS_HAT0Y",
            )
            if hasattr(e, name)
        }
        axes = set(caps.get(e.EV_ABS, []))
        return has_gamepad_keys or len(axes & joystick_axes) >= 4

    def _describe(self, device: Any) -> dict[str, Any]:
        info = device.info
        stable = "|".join(
            [
                f"{info.bustype:04x}",
                f"{info.vendor:04x}",
                f"{info.product:04x}",
                device.uniq or "",
                device.phys or "",
                device.name or "",
            ]
        )
        device_id = hashlib.sha256(stable.encode("utf-8")).hexdigest()[:20]
        caps = device.capabilities()
        e = self.evdev.ecodes
        axes = [
            {"code": int(code), "name": self._event_name(e.EV_ABS, int(code))}
            for code in caps.get(e.EV_ABS, [])
        ]
        buttons = [
            {"code": int(code), "name": self._event_name(e.EV_KEY, int(code))}
            for code in caps.get(e.EV_KEY, [])
            if int(code) >= getattr(e, "BTN_MISC", 0x100)
        ]
        return {
            "id": device_id,
            "path": device.path,
            "name": device.name,
            "phys": device.phys,
            "uniq": device.uniq,
            "bus": info.bustype,
            "vendor": info.vendor,
            "product": info.product,
            "version": info.version,
            "axes": axes,
            "buttons": buttons,
            "active": bool(self.active_device and self.active_device.path == device.path),
        }

    async def _attach_selected(self, generation: int) -> None:
        async with self.attach_lock:
            for attempt in range(8):
                if generation != self.selection_generation or self.active_device:
                    return
                info = self.devices.get(self.selected_id or "")
                if not info:
                    return
                device = None
                try:
                    device = self.evdev.InputDevice(info["path"])
                    device.grab()
                    if generation != self.selection_generation:
                        device.ungrab()
                        device.close()
                        return
                    self.active_device = device
                    self.reader_task = asyncio.create_task(
                        self._read_loop(device), name="controller1-input"
                    )
                    self._log("info", f"Grabbed {device.name} at {device.path}")
                    return
                except OSError as error:
                    if device:
                        device.close()
                    if attempt == 7:
                        self._log("error", f"Could not grab {info['name']}: {error}")
                        return
                    await asyncio.sleep(0.25 * (attempt + 1))

    async def _detach(self) -> None:
        if self.reader_task:
            self.reader_task.cancel()
            await asyncio.gather(self.reader_task, return_exceptions=True)
            self.reader_task = None
        if self.active_device:
            try:
                self.active_device.ungrab()
            except OSError:
                pass
            self.active_device.close()
            self.active_device = None

    async def _read_loop(self, device: Any) -> None:
        try:
            async for event in device.async_read_loop():
                e = self.evdev.ecodes
                if event.type in (e.EV_KEY, e.EV_ABS):
                    self.on_event(event)
        except asyncio.CancelledError:
            raise
        except OSError as error:
            self._log("warning", f"Input device disconnected: {error}")
        finally:
            if self.active_device is device:
                try:
                    device.ungrab()
                except OSError:
                    pass
                device.close()
                self.active_device = None
                self.on_disconnect()
                self.wake.set()

    async def _scan_loop(self) -> None:
        while self.running:
            try:
                await asyncio.wait_for(self.wake.wait(), timeout=1.0)
            except TimeoutError:
                pass
            self.wake.clear()
            await self.scan()

    def _start_udev_observer(self) -> None:
        try:
            import pyudev

            loop = asyncio.get_running_loop()
            monitor = pyudev.Monitor.from_netlink(pyudev.Context())
            monitor.filter_by(subsystem="input")
            self.observer = pyudev.MonitorObserver(
                monitor,
                callback=lambda _action, _device: loop.call_soon_threadsafe(self.wake.set),
                name="controller1-udev",
            )
            self.observer.start()
        except (ImportError, OSError) as error:
            self._log("warning", f"pyudev unavailable; using one-second hotplug polling: {error}")

    def _event_name(self, event_type: int, code: int) -> str:
        name = self.evdev.ecodes.bytype.get(event_type, {}).get(code, str(code))
        return name[0] if isinstance(name, list) else str(name)

    def _log(self, level: str, message: str) -> None:
        if self.logger:
            getattr(self.logger, level)(message)
