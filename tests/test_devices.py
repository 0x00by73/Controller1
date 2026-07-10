import asyncio
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).parents[1] / "backend"))

from controller1.devices import DeviceManager


class FakeInputDevice:
    def __init__(self):
        self.closed = False
        self.ungrabbed = False

    async def async_read_loop(self):
        yield SimpleNamespace(type=1, code=304, value=1)

    def ungrab(self):
        self.ungrabbed = True

    def close(self):
        self.closed = True


class DeviceManagerTests(unittest.TestCase):
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
