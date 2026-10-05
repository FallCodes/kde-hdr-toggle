# HDR Toggle

A KDE Plasma 6 panel widget that switches HDR on or off for the monitors you pick, with one click.

Turning HDR on also sets each monitor's brightness to a level you choose, for example 100%. Turning it off puts back the brightness the monitor had before. You no longer have to open **System Settings → Display Configuration** and do both by hand.

## Features

- One click toggles HDR on the selected monitors. Wide color gamut is switched along with it, the same way System Settings does.
- The brightness to apply while HDR is on is set per monitor, or can be left unchanged.
- The previous (SDR) brightness is restored when HDR turns off, even if HDR was switched on from System Settings.
- The icon shows the current state (filled badge means HDR is on) and follows changes made elsewhere within a few seconds.
- Optional global shortcut: widget settings → Keyboard Shortcuts.
- If a monitor refuses HDR, you get a notification and its brightness is put back.

## Requirements

- KDE Plasma 6 on Wayland (developed on Plasma 6.7).
- `kscreen-doctor`, which comes with Plasma (libkscreen).
- An HDR-capable monitor. For the brightness setting to change an external monitor's backlight, enable **Control hardware brightness with DDC/CI** for it in System Settings → Display Configuration.

## Install

### From the KDE Store

Right-click your panel → **Add Widgets…** → **Get New Widgets** → **Download New Plasma Widgets**, search for **HDR Toggle** and click **Install**. Then drag it from the Add Widgets list onto the panel.

### From source

From a clone of this repository:

```sh
./install.sh
```

Then right-click your panel → **Add Widgets…**, search for **HDR Toggle** and drag it onto the panel.

After pulling new changes, run `./install.sh --restart`. This reinstalls the widget and restarts plasmashell so the panel loads the new version.

### Setup

Right-click the icon → **Configure HDR Toggle…** to tick the monitors it should manage and set their HDR brightness.

To uninstall, remove the widget from the panel, then run:

```sh
kpackagetool6 -t Plasma/Applet -r com.fallcodes.hdrtoggle
```

## How it works

The widget drives `kscreen-doctor`. For example, turning HDR on for one monitor at 100% brightness runs:

```sh
kscreen-doctor output.DP-2.hdr.enable output.DP-2.wcg.enable output.DP-2.brightness.100
```

It reads the current state with `kscreen-doctor -j` every 3 seconds (about 20 ms per call) and remembers each monitor's last SDR brightness in the widget's settings.

## Development

- The decision logic is in `package/contents/ui/logic.js`, with unit tests you can run using `node --test tests/`.
- The widget logs warnings to the journal: `journalctl --user -b | grep hdrtoggle`.
- Test changes in a real panel. `plasmawindowed` only shows a widget's popup view, and this widget has none.

## License

GPL-2.0-or-later. See [LICENSE](LICENSE).

Copyright © 2026 Mattia De Francesco
