/**
 * Pure helpers for WinWing MSFS2024 Vibration Bridge.
 * Kept free of HID / SimConnect so unit tests can run without hardware.
 */

'use strict'

/** @param {*} value @param {number} [fallback=0] */
function safeNumber(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

/**
 * Build the 14-byte WinWing vibration HID report.
 * @param {number[]} subId 4-byte sub-device id
 * @param {number} motorIdx
 * @param {number} value 0–255
 * @returns {number[]}
 */
function buildVibPacket(subId, motorIdx, value) {
  const v = Math.max(0, Math.min(255, Math.round(safeNumber(value, 0))))
  const m = Math.max(0, Math.min(255, Math.round(safeNumber(motorIdx, 0))))
  return [
    0x02,
    safeNumber(subId[0], 0) & 0xff,
    safeNumber(subId[1], 0) & 0xff,
    safeNumber(subId[2], 0) & 0xff,
    safeNumber(subId[3], 0) & 0xff,
    0x03,
    0x49,
    m,
    v,
    0, 0, 0, 0, 0,
  ]
}

/**
 * Clamp intensity 0–100 and convert to HID byte 0–255.
 * @param {*} raw
 * @returns {number}
 */
function intensityToHidByte(raw) {
  const clamped = Math.min(100, Math.max(0, safeNumber(raw, 0)))
  return Math.round(clamped * 2.55)
}

/**
 * Route per-engine effects onto a throttle handle.
 *   1 engine  → both handles feel engine 0
 *   2 engines → handle 0 = engine 0, handle 1 = engine 1
 *   3+        → even indices left wing, odd indices right wing (max)
 * @param {number} handleIdx
 * @param {number[]} engFx
 * @param {number} totalEngines
 * @returns {number}
 */
function engFxForHandle(handleIdx, engFx, totalEngines) {
  const n = Math.max(1, Math.round(safeNumber(totalEngines, 1)))
  const fx = [0, 1, 2, 3].map(i => safeNumber(engFx && engFx[i], 0))
  const h = handleIdx === 1 ? 1 : 0
  if (n === 1) return fx[0]
  if (n === 2) return fx[h]
  let best = fx[h]
  for (let i = h + 2; i < n; i += 2) {
    if (fx[i] > best) best = fx[i]
  }
  return best
}

/**
 * Per-engine RPM contribution for piston / turboprop.
 * @param {number} rpm
 * @param {boolean} combustion
 * @param {boolean} isTurboProp
 * @returns {number}
 */
function pistonTurbopropEngineFx(rpm, combustion, isTurboProp) {
  if (!combustion) return 0
  const r = safeNumber(rpm, 0)
  if (r <= 200) return 0
  const maxRpm = isTurboProp ? 1800 : 2700
  const rpmRatio = Math.min(1, r / maxRpm)
  return Math.min(18, Math.abs(rpmRatio - 0.65) * 14 + 2)
}

/**
 * Per-engine RPM rumble for jets (afterburner applied separately).
 * @param {number} rpm
 * @param {boolean} combustion
 * @returns {number}
 */
function jetEngineRpmFx(rpm, combustion) {
  if (!combustion) return 0
  return Math.min(1, safeNumber(rpm, 0) / 10000) * 8
}

/** Touchdown pulse tuned to former ~25-frame / 0.88 decay at ~50 Hz (~500 ms). */
const TOUCHDOWN_DURATION_MS = 500
const TOUCHDOWN_DECAY_STEPS = 25
const TOUCHDOWN_DECAY_FACTOR = 0.88

function createTouchdownTracker() {
  return {
    prevOnGround: true,
    lastAirborneVertSpeedFpm: 0,
    startTime: 0,
    activeUntil: 0,
    startIntensity: 0,
  }
}

/**
 * Time-based touchdown pulse using last airborne vertical speed.
 * @param {object} tracker
 * @param {{ onGround: *, vertSpeedFpm: * }} sample
 * @param {number} nowMs
 * @returns {{ intensity: number, triggered: boolean, sinkFpm: number }}
 */
function updateTouchdown(tracker, sample, nowMs) {
  const onGround = safeNumber(sample.onGround, 0) > 0.5
  const vertSpeedFpm = safeNumber(sample.vertSpeedFpm, tracker.lastAirborneVertSpeedFpm)

  if (!onGround) {
    tracker.lastAirborneVertSpeedFpm = vertSpeedFpm
  }

  const justTouched = !tracker.prevOnGround && onGround
  tracker.prevOnGround = onGround

  if (justTouched && nowMs >= tracker.activeUntil) {
    const sinkFpm = tracker.lastAirborneVertSpeedFpm
    const sinkRate = Math.abs(safeNumber(sinkFpm, 0))
    tracker.startIntensity = Math.min(100, sinkRate / 6)
    tracker.startTime = nowMs
    tracker.activeUntil = nowMs + TOUCHDOWN_DURATION_MS
    return {
      intensity: tracker.startIntensity,
      triggered: true,
      sinkFpm,
    }
  }

  if (nowMs < tracker.activeUntil) {
    const progress = Math.min(1, (nowMs - tracker.startTime) / TOUCHDOWN_DURATION_MS)
    const intensity =
      tracker.startIntensity *
      Math.pow(TOUCHDOWN_DECAY_FACTOR, progress * TOUCHDOWN_DECAY_STEPS)
    return {
      intensity: Number.isFinite(intensity) ? intensity : 0,
      triggered: false,
      sinkFpm: tracker.lastAirborneVertSpeedFpm,
    }
  }

  return { intensity: 0, triggered: false, sinkFpm: tracker.lastAirborneVertSpeedFpm }
}

function resetTouchdown(tracker) {
  tracker.startTime = 0
  tracker.activeUntil = 0
  tracker.startIntensity = 0
}

module.exports = {
  safeNumber,
  buildVibPacket,
  intensityToHidByte,
  engFxForHandle,
  pistonTurbopropEngineFx,
  jetEngineRpmFx,
  createTouchdownTracker,
  updateTouchdown,
  resetTouchdown,
  TOUCHDOWN_DURATION_MS,
  TOUCHDOWN_DECAY_STEPS,
  TOUCHDOWN_DECAY_FACTOR,
}
