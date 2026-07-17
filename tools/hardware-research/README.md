# Hardware research tools (experimental)

These scripts are **not** part of the runtime application. They were used during
protocol discovery against WinWing Orion 2 HID interfaces.

| Script | Purpose |
|--------|---------|
| `test-hid.js` | Enumerate WinWing HID interfaces and try a simple vibration pulse |
| `test-write.js` | Compare node-hid vs Windows HID API write paths |
| `test-winapi.js` | Exercise CreateFile / HidD_SetOutputReport / SetFeature |
| `test-init.js` | Replay an observed init / heartbeat / SET_LEDX sequence |

Requirements:

- Windows
- Compatible hardware connected
- `node-hid` (project dependency)
- `koffi` for the WinAPI scripts (`npm install koffi` if needed)

They may open devices exclusively and can interfere with SimAppPro or the main
bridge. Use only for local research.
