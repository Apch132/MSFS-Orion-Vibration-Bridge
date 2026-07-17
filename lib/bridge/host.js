/**
 * Stdio JSON host for the shared bridge.
 * One newline-delimited JSON object per message.
 *
 * Commands in:
 *   {"cmd":"start"}
 *   {"cmd":"stop"}
 *   {"cmd":"updatePreferences","preferences":{...}}
 *   {"cmd":"getState"}
 *   {"cmd":"ping"}
 *
 * Events out:
 *   {"event":"ready","state":{...}}
 *   {"event":"state","state":{...}}
 *   {"event":"log","level":"info","message":"..."}
 *   {"event":"error","message":"..."}
 *   {"event":"pong"}
 */

'use strict'

const readline = require('readline')
const {
  createBridge,
  getDefaultBridgePreferences,
} = require('./create-bridge')

function send(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`)
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
      send({ event: 'log', level, message })
    },
  })

  bridge.on('state', (state) => send({ event: 'state', state }))

  send({ event: 'ready', state: bridge.getState() })

  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })

  for await (const line of rl) {
    const trimmed = String(line || '').trim()
    if (!trimmed) continue
    let msg
    try {
      msg = JSON.parse(trimmed)
    } catch (err) {
      send({ event: 'error', message: `invalid json: ${err.message}` })
      continue
    }

    try {
      switch (msg.cmd) {
        case 'ping':
          send({ event: 'pong' })
          break
        case 'start': {
          if (msg.preferences) bridge.updatePreferences(msg.preferences)
          const state = await bridge.start()
          send({ event: 'started', state })
          break
        }
        case 'stop': {
          const state = await bridge.stop()
          send({ event: 'stopped', state })
          break
        }
        case 'updatePreferences': {
          const preferences = bridge.updatePreferences(msg.preferences)
          send({ event: 'preferencesUpdated', preferences, state: bridge.getState() })
          break
        }
        case 'getState':
          send({ event: 'state', state: bridge.getState() })
          break
        case 'shutdown': {
          await bridge.stop()
          send({ event: 'bye' })
          process.exit(0)
          break
        }
        default:
          send({ event: 'error', message: `unknown cmd: ${msg.cmd}` })
      }
    } catch (err) {
      send({ event: 'error', message: err && err.message ? err.message : String(err) })
    }
  }

  await bridge.stop()
}

main().catch((err) => {
  send({ event: 'error', message: err && err.stack ? err.stack : String(err) })
  process.exit(1)
})
