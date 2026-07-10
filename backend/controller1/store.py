from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any

from .models import (
    DEFAULT_OUTPUT_GAMEPAD_NAME,
    DEFAULT_OUTPUT_KEYBOARD_NAME,
    Profile,
    default_state,
)


class ProfileStore:
    """Decky SettingsManager store with an atomic standalone fallback."""

    def __init__(self, settings_dir: str) -> None:
        self.path = Path(settings_dir) / "controller1.json"
        self.state = default_state()
        self.manager: Any | None = None
        try:
            from settings import SettingsManager

            self.manager = SettingsManager("controller1", settings_dir)
        except ImportError:
            pass

    def load(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if self.manager and self.manager.settings:
            loaded = self.manager.settings
        elif not self.path.exists() or self.path.stat().st_size == 0:
            self.save()
            return
        else:
            try:
                loaded = json.loads(self.path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                loaded = {}
        try:
            profiles = [Profile.from_dict(item).to_dict() for item in loaded.get("profiles", [])]
            if not profiles:
                raise ValueError("settings contain no profiles")
            self.state = {
                "version": 1,
                "enabled": bool(loaded.get("enabled", False)),
                "outputGamepadName": str(
                    loaded.get("outputGamepadName", DEFAULT_OUTPUT_GAMEPAD_NAME)
                ),
                "outputKeyboardName": str(
                    loaded.get("outputKeyboardName", DEFAULT_OUTPUT_KEYBOARD_NAME)
                ),
                "activeProfileId": str(loaded.get("activeProfileId", profiles[0]["id"])),
                "profiles": profiles,
            }
            if not any(p["id"] == self.state["activeProfileId"] for p in profiles):
                self.state["activeProfileId"] = profiles[0]["id"]
        except (OSError, ValueError, TypeError, json.JSONDecodeError):
            backup = self.path.with_suffix(".json.invalid")
            try:
                self.path.replace(backup)
            except OSError:
                pass
            self.state = default_state()
            self.save()

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if self.manager:
            self.manager.settings = self.state
            self.manager.commit()
            return
        descriptor, temporary = tempfile.mkstemp(
            prefix=".controller1-", suffix=".json", dir=self.path.parent
        )
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
                json.dump(self.state, handle, indent=2, sort_keys=True)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, self.path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)

    @property
    def profiles(self) -> list[Profile]:
        return [Profile.from_dict(item) for item in self.state["profiles"]]

    @property
    def active_profile(self) -> Profile:
        active = self.state["activeProfileId"]
        return next((profile for profile in self.profiles if profile.id == active), self.profiles[0])

    def replace_profile(self, profile: Profile) -> None:
        self.state["profiles"] = [
            profile.to_dict() if item["id"] == profile.id else item
            for item in self.state["profiles"]
        ]
        self.save()

    def add_profile(self, name: str) -> Profile:
        profile = Profile(name=name.strip() or "Profile")
        self.state["profiles"].append(profile.to_dict())
        self.state["activeProfileId"] = profile.id
        self.save()
        return profile

    def delete_profile(self, profile_id: str) -> None:
        profiles = [item for item in self.state["profiles"] if item["id"] != profile_id]
        if not profiles:
            raise ValueError("at least one profile is required")
        self.state["profiles"] = profiles
        if self.state["activeProfileId"] == profile_id:
            self.state["activeProfileId"] = profiles[0]["id"]
        self.save()

    def set_active(self, profile_id: str) -> Profile:
        profile = next((item for item in self.profiles if item.id == profile_id), None)
        if profile is None:
            raise ValueError("unknown profile")
        self.state["activeProfileId"] = profile_id
        self.save()
        return profile
