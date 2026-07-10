import asyncio
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).parents[1] / "backend"))

from controller1.devices import DeviceManager


class FakeAbsInfo:
    def __init__(self, **kwargs):
        self.__dict__.update(kwargs)


class FakeInputDevice:
    def __init__(self):
        self.path = "/dev/input/event0"
        self.name = "Example Gamepad"
        self.phys = "usb-0000:00:14.0-1/input0"
        self.uniq = ""
        self.info = SimpleNamespace(bustype=3, vendor=0x045E, product=0x028E, version=0x0111)
        self.closed = False
        self.ungrabbed = False

    def capabilities(self, verbose=False, absinfo=True):
        e = FakeEvdev.ecodes
        if absinfo:
            return {
                e.EV_KEY: [304, 305],
                e.EV_ABS: [(0, FakeAbsInfo(min=0, max=255)), (1, FakeAbsInfo(min=0, max=255))],
            }
        return {
            e.EV_KEY: [304, 305],
            e.EV_ABS: [0, 1, 2, 3],
        }

    async def async_read_loop(self):
        yield SimpleNamespace(type=1, code=304, value=1)

    def ungrab(self):
        self.ungrabbed = True

    def close(self):
        self.closed = True


class FakeEvdev:
    ecodes = SimpleNamespace(
        EV_KEY=1,
        EV_ABS=3,
        BTN_JOYSTICK=0x120,
        BTN_DIGI=0x140,
        BTN_MISC=0x100,
        ABS_X=0,
        ABS_Y=1,
        ABS_Z=2,
        ABS_RX=3,
        bytype={1: {304: "BTN_SOUTH"}, 3: {0: "ABS_X", 1: "ABS_Y", 2: "ABS_Z", 3: "ABS_RX"}},
    )

    @staticmethod
    def list_devices():
        return ["/dev/input/event0"]

    @staticmethod
    def InputDevice(path):
        return FakeInputDevice()


class DeviceManagerTests(unittest.TestCase):
    def test_scan_accepts_evdev_19_absinfo_tuples(self):
        devices = []
        manager = DeviceManager(
            FakeEvdev,
            lambda _event: None,
            devices.extend,
            lambda: None,
        )

        found = asyncio.run(manager.scan())

        self.assertEqual(len(found), 1)
        self.assertEqual(found[0]["name"], "Example Gamepad")
        self.assertEqual(found[0]["axes"][0]["name"], "ABS_X")

    def test_parse_capability_bitmap(self):
        manager = DeviceManager(FakeEvdev, lambda _event: None, lambda _devices: None, lambda: None)
        self.assertEqual(manager._parse_capability_bitmap("3 0 0"), [0, 1])

    def test_reader_releases_device_and_notifies_on_disconnect(self):
        events = []
        disconnects = []
        evdev = SimpleNamespace(ecodes=SimpleNamespace(EV_KEY=1, EV_ABS=3))
        manager = DeviceManager(
            evdev,
            events.append,
            lambda _devices: None,
            lambda: disconnects.append(True),
        )
        device = FakeInputDevice()
        manager.active_device = device

        asyncio.run(manager._read_loop(device))

        self.assertEqual(len(events), 1)
        self.assertTrue(device.ungrabbed)
        self.assertTrue(device.closed)
        self.assertIsNone(manager.active_device)
        self.assertEqual(disconnects, [True])


if __name__ == "__main__":
    unittest.main()
