/**
 * Stdio JSON host for the shared bridge.
 * One newline-delimited JSON object per message.
 * Human-readable logs go to stderr; protocol messages go to stdout only.
 *
 * Commands in:
 *   {"cmd":"start"}
 *   {"cmd":"stop"}
 *   {"cmd":"updatePreferences","preferences":{...}}
 *   {"cmd":"getState"}
 *   {"cmd":"getTelemetry"}
 *   {"cmd":"ping"}
 *   {"cmd":"shutdown"}
 *
 * Events out (protocolVersion: 1):
 *   ready | started | stopped | state | telemetry | event
 *   error | preferencesUpdated | pong | shutdownComplete
 */

'use strict'

if (process.argv.includes('--runtime-version')) {
  process.stdout.write(process.version + '\n')
  process.exit(0)
}

const readline = require('readline')
const {
  createBridge,
  getDefaultBridgePreferences,
} = require('./create-bridge')

const PROTOCOL_VERSION = 1

function send(obj) {
  const payload = { protocolVersion: PROTOCOL_VERSION, ...obj }
  process.stdout.write(`${JSON.stringify(payload)}\n`)
}

function logHuman(level, message) {
  process.stderr.write(`[bridge-host][${level}] ${message}\n`)
}

async function main() {
  const initial = process.argv.includes('--preferences')
    ? (() => {
        const idx = process.argv.indexOf('--preferences')
        try {
          return JSON.parse(process.argv[idx + 1] || '{}')
        } catch {
          return getDefaultBridgePreferences()
        }
      })()
    : getDefaultBridgePreferences()

  const bridge = createBridge({
    preferences: initial,
    logger(level, message) {
      logHuman(level, message)
    },
  })

  bridge.on('state', (state) => send({ type: 'state', event: 'state', state }))
  bridge.on('telemetry', (payload) => send({
    type: 'telemetry',
    event: 'telemetry',
    payload,
  }))
  bridge.on('flightEvent', (payload) => send({
    type: 'event',
    event: 'event',
    payload,
  }))

  send({ type: 'ready', event: 'ready', state: bridge.getState() })

  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })

  for await (const line of rl) {
    const trimmed = String(line || '').trim()
    if (!trimmed) continue
    let msg
    try {
      msg = JSON.parse(trimmed)
    } catch (err) {
      send({
        type: 'error',
        event: 'error',
        message: `invalid json: ${err.message}`,
      })
      continue
    }

    try {
      switch (msg.cmd) {
        case 'ping':
          send({ type: 'pong', event: 'pong' })
          break
        case 'start': {
          if (msg.preferences) bridge.updatePreferences(msg.preferences)
          const state = await bridge.start()
          send({ type: 'started', event: 'started', state })
          break
        }
        case 'stop': {
          const state = await bridge.stop()
          send({ type: 'stopped', event: 'stopped', state })
          break
        }
        case 'updatePreferences': {
          const preferences = bridge.updatePreferences(msg.preferences)
          send({
            type: 'preferencesUpdated',
            event: 'preferencesUpdated',
            preferences,
            state: bridge.getState(),
          })
          break
        }
        case 'getState':
          send({ type: 'state', event: 'state', state: bridge.getState() })
          break
        case 'getTelemetry':
          send({
            type: 'telemetry',
            event: 'telemetry',
            payload: bridge.getTelemetry(),
          })
          break
        case 'shutdown': {
          await bridge.stop()
          send({ type: 'shutdownComplete', event: 'shutdownComplete' })
          process.exit(0)
          break
        }
        default:
          send({
            type: 'error',
            event: 'error',
            message: `unknown cmd: ${msg.cmd}`,
          })
      }
    } catch (err) {
      send({
        type: 'error',
        event: 'error',
        message: err && err.message ? err.message : String(err),
      })
    }
  }

  await bridge.stop()
  send({ type: 'shutdownComplete', event: 'shutdownComplete' })
}

main().catch((err) => {
  send({
    type: 'error',
    event: 'error',
    message: err && err.stack ? err.stack : String(err),
  })
  process.exit(1)
})
