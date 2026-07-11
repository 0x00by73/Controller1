import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parents[1] / "backend"))

from controller1.suppress import UDEV_MARKER, PhysicalSuppressor


class PhysicalSuppressorTests(unittest.TestCase):
    def test_installs_vendor_specific_udev_rule(self):
        suppressor = PhysicalSuppressor()
        with patch.object(suppressor, "_reload_udev"), patch(
            "controller1.suppress.UDEV_RULES_PATH"
        ) as rules_path:
            rules_path.write_text = unittest.mock.Mock()
            result = suppressor.activate("/dev/input/event5", 0x1209, 0x4F54)

        self.assertTrue(result["udevRuleInstalled"])
        content = rules_path.write_text.call_args.args[0]
        self.assertIn(UDEV_MARKER, content)
        self.assertIn('ATTRS{idVendor}=="1209"', content)
        self.assertIn('ATTRS{idProduct}=="4f54"', content)
        self.assertIn('KERNEL=="hidraw*"', content)
        self.assertIn('ENV{ID_INPUT_JOYSTICK}=""', content)

    def test_deactivate_removes_rule_file(self):
        suppressor = PhysicalSuppressor()
        with patch.object(suppressor, "_reload_udev"), patch(
            "controller1.suppress.UDEV_RULES_PATH"
        ) as rules_path:
            rules_path.exists.return_value = True
            rules_path.unlink = unittest.mock.Mock()
            suppressor.deactivate()

        rules_path.unlink.assert_called_once()

    def test_sibling_event_paths_skips_primary(self):
        suppressor = PhysicalSuppressor()
        fake_usb = Path("/fake/usb")
        input_dir = fake_usb / "1.0" / "input" / "input48"

        with patch.object(suppressor, "_usb_device_dir", return_value=fake_usb):
            with patch.object(Path, "glob") as glob, patch.object(
                Path, "is_dir", return_value=True
            ):
                glob.side_effect = [
                    [input_dir],
                    [Path("event48"), Path("event49")],
                ]
                siblings = suppressor.sibling_event_paths("/dev/input/event48")

        self.assertEqual(siblings, ["/dev/input/event49"])


if __name__ == "__main__":
    unittest.main()
