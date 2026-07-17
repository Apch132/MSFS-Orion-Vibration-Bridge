'use strict'

const assert = require('assert')
const {
  safeNumber,
  buildVibPacket,
  intensityToHidByte,
  engFxForHandle,
  pistonTurbopropEngineFx,
  jetEngineRpmFx,
  createTouchdownTracker,
  updateTouchdown,
  TOUCHDOWN_DURATION_MS,
  TOUCHDOWN_DECAY_FACTOR,
  TOUCHDOWN_DECAY_STEPS,
} = require('../lib/vibration-core')

let passed = 0
function test(name, fn) {
  fn()
  passed++
  console.log(`  ok  ${name}`)
}

console.log('vibration-core tests\n')

test('buildVibPacket is exactly 14 bytes with command layout', () => {
  const pkt = buildVibPacket([0x01, 0xBF, 0x00, 0x00], 0, 200)
  assert.strictEqual(pkt.length, 14)
  assert.deepStrictEqual(pkt, [
    0x02, 0x01, 0xBF, 0x00, 0x00, 0x03, 0x49, 0, 200, 0, 0, 0, 0, 0,
  ])
})

test('intensityToHidByte clamps HID bytes to 0..255 (never 256)', () => {
  assert.strictEqual(intensityToHidByte(0), 0)
  assert.strictEqual(intensityToHidByte(255), 255)
  assert.strictEqual(intensityToHidByte(128), 128)
  assert.strictEqual(intensityToHidByte(127.4), 127)
  assert.strictEqual(intensityToHidByte(127.6), 128)
  assert.strictEqual(intensityToHidByte(-10), 0)
  assert.strictEqual(intensityToHidByte(256), 255)
  assert.strictEqual(intensityToHidByte(300), 255)
  assert.strictEqual(intensityToHidByte(NaN), 0)
  assert.strictEqual(intensityToHidByte(undefined), 0)
})

test('engFxForHandle routes mono / twin / quad correctly', () => {
  const engFx = [10, 20, 30, 40]
  assert.strictEqual(engFxForHandle(0, engFx, 1), 10)
  assert.strictEqual(engFxForHandle(1, engFx, 1), 10)
  assert.strictEqual(engFxForHandle(0, engFx, 2), 10)
  assert.strictEqual(engFxForHandle(1, engFx, 2), 20)
  assert.strictEqual(engFxForHandle(0, engFx, 4), 30) // max(10, 30)
  assert.strictEqual(engFxForHandle(1, engFx, 4), 40) // max(20, 40)
})

test('engine RPM helpers use per-engine values and reject invalid telemetry', () => {
  assert.strictEqual(pistonTurbopropEngineFx(2700, true, false) > 0, true)
  assert.strictEqual(pistonTurbopropEngineFx(100, true, false), 0)
  assert.strictEqual(pistonTurbopropEngineFx(2700, false, false), 0)
  assert.strictEqual(pistonTurbopropEngineFx(NaN, true, false), 0)
  assert.strictEqual(jetEngineRpmFx(10000, true), 1)
  assert.strictEqual(jetEngineRpmFx(5000, true), 0.5)
  assert.strictEqual(jetEngineRpmFx(NaN, true), 0)
  assert.strictEqual(jetEngineRpmFx(10000, false), 0)

  // Distinct engines can produce distinct effects
  const left = jetEngineRpmFx(2000, true)
  const right = jetEngineRpmFx(10000, true)
  assert.notStrictEqual(left, right)
})

test('safeNumber never yields NaN', () => {
  assert.strictEqual(safeNumber(NaN), 0)
  assert.strictEqual(safeNumber('x', 3), 3)
  assert.strictEqual(safeNumber(null), 0)
  assert.strictEqual(safeNumber(12.5), 12.5)
})

test('touchdown uses last airborne vertical speed and wall-clock decay', () => {
  const td = createTouchdownTracker()
  let t0 = 1000

  // Airborne with sink
  let r = updateTouchdown(td, { onGround: 0, vertSpeedFpm: -600 }, t0)
  assert.strictEqual(r.triggered, false)
  assert.strictEqual(r.intensity, 0)

  // Still airborne, VS already near zero (bad sample) — keep last airborne
  r = updateTouchdown(td, { onGround: 0, vertSpeedFpm: -5 }, t0 + 10)
  assert.strictEqual(td.lastAirborneVertSpeedFpm, -5)

  // Restore a meaningful airborne sink then touch down
  updateTouchdown(td, { onGround: 0, vertSpeedFpm: -600 }, t0 + 20)
  r = updateTouchdown(td, { onGround: 1, vertSpeedFpm: 0 }, t0 + 30)
  assert.strictEqual(r.triggered, true)
  assert.strictEqual(r.sinkFpm, -600)
  assert.strictEqual(r.intensity, Math.min(1, 600 / 600))

  const mid = updateTouchdown(td, { onGround: 1, vertSpeedFpm: 0 }, t0 + 30 + TOUCHDOWN_DURATION_MS / 2)
  const expectedMid =
    r.intensity * Math.pow(TOUCHDOWN_DECAY_FACTOR, 0.5 * TOUCHDOWN_DECAY_STEPS)
  assert.ok(Math.abs(mid.intensity - expectedMid) < 1e-9)
  assert.strictEqual(mid.triggered, false)

  const done = updateTouchdown(td, { onGround: 1, vertSpeedFpm: 0 }, t0 + 30 + TOUCHDOWN_DURATION_MS)
  assert.strictEqual(done.intensity, 0)
})

test('invalid touchdown telemetry does not produce NaN intensity', () => {
  const td = createTouchdownTracker()
  updateTouchdown(td, { onGround: 0, vertSpeedFpm: NaN }, 0)
  const r = updateTouchdown(td, { onGround: 1, vertSpeedFpm: NaN }, 1)
  assert.strictEqual(Number.isFinite(r.intensity), true)
  assert.strictEqual(Number.isNaN(r.intensity), false)
})

console.log(`\n${passed} tests passed`)
