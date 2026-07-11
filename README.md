# Controller1

Controller1 is a Decky Loader plugin that exclusively reads a physical Linux
input device, applies profile-specific calibration and mappings, then emits a
stable virtual Xbox-style controller plus a virtual keyboard/mouse.

## Steam Input setup

Controller1 is intended to be the mapping layer:

1. Enable Controller1 and select the physical controller.
   Unmapped axes pass through automatically; buttons require an explicit mapping.
   An explicit mapping overrides passthrough for its source and output.
2. In each game's **Properties → Controller**, choose **Disable Steam Input**
   if the game supports Xbox controllers directly.
3. If a game requires Steam Input, use a plain **Gamepad** template with no
   remapping. Controller1's keyboard/mouse output bypasses Steam Input.

The physical evdev node is held with `EVIOCGRAB`, preventing normal evdev and
joydev consumers from seeing duplicate input. A supported controller that
Steam opens directly through `hidraw` can bypass `EVIOCGRAB`; disable Steam
Input for that controller/game if duplicate input occurs.

## Mapping examples

- A three-position RC switch: learn the axis three times and create three key
  mappings with non-overlapping normalized ranges.
- Gimbal to virtual stick: learn the gimbal axis, choose **Gamepad axis**, and
  enter `ABS_X`, `ABS_Y`, `ABS_RX`, or `ABS_RY`.
- Chord: learn the modifier, choose **Learn another chord input**, move the
  second input, then map the combination to `KEY_ESC`.
- Keyboard shortcut: choose **Keyboard shortcut** and enter
  `KEY_LEFTCTRL+KEY_C`.
- Layer: map a held input to a layer name, then use the same name in the
  mapping's **Active layer** field.

Linux event code names come from `linux/input-event-codes.h` (`KEY_*`, `BTN_*`,
`ABS_*`, and `REL_*`).

## Controls

Calibration progress belongs to the active profile and physical controller,
survives reconnects, and resets only when **Start calibration** is selected.
Move every axis through its full travel, return controls to center, then save.
Select any axis or button in **Controls** to configure its mappings. Controller1
normalizes raw input before evaluating ranges or emitting virtual axes.

## Build

Requirements: Node 20+, pnpm 9, Docker.

```sh
npx pnpm@9 install
npx pnpm@9 run typecheck
npx pnpm@9 run build
make -C backend vendor
python3 -m unittest discover -s tests -v
```

`make -C backend vendor` builds `python-evdev` and `pyudev` against CPython
3.11 into Decky's first-class `py_modules/` directory. Do not build or package
`py_modules/` on macOS. The GitHub workflow performs this step and produces an
installable `Controller1.zip`.

## Install from URL (Decky Developer Mode)

Decky expects a **direct URL to a built plugin zip**, not a GitHub repo page or
Actions artifact link.

1. Enable **Developer Mode** in Decky settings.
2. Open the **Developer** tab.
3. Paste this URL into **Install Plugin from URL**:

   `https://github.com/0x00by73/Controller1/releases/latest/download/Controller1.zip`

Do **not** use:

- `https://github.com/0x00by73/Controller1` (repo page, not a zip)
- `https://github.com/0x00by73/Controller1/archive/refs/heads/main.zip` (source
  archive, no built `dist/index.js`)
- GitHub Actions artifact download URLs (zip-in-zip wrapper with no top-level
  `plugin.json`, which hangs Decky on "Parsing zip")

The release zip must contain exactly one top-level folder named `Controller1/`
with `plugin.json`, `package.json`, `LICENSE`, `main.py`, and `dist/index.js`.

## Device-side verification

In SteamOS Desktop Mode:

```sh
sudo evtest
jstest /dev/input/js0
udevadm info /dev/input/eventX
```

Verify that:

- the physical device stops producing events for other evdev consumers while
  Controller1 is enabled;
- `Controller1 Virtual Gamepad` always reports `045e:028e`;
- reconnecting the physical controller does not change the virtual identity;
- disabling/unloading Controller1 releases the physical grab and all held keys.

Then repeat in Game Mode and confirm the game sees one controller.
