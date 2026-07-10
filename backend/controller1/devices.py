from __future__ import annotations

import asyncio
import hashlib
from collections.abc import Callable
from pathlib import Path
from typing import Any


def canonical_event_name(evdev_module: Any, event_type: int, code: int) -> str:
    names = evdev_module.ecodes.bytype.get(event_type, {}).get(code, str(code))
    if not isinstance(names, (list, tuple)):
        return str(names)
    if not names:
        return str(code)
    categories = {"BTN_JOYSTICK", "BTN_GAMEPAD", "BTN_DIGI", "BTN_WHEEL"}
    return str(next((name for name in names if name not in categories), names[0]))


class DeviceManager:
    def __init__(
        self,
        evdev_module: Any,
        on_event: Callable[[Any], None],
        on_devices_changed: Callable[[list[dict[str, Any]]], None],
        on_disconnect: Callable[[], None],
        logger: Any | None = None,
        on_connection_changed: Callable[[], None] | None = None,
    ) -> None:
        self.evdev = evdev_module
        self.on_event = on_event
        self.on_devices_changed = on_devices_changed
        self.on_disconnect = on_disconnect
        self.logger = logger
        self.on_connection_changed = on_connection_changed
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
            attached = await self._attach_selected(self.selection_generation)
            if not attached:
                info = self.devices.get(device_id)
                name = info["name"] if info else device_id
                raise RuntimeError(f"Could not capture controller: {name}")

    async def scan(self) -> list[dict[str, Any]]:
        discovered: dict[str, dict[str, Any]] = {}
        for path in self.evdev.list_devices():
            device = None
            try:
                device = self.evdev.InputDevice(path)
                if self._is_candidate(device):
                    info = self._describe(device)
                    discovered[info["id"]] = info
            except OSError as error:
                self._log("info", f"Could not open {path}: {error}")
                info = self._describe_from_sysfs(path)
                if info and self._is_candidate_info(info):
                    discovered[info["id"]] = info
            except Exception as error:
                self._log("warning", f"Skipping {path}: {error}")
            finally:
                if device:
                    device.close()
        changed = self._inventory_signature(discovered) != self._inventory_signature(self.devices)
        self.devices = discovered
        if changed:
            self.on_devices_changed(list(discovered.values()))
        if self.selected_id and not self.active_device:
            await self._attach_selected(self.selection_generation)
        elif self.active_device and self.selected_id not in discovered:
            await self._detach()
        return list(discovered.values())

    @staticmethod
    def _inventory_signature(
        devices: dict[str, dict[str, Any]],
    ) -> tuple[tuple[Any, ...], ...]:
        """Compare topology and capabilities without live input state."""
        return tuple(
            sorted(
                (
                    device_id,
                    info.get("path"),
                    info.get("name"),
                    info.get("phys"),
                    info.get("uniq"),
                    info.get("bus"),
                    info.get("vendor"),
                    info.get("product"),
                    info.get("version"),
                    tuple(
                        (
                            axis.get("code"),
                            axis.get("name"),
                            axis.get("min"),
                            axis.get("max"),
                            axis.get("flat"),
                            axis.get("fuzz"),
                            axis.get("resolution"),
                        )
                        for axis in info.get("axes", [])
                    ),
                    tuple(
                        (button.get("code"), button.get("name"))
                        for button in info.get("buttons", [])
                    ),
                )
                for device_id, info in devices.items()
            )
        )

    def _capabilities(self, device: Any) -> dict[int, list[int]]:
        # evdev 1.9+ defaults absinfo=True, which returns (code, AbsInfo) tuples.
        return device.capabilities(absinfo=False)

    def _is_candidate(self, device: Any) -> bool:
        return self._is_candidate_info(
            {
                "name": device.name or "",
                "phys": device.phys or "",
                "vendor": int(device.info.vendor),
                "product": int(device.info.product),
                "keyCodes": self._capabilities(device).get(self.evdev.ecodes.EV_KEY, []),
                "absCodes": self._capabilities(device).get(self.evdev.ecodes.EV_ABS, []),
            }
        )

    def _is_candidate_info(self, info: dict[str, Any]) -> bool:
        name = str(info.get("name") or "")
        if name.startswith("Controller1 Virtual"):
            return False
        if str(info.get("phys") or "") == "controller1/virtual":
            return False
        # Steam Input's transient Xbox-compatible uinput device is an output,
        # not a physical controller Controller1 should capture.
        if int(info.get("vendor") or 0) == 0x28DE and int(info.get("product") or 0) == 0x11FF:
            return False
        e = self.evdev.ecodes
        keys = {int(code) for code in info.get("keyCodes", [])}
        has_gamepad_keys = any(
            getattr(e, "BTN_JOYSTICK", 0x120)
            <= code
            < getattr(e, "BTN_DIGI", 0x140)
            for code in keys
        )
        joystick_axes = {
            getattr(e, axis_name)
            for axis_name in (
                "ABS_X", "ABS_Y", "ABS_Z", "ABS_RX", "ABS_RY", "ABS_RZ",
                "ABS_THROTTLE", "ABS_RUDDER", "ABS_WHEEL", "ABS_GAS", "ABS_BRAKE",
                "ABS_HAT0X", "ABS_HAT0Y",
            )
            if hasattr(e, axis_name)
        }
        axes = {int(code) for code in info.get("absCodes", [])}
        return has_gamepad_keys or len(axes & joystick_axes) >= 4

    def _describe(self, device: Any) -> dict[str, Any]:
        info = device.info
        caps = self._capabilities(device)
        e = self.evdev.ecodes
        axes = self._describe_axes(device, caps.get(e.EV_ABS, []))
        buttons = [
            {"code": int(code), "name": self._event_name(e.EV_KEY, int(code))}
            for code in caps.get(e.EV_KEY, [])
            if int(code) >= getattr(e, "BTN_MISC", 0x100)
        ]
        return self._build_device_info(
            path=str(device.path),
            name=str(device.name or ""),
            phys=str(device.phys or ""),
            uniq=str(device.uniq or ""),
            bustype=int(info.bustype),
            vendor=int(info.vendor),
            product=int(info.product),
            version=int(info.version),
            axes=axes,
            buttons=buttons,
        )

    def _describe_axes(self, device: Any, codes: list[int]) -> list[dict[str, Any]]:
        e = self.evdev.ecodes
        capability_info: dict[int, Any] = {}
        try:
            for item in device.capabilities(absinfo=True).get(e.EV_ABS, []):
                if isinstance(item, tuple) and len(item) >= 2:
                    capability_info[int(item[0])] = item[1]
        except (OSError, TypeError, ValueError):
            pass

        axes = []
        for raw_code in codes:
            code = int(raw_code)
            abs_info = capability_info.get(code)
            if abs_info is None:
                try:
                    abs_info = device.absinfo(code)
                except (AttributeError, OSError, TypeError, ValueError):
                    pass
            value = getattr(abs_info, "value", None)
            axes.append(
                {
                    "code": code,
                    "name": self._event_name(e.EV_ABS, code),
                    "min": getattr(abs_info, "min", None),
                    "max": getattr(abs_info, "max", None),
                    "flat": getattr(abs_info, "flat", None),
                    "fuzz": getattr(abs_info, "fuzz", None),
                    "resolution": getattr(abs_info, "resolution", None),
                    "value": value,
                    "initialValue": value,
                }
            )
        return axes

    def _describe_from_sysfs(self, path: str) -> dict[str, Any] | None:
        sysfs = Path("/sys/class/input") / Path(path).name / "device"
        if not sysfs.is_dir():
            return None
        try:
            bustype = int(self._read_sysfs(sysfs / "id" / "bustype"), 16)
            vendor = int(self._read_sysfs(sysfs / "id" / "vendor"), 16)
            product = int(self._read_sysfs(sysfs / "id" / "product"), 16)
            version = int(self._read_sysfs(sysfs / "id" / "version"), 16)
        except ValueError:
            return None
        name = self._read_sysfs(sysfs / "name")
        phys = self._read_sysfs(sysfs / "phys")
        uniq = self._read_sysfs(sysfs / "uniq")
        e = self.evdev.ecodes
        abs_codes = self._parse_capability_bitmap(self._read_sysfs(sysfs / "capabilities" / "abs"))
        key_codes = self._parse_capability_bitmap(self._read_sysfs(sysfs / "capabilities" / "key"))
        axes = [
            {"code": int(code), "name": self._event_name(e.EV_ABS, int(code))}
            for code in abs_codes
        ]
        buttons = [
            {"code": int(code), "name": self._event_name(e.EV_KEY, int(code))}
            for code in key_codes
            if int(code) >= getattr(e, "BTN_MISC", 0x100)
        ]
        if not self._is_candidate_info(
            {
                "name": name,
                "phys": phys,
                "vendor": vendor,
                "product": product,
                "keyCodes": key_codes,
                "absCodes": abs_codes,
            }
        ):
            return None
        return self._build_device_info(
            path=path,
            name=name,
            phys=phys,
            uniq=uniq,
            bustype=bustype,
            vendor=vendor,
            product=product,
            version=version,
            axes=axes,
            buttons=buttons,
        )

    def _build_device_info(
        self,
        *,
        path: str,
        name: str,
        phys: str,
        uniq: str,
        bustype: int,
        vendor: int,
        product: int,
        version: int,
        axes: list[dict[str, Any]],
        buttons: list[dict[str, Any]],
    ) -> dict[str, Any]:
        stable = "|".join(
            [
                f"{bustype:04x}",
                f"{vendor:04x}",
                f"{product:04x}",
                uniq,
                phys,
                name,
            ]
        )
        device_id = hashlib.sha256(stable.encode("utf-8")).hexdigest()[:20]
        info = {
            "id": device_id,
            "path": path,
            "name": name,
            "phys": phys,
            "uniq": uniq,
            "bus": bustype,
            "vendor": vendor,
            "product": product,
            "version": version,
            "axes": axes,
            "buttons": buttons,
            "active": bool(self.active_device and self.active_device.path == path),
        }
        return info

    def _read_sysfs(self, path: Path) -> str:
        try:
            return path.read_text(encoding="utf-8", errors="replace").strip()
        except OSError:
            return ""

    def _parse_capability_bitmap(self, raw: str) -> list[int]:
        if not raw:
            return []
        codes: list[int] = []
        for word_index, word in enumerate(raw.split()):
            value = int(word, 16)
            for bit in range(32):
                if value & (1 << bit):
                    codes.append(word_index * 32 + bit)
        return codes

    async def _attach_selected(self, generation: int) -> bool:
        async with self.attach_lock:
            for attempt in range(8):
                if generation != self.selection_generation or self.active_device:
                    return self.active_device is not None
                info = self.devices.get(self.selected_id or "")
                if not info:
                    return False
                device = None
                try:
                    device = self.evdev.InputDevice(info["path"])
                    device.grab()
                    if generation != self.selection_generation:
                        device.ungrab()
                        device.close()
                        return False
                    self.active_device = device
                    self.reader_task = asyncio.create_task(
                        self._read_loop(device), name="controller1-input"
                    )
                    if self.on_connection_changed:
                        self.on_connection_changed()
                    self._log("info", f"Grabbed {device.name} at {device.path}")
                    return True
                except OSError as error:
                    if device:
                        device.close()
                    if attempt == 7:
                        self._log("error", f"Could not grab {info['name']}: {error}")
                        return False
                    await asyncio.sleep(0.25 * (attempt + 1))
        return False

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
            if self.on_connection_changed:
                self.on_connection_changed()

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
                if self.on_connection_changed:
                    self.on_connection_changed()
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
        return canonical_event_name(self.evdev, event_type, code)

    def _log(self, level: str, message: str) -> None:
        if self.logger:
            getattr(self.logger, level)(message)
