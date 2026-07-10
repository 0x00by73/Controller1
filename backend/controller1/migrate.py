from __future__ import annotations

from copy import deepcopy
from typing import Any


CURRENT_VERSION = 2


def migrate_state(value: dict[str, Any]) -> dict[str, Any]:
    """Return a v2 state without rewriting legacy manual bindings."""
    state = deepcopy(value)
    version = int(state.get("version", 1))
    if version > CURRENT_VERSION:
        raise ValueError(f"unsupported settings version: {version}")
    if version < 2:
        for profile in state.get("profiles", []):
            profile.setdefault("logicalControls", [])
            profile.setdefault("outputMode", "standard")
        state["version"] = 2
    return state
