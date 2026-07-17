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
