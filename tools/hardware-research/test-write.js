/**
 * WinWing HID write test — tries multiple approaches to send vibration.
 *
 * Approach A: node-hid sendFeatureReport  (HID feature report)
 * Approach B: Windows HidD_SetOutputReport via koffi + hid.dll
 * Approach C: Windows HidD_SetFeatureReport via koffi + hid.dll
 *
 * Run: node test-write.js
 */

'use strict'

const HID    = require('node-hid')
const koffi  = require('koffi')

const WINWING_VID = 0x4098
// From SimLogic.log: PID 48808 (0xBEA8) = Joystick Base 2 + F16 JGRIP
const TARGET_PID  = 0xBEA8

// ─── Find device ────────────────────────────────────────────────────────────

const all      = HID.devices()
const winwing  = all.filter(d => d.vendorId === WINWING_VID && d.productId === TARGET_PID)

if (winwing.length === 0) {
  console.error('WinWing joystick not found! (VID 0x4098, PID 0xBEA8)')
  process.exit(1)
}

console.log('WinWing interfaces found:')
winwing.forEach((d, i) => {
  console.log(`  [${i}] interface=${d.interface} usagePage=0x${d.usagePage?.toString(16)} usage=0x${d.usage?.toString(16)}`)
  console.log(`       path: ${d.path}`)
})
console.log()

// ─── Build vibration buffer ──────────────────────────────────────────────────
// From WWTHID.log: SET_LEDX data: 49 [motor_index] [value]
// Byte 0 = report ID (0x00 for output, non-zero for feature)
// Byte 1 = 0x49 command
// Byte 2 = motor index (0)
// Byte 3 = intensity (100)

function makeReport(reportId, intensity) {
  const buf = Buffer.alloc(65, 0)
  buf[0] = reportId
  buf[1] = 0x49
  buf[2] = 0x00          // motor index
  buf[3] = intensity
  return buf
}

// ─── Approach A: node-hid feature report ─────────────────────────────────────

console.log('=== Approach A: node-hid sendFeatureReport ===')
for (const iface of winwing) {
  try {
    const dev = new HID.HID(iface.path)

    // Try feature report IDs 0, 1, 2
    for (const rid of [0, 1, 2]) {
      const buf = makeReport(rid, 100)
      try {
        dev.sendFeatureReport(Array.from(buf))
        console.log(`  [OK] feature report ID=${rid} on interface ${iface.interface}`)
        setTimeout(() => {
          dev.sendFeatureReport(Array.from(makeReport(rid, 0)))
          dev.close()
        }, 500)
      } catch (e) {
        console.log(`  [--] feature report ID=${rid} interface ${iface.interface}: ${e.message}`)
      }
    }
    dev.close()
  } catch (e) {
    console.log(`  [FAIL] open interface ${iface.interface}: ${e.message}`)
  }
}

// ─── Approach B & C: Windows HID API via koffi ───────────────────────────────

console.log('\n=== Approach B+C: Windows HID API (HidD_SetOutputReport / SetFeatureReport) ===')

const kernel32 = koffi.load('kernel32.dll')
const hidDll   = koffi.load('hid.dll')

const GENERIC_WRITE       = 0x40000000
const GENERIC_READ        = 0x80000000
const FILE_SHARE_READ     = 0x00000001
const FILE_SHARE_WRITE    = 0x00000002
const OPEN_EXISTING       = 3
const INVALID_HANDLE      = BigInt('0xFFFFFFFFFFFFFFFF')

const CreateFileW = kernel32.func('CreateFileW',
  'void*', ['str16', 'uint32', 'uint32', 'void*', 'uint32', 'uint32', 'void*'])
const CloseHandle = kernel32.func('CloseHandle',
  'int', ['void*'])
const GetLastError = kernel32.func('GetLastError',
  'uint32', [])

// HidD_SetOutputReport(handle, reportBuffer, reportBufferLength) -> BOOLEAN
const SetOutputReport  = hidDll.func('HidD_SetOutputReport',
  'bool', ['void*', 'void*', 'uint32'])
// HidD_SetFeatureReport(handle, reportBuffer, reportBufferLength) -> BOOLEAN
const SetFeatureReport = hidDll.func('HidD_SetFeatureReport',
  'bool', ['void*', 'void*', 'uint32'])

for (const iface of winwing) {
  // Convert node-hid path to wide string (already a string on Windows)
  const handle = CreateFileW(
    iface.path,
    GENERIC_READ | GENERIC_WRITE,
    FILE_SHARE_READ | FILE_SHARE_WRITE,
    null,
    OPEN_EXISTING,
    0,
    null
  )

  const ptr = koffi.address(handle)
  if (ptr === INVALID_HANDLE || ptr === 0n) {
    const err = GetLastError()
    console.log(`  [FAIL] CreateFile interface ${iface.interface}: error ${err} (0x${err.toString(16)})`)
    continue
  }
  console.log(`  [OK] Opened interface ${iface.interface} via CreateFile`)

  const report = makeReport(0, 100)

  // Try output report
  const okOut = SetOutputReport(handle, report, report.length)
  if (okOut) {
    console.log(`  [OK] HidD_SetOutputReport succeeded on interface ${iface.interface}!`)
    setTimeout(() => {
      SetOutputReport(handle, makeReport(0, 0), 65)
    }, 500)
  } else {
    const err = GetLastError()
    console.log(`  [--] SetOutputReport interface ${iface.interface}: error ${err} (0x${err.toString(16)})`)
  }

  // Try feature report
  const okFeat = SetFeatureReport(handle, report, report.length)
  if (okFeat) {
    console.log(`  [OK] HidD_SetFeatureReport succeeded on interface ${iface.interface}!`)
    setTimeout(() => {
      SetFeatureReport(handle, makeReport(0, 0), 65)
    }, 500)
  } else {
    const err = GetLastError()
    console.log(`  [--] SetFeatureReport interface ${iface.interface}: error ${err} (0x${err.toString(16)})`)
  }

  CloseHandle(handle)
}

console.log('\nDone. Did any approach succeed?')
