from __future__ import annotations

from typing import Any

from .models import DEFAULT_OUTPUT_GAMEPAD_NAME, DEFAULT_OUTPUT_KEYBOARD_NAME


class VirtualOutputs:
    GAMEPAD_NAME = DEFAULT_OUTPUT_GAMEPAD_NAME
    KEYBOARD_NAME = DEFAULT_OUTPUT_KEYBOARD_NAME
    PHYS = "controller1/virtual"
    GAMEPAD_BUTTON_NAMES = (
        "BTN_SOUTH", "BTN_EAST", "BTN_NORTH", "BTN_WEST",
        "BTN_TL", "BTN_TR", "BTN_TL2", "BTN_TR2",
        "BTN_SELECT", "BTN_START", "BTN_MODE",
        "BTN_THUMBL", "BTN_THUMBR",
    )
    GAMEPAD_AXIS_NAMES = (
        "ABS_X", "ABS_Y", "ABS_RX", "ABS_RY",
        "ABS_Z", "ABS_RZ", "ABS_HAT0X", "ABS_HAT0Y",
    )
    MOUSE_BUTTON_NAMES = (
        "BTN_LEFT", "BTN_RIGHT", "BTN_MIDDLE", "BTN_SIDE",
        "BTN_EXTRA", "BTN_FORWARD", "BTN_BACK", "BTN_TASK",
    )
    MOUSE_MOVE_NAMES = ("REL_X", "REL_Y", "REL_WHEEL", "REL_HWHEEL")

    def __init__(
        self,
        evdev_module: Any,
        gamepad_name: str = GAMEPAD_NAME,
        keyboard_name: str = KEYBOARD_NAME,
    ) -> None:
        self.evdev = evdev_module
        self.gamepad_name = gamepad_name
        self.keyboard_name = keyboard_name
        self.gamepad: Any | None = None
        self.keyboard: Any | None = None

    def open(
        self,
        gamepad_name: str | None = None,
        keyboard_name: str | None = None,
    ) -> None:
        if self.gamepad or self.keyboard:
            return
        if gamepad_name is not None:
            self.gamepad_name = gamepad_name
        if keyboard_name is not None:
            self.keyboard_name = keyboard_name
        e = self.evdev.ecodes
        abs_info = self.evdev.AbsInfo
        gamepad_caps = {
            e.EV_KEY: self._named_codes(self.GAMEPAD_BUTTON_NAMES),
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
        keyboard_keys = set(self._keyboard_codes().values())
        keyboard_keys.update(self._named_codes(self.MOUSE_BUTTON_NAMES))
        keyboard_caps = {
            e.EV_KEY: sorted(keyboard_keys),
            e.EV_REL: self._named_codes(self.MOUSE_MOVE_NAMES),
        }
        try:
            self.gamepad = self.evdev.UInput(
                gamepad_caps,
                name=self.gamepad_name,
                vendor=0x045E,
                product=0x028E,
                version=0x0114,
                bustype=e.BUS_USB,
                phys=self.PHYS,
            )
            self.keyboard = self.evdev.UInput(
                keyboard_caps,
                name=self.keyboard_name,
                vendor=0x1209,
                product=0xC101,
                version=1,
                bustype=e.BUS_USB,
                phys=self.PHYS,
            )
        except (OSError, ValueError):
            self.close()
            raise

    def catalog(self) -> dict[str, list[dict[str, str]]]:
        def entries(names: list[str] | tuple[str, ...]) -> list[dict[str, str]]:
            return [{"code": name, "name": name} for name in names]

        keyboard_names = sorted(self._keyboard_codes())
        return {
            "gamepadButton": entries(
                [name for name in self.GAMEPAD_BUTTON_NAMES if self._has_code(name)]
            ),
            "gamepadAxis": entries(
                [name for name in self.GAMEPAD_AXIS_NAMES if self._has_code(name)]
            ),
            "key": entries(keyboard_names),
            "mouseButton": entries(
                [name for name in self.MOUSE_BUTTON_NAMES if self._has_code(name)]
            ),
            "mouseMove": entries(
                [name for name in self.MOUSE_MOVE_NAMES if self._has_code(name)]
            ),
        }

    def _has_code(self, name: str) -> bool:
        return isinstance(getattr(self.evdev.ecodes, name, None), int)

    def _named_codes(self, names: tuple[str, ...]) -> list[int]:
        return [
            int(getattr(self.evdev.ecodes, name))
            for name in names
            if self._has_code(name)
        ]

    def gamepad_control(self, event_type: int, code: int) -> tuple[str, str] | None:
        e = self.evdev.ecodes
        if event_type == e.EV_KEY:
            allowed = self.GAMEPAD_BUTTON_NAMES
            output_type = "gamepadButton"
        elif event_type == e.EV_ABS:
            allowed = self.GAMEPAD_AXIS_NAMES
            output_type = "gamepadAxis"
        else:
            return None

        names = e.bytype.get(event_type, {}).get(code, ())
        if isinstance(names, str):
            names = (names,)
        for name in names:
            if name in allowed:
                return output_type, name
        return None

    def _keyboard_codes(self) -> dict[str, int]:
        e = self.evdev.ecodes
        key_max = getattr(e, "KEY_MAX", 0x2FF)
        return {
            name: int(value)
            for name, value in vars(e).items()
            if name.startswith("KEY_")
            and name not in {"KEY_MAX", "KEY_CNT"}
            and isinstance(value, int)
            and 0 < value <= key_max
        }

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
