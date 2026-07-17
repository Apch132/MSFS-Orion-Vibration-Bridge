/**
 * Build the autonomous bridge-host sidecar for the Tauri launcher.
 * Output uses Tauri 2 externalBin naming for Windows MSVC.
 */

'use strict'

const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const TARGET_TRIPLE = 'x86_64-pc-windows-msvc'
const SIDECAR_NAME = 'bridge-host'
const STAGING = path.join(ROOT, 'dist', 'sidecars', `${SIDECAR_NAME}.exe`)
const DIST_NAMED = path.join(
  ROOT,
  'dist',
  'sidecars',
  `${SIDECAR_NAME}-${TARGET_TRIPLE}.exe`,
)
const TAURI_BINARIES = path.join(
  ROOT,
  'apps',
  'launcher',
  'src-tauri',
  'binaries',
)
const TAURI_NAMED = path.join(TAURI_BINARIES, `${SIDECAR_NAME}-${TARGET_TRIPLE}.exe`)
const ENTRY = path.join(ROOT, 'lib', 'bridge', 'host.js')
const PKG_CONFIG = path.join(ROOT, 'package.json')

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function resolvePkgBin() {
  const candidates = [
    path.join(ROOT, 'node_modules', '@yao-pkg', 'pkg', 'lib-es5', 'bin.js'),
    path.join(ROOT, 'node_modules', 'pkg', 'lib-es5', 'bin.js'),
  ]
  for (const local of candidates) {
    if (fs.existsSync(local)) return { cmd: process.execPath, argsPrefix: [local] }
  }
  const binName = process.platform === 'win32' ? 'pkg.cmd' : 'pkg'
  const bin = path.join(ROOT, 'node_modules', '.bin', binName)
  if (fs.existsSync(bin)) return { cmd: bin, argsPrefix: [] }
  throw new Error('[@yao-pkg/pkg] not found — run npm install')
}

function runPkg() {
  ensureDir(path.dirname(STAGING))
  const { cmd, argsPrefix } = resolvePkgBin()
  const args = [
    ...argsPrefix,
    ENTRY,
    '--targets',
    'node22-win-x64',
    '--output',
    STAGING,
    '--config',
    PKG_CONFIG,
  ]
  console.log(`[build:bridge-host] ${cmd} ${args.join(' ')}`)
  const result = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: false,
  })
  if (result.status !== 0) {
    process.exit(result.status || 1)
  }
}

function copySidecar() {
  if (!fs.existsSync(STAGING)) {
    console.error(`[build:bridge-host] missing staged binary: ${STAGING}`)
    process.exit(1)
  }
  ensureDir(path.dirname(DIST_NAMED))
  ensureDir(TAURI_BINARIES)
  fs.copyFileSync(STAGING, DIST_NAMED)
  fs.copyFileSync(STAGING, TAURI_NAMED)
  const size = fs.statSync(TAURI_NAMED).size
  console.log(`[build:bridge-host] wrote ${DIST_NAMED}`)
  console.log(`[build:bridge-host] wrote ${TAURI_NAMED} (${size} bytes)`)
}

runPkg()
copySidecar()
