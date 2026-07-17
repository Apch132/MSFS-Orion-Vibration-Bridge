# WinWing MSFS2024 Vibration Bridge

Unofficial Windows utility that reads Microsoft Flight Simulator 2024 telemetry through SimConnect and drives the vibration motors on selected WinWing Orion 2 controllers over HID.

It is a Windows utility with two front ends sharing the same vibration core:

- **CLI** (`vibration.js` / `WinwingVibration.exe`) — lightweight, VR-friendly, always uses built-in default feel curves; **requires Node.js** when run from source (the packaged `.exe` is autonomous)
- **Desktop launcher** (Tauri) — local preference UI, saved profiles, Start/Stop via an embedded `bridge-host` sidecar; **Node.js is not required** on end-user machines

## CLI vs Desktop Launcher

| | CLI | Desktop launcher |
|--|-----|------------------|
| Role | Run the vibration bridge | Configure profiles / themes; Start/Stop shared bridge |
| Feel curves | Built-in defaults from the shared core | Editable Aircraft / Helicopter profiles (local only) |
| Preferences file | None | OS app data via Tauri Store (`launcher-preferences.json`) |
| SimConnect / HID | Active via shared `createBridge()` | Same runtime via packaged `bridge-host` sidecar (UI never talks to HID/SimConnect) |
| Runtime dependency | Node.js (source) or packaged CLI exe | None (sidecar embedded in the installer) |
| Best for | VR, minimal footprint | Desktop tuning and future HUD |

Launcher preferences live under the Windows app data directory for identifier `community.winwing.msfs2024-vibration-bridge` (managed by Tauri / the Store plugin). They are **never** read by the CLI and are not stored in the git repository.

### Launcher development

Requirements beyond the CLI: Rust toolchain, Windows WebView2 (usually preinstalled). The bridge host sidecar is built with `@yao-pkg/pkg` before Tauri starts.

```bash
npm --prefix apps/launcher ci
npm run build:bridge-host
npm run dev:launcher
```

`tauri dev` / `tauri build` also call `scripts/ensure-bridge-host.js` automatically so the sidecar exists under `apps/launcher/src-tauri/binaries/`.

Build the launcher NSIS installer (embeds the sidecar):

```bash
npm run build:launcher
```

Typecheck:

```bash
npm run typecheck:launcher
```

**Current launcher status:** preferences load/validate/autosave/reset work; Start/Stop drives the **shared bridge runtime** (same engine as the CLI) through the packaged sidecar; live SimConnect telemetry feeds the Telemetry cards, animated controls, flight-event timeline, and HUD (see [docs/TELEMETRY.md](docs/TELEMETRY.md)).

### Telemetry architecture

```text
MSFS → createBridge() → host stdout (≤15 Hz) → Tauri → launcher UI / HUD
                 ↘ 50 Hz HID vibration (unchanged)
```

- Without MSFS: launcher stays usable; SimConnect shows Disconnected / Connecting; HUD stays neutral.
- Without WinWing HID: telemetry and HUD still work; HID status is independent.
- Sidecar crash: last values marked stale; Start again after the host respawns.

Smoke-test the **packaged** sidecar (not `node lib/bridge/host.js`):

```bash
npm run build:bridge-host
npm run smoke:bridge-host
```

Requires MSFS 2024 in a flight for a full SimConnect pass (exit code `4` if the sim is offline).

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

Effects are a **haptic interpretation** of available SimVars, not certified flight fidelity.

**Intensity sliders (launcher)** map to the real HID motor byte:

| Slider | HID byte |
|--------|----------|
| 0% | 0 |
| 50% | ≈128 |
| 100% | 255 |

Each effect keeps its trigger conditions and 0..1 dynamic curve. The slider is that effect’s hardware ceiling. **Master** multiplies the summed contribution last, then the value is clamped to `0..255` (never 256).

```text
effectOutput = dynamicFactor × (effectSlider / 100) × 255
finalOutput  = clamp(sum(activeEffects) × (master / 100), 0, 255)
```

Effects include:

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

Build the launcher bridge-host sidecar (autonomous; no system Node.js at runtime):

```bash
npm run build:bridge-host
```

Output (not committed):

- `dist/sidecars/bridge-host-x86_64-pc-windows-msvc.exe`
- `apps/launcher/src-tauri/binaries/bridge-host-x86_64-pc-windows-msvc.exe`

Build the desktop launcher (NSIS, embeds the sidecar):

```bash
npm run build:launcher
```

Run unit tests (CLI core + host protocol + launcher preferences; no simulator / no hardware required):

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
- Desktop launcher is autonomous (bundled `bridge-host` sidecar); CLI from source still needs Node.js
- UI telemetry is capped at ~15 Hz; HUD interpolates locally (not a certified instrument)
- Control positions use SimConnect surface/lever positions (not raw USB HID axes)
- Release binaries are unsigned
- Effect quality depends on SimVars each aircraft publishes
- Third-party aircraft may omit or mishandle some variables
- Packaged sidecar uses EvenAR `node-simconnect` (pure JS over the SimConnect service); no `SimConnect.dll` is shipped

Experimental HID research scripts are not part of the public runtime and are not required to run the bridge.

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
