import asyncio
import sys
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).parents[1] / "backend"))

from controller1.service import ControllerService


class FakeLogger:
    def error(self, _message):
        pass

    def warning(self, _message):
        pass


class FakeInputDevice:
    path = "/dev/input/event0"

    def capabilities(self, absinfo=False):
        return {3: [0], 1: [304, 305]}

    def absinfo(self, code):
        assert code == 0
        return SimpleNamespace(value=10, min=-100, max=100)

    def active_keys(self):
        return [305]


class FakeEngine:
    def __init__(self):
        self.raw_state = {}
        self.profile = None

    def process(self, event_type, code, value):
        self.raw_state[f"{event_type}:{code}"] = value

    def set_profile(self, profile):
        self.profile = profile

    def release_all(self):
        pass


class FakeDevices:
    def __init__(self, device):
        self.active_device = device
        self.devices = {"device": {"path": device.path, "active": True}}

    async def stop(self):
        pass


class FakeOutputs:
    def __init__(self):
        self.gamepad_name = "Controller1 Virtual Gamepad"
        self.keyboard_name = "Controller1 Virtual Keyboard and Mouse"
        self.opened = True
        self.close_count = 0

    def open(self):
        self.opened = True

    def close(self):
        self.opened = False
        self.close_count += 1


class SelectableDevices(FakeDevices):
    def __init__(self, device):
        super().__init__(device)
        self.selections = []

    async def select(self, device_id):
        self.selections.append(device_id)


class ControllerServiceTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.events = []

        async def emit(event, *args):
            self.events.append((event, *args))

        self.service = ControllerService(
            self.directory.name,
            emit,
            FakeLogger(),
        )
        self.service.store.load()

    async def asyncTearDown(self):
        await self.service.stop()
        self.directory.cleanup()

    async def test_output_names_are_trimmed_persisted_and_reported(self):
        status = await self.service.set_output_names("  Custom Pad  ", " Custom Keys ")

        self.assertEqual(status["outputGamepadName"], "Custom Pad")
        self.assertEqual(status["outputKeyboardName"], "Custom Keys")
        self.assertEqual(self.service.store.state["outputGamepadName"], "Custom Pad")
        self.assertEqual(self.events[-1][0], "status_changed")

        with self.assertRaises(ValueError):
            await self.service.set_output_names("", "Valid")
        with self.assertRaises(ValueError):
            await self.service.set_output_names("x" * 81, "Valid")

    async def test_output_names_recreate_outputs_and_reselect_device_when_enabled(self):
        profile = self.service.store.active_profile
        profile.device_id = "configured-device"
        self.service.store.replace_profile(profile)
        self.service.store.state["enabled"] = True
        self.service.outputs = FakeOutputs()
        self.service.devices = SelectableDevices(FakeInputDevice())
        self.service.engine = FakeEngine()

        await self.service.set_output_names("New Pad", "New Keys")

        self.assertEqual(self.service.outputs.gamepad_name, "New Pad")
        self.assertEqual(self.service.outputs.keyboard_name, "New Keys")
        self.assertTrue(self.service.outputs.opened)
        self.assertEqual(self.service.outputs.close_count, 1)
        self.assertEqual(self.service.devices.selections, [None, "configured-device"])

    async def test_calibration_emits_aggregated_session_snapshot(self):
        device = FakeInputDevice()
        self.service.evdev = SimpleNamespace(
            ecodes=SimpleNamespace(
                EV_KEY=1,
                EV_ABS=3,
                bytype={1: {304: "BTN_SOUTH", 305: "BTN_EAST"}, 3: {0: "ABS_X"}},
            )
        )
        self.service.devices = FakeDevices(device)
        self.service.engine = FakeEngine()
        profile = self.service.store.active_profile
        profile.device_id = "device"
        self.service.store.replace_profile(profile)

        await self.service.begin_calibration(
            [{"eventType": 3, "code": 0, "name": "ABS_X"}]
        )
        self.assertTrue((await self.service.get_status())["calibrating"])

        self.service._on_input(SimpleNamespace(type=3, code=0, value=-50))
        self.service._on_input(SimpleNamespace(type=1, code=304, value=1))
        self.service._on_input(SimpleNamespace(type=3, code=0, value=75))
        await asyncio.sleep(0.51)
        saved_run = self.service.store.active_profile.calibration_runs["device"]
        self.assertEqual(saved_run.axis_ranges["3:0"], {"min": -50, "max": 75})
        self.assertEqual(saved_run.pressed_buttons, {"1:304", "1:305"})
        profile = await self.service.finish_calibration(
            self.service.store.active_profile.id,
            {"3:0": 5},
        )
        await asyncio.sleep(0)

        snapshots = [args[0] for event, *args in self.events if event == "input_snapshot"]
        self.assertEqual(snapshots[0]["values"]["1:304"], 0)
        self.assertEqual(snapshots[0]["values"]["1:305"], 1)
        final = snapshots[-1]
        self.assertEqual(final["values"]["3:0"], 75)
        self.assertEqual(final["values"]["1:304"], 1)
        self.assertEqual(final["values"]["1:305"], 1)
        self.assertEqual(final["axisRanges"]["3:0"], {"min": -50, "max": 75})
        self.assertEqual(final["pressedButtons"], ["1:304", "1:305"])
        self.assertEqual(profile["calibrations"]["3:0"]["min"], -50)
        self.assertEqual(profile["calibrations"]["3:0"]["center"], 5)
        self.assertEqual(profile["calibrations"]["3:0"]["max"], 75)
        self.assertEqual(
            profile["calibrationRuns"]["device"]["axisRanges"]["3:0"],
            {"min": -50, "max": 75},
        )
        self.assertEqual(
            profile["calibrationRuns"]["device"]["pressedButtons"],
            ["1:304", "1:305"],
        )
        self.assertFalse((await self.service.get_status())["calibrating"])

    async def test_live_snapshot_keeps_trailing_axis_and_button_state(self):
        self.service.engine = FakeEngine()
        self.service.last_live_snapshot_emit = time.monotonic()

        self.service._on_input(SimpleNamespace(type=3, code=0, value=-100))
        self.service._on_input(SimpleNamespace(type=3, code=0, value=100))
        self.service._on_input(SimpleNamespace(type=1, code=304, value=1))
        self.service._on_input(SimpleNamespace(type=1, code=304, value=0))
        await asyncio.sleep(0.03)

        snapshots = [args[0] for event, *args in self.events if event == "input_snapshot"]
        self.assertGreaterEqual(len(snapshots), 1)
        self.assertEqual(snapshots[-1]["values"]["3:0"], 100)
        self.assertEqual(snapshots[-1]["values"]["1:304"], 0)


if __name__ == "__main__":
    unittest.main()
