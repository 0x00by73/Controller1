from __future__ import annotations

import os
import sys
from typing import Any

import decky

PLUGIN_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(PLUGIN_DIR, "py_modules"))
sys.path.insert(0, os.path.join(PLUGIN_DIR, "backend"))

from controller1 import ControllerService


class Plugin:
    service: ControllerService | None = None

    async def _main(self) -> None:
        settings_dir = getattr(
            decky,
            "DECKY_PLUGIN_SETTINGS_DIR",
            os.path.join(decky.DECKY_HOME, "settings", "Controller1"),
        )
        self.service = ControllerService(settings_dir, decky.emit, decky.logger)
        await self.service.start()
        decky.logger.info("Controller1 started")

    async def _unload(self) -> None:
        if self.service is not None:
            await self.service.stop()
            decky.logger.info("Controller1 stopped")

    async def _uninstall(self) -> None:
        pass

    def _require_service(self) -> ControllerService:
        if self.service is None:
            raise RuntimeError("Controller1 backend is still starting")
        return self.service

    async def get_status(self) -> dict[str, Any]:
        return await self._require_service().get_status()

    async def refresh_devices(self) -> list[dict[str, Any]]:
        return await self._require_service().refresh_devices()

    async def set_enabled(
        self, enabled: bool, device_id: str | None = None
    ) -> dict[str, Any]:
        return await self._require_service().set_enabled(enabled, device_id)

    async def set_profile(self, profile_id: str) -> dict[str, Any]:
        return await self._require_service().set_profile(profile_id)

    async def create_profile(self, name: str) -> dict[str, Any]:
        return await self._require_service().create_profile(name)

    async def delete_profile(self, profile_id: str) -> dict[str, Any]:
        return await self._require_service().delete_profile(profile_id)

    async def save_binding(
        self, profile_id: str, binding: dict[str, Any]
    ) -> dict[str, Any]:
        return await self._require_service().save_binding(profile_id, binding)

    async def delete_binding(
        self, profile_id: str, binding_id: str
    ) -> dict[str, Any]:
        return await self._require_service().delete_binding(profile_id, binding_id)

    async def start_learning(self) -> None:
        await self._require_service().start_learning()

    async def stop_learning(self) -> None:
        await self._require_service().stop_learning()

    async def begin_calibration(self, inputs: list[dict[str, Any]]) -> None:
        await self._require_service().begin_calibration(inputs)

    async def finish_calibration(
        self, profile_id: str, centers: dict[str, int] | None = None
    ) -> dict[str, Any]:
        return await self._require_service().finish_calibration(profile_id, centers)

    async def set_calibration(
        self,
        profile_id: str,
        input_value: dict[str, Any],
        calibration: dict[str, Any],
    ) -> dict[str, Any]:
        return await self._require_service().set_calibration(profile_id, input_value, calibration)
