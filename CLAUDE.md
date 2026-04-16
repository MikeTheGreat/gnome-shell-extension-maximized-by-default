# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Deploy

```bash
./deploy.sh
```

This builds a zip to `dist/` and installs directly to `~/.local/share/gnome-shell/extensions/<uuid>/`. After running, log out/in (Wayland) or press `Alt+F2 → r` (X11) to reload GNOME Shell.

## Architecture

This is a minimal GNOME Shell extension with two source files in `src/`:

- **[extension.js](src/extension.js)** — The entire extension logic. A single ES module class with `enable()`/`disable()` methods following the GNOME Shell extension API. On `window-created`, it hooks into the `shown` signal and maximizes only `Meta.WindowType.NORMAL` windows that report `can_maximize() === true`. The `maximize()` call signature differs between GNOME ≤46 (requires `Meta.MaximizeFlags.BOTH`) and ≥47 (no argument needed); this is handled with a version check on `Config.PACKAGE_VERSION`.
- **[metadata.json](src/metadata.json)** — Extension metadata including UUID, version, and supported `shell-version` list (currently 45–49).

The UUID is `gnome-shell-extension-maximized-by-default@mikethegreat.github.com`. When adding support for a new GNOME Shell version, update `shell-version` in `metadata.json` and verify the `maximize()` API hasn't changed again.
