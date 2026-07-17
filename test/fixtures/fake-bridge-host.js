/**
 * Lightweight stdio JSON fake used by Rust sidecar protocol tests.
 * Does not touch SimConnect or HID.
 */

'use strict'

const readline = require('readline')

const PROTOCOL_VERSION = 1

function send(obj) {
  process.stdout.write(`${JSON.stringify({ protocolVersion: PROTOCOL_VERSION, ...obj })}\n`)
}

async function main() {
  if (process.argv.includes('--hang-before-ready')) {
    // Stay alive without emitting ready (startup-timeout simulation).
    setInterval(() => {}, 60_000)
    return
  }

  const state = {
    status: 'stopped',
    running: false,
    simConnected: false,
    simApplicationName: null,
    hidOpenCount: 0,
    preferences: {},
  }

  send({ type: 'ready', event: 'ready', state })

  if (process.argv.includes('--crash-after-ready')) {
    process.exit(2)
  }

  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
  for await (const line of rl) {
    const trimmed = String(line || '').trim()
    if (!trimmed) continue
    let msg
    try {
      msg = JSON.parse(trimmed)
    } catch (err) {
      send({ type: 'error', event: 'error', message: `invalid json: ${err.message}` })
      continue
    }

    switch (msg.cmd) {
      case 'ping':
        send({ type: 'pong', event: 'pong' })
        break
      case 'start':
        state.status = 'running'
        state.running = true
        if (msg.preferences) state.preferences = msg.preferences
        send({ type: 'started', event: 'started', state })
        break
      case 'stop':
        state.status = 'stopped'
        state.running = false
        send({ type: 'stopped', event: 'stopped', state })
        break
      case 'updatePreferences':
        state.preferences = msg.preferences || {}
        send({
          type: 'preferencesUpdated',
          event: 'preferencesUpdated',
          preferences: state.preferences,
          state,
        })
        break
      case 'getState':
        send({ type: 'state', event: 'state', state })
        break
      case 'getTelemetry':
        send({
          type: 'telemetry',
          event: 'telemetry',
          payload: {
            schemaVersion: 1,
            timestamp: Date.now(),
            stale: false,
            connection: {
              simconnect: state.simConnected ? 'connected' : 'disconnected',
              hid: state.hidOpenCount > 0 ? 'connected' : 'disconnected',
            },
            aircraft: {
              title: 'Fake Aircraft',
              type: 'Jet',
              category: 'Airplane',
              isHelicopter: false,
              engineCount: 2,
            },
            flight: {
              indicatedAirspeedKts: 220,
              trueAirspeedKts: 230,
              groundSpeedKts: 210,
              altitudeFt: 12000,
              verticalSpeedFpm: 0,
              headingDeg: 90,
              pitchDeg: 2,
              bankDeg: 0,
              mach: 0.55,
              gForce: 1,
              angleOfAttackDeg: 3,
              sideslipDeg: 0,
            },
            aircraftState: {
              onGround: false,
              gearPosition: 0,
              flapsPosition: 0,
              spoilersPosition: 0,
              stallWarning: false,
              overspeedWarning: false,
              afterburnerActive: false,
            },
            controls: {
              stickX: 0,
              stickY: 0,
              rudder: 0,
              leftThrottle: 0.6,
              rightThrottle: 0.6,
              brakesLeft: 0,
              brakesRight: 0,
            },
            engines: [
              { index: 1, running: true, rpmPercent: 80, n1Percent: 80, n2Percent: 85, combustion: true },
              { index: 2, running: true, rpmPercent: 80, n1Percent: 80, n2Percent: 85, combustion: true },
            ],
          },
        })
        break
      case 'shutdown':
        send({ type: 'shutdownComplete', event: 'shutdownComplete' })
        process.exit(0)
        break
      default:
        send({ type: 'error', event: 'error', message: `unknown cmd: ${msg.cmd}` })
    }
  }
}

main().catch((err) => {
  send({ type: 'error', event: 'error', message: String(err && err.stack ? err.stack : err) })
  process.exit(1)
})
