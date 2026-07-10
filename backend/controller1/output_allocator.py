from __future__ import annotations

from copy import deepcopy

from .models import Action, LogicalControl, Profile


STANDARD_BUTTONS = (
    "BTN_SOUTH", "BTN_EAST", "BTN_NORTH", "BTN_WEST",
    "BTN_TL", "BTN_TR", "BTN_TL2", "BTN_TR2",
    "BTN_SELECT", "BTN_START", "BTN_MODE", "BTN_THUMBL", "BTN_THUMBR",
)
STANDARD_AXES = (
    "ABS_X", "ABS_Y", "ABS_RX", "ABS_RY",
    "ABS_Z", "ABS_RZ", "ABS_HAT0X", "ABS_HAT0Y",
)
EXTENDED_BUTTONS = tuple(f"BTN_TRIGGER_HAPPY{index}" for index in range(1, 33))
HYBRID_KEYS = tuple(f"KEY_F{index}" for index in range(13, 25)) + tuple(
    f"KEY_{letter}" for letter in "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
)


def _used_actions(profile: Profile) -> set[tuple[str, str]]:
    used: set[tuple[str, str]] = set()
    for binding in profile.bindings:
        used.add((binding.action.type, binding.action.code))
    for control in profile.logical_controls:
        if control.action:
            used.add((control.action.type, control.action.code))
        for position in control.positions:
            if position.action:
                used.add((position.action.type, position.action.code))
    return used


def allocate_logical_control(profile: Profile, value: LogicalControl) -> LogicalControl:
    control = deepcopy(value)
    used = _used_actions(profile)
    if control.kind == "analog":
        if control.action is None:
            code = next(
                (item for item in STANDARD_AXES if ("gamepadAxis", item) not in used),
                None,
            )
            if code is None:
                raise ValueError("no virtual analog outputs remain")
            control.action = Action("gamepadAxis", code=code)
        return control

    choices: list[tuple[str, str]] = [
        ("gamepadButton", code) for code in STANDARD_BUTTONS
    ]
    if profile.output_mode in {"extended", "hybrid"}:
        choices.extend(("gamepadButton", code) for code in EXTENDED_BUTTONS)
    if profile.output_mode == "hybrid":
        choices.extend(("key", code) for code in HYBRID_KEYS)

    for position in control.positions:
        if position.action is not None:
            continue
        allocated = next((item for item in choices if item not in used), None)
        if allocated is None:
            raise ValueError(f"no {profile.output_mode} outputs remain")
        output_type, code = allocated
        position.action = Action(output_type, code=code)
        used.add(allocated)
    return control
