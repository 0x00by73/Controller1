import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / "backend"))

from controller1.models import Action, Binding, Predicate, InputRef
from controller1.models import DEFAULT_OUTPUT_GAMEPAD_NAME, DEFAULT_OUTPUT_KEYBOARD_NAME
from controller1.store import ProfileStore


class ProfileStoreTests(unittest.TestCase):
    def test_profiles_and_bindings_round_trip(self):
        with tempfile.TemporaryDirectory() as directory:
            store = ProfileStore(directory)
            store.load()
            profile = store.active_profile
            profile.bindings.append(
                Binding(
                    [Predicate(InputRef(1, 304, "BTN_SOUTH"))],
                    Action("key", code="KEY_SPACE"),
                )
            )
            store.replace_profile(profile)

            reloaded = ProfileStore(directory)
            reloaded.load()
            self.assertEqual(reloaded.active_profile.bindings[0].action.code, "KEY_SPACE")

    def test_invalid_settings_are_replaced(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "controller1.json"
            path.write_text("{broken", encoding="utf-8")
            store = ProfileStore(directory)
            store.load()
            self.assertEqual(len(store.profiles), 1)
            self.assertTrue((Path(directory) / "controller1.json.invalid").exists())
            json.loads(path.read_text(encoding="utf-8"))

    def test_last_profile_cannot_be_deleted(self):
        with tempfile.TemporaryDirectory() as directory:
            store = ProfileStore(directory)
            store.load()
            with self.assertRaises(ValueError):
                store.delete_profile(store.active_profile.id)

    def test_legacy_settings_gain_default_output_names(self):
        with tempfile.TemporaryDirectory() as directory:
            store = ProfileStore(directory)
            legacy = store.state
            legacy.pop("outputGamepadName")
            legacy.pop("outputKeyboardName")
            store.path.write_text(json.dumps(legacy), encoding="utf-8")

            store.load()

            self.assertEqual(store.state["outputGamepadName"], DEFAULT_OUTPUT_GAMEPAD_NAME)
            self.assertEqual(
                store.state["outputKeyboardName"], DEFAULT_OUTPUT_KEYBOARD_NAME
            )

    def test_custom_output_names_round_trip(self):
        with tempfile.TemporaryDirectory() as directory:
            store = ProfileStore(directory)
            store.load()
            store.state["outputGamepadName"] = "Custom Pad"
            store.state["outputKeyboardName"] = "Custom Keys"
            store.save()

            reloaded = ProfileStore(directory)
            reloaded.load()

            self.assertEqual(reloaded.state["outputGamepadName"], "Custom Pad")
            self.assertEqual(reloaded.state["outputKeyboardName"], "Custom Keys")


if __name__ == "__main__":
    unittest.main()
