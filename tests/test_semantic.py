import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / "backend"))

from controller1.discovery import DiscoverySession
from controller1.engine import MappingEngine
from controller1.logical_controls import compile_profile
from controller1.migrate import migrate_state
from controller1.models import (
    Action,
    Binding,
    InputRef,
    LogicalControl,
    LogicalPosition,
    Predicate,
    Profile,
)
from controller1.output_allocator import (
    STANDARD_BUTTONS,
    allocate_logical_control,
)


class FakeOutputs:
    def __init__(self):
        self.events = []

    def gamepad_control(self, _event_type, _code):
        return ("gamepadButton", "BTN_SOUTH")

    def gamepad_button(self, code, pressed):
        self.events.append(("gamepadButton", code, pressed))

    def key(self, code, pressed):
        self.events.append(("key", code, pressed))

    def mouse_button(self, code, pressed):
        self.events.append(("mouseButton", code, pressed))


def paired_switch(control_id="gear"):
    left = InputRef(1, 288, "BTN_TRIGGER")
    right = InputRef(1, 289, "BTN_THUMB")
    return LogicalControl(
        id=control_id,
        name="Gear",
        kind="switch3",
        sources=[left, right],
        positions=[
            LogicalPosition(
                "low",
                "Low",
                [Predicate(left, "pressed"), Predicate(right, "released")],
                Action("gamepadButton", code="BTN_SOUTH"),
            ),
            LogicalPosition(
                "center",
                "Center",
                [Predicate(left, "released"), Predicate(right, "released")],
                Action("gamepadButton", code="BTN_EAST"),
            ),
            LogicalPosition(
                "high",
                "High",
                [Predicate(left, "released"), Predicate(right, "pressed")],
                Action("gamepadButton", code="BTN_NORTH"),
            ),
        ],
        confidence=1,
        confirmed=True,
    )


class MigrationTests(unittest.TestCase):
    def test_v1_to_v2_preserves_manual_bindings(self):
        binding = {"id": "legacy", "conditions": [], "action": {"type": "key", "code": "KEY_A"}}
        migrated = migrate_state(
            {"version": 1, "profiles": [{"id": "p", "name": "P", "bindings": [binding]}]}
        )
        self.assertEqual(migrated["version"], 2)
        self.assertEqual(migrated["profiles"][0]["bindings"], [binding])
        self.assertEqual(migrated["profiles"][0]["logicalControls"], [])
        self.assertEqual(migrated["profiles"][0]["outputMode"], "standard")


class CompilerTests(unittest.TestCase):
    def test_compiles_deterministically_and_synthesizes_released_center(self):
        profile = Profile(
            name="P",
            bindings=[Binding([], Action("key", code="KEY_A"), id="manual")],
            logical_controls=[paired_switch()],
        )
        runtime = compile_profile(profile)
        self.assertEqual(len(profile.bindings), 1)
        self.assertEqual(
            [item.id for item in runtime.bindings],
            [
                "manual",
                "logical:gear:position:low",
                "logical:gear:position:center",
                "logical:gear:position:high",
            ],
        )
        center = runtime.bindings[2]
        self.assertEqual([item.test for item in center.conditions], ["released", "released"])
        self.assertEqual(center.logical_control_id, "gear")


class DiscoveryTests(unittest.TestCase):
    def test_classifies_mutually_exclusive_keys_as_switch3(self):
        session = DiscoverySession()
        session.start("p", {"1:288": 0, "1:289": 0})
        session.begin_observation()
        for code, value in ((288, 1), (288, 0), (289, 1), (289, 0)):
            session.observe(1, code, value)
        candidate = session.finish_observation()
        self.assertIsNotNone(candidate)
        self.assertEqual(candidate.kind, "switch3")
        self.assertEqual(candidate.positions[1].label, "Center")
        self.assertFalse(candidate.confirmed)

    def test_classifies_stable_axis_clusters_and_continuous_axis(self):
        switch = DiscoverySession()
        switch.start("p", {"3:0": 0})
        switch.begin_observation()
        for value in (-1.0, -1.0, 0.0, 0.0, 1.0, 1.0):
            switch.observe(3, 0, round(value * 100), value)
        self.assertEqual(switch.finish_observation().kind, "switch3")

        analog = DiscoverySession()
        analog.start("p", {"3:0": 0})
        analog.begin_observation()
        for value in (-1, -.7, -.3, 0, .25, .6, 1):
            analog.observe(3, 0, round(value * 100), value)
        self.assertEqual(analog.finish_observation().kind, "analog")


class AllocatorTests(unittest.TestCase):
    def test_standard_exhaustion_and_extended_fallback(self):
        controls = []
        for index, code in enumerate(STANDARD_BUTTONS):
            controls.append(
                LogicalControl(
                    str(index), code, "button", [],
                    [LogicalPosition("p", "P", [], Action("gamepadButton", code=code))],
                )
            )
        missing = LogicalControl(
            "new", "New", "button", [], [LogicalPosition("p", "P", [])]
        )
        with self.assertRaises(ValueError):
            allocate_logical_control(
                Profile(name="P", logical_controls=controls), missing
            )
        allocated = allocate_logical_control(
            Profile(name="P", logical_controls=controls, output_mode="extended"),
            missing,
        )
        self.assertEqual(
            allocated.positions[0].action.code, "BTN_TRIGGER_HAPPY1"
        )


class BindAssistTests(unittest.TestCase):
    def test_isolates_unrelated_inputs_and_pulses_positions(self):
        outputs = FakeOutputs()
        engine = MappingEngine(outputs)
        engine.set_profile(compile_profile(Profile(name="P", logical_controls=[paired_switch()])))
        engine.start_bind_assist("gear")

        engine.process(1, 400, 1)
        self.assertEqual(outputs.events, [])
        engine.process(1, 288, 1)
        engine.process(1, 288, 0)

        self.assertEqual(
            outputs.events,
            [
                ("gamepadButton", "BTN_SOUTH", True),
                ("gamepadButton", "BTN_SOUTH", False),
                ("gamepadButton", "BTN_EAST", True),
                ("gamepadButton", "BTN_EAST", False),
            ],
        )


if __name__ == "__main__":
    unittest.main()
