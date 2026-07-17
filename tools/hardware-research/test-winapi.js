/**
 * Test Windows HID API directly for WinWing vibration.
 * Uses koffi to call CreateFile + HidD_SetOutputReport / HidD_SetFeature
 */
'use strict'

const koffi = require('koffi')
const HID   = require('node-hid')

const WINWING_VID = 0x4098

const kernel32 = koffi.load('kernel32.dll')
const hidDll   = koffi.load('hid.dll')

const GENERIC_WRITE   = 0x40000000
const GENERIC_READ    = 0x80000000
const FILE_SHARE_READ = 0x00000001
const FILE_SHARE_WRITE= 0x00000002
const OPEN_EXISTING   = 3
const FILE_FLAG_OVERLAPPED = 0x40000000

const CreateFileW      = kernel32.func('CreateFileW', 'void*',
  ['str16', 'uint32', 'uint32', 'void*', 'uint32', 'uint32', 'void*'])
const CloseHandle      = kernel32.func('CloseHandle', 'int', ['void*'])
const GetLastError     = kernel32.func('GetLastError', 'uint32', [])
const WriteFile        = kernel32.func('WriteFile', 'int',
  ['void*', 'void*', 'uint32', '_Out_ uint32 *', 'void*'])

const SetOutputReport  = hidDll.func('HidD_SetOutputReport', 'bool',
  ['void*', 'void*', 'uint32'])
const SetFeature       = hidDll.func('HidD_SetFeature', 'bool',
  ['void*', 'void*', 'uint32'])

// ─── Build report ────────────────────────────────────────────────────────────

function makeReport(reportId, intensity) {
  const buf = Buffer.alloc(65, 0)
  buf[0] = reportId  // report ID
  buf[1] = 0x49      // SET_LEDX
  buf[2] = 0x00      // motor 0
  buf[3] = intensity
  return buf
}

// ─── Test all WinWing devices ─────────────────────────────────────────────────

const devices = HID.devices().filter(d => d.vendorId === WINWING_VID)
console.log(`Found ${devices.length} WinWing interface(s)\n`)

for (const d of devices) {
  console.log(`PID=0x${d.productId.toString(16).toUpperCase()} iface=${d.interface}`)
  console.log(`  path: ${d.path}`)

  // Try: GENERIC_READ | GENERIC_WRITE, shared
  for (const [label, access, share, flags] of [
    ['RW shared',    GENERIC_READ | GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE, 0],
    ['W only shared',GENERIC_WRITE,                FILE_SHARE_READ | FILE_SHARE_WRITE, 0],
    ['RW excl',      GENERIC_READ | GENERIC_WRITE, 0, 0],
  ]) {
    const h = CreateFileW(d.path, access, share, null, OPEN_EXISTING, flags, null)
    const ptr = koffi.address(h)
    const INVALID = BigInt('0xFFFFFFFFFFFFFFFF')

    if (ptr === INVALID || ptr === 0n) {
      const err = GetLastError()
      console.log(`  [${label}] CreateFile FAIL err=${err} (0x${err.toString(16)})`)
      continue
    }
    console.log(`  [${label}] CreateFile OK`)

    const rpt = makeReport(0, 100)

    // HidD_SetOutputReport
    const bytesWritten = [0]
    const okOut = SetOutputReport(h, rpt, rpt.length)
    if (okOut) {
      console.log(`    HidD_SetOutputReport SUCCEEDED! 🎉`)
    } else {
      const err = GetLastError()
      console.log(`    HidD_SetOutputReport FAIL err=${err} (0x${err.toString(16)})`)
    }

    // HidD_SetFeature
    const okFeat = SetFeature(h, rpt, rpt.length)
    if (okFeat) {
      console.log(`    HidD_SetFeature SUCCEEDED! 🎉`)
    } else {
      const err = GetLastError()
      console.log(`    HidD_SetFeature FAIL err=${err} (0x${err.toString(16)})`)
    }

    CloseHandle(h)
    break  // only test first successful open mode
  }
  console.log()
}
