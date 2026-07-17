# Desktop launcher

Tauri 2 + Vite + TypeScript shell for WinWing MSFS Vibration Bridge.

This package owns **local preferences only** in this milestone. It does not open SimConnect or HID devices and does not call `lib/vibration-core.js` yet.

```bash
npm ci
npm test
npm run typecheck
npm run tauri:dev
npm run tauri:build
```

Preferences are validated in `src/preferences/` and persisted with `@tauri-apps/plugin-store` under the OS app data directory.
