/**
 * Shared telemetry model for UI / HUD.
 * Normalizes raw SimConnect state into a versioned snapshot.
 * Decoupled from the 50 Hz HID vibration loop.
 */

'use strict'

const { safeNumber } = require('../vibration-core')

const TELEMETRY_SCHEMA_VERSION = 1
const TELEMETRY_PUBLISH_HZ = 15
const TELEMETRY_PUBLISH_MS = Math.round(1000 / TELEMETRY_PUBLISH_HZ)
const FLIGHT_EVENT_COOLDOWN_MS = 2500

const FLIGHT_EVENT_KINDS = Object.freeze([
  'takeoff',
  'gear_up',
  'flaps_retracted',
  'mach_1',
  'landing',
  'touchdown',
])

function finiteOr(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function clamp(value, min, max, fallback = min) {
  const n = finiteOr(value, fallback)
  if (n < min) return min
  if (n > max) return max
  return n
}

/** Normalize heading to [0, 359]. */
function normalizeHeadingDeg(value) {
  let h = finiteOr(value, 0) % 360
  if (h < 0) h += 360
  return Math.round(h * 10) / 10 % 360
}

/** Control axis to [-1, 1]. */
function normalizeAxis(value) {
  return clamp(value, -1, 1, 0)
}

/** Percent SimVar (0–100) → [0, 1]. */
function pctToUnit(value) {
  return clamp(finiteOr(value, 0) / 100, 0, 1, 0)
}

/** Bool-ish SimVar → boolean. */
function asBool(value) {
  return finiteOr(value, 0) >= 0.5
}

function cleanString(value, fallback = '') {
  if (value == null) return fallback
  const s = String(value).replace(/\0/g, '').trim()
  return s || fallback
}

function createEmptyTelemetry(overrides = {}) {
  return {
    schemaVersion: TELEMETRY_SCHEMA_VERSION,
    timestamp: 0,
    stale: false,
    connection: {
      simconnect: 'disconnected',
      hid: 'disconnected',
    },
    aircraft: {
      title: '',
      type: '',
      category: '',
      isHelicopter: false,
      engineCount: 0,
    },
    flight: {
      indicatedAirspeedKts: 0,
      trueAirspeedKts: 0,
      groundSpeedKts: 0,
      altitudeFt: 0,
      verticalSpeedFpm: 0,
      headingDeg: 0,
      pitchDeg: 0,
      bankDeg: 0,
      mach: 0,
      gForce: 1,
      angleOfAttackDeg: 0,
      sideslipDeg: 0,
    },
    aircraftState: {
      onGround: true,
      gearPosition: 0,
      flapsPosition: 0,
      spoilersPosition: 0,
      stallWarning: false,
      overspeedWarning: false,
      afterburnerActive: false,
    },
    controls: {
      stickX: 0,
      stickY: 0,
      rudder: 0,
      leftThrottle: 0,
      rightThrottle: 0,
      brakesLeft: 0,
      brakesRight: 0,
    },
    engines: [],
    ...overrides,
  }
}

/**
 * Map ENGINE TYPE SimVar to a short label.
 * 0 piston, 1 jet, 2 none, 3 helo, 4 unsupported, 5 turboprop
 */
function engineTypeLabel(engineType) {
  switch (Math.round(finiteOr(engineType, -1))) {
    case 0: return 'Piston'
    case 1: return 'Jet'
    case 2: return 'None'
    case 3: return 'Helicopter'
    case 4: return 'Unsupported'
    case 5: return 'Turboprop'
    default: return ''
  }
}

function isHelicopterFromRaw(raw) {
  const category = cleanString(raw.category)
  if (/heli/i.test(category)) return true
  return Math.round(finiteOr(raw.engineType, -1)) === 3
}

function buildEngines(raw) {
  const count = Math.max(0, Math.min(4, Math.round(finiteOr(raw.numberOfEngines, 0))))
  const engines = []
  for (let i = 1; i <= Math.max(count, 1); i++) {
    const rpm = finiteOr(raw[`engineRpm${i}`], 0)
    const n1 = finiteOr(raw[`engN1_${i}`], 0)
    const n2 = finiteOr(raw[`engN2_${i}`], 0)
    const combustion = asBool(raw[`engCombustion${i}`])
    const rpmPercent = clamp(rpm > 0 ? (n1 > 0 ? n1 : Math.min(100, rpm / 30)) : 0, 0, 100, 0)
    engines.push({
      index: i,
      running: combustion && (rpm > 1 || n1 > 1),
      rpmPercent: Math.round(rpmPercent * 10) / 10,
      n1Percent: clamp(n1, 0, 120, 0),
      n2Percent: clamp(n2, 0, 120, 0),
      combustion,
    })
    if (i >= count && count > 0) break
  }
  if (count === 0) {
    return [{
      index: 1,
      running: false,
      rpmPercent: 0,
      n1Percent: 0,
      n2Percent: 0,
      combustion: false,
    }]
  }
  return engines.slice(0, count)
}

/**
 * Build a normalized UI telemetry snapshot from raw bridge flight state.
 * @param {object} raw raw SimVar state (+ optional title/category strings)
 * @param {object} connectionMeta
 * @param {number} [timestamp]
 */
function buildTelemetrySnapshot(raw = {}, connectionMeta = {}, timestamp = Date.now()) {
  const simStatus = connectionMeta.simconnect
    || (connectionMeta.simConnected ? 'connected' : 'disconnected')
  const hidStatus = connectionMeta.hid
    || (finiteOr(connectionMeta.hidOpenCount, 0) > 0 ? 'connected' : 'disconnected')

  const title = cleanString(raw.title)
  const category = cleanString(raw.category)
  const type = cleanString(raw.atcType) || engineTypeLabel(raw.engineType) || category
  const helo = isHelicopterFromRaw(raw)
  const engineCount = Math.max(0, Math.min(4, Math.round(finiteOr(raw.numberOfEngines, 0))))

  const afterburner = Math.max(
    finiteOr(raw.afterburnerPct1, 0),
    finiteOr(raw.afterburnerPct2, 0),
  ) > 1

  const gear = pctToUnit(
    finiteOr(raw.gearPct, NaN) >= 0
      ? raw.gearPct
      : (
        (finiteOr(raw.gearLeftPct, 0)
          + finiteOr(raw.gearRightPct, 0)
          + finiteOr(raw.gearNosePct, 0)) / 3
      ),
  )

  return createEmptyTelemetry({
    schemaVersion: TELEMETRY_SCHEMA_VERSION,
    timestamp: Math.round(finiteOr(timestamp, Date.now())),
    stale: Boolean(connectionMeta.stale),
    connection: {
      simconnect: ['disconnected', 'connecting', 'connected', 'error'].includes(simStatus)
        ? simStatus
        : 'disconnected',
      hid: ['disconnected', 'connected', 'error'].includes(hidStatus)
        ? hidStatus
        : 'disconnected',
    },
    aircraft: {
      title,
      type,
      category,
      isHelicopter: helo,
      engineCount,
    },
    flight: {
      indicatedAirspeedKts: clamp(raw.indicatedAirspeedKnots, 0, 2000, 0),
      trueAirspeedKts: clamp(raw.airspeedKnots, 0, 2000, 0),
      groundSpeedKts: clamp(raw.groundSpeedKnots, 0, 2000, 0),
      altitudeFt: clamp(raw.altitudeFt, -2000, 100000, 0),
      verticalSpeedFpm: clamp(raw.vertSpeedFpm, -30000, 30000, 0),
      headingDeg: normalizeHeadingDeg(raw.headingDeg),
      pitchDeg: clamp(raw.pitchDeg, -90, 90, 0),
      bankDeg: clamp(raw.bankDeg, -180, 180, 0),
      mach: clamp(raw.mach, 0, 10, 0),
      gForce: clamp(raw.gForce, -10, 20, 1),
      angleOfAttackDeg: clamp(raw.aoa, -90, 90, 0),
      sideslipDeg: clamp(raw.sideslipDeg, -90, 90, 0),
    },
    aircraftState: {
      onGround: asBool(raw.onGround),
      gearPosition: gear,
      flapsPosition: pctToUnit(raw.flapsLeftPct),
      spoilersPosition: pctToUnit(raw.speedbrakePct),
      stallWarning: asBool(raw.stallWarning),
      overspeedWarning: asBool(raw.overspeedWarning),
      afterburnerActive: afterburner,
    },
    controls: {
      stickX: normalizeAxis(raw.aileronInput),
      stickY: normalizeAxis(raw.elevatorInput),
      rudder: normalizeAxis(raw.rudderInput),
      leftThrottle: clamp(raw.throttle1, 0, 1, 0),
      rightThrottle: clamp(raw.throttle2, 0, 1, 0),
      brakesLeft: clamp(raw.brakeLeft, 0, 1, 0),
      brakesRight: clamp(raw.brakeRight, 0, 1, 0),
    },
    engines: buildEngines(raw),
  })
}

function approxEqual(a, b, eps) {
  return Math.abs(finiteOr(a, 0) - finiteOr(b, 0)) <= eps
}

/**
 * True when the snapshot changed enough to warrant a UI publish.
 */
function telemetryChangedSignificantly(prev, next) {
  if (!prev) return true
  if (prev.connection.simconnect !== next.connection.simconnect) return true
  if (prev.connection.hid !== next.connection.hid) return true
  if (prev.aircraft.title !== next.aircraft.title) return true
  if (prev.aircraft.category !== next.aircraft.category) return true
  if (prev.aircraft.isHelicopter !== next.aircraft.isHelicopter) return true
  if (prev.aircraft.engineCount !== next.aircraft.engineCount) return true
  if (prev.aircraftState.onGround !== next.aircraftState.onGround) return true
  if (prev.aircraftState.stallWarning !== next.aircraftState.stallWarning) return true
  if (prev.aircraftState.overspeedWarning !== next.aircraftState.overspeedWarning) return true
  if (prev.aircraftState.afterburnerActive !== next.aircraftState.afterburnerActive) return true

  const f = next.flight
  const pf = prev.flight
  if (!approxEqual(pf.indicatedAirspeedKts, f.indicatedAirspeedKts, 0.4)) return true
  if (!approxEqual(pf.altitudeFt, f.altitudeFt, 2)) return true
  if (!approxEqual(pf.verticalSpeedFpm, f.verticalSpeedFpm, 20)) return true
  if (!approxEqual(pf.headingDeg, f.headingDeg, 0.4)) return true
  if (!approxEqual(pf.pitchDeg, f.pitchDeg, 0.2)) return true
  if (!approxEqual(pf.bankDeg, f.bankDeg, 0.2)) return true
  if (!approxEqual(pf.mach, f.mach, 0.005)) return true
  if (!approxEqual(pf.gForce, f.gForce, 0.02)) return true

  const c = next.controls
  const pc = prev.controls
  if (!approxEqual(pc.stickX, c.stickX, 0.01)) return true
  if (!approxEqual(pc.stickY, c.stickY, 0.01)) return true
  if (!approxEqual(pc.rudder, c.rudder, 0.01)) return true
  if (!approxEqual(pc.leftThrottle, c.leftThrottle, 0.01)) return true
  if (!approxEqual(pc.rightThrottle, c.rightThrottle, 0.01)) return true
  if (!approxEqual(pc.brakesLeft, c.brakesLeft, 0.02)) return true
  if (!approxEqual(pc.brakesRight, c.brakesRight, 0.02)) return true

  if (!approxEqual(prev.aircraftState.gearPosition, next.aircraftState.gearPosition, 0.02)) return true
  if (!approxEqual(prev.aircraftState.flapsPosition, next.aircraftState.flapsPosition, 0.02)) return true
  if (!approxEqual(prev.aircraftState.spoilersPosition, next.aircraftState.spoilersPosition, 0.02)) return true

  if (prev.engines.length !== next.engines.length) return true
  for (let i = 0; i < next.engines.length; i++) {
    const a = prev.engines[i]
    const b = next.engines[i]
    if (!a || a.running !== b.running || a.combustion !== b.combustion) return true
    if (!approxEqual(a.n1Percent, b.n1Percent, 0.5)) return true
    if (!approxEqual(a.rpmPercent, b.rpmPercent, 0.5)) return true
  }
  return false
}

function createFlightEventDetector() {
  let prev = null
  let aircraftKey = ''
  /** @type {Record<string, number>} */
  const lastEmittedAt = {}

  function resetTransitions() {
    prev = null
    for (const key of Object.keys(lastEmittedAt)) delete lastEmittedAt[key]
  }

  function canEmit(kind, now) {
    if (!Object.prototype.hasOwnProperty.call(lastEmittedAt, kind)) return true
    return now - lastEmittedAt[kind] >= FLIGHT_EVENT_COOLDOWN_MS
  }

  /**
   * @param {ReturnType<typeof createEmptyTelemetry>} snap
   * @param {number} [now]
   * @returns {{ kind: string, timestamp: number }[]}
   */
  function observe(snap, now = Date.now()) {
    const events = []
    const key = `${snap.aircraft.title}|${snap.aircraft.category}|${snap.aircraft.engineCount}`
    if (aircraftKey && key !== aircraftKey) {
      resetTransitions()
    }
    aircraftKey = key

    if (!prev) {
      prev = snap
      return events
    }

    function push(kind) {
      if (!FLIGHT_EVENT_KINDS.includes(kind)) return
      if (!canEmit(kind, now)) return
      lastEmittedAt[kind] = now
      events.push({ kind, timestamp: now })
    }

    const wasGround = prev.aircraftState.onGround
    const onGround = snap.aircraftState.onGround
    const speed = Math.max(
      snap.flight.indicatedAirspeedKts,
      snap.flight.groundSpeedKts,
    )

    if (wasGround && !onGround && speed >= 25) {
      push('takeoff')
    }
    if (!wasGround && onGround) {
      push('touchdown')
    }

    const prevGear = prev.aircraftState.gearPosition
    const gear = snap.aircraftState.gearPosition
    if (!onGround && prevGear > 0.75 && gear < 0.25) {
      push('gear_up')
    }
    // "Landing" = gear extended for approach while airborne
    if (!onGround && prevGear < 0.25 && gear > 0.75) {
      push('landing')
    }

    if (prev.aircraftState.flapsPosition > 0.1 && snap.aircraftState.flapsPosition < 0.05) {
      push('flaps_retracted')
    }

    if (prev.flight.mach < 0.995 && snap.flight.mach >= 1.0) {
      push('mach_1')
    }

    prev = snap
    return events
  }

  return {
    observe,
    reset: () => {
      aircraftKey = ''
      resetTransitions()
    },
  }
}

/**
 * Rate-limited publisher for UI telemetry (default 15 Hz).
 */
function createTelemetryPublisher(options = {}) {
  const intervalMs = Math.max(50, options.intervalMs || TELEMETRY_PUBLISH_MS)
  const nowFn = options.now || (() => Date.now())
  const forceOnConnect = options.forceOnConnect !== false
  let lastPublishAt = 0
  let lastPublished = null
  let lastSimStatus = null

  function maybePublish(snapshot) {
    const t = nowFn()
    const statusChanged = forceOnConnect
      && lastSimStatus !== snapshot.connection.simconnect
    lastSimStatus = snapshot.connection.simconnect

    if (!statusChanged) {
      if (t - lastPublishAt < intervalMs) return null
      if (!telemetryChangedSignificantly(lastPublished, snapshot)) {
        lastPublishAt = t
        return null
      }
    }

    lastPublishAt = t
    lastPublished = snapshot
    return snapshot
  }

  function reset() {
    lastPublishAt = 0
    lastPublished = null
    lastSimStatus = null
  }

  return { maybePublish, reset, intervalMs }
}

module.exports = {
  TELEMETRY_SCHEMA_VERSION,
  TELEMETRY_PUBLISH_HZ,
  TELEMETRY_PUBLISH_MS,
  FLIGHT_EVENT_KINDS,
  FLIGHT_EVENT_COOLDOWN_MS,
  createEmptyTelemetry,
  buildTelemetrySnapshot,
  telemetryChangedSignificantly,
  createFlightEventDetector,
  createTelemetryPublisher,
  normalizeHeadingDeg,
  normalizeAxis,
  clamp,
  finiteOr,
}
