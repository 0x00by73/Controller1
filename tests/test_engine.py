import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / "backend"))

from controller1.engine import MappingEngine
from controller1.models import (
    Action,
    AxisCalibration,
    Binding,
    InputRef,
    Predicate,
    Profile,
)


class FakeOutputs:
    def __init__(self):
        self.events = []

    def key(self, code, pressed):
        self.events.append(("key", code, pressed))

    def key_combo(self, codes, pressed):
        self.events.append(("keyCombo", tuple(codes), pressed))

    def mouse_button(self, code, pressed):
        self.events.append(("mouseButton", code, pressed))

    def gamepad_button(self, code, pressed):
        self.events.append(("gamepadButton", code, pressed))

    def gamepad_axis(self, code, value):
        self.events.append(("gamepadAxis", code, value))

    def mouse_move(self, code, value):
        self.events.append(("mouseMove", code, value))


class CalibrationTests(unittest.TestCase):
    def test_asymmetric_axis_is_normalized_around_center(self):
        calibration = AxisCalibration(minimum=100, center=1100, maximum=2100, deadzone=0)
        self.assertEqual(calibration.normalize(100), -1)
        self.assertEqual(calibration.normalize(1100), 0)
        self.assertEqual(calibration.normalize(2100), 1)
        self.assertAlmostEqual(calibration.normalize(1600), 0.5)

    def test_deadzone_expo_and_inversion(self):
        calibration = AxisCalibration(
            minimum=-100, center=0, maximum=100, deadzone=0.1, expo=1, invert=True
        )
        self.assertEqual(calibration.normalize(5), 0)
        self.assertAlmostEqual(calibration.normalize(100), -1)


class MappingEngineTests(unittest.TestCase):
    def setUp(self):
        self.outputs = FakeOutputs()
        self.engine = MappingEngine(self.outputs)

    def test_button_to_key_has_press_and_release_edges(self):
        button = InputRef(1, 304, "BTN_SOUTH")
        profile = Profile(
            name="test",
            bindings=[
                Binding(
                    conditions=[Predicate(button, "pressed")],
                    action=Action("key", code="KEY_ESC"),
                )
            ],
        )
        self.engine.set_profile(profile)
        self.engine.process(1, 304, 1)
        self.engine.process(1, 304, 2)
        self.engine.process(1, 304, 0)
        self.assertEqual(
            self.outputs.events,
            [("key", "KEY_ESC", True), ("key", "KEY_ESC", False)],
        )

    def test_chord_requires_all_inputs(self):
        modifier = InputRef(1, 314, "BTN_SELECT")
        stick = InputRef(3, 4, "ABS_RY")
        profile = Profile(
            name="test",
            calibrations={stick.key: AxisCalibration(-100, 0, 100, deadzone=0)},
            bindings=[
                Binding(
                    conditions=[
                        Predicate(modifier, "pressed"),
                        Predicate(stick, "axisRange", low=-1, high=-0.6),
                    ],
                    action=Action("key", code="KEY_ESC"),
                )
            ],
        )
        self.engine.set_profile(profile)
        self.engine.process(3, 4, -100)
        self.assertEqual(self.outputs.events, [])
        self.engine.process(1, 314, 1)
        self.engine.process(1, 314, 0)
        self.assertEqual(
            self.outputs.events,
            [("key", "KEY_ESC", True), ("key", "KEY_ESC", False)],
        )

    def test_calibrated_axis_is_forwarded(self):
        axis = InputRef(3, 0, "ABS_X")
        profile = Profile(
            name="test",
            calibrations={axis.key: AxisCalibration(100, 1100, 2100, deadzone=0)},
            bindings=[
                Binding(
                    conditions=[],
                    action=Action("gamepadAxis", code="ABS_X", source=axis),
                )
            ],
        )
        self.engine.set_profile(profile)
        self.engine.process(3, 0, 1600)
        self.assertEqual(self.outputs.events, [("gamepadAxis", "ABS_X", 0.5)])

    def test_hold_layer_controls_layer_binding(self):
        modifier = InputRef(1, 314, "BTN_SELECT")
        trigger = InputRef(1, 304, "BTN_SOUTH")
        profile = Profile(
            name="test",
            bindings=[
                Binding(
                    conditions=[Predicate(modifier, "pressed")],
                    action=Action("layer", code="menu"),
                ),
                Binding(
                    layer="menu",
                    conditions=[Predicate(trigger, "pressed")],
                    action=Action("key", code="KEY_ESC"),
                ),
            ],
        )
        self.engine.set_profile(profile)
        self.engine.process(1, 304, 1)
        self.assertEqual(self.outputs.events, [])
        self.engine.process(1, 314, 1)
        self.engine.process(1, 314, 0)
        self.assertEqual(
            self.outputs.events,
            [("key", "KEY_ESC", True), ("key", "KEY_ESC", False)],
        )

    def test_overlapping_bindings_reference_count_output(self):
        first = InputRef(1, 304)
        second = InputRef(1, 305)
        profile = Profile(
            name="test",
            bindings=[
                Binding([Predicate(first)], Action("key", code="KEY_A")),
                Binding([Predicate(second)], Action("key", code="KEY_A")),
            ],
        )
        self.engine.set_profile(profile)
        self.engine.process(1, 304, 1)
        self.engine.process(1, 305, 1)
        self.engine.process(1, 304, 0)
        self.engine.process(1, 305, 0)
        self.assertEqual(
            self.outputs.events,
            [("key", "KEY_A", True), ("key", "KEY_A", False)],
        )

    def test_overlapping_shortcuts_keep_shared_modifier_held(self):
        first = InputRef(1, 304)
        second = InputRef(1, 305)
        profile = Profile(
            name="test",
            bindings=[
                Binding(
                    [Predicate(first)],
                    Action("keyCombo", codes=["KEY_LEFTCTRL", "KEY_C"]),
                ),
                Binding(
                    [Predicate(second)],
                    Action("keyCombo", codes=["KEY_LEFTCTRL", "KEY_V"]),
                ),
            ],
        )
        self.engine.set_profile(profile)
        self.engine.process(1, 304, 1)
        self.engine.process(1, 305, 1)
        self.engine.process(1, 304, 0)
        self.engine.process(1, 305, 0)
        self.assertEqual(
            self.outputs.events,
            [
                ("key", "KEY_LEFTCTRL", True),
                ("key", "KEY_C", True),
                ("key", "KEY_V", True),
                ("key", "KEY_C", False),
                ("key", "KEY_V", False),
                ("key", "KEY_LEFTCTRL", False),
            ],
        )

    def test_conditioned_axis_is_neutralized(self):
        modifier = InputRef(1, 314)
        axis = InputRef(3, 0)
        profile = Profile(
            name="test",
            calibrations={axis.key: AxisCalibration(-100, 0, 100, deadzone=0)},
            bindings=[
                Binding(
                    [Predicate(modifier)],
                    Action("gamepadAxis", code="ABS_X", source=axis),
                )
            ],
        )
        self.engine.set_profile(profile)
        self.engine.process(1, 314, 1)
        self.engine.process(3, 0, 100)
        self.engine.process(1, 314, 0)
        self.assertEqual(
            self.outputs.events,
            [("gamepadAxis", "ABS_X", 1.0), ("gamepadAxis", "ABS_X", 0.0)],
        )


if __name__ == "__main__":
    unittest.main()
