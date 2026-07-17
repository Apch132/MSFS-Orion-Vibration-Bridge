'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { scaleEffect, applyMaster, getDefaultBridgePreferences } = require('../lib/bridge/preferences')
const { intensityToHidByte, HID_MAX } = require('../lib/vibration-core')
const { computeMotorIntensities } = require('../lib/bridge/compute')
const { createTouchdownTracker } = require('../lib/vibration-core')
const { DEVICE_CONFIG } = require('../lib/bridge/create-bridge')

describe('HID intensity semantics', () => {
  it('maps slider 0 / 50 / 100% through a full dynamic factor', () => {
    const effect = { enabled: true, intensity: 0 }
    assert.equal(scaleEffect(effect, 1), 0)

    effect.intensity = 50
    assert.equal(scaleEffect(effect, 1), 127.5)

    effect.intensity = 100
    assert.equal(scaleEffect(effect, 1), 255)
  })

  it('disabled effect contributes zero regardless of slider', () => {
    assert.equal(scaleEffect({ enabled: false, intensity: 100 }, 1), 0)
  })

  it('applies Master last and clamps to 255', () => {
    const master = { enabled: true, intensity: 100 }
    assert.equal(applyMaster(master, 200), 200)
    assert.equal(applyMaster({ enabled: true, intensity: 50 }, 200), 100)
    assert.equal(applyMaster({ enabled: true, intensity: 100 }, 400), 255)
    assert.equal(applyMaster({ enabled: false, intensity: 100 }, 200), 0)
  })

  it('never emits HID 256', () => {
    assert.equal(intensityToHidByte(255.9), 255)
    assert.equal(intensityToHidByte(256), 255)
    assert.equal(HID_MAX, 255)
  })

  it('stall at 100% with master 100% can reach full HID', () => {
    const prefs = getDefaultBridgePreferences()
    prefs.profiles.aircraft.stall.intensity = 100
    const touchdown = createTouchdownTracker()
    const meta = { lastEngineType: -1, lastEnginesRunning: -1 }
    const out = computeMotorIntensities({
      state: {
        numberOfEngines: 1,
        engCombustion1: 1,
        engineRpm1: 1000,
        engineType: 1,
        onGround: 0,
        stallWarning: 1,
        gearLeftPct: 0,
        gearRightPct: 0,
        gearNosePct: 0,
        gearPct: 0,
        gForce: 1,
        mach: 0.4,
        airspeedKnots: 200,
        flapsLeftPct: 0,
        speedbrakePct: 0,
        afterburnerPct1: 0,
        afterburnerPct2: 0,
        vertSpeedFpm: 0,
        apuPctRpm: 0,
      },
      preferences: prefs,
      touchdown,
      nowMs: 1000,
      meta,
      deviceConfig: DEVICE_CONFIG,
    })
    assert.ok(out['F16 JGRIP'] >= 250, `expected near-full HID, got ${out['F16 JGRIP']}`)
    assert.ok(out['F16 JGRIP'] <= 255)
  })

  it('default aircraft ceilings reconstruct historical feel peaks', () => {
    const prefs = getDefaultBridgePreferences()
    const a = prefs.profiles.aircraft
    assert.equal(a.engine.intensity, 18)
    assert.equal(a.afterburner.intensity, 30)
    assert.equal(a.gear.intensity, 35)
    assert.equal(a.flaps.intensity, 18)
    assert.equal(a.stall.intensity, 70)
    assert.equal(a.transonic.intensity, 55)
    assert.equal(a.touchdown.intensity, 100)
    assert.equal(a.master.intensity, 100)

    const h = prefs.profiles.helicopter
    assert.equal(h.engine.intensity, 40)
    assert.equal(h.gear.intensity, 45)
    assert.equal(h.stall.intensity, 56)
    assert.equal(h.afterburner.enabled, false)
    assert.equal(h.flaps.enabled, false)
    assert.equal(h.transonic.enabled, false)
  })

  it('stall default ceiling (~70%) yields historical ~178 HID', () => {
    const prefs = getDefaultBridgePreferences()
    const touchdown = createTouchdownTracker()
    const meta = { lastEngineType: -1, lastEnginesRunning: -1 }
    const out = computeMotorIntensities({
      state: {
        numberOfEngines: 1,
        engCombustion1: 1,
        engineRpm1: 1000,
        engineType: 1,
        onGround: 0,
        stallWarning: 1,
        gearLeftPct: 0,
        gearRightPct: 0,
        gearNosePct: 0,
        gearPct: 0,
        gForce: 1,
        mach: 0.4,
        airspeedKnots: 200,
        flapsLeftPct: 0,
        speedbrakePct: 0,
        afterburnerPct1: 0,
        afterburnerPct2: 0,
        vertSpeedFpm: 0,
        apuPctRpm: 0,
      },
      preferences: prefs,
      touchdown,
      nowMs: 1000,
      meta,
      deviceConfig: DEVICE_CONFIG,
    })
    // 70 feel-units × 2.55 ≈ 178.5 HID
    assert.ok(out['F16 JGRIP'] >= 170 && out['F16 JGRIP'] <= 185, `got ${out['F16 JGRIP']}`)
  })

  it('master 50% halves the summed HID contribution', () => {
    const prefs = getDefaultBridgePreferences()
    prefs.profiles.aircraft.master.intensity = 50
    const touchdown = createTouchdownTracker()
    const meta = { lastEngineType: -1, lastEnginesRunning: -1 }
    const state = {
      numberOfEngines: 1,
      engCombustion1: 1,
      engineRpm1: 10000,
      engineType: 1,
      onGround: 0,
      stallWarning: 0,
      gearLeftPct: 0,
      gearRightPct: 0,
      gearNosePct: 0,
      gearPct: 0,
      gForce: 1,
      mach: 0.4,
      airspeedKnots: 200,
      flapsLeftPct: 0,
      speedbrakePct: 0,
      afterburnerPct1: 0,
      afterburnerPct2: 0,
      vertSpeedFpm: 0,
      apuPctRpm: 0,
    }
    const full = computeMotorIntensities({
      state,
      preferences: getDefaultBridgePreferences(),
      touchdown: createTouchdownTracker(),
      nowMs: 1000,
      meta: { lastEngineType: -1, lastEnginesRunning: -1 },
      deviceConfig: DEVICE_CONFIG,
    })
    const half = computeMotorIntensities({
      state,
      preferences: prefs,
      touchdown,
      nowMs: 1000,
      meta,
      deviceConfig: DEVICE_CONFIG,
    })
    assert.ok(full['F15EX L'] > 0)
    assert.ok(Math.abs(half['F15EX L'] - full['F15EX L'] * 0.5) < 0.6)
  })
})
