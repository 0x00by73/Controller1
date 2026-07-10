#!/bin/bash
set -euo pipefail

if [[ ! -c /dev/uinput ]]; then
  echo "FAIL: /dev/uinput is unavailable"
  exit 1
fi

gamepad=""
keyboard=""
for event in /sys/class/input/event*; do
  [[ -e "$event/device/name" ]] || continue
  name="$(<"$event/device/name")"
  case "$name" in
    "Controller1 Virtual Gamepad") gamepad="$event" ;;
    "Controller1 Virtual Keyboard and Mouse") keyboard="$event" ;;
  esac
done

if [[ -z "$gamepad" || -z "$keyboard" ]]; then
  echo "FAIL: enable Controller1 before running this script"
  exit 1
fi

vendor="$(<"$gamepad/device/id/vendor")"
product="$(<"$gamepad/device/id/product")"
if [[ "$vendor:$product" != "045e:028e" ]]; then
  echo "FAIL: unexpected virtual gamepad identity $vendor:$product"
  exit 1
fi

echo "PASS: virtual gamepad is 045e:028e at /dev/input/$(basename "$gamepad")"
echo "PASS: virtual keyboard/mouse exists at /dev/input/$(basename "$keyboard")"
echo "NEXT: record the gamepad event path, reconnect the physical controller,"
echo "      rerun this script, and confirm Steam shows only one unchanged controller."
