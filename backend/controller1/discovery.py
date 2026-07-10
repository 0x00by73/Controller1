from __future__ import annotations

from collections import defaultdict
from typing import Any, Callable
from uuid import uuid4

from .models import InputRef, LogicalControl, LogicalPosition, Predicate


EV_KEY = 1
EV_ABS = 3
ABS_ACTIVE_THRESHOLD = 0.12


class DiscoverySession:
    """One-control-at-a-time observer fed by the existing input stream."""

    def __init__(
        self, name_resolver: Callable[[int, int], str] | None = None
    ) -> None:
        self.active = False
        self.profile_id: str | None = None
        self.state = "idle"
        self.baseline: dict[str, int] = {}
        self.baseline_normalized: dict[str, float] = {}
        self.current: dict[str, int] = {}
        self.samples: dict[str, list[float]] = defaultdict(list)
        self.key_states: set[tuple[tuple[str, int], ...]] = set()
        self.changed_inputs: set[str] = set()
        self.candidate: LogicalControl | None = None
        self.name_resolver = name_resolver

    def start(
        self,
        profile_id: str,
        snapshot: dict[str, int],
        normalized_snapshot: dict[str, float] | None = None,
    ) -> None:
        self.active = True
        self.profile_id = profile_id
        self._begin_observation(snapshot, normalized_snapshot)

    def begin_observation(
        self,
        snapshot: dict[str, int] | None = None,
        normalized_snapshot: dict[str, float] | None = None,
    ) -> None:
        if not self.active:
            raise RuntimeError("discovery is not active")
        if snapshot is None:
            snapshot = self.baseline
            normalized_snapshot = self.baseline_normalized
        self._begin_observation(snapshot, normalized_snapshot)

    def _begin_observation(
        self,
        snapshot: dict[str, int],
        normalized_snapshot: dict[str, float] | None = None,
    ) -> None:
        self.baseline = dict(snapshot)
        self.baseline_normalized = dict(normalized_snapshot or {})
        self.current = dict(snapshot)
        self._clear_observation()
        self.state = "observing"
        self._capture_key_state()

    def observe(
        self, event_type: int, code: int, value: int, normalized: float | None = None
    ) -> None:
        if not self.active or self.state != "observing":
            return
        key = f"{event_type}:{code}"
        self.current[key] = value
        if event_type == EV_KEY:
            if value != self.baseline.get(key, 0):
                self.changed_inputs.add(key)
            self.samples[key].append(float(value != 0))
            self._capture_key_state()
        elif event_type == EV_ABS:
            sample_value = float(value if normalized is None else normalized)
            self.samples[key].append(sample_value)
            if self._abs_moved(key, value, normalized):
                self.changed_inputs.add(key)

    def _abs_moved(
        self, key: str, value: int, normalized: float | None
    ) -> bool:
        baseline_norm = self.baseline_normalized.get(key)
        if normalized is not None and baseline_norm is not None:
            return abs(normalized - baseline_norm) > ABS_ACTIVE_THRESHOLD
        baseline = self.baseline.get(key, 0)
        return abs(value - baseline) > max(32, abs(baseline) // 16)

    def finish_observation(self) -> LogicalControl | None:
        if not self.active or self.state != "observing":
            raise RuntimeError("no discovery observation is active")
        self.candidate = self._classify()
        self.state = "candidate" if self.candidate else "observing"
        return self.candidate

    def stop(self) -> None:
        self.active = False
        self.profile_id = None
        self.state = "idle"
        self.candidate = None
        self.changed_inputs.clear()

    def status(self) -> dict[str, Any]:
        prompts = {
            "idle": "Start discovery",
            "observing": "Move one control through every position, then tap Next",
            "candidate": "Review the detected control",
        }
        result: dict[str, Any] = {
            "active": self.active,
            "state": self.state,
            "prompt": prompts[self.state],
            "changedInputs": [
                self._input(key).to_dict() for key in sorted(self.changed_inputs)
            ],
        }
        if self.candidate is not None:
            result["candidate"] = self.candidate.to_dict()
        return result

    def _clear_observation(self) -> None:
        self.samples.clear()
        self.key_states.clear()
        self.changed_inputs.clear()
        self.candidate = None

    def _capture_key_state(self) -> None:
        keys = sorted(
            key for key in set(self.current) | set(self.baseline) if key.startswith("1:")
        )
        self.key_states.add(tuple((key, int(self.current.get(key, 0) != 0)) for key in keys))

    def _classify(self) -> LogicalControl | None:
        key_sources = sorted(
            key for key in self.changed_inputs if key.startswith(f"{EV_KEY}:")
        )
        if len(key_sources) == 2:
            states = {
                tuple(dict(state).get(key, 0) for key in key_sources)
                for state in self.key_states
            }
            if {(0, 0), (1, 0), (0, 1)} <= states and (1, 1) not in states:
                first, second = (self._input(key) for key in key_sources)
                return LogicalControl(
                    id=uuid4().hex,
                    name="Three-position switch",
                    kind="switch3",
                    sources=[first, second],
                    positions=[
                        LogicalPosition(
                            "left", "Left",
                            [Predicate(first, "pressed"), Predicate(second, "released")],
                        ),
                        LogicalPosition(
                            "center", "Center",
                            [Predicate(first, "released"), Predicate(second, "released")],
                        ),
                        LogicalPosition(
                            "right", "Right",
                            [Predicate(first, "released"), Predicate(second, "pressed")],
                        ),
                    ],
                    confidence=0.98,
                    confirmed=False,
                )
        if len(key_sources) == 1:
            source = self._input(key_sources[0])
            return LogicalControl(
                id=uuid4().hex,
                name="Button",
                kind="button",
                sources=[source],
                positions=[
                    LogicalPosition("pressed", "Pressed", [Predicate(source, "pressed")])
                ],
                confidence=0.95,
                confirmed=False,
            )

        abs_sources = sorted(
            key for key in self.changed_inputs if key.startswith(f"{EV_ABS}:")
        )
        if len(abs_sources) != 1:
            return None
        key = abs_sources[0]
        source = self._input(key)
        values = self.samples[key]
        clusters = self._clusters(values)
        if len(clusters) in (2, 3):
            boundaries = [
                (clusters[index] + clusters[index + 1]) / 2
                for index in range(len(clusters) - 1)
            ]
            labels = ["Low", "High"] if len(clusters) == 2 else ["Low", "Center", "High"]
            positions = []
            for index, label in enumerate(labels):
                low = -1.0 if index == 0 else boundaries[index - 1]
                high = 1.0 if index == len(labels) - 1 else boundaries[index]
                positions.append(
                    LogicalPosition(
                        label.lower(), label,
                        [Predicate(source, "axisRange", low=low, high=high)],
                    )
                )
            return LogicalControl(
                id=uuid4().hex,
                name=f"{len(clusters)}-position switch",
                kind=f"switch{len(clusters)}",
                sources=[source],
                positions=positions,
                confidence=0.9,
                confirmed=False,
            )
        if len({round(value, 2) for value in values}) >= 6:
            return LogicalControl(
                id=uuid4().hex,
                name="Analog control",
                kind="analog",
                sources=[source],
                positions=[],
                confidence=0.85,
                confirmed=False,
            )
        return LogicalControl(
            id=uuid4().hex,
            name="Ambiguous control",
            kind="analog",
            sources=[source],
            positions=[],
            confidence=0.35,
            confirmed=False,
        )

    @staticmethod
    def _clusters(values: list[float]) -> list[float]:
        if not values:
            return []
        ordered = sorted(values)
        tolerance = max(0.04, (ordered[-1] - ordered[0]) * 0.08)
        groups: list[list[float]] = []
        for value in ordered:
            if not groups or abs(value - sum(groups[-1]) / len(groups[-1])) > tolerance:
                groups.append([value])
            else:
                groups[-1].append(value)
        return [sum(group) / len(group) for group in groups]

    def _input(self, key: str) -> InputRef:
        event_type, code = key.split(":", 1)
        event_type_value = int(event_type)
        code_value = int(code)
        name = (
            self.name_resolver(event_type_value, code_value)
            if self.name_resolver
            else ""
        )
        return InputRef(event_type_value, code_value, name)
