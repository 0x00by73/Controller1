from __future__ import annotations

from copy import deepcopy

from .models import Action, Binding, LogicalControl, Profile


def compile_logical_control(control: LogicalControl) -> list[Binding]:
    bindings: list[Binding] = []
    if control.kind == "analog" and control.action is not None and control.sources:
        action = deepcopy(control.action)
        if action.source is None:
            action.source = control.sources[0]
        bindings.append(
            Binding(
                id=f"logical:{control.id}:analog",
                name=control.name,
                conditions=[],
                action=action,
                logical_control_id=control.id,
            )
        )
    for position in control.positions:
        if position.action is None:
            continue
        bindings.append(
            Binding(
                id=f"logical:{control.id}:position:{position.id}",
                name=f"{control.name}: {position.label}",
                conditions=deepcopy(position.conditions),
                action=deepcopy(position.action),
                logical_control_id=control.id,
            )
        )
    return bindings


def compile_profile(profile: Profile) -> Profile:
    """Create the in-memory runtime profile; never persist this result."""
    runtime = deepcopy(profile)
    runtime.bindings = list(deepcopy(profile.bindings))
    for control in profile.logical_controls:
        runtime.bindings.extend(compile_logical_control(control))
    return runtime
