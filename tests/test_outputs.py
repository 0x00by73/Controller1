import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).parents[1] / "backend"))

from controller1.outputs import VirtualOutputs


class FakeUInput:
    created = []

    def __init__(self, capabilities, **kwargs):
        self.capabilities = capabilities
        self.kwargs = kwargs
        self.closed = False
        self.events = []
        self.created.append(self)

    def write(self, event_type, code, value):
        self.events.append((event_type, code, value))

    def syn(self):
        self.events.append(("syn",))

    def close(self):
        self.closed = True


def fake_evdev():
    names = {
        "EV_KEY": 1,
        "EV_ABS": 3,
        "EV_REL": 2,
        "BUS_USB": 3,
        "KEY_A": 30,
        "KEY_SPACE": 57,
        "KEY_MAX": 0x2FF,
        "BTN_0": 256,
        "BTN_TRIGGER": 288,
        "BTN_TRIGGER_HAPPY1": 704,
        "ABS_THROTTLE": 20,
    }
    for index, name in enumerate(VirtualOutputs.GAMEPAD_BUTTON_NAMES, start=304):
        names[name] = index
    for index, name in enumerate(VirtualOutputs.GAMEPAD_AXIS_NAMES):
        names[name] = index
    for index, name in enumerate(VirtualOutputs.MOUSE_BUTTON_NAMES, start=272):
        names[name] = index
    for index, name in enumerate(VirtualOutputs.MOUSE_MOVE_NAMES):
        names[name] = index
    bytype = {
        names["EV_KEY"]: {
            **{
                names[name]: name
                for name in VirtualOutputs.GAMEPAD_BUTTON_NAMES
            },
            names["BTN_0"]: "BTN_0",
            names["BTN_TRIGGER"]: ("BTN_JOYSTICK", "BTN_TRIGGER"),
            names["BTN_TRIGGER_HAPPY1"]: "BTN_TRIGGER_HAPPY1",
        },
        names["EV_ABS"]: {
            **{
                names[name]: name
                for name in VirtualOutputs.GAMEPAD_AXIS_NAMES
            },
            names["ABS_THROTTLE"]: "ABS_THROTTLE",
        },
    }
    return SimpleNamespace(
        ecodes=SimpleNamespace(**names, bytype=bytype),
        AbsInfo=lambda *values: values,
        UInput=FakeUInput,
    )


class VirtualOutputsTests(unittest.TestCase):
    def setUp(self):
        FakeUInput.created.clear()

    def test_custom_names_are_used_when_opening(self):
        outputs = VirtualOutputs(fake_evdev(), "Custom Pad", "Custom Keys")

        outputs.open()

        self.assertEqual(FakeUInput.created[0].kwargs["name"], "Custom Pad")
        self.assertEqual(FakeUInput.created[1].kwargs["name"], "Custom Keys")
        self.assertEqual(FakeUInput.created[0].kwargs["phys"], "controller1/virtual")
        self.assertEqual(FakeUInput.created[1].kwargs["phys"], "controller1/virtual")

    def test_catalog_matches_created_capability_groups(self):
        outputs = VirtualOutputs(fake_evdev())

        catalog = outputs.catalog()

        self.assertIn({"code": "BTN_SOUTH", "name": "BTN_SOUTH"}, catalog["gamepadButton"])
        self.assertIn({"code": "ABS_X", "name": "ABS_X"}, catalog["gamepadAxis"])
        self.assertIn({"code": "KEY_A", "name": "KEY_A"}, catalog["key"])
        self.assertIn({"code": "BTN_LEFT", "name": "BTN_LEFT"}, catalog["mouseButton"])
        self.assertIn({"code": "REL_X", "name": "REL_X"}, catalog["mouseMove"])
        self.assertNotIn(
            {"code": "BTN_LEFT", "name": "BTN_LEFT"},
            catalog["key"],
        )

    def test_standard_input_codes_resolve_to_virtual_controls(self):
        outputs = VirtualOutputs(fake_evdev())
        e = outputs.evdev.ecodes

        self.assertEqual(
            outputs.gamepad_control(e.EV_KEY, e.BTN_SOUTH),
            ("gamepadButton", "BTN_SOUTH"),
        )
        self.assertEqual(
            outputs.gamepad_control(e.EV_ABS, e.ABS_X),
            ("gamepadAxis", "ABS_X"),
        )
        self.assertEqual(
            outputs.gamepad_control(e.EV_KEY, e.BTN_TRIGGER),
            ("gamepadButton", "BTN_SOUTH"),
        )
        self.assertEqual(
            outputs.gamepad_control(e.EV_KEY, e.BTN_0),
            ("gamepadButton", "BTN_SOUTH"),
        )
        self.assertEqual(
            outputs.gamepad_control(e.EV_KEY, e.BTN_TRIGGER_HAPPY1),
            ("gamepadButton", "BTN_SOUTH"),
        )
        self.assertEqual(
            outputs.gamepad_control(e.EV_ABS, e.ABS_THROTTLE),
            ("gamepadAxis", "ABS_HAT0X"),
        )
        self.assertIsNone(outputs.gamepad_control(e.EV_KEY, e.BTN_LEFT))

    def test_successful_virtual_writes_are_reported(self):
        emitted = []
        outputs = VirtualOutputs(
            fake_evdev(),
            on_emit=lambda *event: emitted.append(event),
        )
        outputs.open()

        outputs.gamepad_button("BTN_SOUTH", True)
        outputs.gamepad_axis("ABS_X", 0.5)

        self.assertEqual(
            emitted,
            [
                ("gamepadButton", "BTN_SOUTH", 1, True),
                ("gamepadAxis", "ABS_X", 16384, True),
            ],
        )


if __name__ == "__main__":
    unittest.main()
