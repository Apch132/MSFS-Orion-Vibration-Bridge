/**
 * Vibration intensity computation with runtime preference scaling.
 */

'use strict'

const {
  safeNumber,
  engFxForHandle,
  pistonTurbopropEngineFx,
  jetEngineRpmFx,
  updateTouchdown,
  resetTouchdown,
} = require('../vibration-core')
const { activeProfileSettings, scaleEffect } = require('./preferences')

const ENGINE_TYPE_NAMES = {
  0: 'Piston', 1: 'Jet', 2: 'Glider/Unpowered',
  3: 'Helicopter', 4: 'Rocket', 5: 'Turboprop',
}

/**
 * @param {object} args
 * @param {object} args.state flight sim state
 * @param {object} args.preferences bridge preferences
 * @param {object} args.touchdown touchdown tracker
 * @param {number} args.nowMs
 * @param {{ lastEngineType: number, lastEnginesRunning: number }} args.meta
 * @param {(msg: string) => void} [args.log]
 */
function computeMotorIntensities(args) {
  const {
    state,
    preferences,
    touchdown,
    nowMs,
    meta,
    deviceConfig,
    log = () => {},
  } = args

  const profile = activeProfileSettings(preferences)
  const totalEngines = Math.max(1, Math.round(safeNumber(state.numberOfEngines, 1)))
  const combustion = [
    safeNumber(state.engCombustion1) > 0.5,
    safeNumber(state.engCombustion2) > 0.5,
    safeNumber(state.engCombustion3) > 0.5,
    safeNumber(state.engCombustion4) > 0.5,
  ]
  const rpms = [
    safeNumber(state.engineRpm1),
    safeNumber(state.engineRpm2),
    safeNumber(state.engineRpm3),
    safeNumber(state.engineRpm4),
  ]
  const enginesRunning = combustion.slice(0, totalEngines).filter(Boolean).length
  const anyEngineOn = enginesRunning > 0

  if (enginesRunning !== meta.lastEnginesRunning) {
    log(`[VIB] Engines running: ${enginesRunning}/${totalEngines}`)
    meta.lastEnginesRunning = enginesRunning
  }

  const motorIntensities = {}

  if (!anyEngineOn) {
    resetTouchdown(touchdown)
    touchdown.prevOnGround = safeNumber(state.onGround) > 0.5
    const apuVib = safeNumber(state.apuPctRpm) > 10
      ? Math.min(8, (safeNumber(state.apuPctRpm) / 100) * 8)
      : 0
    const base = scaleEffect(profile.master, apuVib)
    for (const cfg of deviceConfig) {
      for (const motor of cfg.motors) {
        motorIntensities[motor.label] = Math.min(100, base)
      }
    }
    return motorIntensities
  }

  const engineTypeInt = Math.round(safeNumber(state.engineType, 1))
  const isHelo = engineTypeInt === 3
  const isPiston = engineTypeInt === 0
  const isTurboProp = engineTypeInt === 5

  if (engineTypeInt !== meta.lastEngineType) {
    log(`[VIB] Aircraft type: ${ENGINE_TYPE_NAMES[engineTypeInt] || `Unknown(${engineTypeInt})`}`)
    meta.lastEngineType = engineTypeInt
  }

  let base = 0
  let aeroFx = 0
  const engFx = [0, 0, 0, 0]
  let afterburnerFx = [0, 0, 0, 0]

  const td = updateTouchdown(touchdown, {
    onGround: state.onGround,
    vertSpeedFpm: state.vertSpeedFpm,
  }, nowMs)

  if (td.triggered) {
    log(`[VIB] Touchdown! sink=${td.sinkFpm.toFixed(0)} fpm → ${td.intensity.toFixed(0)}%`)
  }
  base += scaleEffect(profile.touchdown, td.intensity)

  const gearMoving =
    (safeNumber(state.gearLeftPct) > 3 && safeNumber(state.gearLeftPct) < 97) ||
    (safeNumber(state.gearRightPct) > 3 && safeNumber(state.gearRightPct) < 97) ||
    (safeNumber(state.gearNosePct) > 3 && safeNumber(state.gearNosePct) < 97)
  if (gearMoving) base += scaleEffect(profile.gear, 25)

  if (safeNumber(state.stallWarning)) {
    base += scaleEffect(profile.stall, isHelo ? 25 : 70)
  }

  const gThreshold = isHelo ? 1.8 : (isPiston || isTurboProp) ? 2.5 : 3.0
  const gExcess = Math.max(0, Math.abs(safeNumber(state.gForce, 1)) - gThreshold)
  base += Math.min(50, gExcess * 18)

  if (isHelo) {
    if (safeNumber(state.rotorRpmPct) > 5) {
      base += scaleEffect(profile.engine, Math.min(1, safeNumber(state.rotorRpmPct) / 100) * 10)
    }
    if (safeNumber(state.rotorRpmPct) > 5 && safeNumber(state.rotorRpmPct) < 90) {
      aeroFx += scaleEffect(profile.engine, (90 - safeNumber(state.rotorRpmPct)) * 1.2)
    }
    if (!(safeNumber(state.onGround) > 0.5) &&
        safeNumber(state.airspeedKnots) > 8 &&
        safeNumber(state.airspeedKnots) < 35) {
      const etlFactor = 1 - Math.abs(safeNumber(state.airspeedKnots) - 20) / 13
      base += scaleEffect(profile.engine, Math.max(0, etlFactor) * 22)
    }
    if (!(safeNumber(state.onGround) > 0.5) &&
        safeNumber(state.airspeedKnots) < 30 &&
        safeNumber(state.vertSpeedFpm) < -300) {
      const vrsFactor = Math.min(1, (Math.abs(safeNumber(state.vertSpeedFpm)) - 300) / 700)
      aeroFx += scaleEffect(profile.engine, vrsFactor * 40)
    }
  } else if (isPiston || isTurboProp) {
    for (let i = 0; i < totalEngines; i++) {
      engFx[i] += scaleEffect(
        profile.engine,
        pistonTurbopropEngineFx(rpms[i], combustion[i], isTurboProp),
      )
    }
    if (safeNumber(state.gearPct) > 5 && !(safeNumber(state.onGround) > 0.5)) {
      const sf = Math.min(1, safeNumber(state.airspeedKnots) / 120)
      aeroFx += scaleEffect(profile.gear, (safeNumber(state.gearPct) / 100) * sf * 20)
    }
    if (safeNumber(state.flapsLeftPct) > 5 && !(safeNumber(state.onGround) > 0.5)) {
      aeroFx += scaleEffect(
        profile.flaps,
        (safeNumber(state.flapsLeftPct) / 100) *
          Math.min(1, safeNumber(state.airspeedKnots) / 100) * 22,
      )
    }
    if (safeNumber(state.airspeedKnots) > 150) {
      aeroFx += Math.min(15, (safeNumber(state.airspeedKnots) - 150) * 0.15)
    }
    if (safeNumber(state.speedbrakePct) > 5 && !(safeNumber(state.onGround) > 0.5)) {
      aeroFx += (safeNumber(state.speedbrakePct) / 100) *
        Math.min(1, safeNumber(state.airspeedKnots) / 200) * 25
    }
  } else {
    const afterburnerByEngine = [
      safeNumber(state.afterburnerPct1),
      safeNumber(state.afterburnerPct2),
      0,
      0,
    ]
    for (let i = 0; i < totalEngines; i++) {
      if (!combustion[i]) continue
      engFx[i] += scaleEffect(profile.engine, jetEngineRpmFx(rpms[i], true))
      const abPct = afterburnerByEngine[i]
      if (abPct > 5) {
        afterburnerFx[i] += scaleEffect(profile.afterburner, (abPct / 100) * 30)
      }
    }
    if (safeNumber(state.gearPct) > 5 && !(safeNumber(state.onGround) > 0.5)) {
      aeroFx += scaleEffect(
        profile.gear,
        (safeNumber(state.gearPct) / 100) *
          Math.min(1, safeNumber(state.airspeedKnots) / 180) * 35,
      )
    }
    if (safeNumber(state.mach) > 0.82) {
      const mach = safeNumber(state.mach)
      const transBuff = Math.exp(-Math.pow((mach - 1.0) / 0.18, 2))
      let trans = Number.isFinite(transBuff) ? transBuff * 55 : 0
      if (mach > 1.3) trans += Math.min(15, (mach - 1.3) * 20)
      base += scaleEffect(profile.transonic, trans)
    }
    if (safeNumber(state.speedbrakePct) > 5 && !(safeNumber(state.onGround) > 0.5)) {
      aeroFx += (safeNumber(state.speedbrakePct) / 100) *
        Math.min(1, safeNumber(state.airspeedKnots) / 300) * 40
    }
    if (safeNumber(state.flapsLeftPct) > 5 && !(safeNumber(state.onGround) > 0.5)) {
      aeroFx += scaleEffect(
        profile.flaps,
        (safeNumber(state.flapsLeftPct) / 100) *
          Math.min(1, safeNumber(state.airspeedKnots) / 200) * 15,
      )
    }
  }

  // groundRoll reserved for future taxi rumble — preference kept for UI parity
  void profile.groundRoll

  for (const cfg of deviceConfig) {
    for (const motor of cfg.motors) {
      let raw
      if (motor.engineIdx === null) {
        raw = base + aeroFx
      } else {
        const eFx = engFxForHandle(motor.engineIdx, engFx, totalEngines)
        const ab = engFxForHandle(motor.engineIdx, afterburnerFx, totalEngines)
        raw = base + eFx + ab
      }
      motorIntensities[motor.label] = Math.min(
        100,
        scaleEffect(profile.master, Number.isFinite(raw) ? raw : 0),
      )
    }
  }

  return motorIntensities
}

module.exports = {
  computeMotorIntensities,
  ENGINE_TYPE_NAMES,
}
