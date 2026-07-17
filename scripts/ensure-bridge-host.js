/**
 * Ensure the Tauri sidecar binary exists (build if missing or --force).
 * Used by tauri beforeDevCommand / beforeBuildCommand.
 */

'use strict'

const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const TARGET_TRIPLE = 'x86_64-pc-windows-msvc'
const TAURI_NAMED = path.join(
  ROOT,
  'apps',
  'launcher',
  'src-tauri',
  'binaries',
  `bridge-host-${TARGET_TRIPLE}.exe`,
)

const force = process.argv.includes('--force')
if (!force && fs.existsSync(TAURI_NAMED)) {
  console.log(`[ensure-bridge-host] sidecar present: ${TAURI_NAMED}`)
  process.exit(0)
}

const result = spawnSync(process.execPath, [path.join(__dirname, 'build-bridge-host.js')], {
  cwd: ROOT,
  stdio: 'inherit',
})
process.exit(result.status || 0)
