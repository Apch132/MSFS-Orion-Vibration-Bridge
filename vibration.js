/**
 * WinWing MSFS2024 Vibration Bridge — CLI entry
 *
 * Thin process wrapper around the shared bridge runtime.
 * Usage:  node vibration.js
 */

'use strict'

const {
  createBridge,
  getDefaultBridgePreferences,
  APP_VERSION,
} = require('./lib/bridge')

async function main() {
  console.log('╔══════════════════════════════════════════════╗')
  console.log(`║  WinWing MSFS2024 Vibration Bridge  v${APP_VERSION}   ║`)
  console.log('╚══════════════════════════════════════════════╝')
  console.log('  Ctrl+C to stop\n')

  const bridge = createBridge({
    preferences: getDefaultBridgePreferences(),
  })

  let exiting = false
  async function shutdown(code = 0) {
    if (exiting) return
    exiting = true
    console.log('\n[EXIT] Stopping...')
    try {
      await bridge.stop()
    } finally {
      process.exit(code)
    }
  }

  process.on('SIGINT', () => { void shutdown(0) })
  process.on('SIGTERM', () => { void shutdown(0) })
  process.on('uncaughtException', (err) => {
    console.error('[FATAL] uncaughtException:', err && err.stack ? err.stack : err)
    void shutdown(1)
  })
  process.on('unhandledRejection', (reason) => {
    console.error('[FATAL] unhandledRejection:', reason)
    void shutdown(1)
  })

  await bridge.start()
}

main().catch((err) => {
  console.error('[FATAL]', err)
  process.exit(1)
})
