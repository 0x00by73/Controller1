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
        self.created.append(self)

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
    }
    for index, name in enumerate(VirtualOutputs.GAMEPAD_BUTTON_NAMES, start=304):
        names[name] = index
    for index, name in enumerate(VirtualOutputs.GAMEPAD_AXIS_NAMES):
        names[name] = index
    for index, name in enumerate(VirtualOutputs.MOUSE_BUTTON_NAMES, start=272):
        names[name] = index
    for index, name in enumerate(VirtualOutputs.MOUSE_MOVE_NAMES):
        names[name] = index
    return SimpleNamespace(
        ecodes=SimpleNamespace(**names),
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


if __name__ == "__main__":
    unittest.main()
