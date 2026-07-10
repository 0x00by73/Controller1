from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any
from uuid import uuid4


DEFAULT_OUTPUT_GAMEPAD_NAME = "Controller1 Virtual Gamepad"
DEFAULT_OUTPUT_KEYBOARD_NAME = "Controller1 Virtual Keyboard and Mouse"


@dataclass(frozen=True)
class InputRef:
    event_type: int
    code: int
    name: str = ""

    @property
    def key(self) -> str:
        return f"{self.event_type}:{self.code}"

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> "InputRef":
        return cls(
            event_type=int(value.get("eventType", value.get("event_type", 0))),
            code=int(value["code"]),
            name=str(value.get("name", "")),
        )

    def to_dict(self) -> dict[str, Any]:
        return {"eventType": self.event_type, "code": self.code, "name": self.name}


@dataclass
class AxisCalibration:
    minimum: int = -32768
    center: int = 0
    maximum: int = 32767
    deadzone: float = 0.03
    invert: bool = False
    expo: float = 0.0

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> "AxisCalibration":
        return cls(
            minimum=int(value.get("min", value.get("minimum", -32768))),
            center=int(value.get("center", 0)),
            maximum=int(value.get("max", value.get("maximum", 32767))),
            deadzone=float(value.get("deadzone", 0.03)),
            invert=bool(value.get("invert", False)),
            expo=float(value.get("expo", 0.0)),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "min": self.minimum,
            "center": self.center,
            "max": self.maximum,
            "deadzone": self.deadzone,
            "invert": self.invert,
            "expo": self.expo,
        }

    def normalize(self, raw: int) -> float:
        span = self.maximum - self.center if raw >= self.center else self.center - self.minimum
        value = 0.0 if span <= 0 else (raw - self.center) / span
        value = max(-1.0, min(1.0, value))
        if abs(value) <= self.deadzone:
            value = 0.0
        else:
            value = (abs(value) - self.deadzone) / max(1e-9, 1.0 - self.deadzone) * (1 if value > 0 else -1)
        expo = max(0.0, min(1.0, self.expo))
        value = (1.0 - expo) * value + expo * value * value * value
        return -value if self.invert else value


@dataclass
class Predicate:
    input: InputRef
    test: str = "pressed"
    low: float = -1.0
    high: float = 1.0

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> "Predicate":
        axis_range = value.get("axisRange", [value.get("low", -1.0), value.get("high", 1.0)])
        return cls(
            input=InputRef.from_dict(value["input"]),
            test=str(value.get("test", "pressed")),
            low=float(axis_range[0]),
            high=float(axis_range[1]),
        )

    def to_dict(self) -> dict[str, Any]:
        result: dict[str, Any] = {"input": self.input.to_dict(), "test": self.test}
        if self.test == "axisRange":
            result["axisRange"] = [self.low, self.high]
        return result


@dataclass
class Action:
    type: str
    code: str = ""
    codes: list[str] = field(default_factory=list)
    source: InputRef | None = None
    scale: float = 1.0

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> "Action":
        return cls(
            type=str(value["type"]),
            code=str(value.get("code", "")),
            codes=[str(item) for item in value.get("codes", [])],
            source=InputRef.from_dict(value["source"]) if value.get("source") else None,
            scale=float(value.get("scale", 1.0)),
        )

    def to_dict(self) -> dict[str, Any]:
        result: dict[str, Any] = {
            "type": self.type,
            "code": self.code,
            "codes": self.codes,
            "scale": self.scale,
        }
        if self.source:
            result["source"] = self.source.to_dict()
        return result


@dataclass
class Binding:
    conditions: list[Predicate]
    action: Action
    id: str = field(default_factory=lambda: uuid4().hex)
    name: str = ""
    layer: str = "base"

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> "Binding":
        return cls(
            id=str(value.get("id") or uuid4().hex),
            name=str(value.get("name", "")),
            layer=str(value.get("layer", "base")),
            conditions=[Predicate.from_dict(item) for item in value.get("conditions", [])],
            action=Action.from_dict(value["action"]),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "layer": self.layer,
            "conditions": [item.to_dict() for item in self.conditions],
            "action": self.action.to_dict(),
        }


@dataclass
class Profile:
    name: str
    id: str = field(default_factory=lambda: uuid4().hex)
    device_id: str | None = None
    bindings: list[Binding] = field(default_factory=list)
    calibrations: dict[str, AxisCalibration] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> "Profile":
        return cls(
            id=str(value.get("id") or uuid4().hex),
            name=str(value.get("name", "Profile")),
            device_id=value.get("deviceId"),
            bindings=[Binding.from_dict(item) for item in value.get("bindings", [])],
            calibrations={
                key: AxisCalibration.from_dict(item)
                for key, item in value.get("calibrations", {}).items()
            },
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "deviceId": self.device_id,
            "bindings": [item.to_dict() for item in self.bindings],
            "calibrations": {key: item.to_dict() for key, item in self.calibrations.items()},
        }


def default_state() -> dict[str, Any]:
    profile = Profile(name="Default")
    return {
        "version": 1,
        "enabled": False,
        "outputGamepadName": DEFAULT_OUTPUT_GAMEPAD_NAME,
        "outputKeyboardName": DEFAULT_OUTPUT_KEYBOARD_NAME,
        "activeProfileId": profile.id,
        "profiles": [profile.to_dict()],
    }
