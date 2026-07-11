from __future__ import annotations

import os
import subprocess
from pathlib import Path
from typing import Any

UDEV_RULES_PATH = Path("/etc/udev/rules.d/99-controller1-suppress.rules")
UDEV_MARKER = "# controller1-managed"


class PhysicalSuppressor:
    """Hide the captured physical controller from SteamOS and desktop consumers."""

    def __init__(self, logger: Any | None = None) -> None:
        self.logger = logger
        self.active_vendor: int | None = None
        self.active_product: int | None = None
        self.active_event_path: str | None = None

    def activate(self, event_path: str, vendor: int, product: int) -> dict[str, Any]:
        self.deactivate()
        self.active_event_path = event_path
        self.active_vendor = vendor
        self.active_product = product
        hidraw_nodes = self.hidraw_nodes_for_event(event_path)
        sibling_events = self.sibling_event_paths(event_path)
        rule_written = self._install_udev_rule(vendor, product)
        return {
            "vendor": vendor,
            "product": product,
            "hidrawNodes": hidraw_nodes,
            "siblingEventPaths": sibling_events,
            "udevRuleInstalled": rule_written,
        }

    def deactivate(self) -> None:
        self._remove_udev_rule()
        self.active_vendor = None
        self.active_product = None
        self.active_event_path = None

    def hidraw_nodes_for_event(self, event_path: str) -> list[str]:
        hid = self._hid_interface_dir(event_path)
        if hid is None:
            return []
        nodes: list[str] = []
        for hidraw_dir in (hid / "hidraw", hid.parent / "hidraw"):
            if not hidraw_dir.is_dir():
                continue
            for entry in sorted(hidraw_dir.glob("hidraw*")):
                node = f"/dev/{entry.name}"
                if node not in nodes:
                    nodes.append(node)
        return nodes

    def sibling_event_paths(self, event_path: str) -> list[str]:
        usb = self._usb_device_dir(event_path)
        if usb is None:
            return []
        siblings: list[str] = []
        for input_dir in usb.glob("**/input/input*"):
            if not input_dir.is_dir():
                continue
            for event_node in sorted(input_dir.glob("event*")):
                path = f"/dev/input/{event_node.name}"
                if path != event_path and path not in siblings:
                    siblings.append(path)
        return siblings

    def _install_udev_rule(self, vendor: int, product: int) -> bool:
        vendor_hex = f"{vendor:04x}"
        product_hex = f"{product:04x}"
        content = "\n".join(
            [
                UDEV_MARKER,
                "# Hide the physical controller while Controller1 owns it.",
                "# Steam Input opens matching hidraw nodes directly, bypassing EVIOCGRAB.",
                f'KERNEL=="hidraw*", ATTRS{{idVendor}}=="{vendor_hex}", ATTRS{{idProduct}}=="{product_hex}", MODE="000"',
                (
                    f'SUBSYSTEM=="input", KERNEL=="event*", '
                    f'ATTRS{{idVendor}}=="{vendor_hex}", ATTRS{{idProduct}}=="{product_hex}", '
                    'MODE="000", ENV{ID_INPUT_JOYSTICK}="", ENV{ID_INPUT}="", '
                    'ENV{LIBINPUT_IGNORE_DEVICE}="1"'
                ),
                (
                    f'SUBSYSTEM=="input", KERNEL=="js*", '
                    f'ATTRS{{idVendor}}=="{vendor_hex}", ATTRS{{idProduct}}=="{product_hex}", '
                    'MODE="000", ENV{ID_INPUT_JOYSTICK}=""'
                ),
                "",
            ]
        )
        try:
            UDEV_RULES_PATH.write_text(content, encoding="utf-8")
            self._reload_udev()
            self._log(
                "info",
                f"Installed suppression rule for physical controller {vendor_hex}:{product_hex}",
            )
            return True
        except OSError as error:
            self._log("warning", f"Could not install suppression udev rule: {error}")
            return False

    def _remove_udev_rule(self) -> None:
        try:
            if UDEV_RULES_PATH.exists():
                UDEV_RULES_PATH.unlink()
                self._reload_udev()
                self._log("info", "Removed physical controller suppression rule")
        except OSError as error:
            self._log("warning", f"Could not remove suppression udev rule: {error}")

    def _reload_udev(self) -> None:
        for command in (
            ["udevadm", "control", "--reload-rules"],
            [
                "udevadm",
                "trigger",
                "--subsystem-match=input",
                "--subsystem-match=hidraw",
                "--action=change",
            ],
        ):
            try:
                subprocess.run(
                    command,
                    check=False,
                    timeout=5,
                    capture_output=True,
                    text=True,
                )
            except (OSError, subprocess.SubprocessError) as error:
                self._log("warning", f"udevadm failed ({' '.join(command)}): {error}")

    @staticmethod
    def _event_sysfs_dir(event_path: str) -> Path:
        return (Path("/sys/class/input") / Path(event_path).name / "device").resolve()

    def _hid_interface_dir(self, event_path: str) -> Path | None:
        current = self._event_sysfs_dir(event_path)
        for path in [current, *current.parents]:
            name = path.name
            if name.startswith(("0003:", "0005:")):
                return path
        return None

    def _usb_device_dir(self, event_path: str) -> Path | None:
        current = self._event_sysfs_dir(event_path)
        for path in [current, *current.parents]:
            if (path / "idVendor").exists() and (path / "idProduct").exists():
                if (path / "busnum").exists() or path.parent.name.startswith("usb"):
                    return path
        return None

    def _log(self, level: str, message: str) -> None:
        if self.logger:
            getattr(self.logger, level)(message)
