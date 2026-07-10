from __future__ import annotations

from typing import Any

from .models import Action, AxisCalibration, Binding, InputRef, Profile


class MappingEngine:
    def __init__(self, outputs: Any, logger: Any | None = None) -> None:
        self.outputs = outputs
        self.logger = logger
        self.profile = Profile(name="Default")
        self.default_calibrations: dict[str, AxisCalibration] = {}
        self.raw_state: dict[str, int] = {}
        self.active_bindings: set[str] = set()
        self.active_continuous: set[str] = set()
        self.output_counts: dict[str, int] = {}
        self.active_passthrough: dict[str, tuple[str, str]] = {}

    def set_profile(self, profile: Profile) -> None:
        self.release_all()
        self.profile = profile
        self.raw_state.clear()

    def set_default_calibrations(
        self, calibrations: dict[str, AxisCalibration]
    ) -> None:
        self.default_calibrations = calibrations

    def calibration_for(self, input_ref: InputRef) -> AxisCalibration:
        return self.profile.calibrations.get(
            input_ref.key,
            self.default_calibrations.get(input_ref.key, AxisCalibration()),
        )

    def normalized(self, input_ref: InputRef, raw: int | None = None) -> float:
        value = self.raw_state.get(input_ref.key, 0) if raw is None else raw
        return self.calibration_for(input_ref).normalize(value)

    def process(self, event_type: int, code: int, value: int) -> None:
        changed = InputRef(event_type=event_type, code=code)
        self.raw_state[changed.key] = value
        self._emit_passthrough(changed, value)

        active_layers = {"base"}
        for _ in range(len(self.profile.bindings)):
            previous_count = len(active_layers)
            for binding in self.profile.bindings:
                if (
                    binding.action.type == "layer"
                    and binding.layer in active_layers
                    and self._conditions_match(binding)
                ):
                    active_layers.add(binding.action.code)
            if len(active_layers) == previous_count:
                break

        for binding in self.profile.bindings:
            if binding.action.type == "layer":
                continue
            should_be_active = binding.layer in active_layers and self._conditions_match(binding)
            was_active = binding.id in self.active_bindings
            is_continuous = binding.action.type in ("gamepadAxis", "mouseMove")

            if is_continuous:
                source = binding.action.source
                was_continuous = binding.id in self.active_continuous
                if should_be_active:
                    self.active_continuous.add(binding.id)
                    if source and source.key == changed.key:
                        self._emit_continuous(binding.action, value)
                elif was_continuous:
                    self.active_continuous.discard(binding.id)
                    if not self._continuous_target_active(binding.action):
                        self._neutralize_continuous(binding.action)
                continue

            if should_be_active and not was_active:
                self._activate_action(binding.action)
                self.active_bindings.add(binding.id)
            elif was_active and not should_be_active:
                self._deactivate_action(binding.action)
                self.active_bindings.discard(binding.id)

    def _conditions_match(self, binding: Binding) -> bool:
        if not binding.conditions:
            return True
        for condition in binding.conditions:
            raw = self.raw_state.get(condition.input.key, 0)
            if condition.test == "pressed":
                matches = raw != 0
            elif condition.test == "released":
                matches = raw == 0
            elif condition.test == "axisRange":
                normalized = self.normalized(condition.input, raw)
                matches = condition.low <= normalized <= condition.high
            else:
                matches = False
            if not matches:
                return False
        return True

    def _emit_primitive(self, output_type: str, code: str, pressed: bool) -> None:
        try:
            if output_type == "key":
                self.outputs.key(code, pressed)
            elif output_type == "mouseButton":
                self.outputs.mouse_button(code, pressed)
            elif output_type == "gamepadButton":
                self.outputs.gamepad_button(code, pressed)
        except (OSError, ValueError) as error:
            self._log(f"Failed to emit {output_type}: {error}")

    def _emit_passthrough(self, changed: InputRef, value: int) -> None:
        resolver = getattr(self.outputs, "gamepad_control", None)
        control = resolver(changed.event_type, changed.code) if resolver else None
        previous = self.active_passthrough.get(changed.key)
        if previous and (not control or self._passthrough_reserved(changed, previous)):
            self._decrement_output(*previous)
            self.active_passthrough.pop(changed.key, None)
            previous = None
        if not control or self._passthrough_reserved(changed, control):
            return

        output_type, output_code = control
        if output_type == "gamepadAxis":
            try:
                self.outputs.gamepad_axis(output_code, self.normalized(changed, value))
            except (OSError, ValueError) as error:
                self._log(f"Failed to pass through {output_code}: {error}")
            return

        pressed = value != 0
        if pressed and previous is None:
            self.active_passthrough[changed.key] = control
            self._increment_output(output_type, output_code)
        elif not pressed and previous is not None:
            self.active_passthrough.pop(changed.key, None)
            self._decrement_output(*previous)

    def _passthrough_reserved(
        self, input_ref: InputRef, control: tuple[str, str]
    ) -> bool:
        output_type, output_code = control
        return any(
            any(condition.input.key == input_ref.key for condition in binding.conditions)
            or (
                binding.action.source is not None
                and binding.action.source.key == input_ref.key
            )
            or (
                binding.action.type == output_type
                and binding.action.code == output_code
            )
            for binding in self.profile.bindings
        )

    def _primitives(self, action: Action) -> list[tuple[str, str]]:
        if action.type == "keyCombo":
            return [("key", code) for code in action.codes]
        if action.type in ("key", "mouseButton", "gamepadButton"):
            return [(action.type, action.code)]
        return []

    def _activate_action(self, action: Action) -> None:
        for output_type, code in self._primitives(action):
            self._increment_output(output_type, code)

    def _deactivate_action(self, action: Action) -> None:
        for output_type, code in reversed(self._primitives(action)):
            self._decrement_output(output_type, code)

    def _increment_output(self, output_type: str, code: str) -> None:
        key = f"{output_type}:{code}"
        count = self.output_counts.get(key, 0)
        self.output_counts[key] = count + 1
        if count == 0:
            self._emit_primitive(output_type, code, True)

    def _decrement_output(self, output_type: str, code: str) -> None:
        key = f"{output_type}:{code}"
        count = self.output_counts.get(key, 0)
        if count <= 1:
            self.output_counts.pop(key, None)
            self._emit_primitive(output_type, code, False)
        else:
            self.output_counts[key] = count - 1

    def _emit_continuous(self, action: Action, raw: int) -> None:
        if not action.source:
            return
        normalized = self.normalized(action.source, raw) * action.scale
        try:
            if action.type == "gamepadAxis":
                self.outputs.gamepad_axis(action.code, normalized)
            elif action.type == "mouseMove":
                self.outputs.mouse_move(action.code, round(normalized * 20))
        except (OSError, ValueError) as error:
            self._log(f"Failed to emit {action.type}: {error}")

    def _continuous_target_active(self, action: Action) -> bool:
        bindings = {binding.id: binding for binding in self.profile.bindings}
        return any(
            (other := bindings.get(binding_id)) is not None
            and other.action.type == action.type
            and other.action.code == action.code
            for binding_id in self.active_continuous
        )

    def _neutralize_continuous(self, action: Action) -> None:
        if action.type != "gamepadAxis":
            return
        try:
            self.outputs.gamepad_axis(action.code, 0.0)
        except (OSError, ValueError) as error:
            self._log(f"Failed to neutralize {action.code}: {error}")

    def release_all(self) -> None:
        bindings = {binding.id: binding for binding in self.profile.bindings}
        for binding_id in tuple(self.active_bindings):
            binding = bindings.get(binding_id)
            if binding:
                self._deactivate_action(binding.action)
        self.active_bindings.clear()
        for output_type, code in tuple(self.active_passthrough.values()):
            self._decrement_output(output_type, code)
        self.active_passthrough.clear()
        self.output_counts.clear()
        continuous_codes = {
            binding.action.code
            for binding_id in self.active_continuous
            if (binding := bindings.get(binding_id))
            and binding.action.type == "gamepadAxis"
        }
        for code in continuous_codes:
            self._neutralize_continuous(Action("gamepadAxis", code=code))
        self.active_continuous.clear()

    def _log(self, message: str) -> None:
        if self.logger:
            self.logger.error(message)
