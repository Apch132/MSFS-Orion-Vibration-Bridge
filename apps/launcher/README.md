# Desktop launcher

Tauri 2 + Vite + TypeScript shell for WinWing MSFS Vibration Bridge.

This package owns local preferences and Start/Stop against the shared Node bridge host (`lib/bridge`). The webview never imports SimConnect or HID modules.

```bash
npm ci
npm test
npm run typecheck
npm run tauri:dev
npm run tauri:build
```

Requires Node.js on PATH so the launcher can spawn `lib/bridge/host.js`.
