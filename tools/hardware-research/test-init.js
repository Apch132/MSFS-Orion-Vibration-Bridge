/**
 * WinWing Full Init Sequence Test
 *
 * Reproduces the exact sequence observed in WWTHID.log:
 *   1. Init (HW, FW, SN, CFG x4, MODE) with broadcast id: 01 00 00 00
 *   2. Wait for USB reconnect (~3s)
 *   3. Reopen device
 *   4. ONLINE_HEARTBEAT
 *   5. READ_CFG_DATA to each sub-device
 *   6. SET_LEDX vibration pulse on both F15EX handles
 *
 * Packet layout (14 bytes total):
 *   [0x02][id0][id1][id2][id3][cmd][p0][p1][p2][p3][p4][p5][p6][p7]
 *
 * Run: node test-init.js
 */
'use strict'

const koffi  = require('koffi')
const HID    = require('node-hid')

const WINWING_VID  = 0x4098
const THROTTLE_PID = 0xBD64   // Throttle Base II — contains F15EX L + R sub-devices

// ─── Windows API ──────────────────────────────────────────────────────────────

const kernel32 = koffi.load('kernel32.dll')

const CreateFileW  = kernel32.func('CreateFileW', 'void*',
  ['str16', 'uint32', 'uint32', 'void*', 'uint32', 'uint32', 'void*'])
const CloseHandle  = kernel32.func('CloseHandle', 'int', ['void*'])
const GetLastError = kernel32.func('GetLastError', 'uint32', [])
const WriteFile    = kernel32.func('WriteFile', 'int',
  ['void*', 'void*', 'uint32', '_Out_ uint32 *', 'void*'])

const GENERIC_READ    = 0x80000000
const GENERIC_WRITE   = 0x40000000
const FILE_SHARE_READ = 0x00000001
const FILE_SHARE_WRITE= 0x00000002
const OPEN_EXISTING   = 3
const INVALID_HANDLE  = BigInt('0xFFFFFFFFFFFFFFFF')

// ─── Sub-device IDs (little-endian from WWTHID.log) ──────────────────────────

const ID_BROADCAST  = [0x01, 0x00, 0x00, 0x00]  // init target — all sub-devices
const ID_THROTTLE   = [0x60, 0xBE, 0x00, 0x00]  // Throttle Base II
const ID_F15EX_L    = [0x01, 0xBF, 0x00, 0x00]  // F15EX L handle
const ID_F15EX_R    = [0x02, 0xBF, 0x00, 0x00]  // F15EX R handle

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a 14-byte HID output report */
function pkt(id, cmd, ...params) {
  const buf = Buffer.alloc(14, 0)
  buf[0] = 0x02       // report ID — WinWing vendor channel
  buf[1] = id[0]; buf[2] = id[1]; buf[3] = id[2]; buf[4] = id[3]
  buf[5] = cmd
  for (let i = 0; i < params.length && i < 8; i++) buf[6 + i] = params[i]
  return buf
}

function hex(buf) {
  return Array.from(buf).map(b => b.toString(16).padStart(2,'0')).join(' ')
}

function idStr(id) {
  return id.map(b => b.toString(16).padStart(2,'0')).join(' ')
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

// ─── Device open / close ──────────────────────────────────────────────────────

function openThrottle() {
  const devices = HID.devices()
  const d = devices.find(dev => dev.vendorId === WINWING_VID && dev.productId === THROTTLE_PID)
  if (!d) return null

  const h = CreateFileW(
    d.path,
    GENERIC_READ | GENERIC_WRITE,
    FILE_SHARE_READ | FILE_SHARE_WRITE,
    null, OPEN_EXISTING, 0, null
  )
  const ptr = koffi.address(h)
  if (ptr === INVALID_HANDLE || ptr === 0n) {
    console.log(`  CreateFile FAILED  err=${GetLastError()}`)
    return null
  }
  return h
}

function send(h, label, buf) {
  const written = [0]
  const ok = WriteFile(h, buf, buf.length, written, null)
  const err = ok ? '' : `  err=${GetLastError()} (0x${GetLastError().toString(16)})`
  console.log(`  ${ok ? '[OK]' : '[--]'} ${label}${err}`)
  console.log(`       ${hex(buf)}`)
  return ok
}

// ─── Main sequence ────────────────────────────────────────────────────────────

async function run() {
  // ── Open ──────────────────────────────────────────────────────────────────
  let h = openThrottle()
  if (!h) {
    console.error('[FAIL] Throttle device (PID 0xBD64) not found or cannot open')
    process.exit(1)
  }
  console.log('[OK] Opened Throttle Base II (PID 0xBD64)\n')

  // ── Step 1: Broadcast init sequence ───────────────────────────────────────
  console.log('=== Step 1: Broadcast init ===')
  send(h, 'REQUEST_DEVICE_HW  (01)', pkt(ID_BROADCAST, 0x01))
  await sleep(50)
  send(h, 'REQUEST_DEVICE_FW  (02)', pkt(ID_BROADCAST, 0x02))
  await sleep(50)
  send(h, 'REQUEST_DEVICE_SN  (03)', pkt(ID_BROADCAST, 0x03))
  await sleep(50)
  send(h, 'READ_CFG_DATA 0x9c (05)', pkt(ID_BROADCAST, 0x05, 0x9c, 0x00, 0x00, 0x00))
  await sleep(50)
  send(h, 'READ_CFG_DATA 0xa0 (05)', pkt(ID_BROADCAST, 0x05, 0xa0, 0x00, 0x00, 0x00))
  await sleep(50)
  send(h, 'READ_CFG_DATA 0xa4 (05)', pkt(ID_BROADCAST, 0x05, 0xa4, 0x00, 0x00, 0x00))
  await sleep(50)
  send(h, 'READ_CFG_DATA 0x04 (05)', pkt(ID_BROADCAST, 0x05, 0x04, 0x00, 0x00, 0x00))
  await sleep(50)
  send(h, 'REQUEST_DEVICE_MODE (18) — USB reconnect expected', pkt(ID_BROADCAST, 0x18))

  // ── Step 2: Wait for USB reconnect ────────────────────────────────────────
  console.log('\n=== Step 2: USB reconnect (closing handle, waiting 4s) ===')
  CloseHandle(h)
  h = null
  await sleep(4000)

  // Re-open after reconnect
  for (let attempt = 1; attempt <= 15; attempt++) {
    h = openThrottle()
    if (h) { console.log(`[OK] Reopened after reconnect (attempt ${attempt})\n`); break }
    console.log(`  Waiting for device... (${attempt}/15)`)
    await sleep(500)
  }
  if (!h) {
    console.error('[FAIL] Device did not reappear after reconnect')
    process.exit(1)
  }

  // ── Step 3: ONLINE_HEARTBEAT ───────────────────────────────────────────────
  console.log('=== Step 3: ONLINE_HEARTBEAT ===')
  send(h, 'ONLINE_HEARTBEAT (00)', pkt(ID_BROADCAST, 0x00))
  await sleep(300)

  // ── Step 4: READ_CFG_DATA to individual sub-devices ───────────────────────
  console.log('\n=== Step 4: Per-sub-device READ_CFG_DATA ===')

  const subCfg = [
    [ID_THROTTLE, 0xb8, 0x00],
    [ID_THROTTLE, 0x10, 0x01],
    [ID_THROTTLE, 0x44, 0x01],
    [ID_THROTTLE, 0x98, 0x01],
    [ID_F15EX_L,  0xb8, 0x00],
    [ID_F15EX_R,  0xb8, 0x00],
  ]
  for (const [id, addrLo, addrHi] of subCfg) {
    send(h, `READ_CFG_DATA id:[${idStr(id)}] addr:${addrHi.toString(16)}${addrLo.toString(16).padStart(2,'0')}`,
      pkt(id, 0x05, addrLo, addrHi, 0x00, 0x00))
    await sleep(50)
  }

  // ── Step 5: SET_LEDX vibration pulse ──────────────────────────────────────
  await sleep(500)
  console.log('\n=== Step 5: SET_LEDX vibration pulse (value=200, 1s) ===')

  send(h, 'SET_LEDX F15EX-L motor=0 value=200', pkt(ID_F15EX_L, 0x49, 0x00, 200))
  send(h, 'SET_LEDX F15EX-R motor=0 value=200', pkt(ID_F15EX_R, 0x49, 0x00, 200))

  await sleep(1000)
  console.log('--- Stopping vibration ---')
  send(h, 'SET_LEDX F15EX-L motor=0 value=0', pkt(ID_F15EX_L, 0x49, 0x00, 0))
  send(h, 'SET_LEDX F15EX-R motor=0 value=0', pkt(ID_F15EX_R, 0x49, 0x00, 0))

  await sleep(200)
  CloseHandle(h)
  console.log('\nDone.')
}

run().catch(err => { console.error(err); process.exit(1) })
