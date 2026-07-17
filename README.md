# WinWing MSFS2024 Vibration Bridge

Unofficial Windows utility that reads Microsoft Flight Simulator 2024 telemetry through SimConnect and drives the vibration motors on selected WinWing Orion 2 controllers over HID.

It is a small console application: no cloud services, no configuration UI in this first public version.

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

Build a standalone executable:

```bash
npm run build
```

Output: `dist/WinwingVibration.exe` (not committed to git). The packaged runtime is Node 22.

Run unit tests (no simulator / no hardware required):

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
- Intensities and curves are hard-coded in this version (no external config file)
- Release binaries are unsigned
- Effect quality depends on SimVars each aircraft publishes
- Third-party aircraft may omit or mishandle some variables

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
