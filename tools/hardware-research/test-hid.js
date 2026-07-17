/**
 * WinWing HID device discovery test
 * Lists all WinWing devices and tries a vibration pulse.
 *
 * Run: node test-hid.js
 */

'use strict'

const HID = require('node-hid')

const WINWING_VID = 0x4098

// Known WinWing device PIDs
const KNOWN_DEVICES = {
  0xBE07: 'F16 JGRIP',
  0xBEA0: 'Joystick Base 2',
  0xBEA8: 'Orion Joystick Base 2 + F16 JGRIP',
  0xBF01: 'F15EX HANDLE L',
  0xBF02: 'F15EX HANDLE R',
  0xBD64: 'Orion Throttle Base II + F15EX L+R',
  0xBE60: 'Orion Throttle Base II',
}

console.log('=== WinWing HID Device Discovery ===\n')

// List all HID devices
const allDevices = HID.devices()
const winwingDevices = allDevices.filter(d => d.vendorId === WINWING_VID)

if (winwingDevices.length === 0) {
  console.log('No WinWing devices found! (VID 0x4098)')
  console.log('Make sure your controllers are connected.')
  process.exit(1)
}

console.log(`Found ${winwingDevices.length} WinWing HID interface(s):\n`)

winwingDevices.forEach((d, i) => {
  const name = KNOWN_DEVICES[d.productId] || 'Unknown'
  console.log(`[${i}] ${d.product || name}`)
  console.log(`    PID:       0x${d.productId.toString(16).toUpperCase()} (${d.productId})`)
  console.log(`    Usage:     0x${d.usage?.toString(16).toUpperCase()} / Page: 0x${d.usagePage?.toString(16).toUpperCase()}`)
  console.log(`    Interface: ${d.interface}`)
  console.log(`    Path:      ${d.path}`)
  console.log()
})

// Find the best interface for output commands
// WinWing uses usagePage 0xFF00 (vendor-defined) for HID output commands
const outputIface = winwingDevices.find(d =>
  (d.usagePage === 0xFF00 || d.usagePage === 0x0001) &&
  KNOWN_DEVICES[d.productId]
)

if (!outputIface) {
  console.log('Could not auto-select output interface.')
  console.log('Try running vibration.js which will enumerate all interfaces.')
  process.exit(0)
}

console.log(`\nSelected for test: ${outputIface.product} (0x${outputIface.productId.toString(16).toUpperCase()})`)
console.log(`Path: ${outputIface.path}\n`)

let dev
try {
  dev = new HID.HID(outputIface.path)
  console.log('[OK] Device opened')
} catch (e) {
  console.error('[FAIL] Could not open device:', e.message)
  console.error('Try running as Administrator, or close SimAppPro first.')
  process.exit(1)
}

// Try sending a vibration pulse (motor index 0, value 127 = ~50%)
// Format from WWTHID.log: 0x49, motor_index, value, 0...
function sendVibration(motorIndex, value) {
  const report = Buffer.alloc(65, 0)  // 1 byte report-ID + 64 bytes data
  report[0] = 0x00  // Report ID (0 = default)
  report[1] = 0x49  // SET_LEDX command
  report[2] = motorIndex
  report[3] = value
  try {
    dev.write(Array.from(report))
    console.log(`  Sent: 0x49 motor=${motorIndex} value=${value}`)
    return true
  } catch (e) {
    console.error(`  Write failed: ${e.message}`)
    return false
  }
}

console.log('Testing vibration (motor 0, 3 pulses)...')
let count = 0
const interval = setInterval(() => {
  count++
  const val = (count % 2 === 0) ? 0 : 200  // alternate on/off
  sendVibration(0, val)
  if (count >= 6) {
    clearInterval(interval)
    sendVibration(0, 0)  // stop
    dev.close()
    console.log('\nDone. Did you feel a vibration?')
    console.log('If yes → the format works. Run vibration.js for the full bridge.')
    console.log('If no  → the report ID or motor index may differ. Check output above.')
    process.exit(0)
  }
}, 500)
