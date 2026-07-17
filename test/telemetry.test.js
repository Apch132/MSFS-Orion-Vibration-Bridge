'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const {
  buildTelemetrySnapshot,
  createEmptyTelemetry,
  createFlightEventDetector,
  createTelemetryPublisher,
  normalizeHeadingDeg,
  normalizeAxis,
  telemetryChangedSignificantly,
  TELEMETRY_SCHEMA_VERSION,
} = require('../lib/bridge/telemetry')
const { createBridge } = require('../lib/bridge')

describe('telemetry normalization', () => {
  it('produces schemaVersion 1 with finite defaults', () => {
    const snap = buildTelemetrySnapshot({
      indicatedAirspeedKnots: Number.NaN,
      airspeedKnots: Infinity,
      gForce: undefined,
      headingDeg: 400,
      aileronInput: 2,
      numberOfEngines: 2,
      engCombustion1: 1,
      engN1_1: 88,
      engN2_1: 90,
      engineRpm1: 1000,
      engCombustion2: 1,
      engN1_2: 87,
      title: 'Demo\0',
      category: 'Airplane',
      onGround: 1,
    }, { simConnected: true, hidOpenCount: 1 })

    assert.equal(snap.schemaVersion, TELEMETRY_SCHEMA_VERSION)
    assert.equal(snap.flight.indicatedAirspeedKts, 0)
    assert.equal(snap.flight.trueAirspeedKts, 0)
    assert.equal(snap.flight.gForce, 1)
    assert.equal(snap.flight.headingDeg, 40)
    assert.equal(snap.controls.stickX, 1)
    assert.equal(snap.aircraft.title, 'Demo')
    assert.equal(snap.aircraft.engineCount, 2)
    assert.equal(snap.engines.length, 2)
    assert.equal(snap.connection.simconnect, 'connected')
    assert.equal(snap.connection.hid, 'connected')
    assert.ok(Number.isFinite(snap.flight.mach))
  })

  it('normalizes heading into 0–359', () => {
    assert.equal(normalizeHeadingDeg(-10), 350)
    assert.equal(normalizeHeadingDeg(720), 0)
    assert.equal(normalizeHeadingDeg(359.96) >= 0, true)
  })

  it('bounds control axes', () => {
    assert.equal(normalizeAxis(-5), -1)
    assert.equal(normalizeAxis(0.25), 0.25)
    assert.equal(normalizeAxis(0), 0)
    assert.equal(normalizeAxis(2), 1)
  })

  it('supports single and twin engines', () => {
    const mono = buildTelemetrySnapshot({
      numberOfEngines: 1,
      engCombustion1: 1,
      engN1_1: 70,
      engineRpm1: 2000,
    })
    assert.equal(mono.engines.length, 1)

    const twin = buildTelemetrySnapshot({
      numberOfEngines: 2,
      engCombustion1: 1,
      engCombustion2: 1,
      engN1_1: 70,
      engN1_2: 72,
    })
    assert.equal(twin.engines.length, 2)
  })

  it('detects helicopter from category or engine type', () => {
    assert.equal(
      buildTelemetrySnapshot({ category: 'Helicopter', engineType: 1 }).aircraft.isHelicopter,
      true,
    )
    assert.equal(
      buildTelemetrySnapshot({ category: 'Airplane', engineType: 3 }).aircraft.isHelicopter,
      true,
    )
  })
})

describe('flight events', () => {
  it('emits takeoff and touchdown on transitions only', () => {
    const detector = createFlightEventDetector()
    const base = createEmptyTelemetry({
      aircraft: { title: 'A', type: 'Jet', category: 'Airplane', isHelicopter: false, engineCount: 2 },
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
        gearPosition: 1,
        flapsPosition: 0.3,
        spoilersPosition: 0,
        stallWarning: false,
        overspeedWarning: false,
        afterburnerActive: false,
      },
    })

    assert.deepEqual(detector.observe(base, 1000), [])

    const airborne = createEmptyTelemetry({
      ...base,
      timestamp: 2000,
      flight: { ...base.flight, indicatedAirspeedKts: 140, groundSpeedKts: 130 },
      aircraftState: { ...base.aircraftState, onGround: false },
    })
    const takeoff = detector.observe(airborne, 2000)
    assert.equal(takeoff.length, 1)
    assert.equal(takeoff[0].kind, 'takeoff')

    const again = detector.observe(airborne, 2100)
    assert.equal(again.length, 0)

    const down = createEmptyTelemetry({
      ...airborne,
      aircraftState: { ...airborne.aircraftState, onGround: true },
    })
    const touch = detector.observe(down, 5000)
    assert.equal(touch.some((e) => e.kind === 'touchdown'), true)
  })

  it('anti-duplicates within cooldown', () => {
    const detector = createFlightEventDetector()
    const ground = createEmptyTelemetry({
      aircraft: { title: 'A', type: 'Jet', category: 'Airplane', isHelicopter: false, engineCount: 1 },
      flight: {
        indicatedAirspeedKts: 120,
        trueAirspeedKts: 120,
        groundSpeedKts: 120,
        altitudeFt: 100,
        verticalSpeedFpm: 0,
        headingDeg: 0,
        pitchDeg: 0,
        bankDeg: 0,
        mach: 0.2,
        gForce: 1,
        angleOfAttackDeg: 0,
        sideslipDeg: 0,
      },
      aircraftState: {
        onGround: true,
        gearPosition: 1,
        flapsPosition: 0,
        spoilersPosition: 0,
        stallWarning: false,
        overspeedWarning: false,
        afterburnerActive: false,
      },
    })
    detector.observe(ground, 1)
    const up = createEmptyTelemetry({
      ...ground,
      aircraftState: { ...ground.aircraftState, onGround: false },
    })
    assert.equal(detector.observe(up, 2)[0].kind, 'takeoff')
    const bounceDown = createEmptyTelemetry({
      ...ground,
      aircraftState: { ...ground.aircraftState, onGround: true },
    })
    detector.observe(bounceDown, 3)
    const up2 = createEmptyTelemetry({
      ...ground,
      aircraftState: { ...ground.aircraftState, onGround: false },
    })
    assert.equal(detector.observe(up2, 4).length, 0)
  })

  it('resets transitions on aircraft change', () => {
    const detector = createFlightEventDetector()
    const a = createEmptyTelemetry({
      aircraft: { title: 'A', type: 'Jet', category: 'Airplane', isHelicopter: false, engineCount: 1 },
      flight: {
        indicatedAirspeedKts: 100,
        trueAirspeedKts: 100,
        groundSpeedKts: 100,
        altitudeFt: 0,
        verticalSpeedFpm: 0,
        headingDeg: 0,
        pitchDeg: 0,
        bankDeg: 0,
        mach: 0.2,
        gForce: 1,
        angleOfAttackDeg: 0,
        sideslipDeg: 0,
      },
      aircraftState: {
        onGround: true,
        gearPosition: 1,
        flapsPosition: 0,
        spoilersPosition: 0,
        stallWarning: false,
        overspeedWarning: false,
        afterburnerActive: false,
      },
    })
    detector.observe(a, 1)
    detector.observe(createEmptyTelemetry({
      ...a,
      aircraftState: { ...a.aircraftState, onGround: false },
    }), 2)

    const b = createEmptyTelemetry({
      ...a,
      aircraft: { ...a.aircraft, title: 'B' },
    })
    assert.deepEqual(detector.observe(b, 3), [])
    const takeoffB = detector.observe(createEmptyTelemetry({
      ...b,
      aircraftState: { ...b.aircraftState, onGround: false },
    }), 4)
    assert.equal(takeoffB[0].kind, 'takeoff')
  })
})

describe('telemetry publisher rate limit', () => {
  it('bounds publish frequency', () => {
    let t = 1000
    const pub = createTelemetryPublisher({ intervalMs: 100, now: () => t })
    const a = buildTelemetrySnapshot({ indicatedAirspeedKnots: 100 }, { simConnected: true })
    assert.ok(pub.maybePublish(a))
    t = 1050
    const b = buildTelemetrySnapshot({ indicatedAirspeedKnots: 120 }, { simConnected: true })
    assert.equal(pub.maybePublish(b), null)
    t = 1200
    assert.ok(pub.maybePublish(b))
  })

  it('skips unchanged snapshots after interval', () => {
    let t = 0
    const pub = createTelemetryPublisher({ intervalMs: 10, now: () => t })
    const a = buildTelemetrySnapshot({ indicatedAirspeedKnots: 50 }, { simConnected: true })
    assert.ok(pub.maybePublish(a))
    t = 50
    assert.equal(pub.maybePublish(a), null)
    assert.equal(telemetryChangedSignificantly(a, a), false)
  })
})

describe('createBridge telemetry emission', () => {
  function createMockHid() {
    return {
      devices: () => [],
      HID: class {
        write() {}
        close() {}
        on() {}
        removeAllListeners() {}
      },
    }
  }

  it('emits normalized telemetry and ignores missing HID', async () => {
    const frames = []
    const bridge = createBridge({
      hid: createMockHid(),
      autoConnectSim: false,
      wallNow: () => 1_000_000,
    })
    bridge.on('telemetry', (payload) => frames.push(payload))
    await bridge.start()
    bridge.ingestSimSample({
      indicatedAirspeedKnots: 180,
      altitudeFt: 5000,
      headingDeg: 10,
      onGround: 0,
      numberOfEngines: 1,
      title: 'Test Jet',
      category: 'Airplane',
    })
    assert.ok(frames.length >= 1)
    const last = frames[frames.length - 1]
    assert.equal(last.schemaVersion, 1)
    assert.equal(last.flight.indicatedAirspeedKts, 180)
    assert.equal(last.aircraft.title, 'Test Jet')
    assert.equal(last.connection.hid, 'disconnected')
    await bridge.stop()
  })

  it('getTelemetry returns a valid snapshot while stopped', () => {
    const bridge = createBridge({
      hid: createMockHid(),
      autoConnectSim: false,
    })
    const snap = bridge.getTelemetry()
    assert.equal(snap.schemaVersion, 1)
    assert.equal(snap.connection.simconnect, 'disconnected')
  })
})
