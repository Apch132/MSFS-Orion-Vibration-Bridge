/**
 * Bounded smoke test for the packaged bridge-host sidecar.
 * Uses the compiled exe (never node + host.js), speaks the stdio protocol,
 * and validates SimConnect reachability when MSFS is running.
 *
 * Exit codes:
 *   0 — ready + start + at least one connected telemetry (or simConnected state)
 *   2 — sidecar missing / failed to start
 *   3 — protocol handshake failure
 *   4 — MSFS / SimConnect did not connect within timeout
 *   5 — unexpected error
 */

'use strict'

const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const readline = require('node:readline')

const ROOT = path.join(__dirname, '..')
const TIMEOUT_MS = Number(process.env.ORION_SMOKE_TIMEOUT_MS || 25000)
const TARGET_TRIPLE = 'x86_64-pc-windows-msvc'

function resolveSidecar() {
  const override = process.env.ORION_BRIDGE_SIDECAR
  if (override && fs.existsSync(override)) return path.resolve(override)

  const candidates = [
    path.join(ROOT, 'dist', 'sidecars', `bridge-host-${TARGET_TRIPLE}.exe`),
    path.join(ROOT, 'dist', 'sidecars', 'bridge-host.exe'),
    path.join(
      ROOT,
      'apps',
      'launcher',
      'src-tauri',
      'binaries',
      `bridge-host-${TARGET_TRIPLE}.exe`,
    ),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

function fail(code, message) {
  process.stderr.write(`[smoke:bridge-host] FAIL: ${message}\n`)
  process.exit(code)
}

function info(message) {
  process.stderr.write(`[smoke:bridge-host] ${message}\n`)
}

async function main() {
  const sidecar = resolveSidecar()
  if (!sidecar) {
    fail(
      2,
      'compiled bridge-host.exe not found. Run `npm run build:bridge-host` first.',
    )
  }

  info(`using sidecar: ${sidecar}`)
  info(`timeout: ${TIMEOUT_MS}ms`)

  const child = spawn(sidecar, [], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })

  const stderrLines = []
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => {
    const text = String(chunk)
    stderrLines.push(text)
    process.stderr.write(text)
  })

  const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity })
  const pending = []
  let waiters = []

  rl.on('line', (line) => {
    const trimmed = String(line || '').trim()
    if (!trimmed) return
    let msg
    try {
      msg = JSON.parse(trimmed)
    } catch (err) {
      info(`non-json stdout: ${trimmed.slice(0, 120)}`)
      return
    }
    if (waiters.length) waiters.shift().resolve(msg)
    else pending.push(msg)
  })

  function nextEvent(timeoutMs = TIMEOUT_MS) {
    if (pending.length) return Promise.resolve(pending.shift())
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        waiters = waiters.filter((w) => w.resolve !== resolve)
        reject(new Error(`timeout waiting for host event (${timeoutMs}ms)`))
      }, timeoutMs)
      waiters.push({
        resolve(msg) {
          clearTimeout(timer)
          resolve(msg)
        },
        reject(err) {
          clearTimeout(timer)
          reject(err)
        },
      })
    })
  }

  function send(cmd) {
    child.stdin.write(`${JSON.stringify(cmd)}\n`)
  }

  async function shutdown() {
    try {
      send({ cmd: 'shutdown', protocolVersion: 1 })
    } catch {
      /* ignore */
    }
    await new Promise((resolve) => {
      const t = setTimeout(() => {
        try { child.kill() } catch { /* ignore */ }
        resolve()
      }, 4000)
      child.once('exit', () => {
        clearTimeout(t)
        resolve()
      })
    })
    rl.close()
  }

  let exitCode = 0
  try {
    const ready = await nextEvent(15000)
    if (ready.type !== 'ready' && ready.event !== 'ready') {
      fail(3, `expected ready, got ${JSON.stringify(ready)}`)
    }
    info('handshake: ready')

    send({ cmd: 'start', protocolVersion: 1 })
    const started = await nextEvent(10000)
    if (started.type !== 'started' && started.event !== 'started') {
      // May receive state/telemetry before started
      let current = started
      const deadline = Date.now() + 10000
      while (current.type !== 'started' && current.event !== 'started') {
        if (Date.now() > deadline) {
          fail(3, `expected started, last=${JSON.stringify(current)}`)
        }
        current = await nextEvent(Math.max(500, deadline - Date.now()))
      }
      info('command: started')
    } else {
      info('command: started')
    }

    const deadline = Date.now() + TIMEOUT_MS
    let sawTelemetry = false
    let simConnected = false
    let hidConnected = false
    let sample = null

    while (Date.now() < deadline) {
      const remaining = Math.max(200, deadline - Date.now())
      let msg
      try {
        msg = await nextEvent(remaining)
      } catch {
        break
      }

      if (msg.type === 'state' || msg.event === 'state') {
        if (msg.state?.simConnected) simConnected = true
        if ((msg.state?.hidOpenCount || 0) > 0) hidConnected = true
      }

      if (msg.type === 'telemetry' || msg.event === 'telemetry') {
        sawTelemetry = true
        sample = msg.payload || null
        const sim = sample?.connection?.simconnect
        if (sim === 'connected') simConnected = true
        if (sample?.connection?.hid === 'connected') hidConnected = true
        if (simConnected) break
      }
    }

    info(`simConnected=${simConnected} hidConnected=${hidConnected} sawTelemetry=${sawTelemetry}`)
    if (sample) {
      info(
        `telemetry sample: ias=${sample.flight?.indicatedAirspeedKts} `
        + `alt=${sample.flight?.altitudeFt} `
        + `title=${JSON.stringify(sample.aircraft?.title || '')}`,
      )
    }

    const simLoaded = stderrLines.some((l) => /\[SIM\] Connecting/i.test(l))
      || stderrLines.some((l) => /\[SIM\] Connected/i.test(l))
      || stderrLines.some((l) => /\[SIM\] Not connected/i.test(l))
    info(`simconnect client invoked: ${simLoaded}`)

    if (!simConnected) {
      exitCode = 4
      info(
        'MSFS did not accept a SimConnect session within the timeout. '
        + 'Start MSFS 2024 (in a flight) and re-run. HID absence is non-blocking.',
      )
    } else {
      info('PASS: SimConnect connected and structured state received from packaged sidecar')
      if (!hidConnected) {
        info('note: no WinWing HID device detected (telemetry still valid)')
      }
    }

    send({ cmd: 'stop', protocolVersion: 1 })
    try {
      await nextEvent(5000)
    } catch {
      /* ignore */
    }
  } catch (err) {
    exitCode = exitCode || 5
    info(`error: ${err && err.message ? err.message : err}`)
  } finally {
    await shutdown()
  }

  process.exit(exitCode)
}

main().catch((err) => {
  fail(5, err && err.stack ? err.stack : String(err))
})
