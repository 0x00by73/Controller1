from __future__ import annotations

from typing import Any


class VirtualOutputs:
    GAMEPAD_NAME = "Controller1 Virtual Gamepad"
    KEYBOARD_NAME = "Controller1 Virtual Keyboard and Mouse"
    PHYS = "controller1/virtual"

    def __init__(self, evdev_module: Any) -> None:
        self.evdev = evdev_module
        self.gamepad: Any | None = None
        self.keyboard: Any | None = None

    def open(self) -> None:
        if self.gamepad or self.keyboard:
            return
        e = self.evdev.ecodes
        abs_info = self.evdev.AbsInfo
        gamepad_caps = {
            e.EV_KEY: [
                e.BTN_SOUTH, e.BTN_EAST, e.BTN_NORTH, e.BTN_WEST,
                e.BTN_TL, e.BTN_TR, e.BTN_TL2, e.BTN_TR2,
                e.BTN_SELECT, e.BTN_START, e.BTN_MODE,
                e.BTN_THUMBL, e.BTN_THUMBR,
            ],
            e.EV_ABS: [
                (e.ABS_X, abs_info(0, -32768, 32767, 128, 256, 0)),
                (e.ABS_Y, abs_info(0, -32768, 32767, 128, 256, 0)),
                (e.ABS_RX, abs_info(0, -32768, 32767, 128, 256, 0)),
                (e.ABS_RY, abs_info(0, -32768, 32767, 128, 256, 0)),
                (e.ABS_Z, abs_info(0, 0, 255, 0, 0, 0)),
                (e.ABS_RZ, abs_info(0, 0, 255, 0, 0, 0)),
                (e.ABS_HAT0X, abs_info(0, -1, 1, 0, 0, 0)),
                (e.ABS_HAT0Y, abs_info(0, -1, 1, 0, 0, 0)),
            ],
        }
        key_max = getattr(e, "KEY_MAX", 0x2FF)
        keyboard_keys = {
            int(value)
            for name, value in vars(e).items()
            if name.startswith("KEY_")
            and name not in {"KEY_MAX", "KEY_CNT"}
            and isinstance(value, int)
            and 0 < value <= key_max
        }
        keyboard_keys.update(
            getattr(e, name)
            for name in (
                "BTN_LEFT", "BTN_RIGHT", "BTN_MIDDLE", "BTN_SIDE",
                "BTN_EXTRA", "BTN_FORWARD", "BTN_BACK", "BTN_TASK",
            )
            if hasattr(e, name)
        )
        keyboard_caps = {
            e.EV_KEY: sorted(keyboard_keys),
            e.EV_REL: [e.REL_X, e.REL_Y, e.REL_WHEEL, e.REL_HWHEEL],
        }
        try:
            self.gamepad = self.evdev.UInput(
                gamepad_caps,
                name=self.GAMEPAD_NAME,
                vendor=0x045E,
                product=0x028E,
                version=0x0114,
                bustype=e.BUS_USB,
                phys=self.PHYS,
            )
            self.keyboard = self.evdev.UInput(
                keyboard_caps,
                name=self.KEYBOARD_NAME,
                vendor=0x1209,
                product=0xC101,
                version=1,
                bustype=e.BUS_USB,
                phys=self.PHYS,
            )
        except (OSError, ValueError):
            self.close()
            raise

    def close(self) -> None:
        for device in (self.gamepad, self.keyboard):
            if device:
                try:
                    device.close()
                except OSError:
                    pass
        self.gamepad = None
        self.keyboard = None

    def _code(self, name: str) -> int:
        value = getattr(self.evdev.ecodes, name, None)
        if value is None:
            raise ValueError(f"unknown Linux input code: {name}")
        return int(value)

    def key(self, code: str, pressed: bool) -> None:
        if not self.keyboard:
            return
        self.keyboard.write(self.evdev.ecodes.EV_KEY, self._code(code), int(pressed))
        self.keyboard.syn()

    def key_combo(self, codes: list[str], pressed: bool) -> None:
        if not self.keyboard:
            return
        ordered = codes if pressed else list(reversed(codes))
        for code in ordered:
            self.keyboard.write(self.evdev.ecodes.EV_KEY, self._code(code), int(pressed))
        self.keyboard.syn()

    def mouse_button(self, code: str, pressed: bool) -> None:
        self.key(code, pressed)

    def mouse_move(self, code: str, amount: int) -> None:
        if not self.keyboard or amount == 0:
            return
        self.keyboard.write(self.evdev.ecodes.EV_REL, self._code(code), amount)
        self.keyboard.syn()

    def gamepad_button(self, code: str, pressed: bool) -> None:
        if not self.gamepad:
            return
        self.gamepad.write(self.evdev.ecodes.EV_KEY, self._code(code), int(pressed))
        self.gamepad.syn()

    def gamepad_axis(self, code: str, normalized: float) -> None:
        if not self.gamepad:
            return
        axis = self._code(code)
        if axis in (self.evdev.ecodes.ABS_Z, self.evdev.ecodes.ABS_RZ):
            value = round(max(0.0, min(1.0, normalized)) * 255)
        elif axis in (self.evdev.ecodes.ABS_HAT0X, self.evdev.ecodes.ABS_HAT0Y):
            value = round(max(-1.0, min(1.0, normalized)))
        else:
            value = round(max(-1.0, min(1.0, normalized)) * 32767)
        self.gamepad.write(self.evdev.ecodes.EV_ABS, axis, value)
        self.gamepad.syn()

    def release_all(self, active_actions: list[tuple[str, list[str]]]) -> None:
        for action_type, codes in active_actions:
            try:
                if action_type == "key":
                    self.key(codes[0], False)
                elif action_type == "keyCombo":
                    self.key_combo(codes, False)
                elif action_type == "mouseButton":
                    self.mouse_button(codes[0], False)
                elif action_type == "gamepadButton":
                    self.gamepad_button(codes[0], False)
            except (ValueError, OSError):
                pass
