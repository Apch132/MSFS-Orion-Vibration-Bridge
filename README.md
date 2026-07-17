# WinWing MSFS2024 Vibration Bridge

Unofficial Windows utility that reads Microsoft Flight Simulator 2024 telemetry through SimConnect and drives the vibration motors on selected WinWing Orion 2 controllers over HID.

It is a Windows utility with two front ends sharing the same future vibration core:

- **CLI** (`vibration.js`) — lightweight, VR-friendly, always uses built-in default feel curves
- **Desktop launcher** (Tauri, in progress) — local preference UI, saved profiles, future telemetry and HUD

## CLI vs Desktop Launcher

| | CLI | Desktop launcher |
|--|-----|------------------|
| Role | Run the vibration bridge | Configure profiles / themes; engine link later |
| Feel curves | Built-in defaults from the shared core | Editable Aircraft / Helicopter profiles (local only) |
| Preferences file | None | OS app data via Tauri Store (`launcher-preferences.json`) |
| SimConnect / HID | Active today | **Not connected yet** in the launcher UI |
| Best for | VR, minimal footprint | Desktop tuning and future HUD |

Launcher preferences live under the Windows app data directory for identifier `community.winwing.msfs2024-vibration-bridge` (managed by Tauri / the Store plugin). They are **never** read by the CLI and are not stored in the git repository.

### Launcher development

Requirements beyond the CLI: Rust toolchain, Windows WebView2 (usually preinstalled).

```bash
npm --prefix apps/launcher ci
npm run dev:launcher
```

Build the launcher installer / binary:

```bash
npm run build:launcher
```

Typecheck:

```bash
npm run typecheck:launcher
```

**Current launcher status:** preferences load/validate/autosave/reset work; Configuration column is interactive; Telemetry and HUD panels are structural placeholders; Start/Stop is disabled until the vibration engine is linked.

## Project status

- Functional on the hardware listed below
- First public / community release (`v0.1.0`)
- **Not affiliated with, endorsed by, or supported by WinWing or Microsoft**
- Compatibility is limited to the devices and grips that were actually tested

## Tested hardware

| Item | Notes |
|------|--------|
| WinWing Orion 2 Throttle Base II | USB PID `0xBD64` |
| F-15EX throttle grips (left + right) | Vibration motors on each grip |
| WinWing Orion 2 Joystick Base 2 | USB PID `0xBEA8` |
| F-16 joystick grip | Vibration motor |
| Microsoft Flight Simulator 2024 | Windows |

Other WinWing PIDs, grips, or bases are **not** claimed to work.

## How it works

1. SimConnect streams selected aircraft variables each simulation frame.
2. The bridge converts those values into haptic intensities (engine, aero, etc.).
3. Intensities are sent as short HID output reports to the open WinWing devices.
4. A ~50 Hz refresh loop keeps motors active (vibration stops if reports stop).

**SimAppPro is not required** while this bridge is running. Close or avoid exclusive locks from other tools if a device fails to open.

This program does not send flight data over the Internet. It only uses local SimConnect and local HID I/O (plus normal Node.js package installs when building from source).

## Current effects

Effects are a **haptic interpretation** of available SimVars, not certified flight fidelity:

- Engine RPM per engine (piston / turboprop / jet)
- Afterburner per engine (where SimVars are present)
- Touchdown pulse (based on last airborne vertical speed, wall-clock decay)
- Landing gear transit and gear drag
- Stall buffet
- G-force buffet
- Transonic / supersonic buffet
- Speed brake
- Flap buffet
- Helicopter rotor rumble, ETL, and VRS cues
- Light APU vibration when engines are off

Aircraft that do not expose a given SimVar will simply not produce that effect.

## Install from a release

When a GitHub Release is published, download `WinwingVibration.exe`, connect the tested hardware, start MSFS 2024, then run the executable.

Windows Defender / SmartScreen may warn about an **unsigned community binary**. That is expected until a signed release exists. Prefer building from source if you want to verify the code yourself.

*(No release artifact is guaranteed to exist yet—check the repository Releases page.)*

## Install from source

**Requirements**

- Windows
- [Node.js](https://nodejs.org/) **20 or newer** (build uses `@yao-pkg/pkg` target `node22-win-x64`)
- MSFS 2024 installed (for SimConnect)
- Compatible WinWing hardware connected

```bash
npm ci
npm start
```

Build the CLI executable:

```bash
npm run build
# or explicitly:
npm run build:cli
```

Output: `dist/WinwingVibration.exe` (not committed to git). The packaged runtime is Node 22.

Run unit tests (CLI core + launcher preferences; no simulator / no hardware required):

```bash
npm test
```

## Usage

1. Connect the Throttle Base II and/or Joystick Base 2 with the tested grips.
2. Launch MSFS 2024 and load a flight.
3. Start the bridge (`npm start` or the release executable).
4. Keep the console window open while flying.
5. Press `Ctrl+C` for a clean shutdown (motors are zeroed before exit).

If hardware is plugged in later, the bridge periodically re-scans and opens newly available devices.

## Known limitations

- Windows only
- Only the listed USB PIDs / grip combinations are supported
- Intensities and curves are hard-coded in the **CLI**; the launcher stores editable profiles locally but does not drive motors yet
- Release binaries are unsigned
- Effect quality depends on SimVars each aircraft publishes
- Third-party aircraft may omit or mishandle some variables
- Desktop launcher does not yet connect SimConnect, HID, or the vibration engine

Experimental HID research scripts live under `tools/hardware-research/` and are not required to run the bridge.

## Safety and disclaimer

- Unofficial community software
- Not affiliated with, approved by, or supported by WinWing or Microsoft
- Use at your own risk; provided **without warranty** of any kind
- Stop the software immediately if vibration behaviour is unexpected or excessive
- **Never** use this software as a source of real-world flight information

## Credits

[Ursa Minor FFB](https://github.com/rtroncoso/ursa-minor-ffb) by [rtroncoso](https://github.com/rtroncoso) — MIT-licensed research and tooling for WinWing **Ursa Minor** sidestick force-feedback / rumble via SimConnect.

This Orion 2 bridge targets **different hardware** (Throttle Base II + F-15EX grips, Joystick Base 2 + F-16 grip) and uses its own code and motor routing. Public research around continuous HID refresh for WinWing vibration motors informed the need for an ongoing output loop in this project. Thanks to the author for sharing that work.

## Contributing

Bug reports and compatibility notes are welcome. Please include:

- Exact hardware (base + grip) and USB PID if known
- Aircraft title
- MSFS 2024 version / build if available
- Steps to reproduce
- Relevant console logs **without** personal paths or account data

Pull requests that change feel curves should explain the motivation; please keep the supported hardware scope clear.

## License

[MIT](./LICENSE) — Copyright (c) 2026 Apch132
