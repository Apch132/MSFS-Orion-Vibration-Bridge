/**
 * Vibration intensity computation with runtime preference scaling.
 *
 * Pipeline:
 *   dynamicFactor ∈ [0, 1]  (trigger conditions + curve shape)
 *   effectOutput  = dynamicFactor * (effectSlider / 100) * 255
 *   finalOutput   = clamp(sum(activeEffects) * (master / 100), 0, 255)
 *
 * Motor intensities returned here are HID bytes 0..255 (never 256).
 */

'use strict'

const {
  safeNumber,
  engFxForHandle,
  pistonTurbopropEngineFx,
  jetEngineRpmFx,
  updateTouchdown,
  resetTouchdown,
  HID_MAX,
} = require('../vibration-core')
const { activeProfileSettings, scaleEffect, applyMaster } = require('./preferences')

const ENGINE_TYPE_NAMES = {
  0: 'Piston', 1: 'Jet', 2: 'Glider/Unpowered',
  3: 'Helicopter', 4: 'Rocket', 5: 'Turboprop',
}

function clampFactor(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.min(1, n)
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
    const apuFactor = safeNumber(state.apuPctRpm) > 10
      ? clampFactor((safeNumber(state.apuPctRpm) / 100) * 0.12)
      : 0
    const hid = applyMaster(profile.master, apuFactor * HID_MAX)
    for (const cfg of deviceConfig) {
      for (const motor of cfg.motors) {
        motorIntensities[motor.label] = hid
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
    log(`[VIB] Touchdown! sink=${td.sinkFpm.toFixed(0)} fpm → factor=${td.intensity.toFixed(2)}`)
  }
  base += scaleEffect(profile.touchdown, td.intensity)

  const gearMoving =
    (safeNumber(state.gearLeftPct) > 3 && safeNumber(state.gearLeftPct) < 97) ||
    (safeNumber(state.gearRightPct) > 3 && safeNumber(state.gearRightPct) < 97) ||
    (safeNumber(state.gearNosePct) > 3 && safeNumber(state.gearNosePct) < 97)
  if (gearMoving) base += scaleEffect(profile.gear, 0.55)

  if (safeNumber(state.stallWarning)) {
    base += scaleEffect(profile.stall, isHelo ? 0.45 : 1)
  }

  // G-buffet (no dedicated slider): full-ceiling contribution, Master still applies.
  const gThreshold = isHelo ? 1.8 : (isPiston || isTurboProp) ? 2.5 : 3.0
  const gExcess = Math.max(0, Math.abs(safeNumber(state.gForce, 1)) - gThreshold)
  base += clampFactor(gExcess * 0.36) * HID_MAX

  if (isHelo) {
    if (safeNumber(state.rotorRpmPct) > 5) {
      base += scaleEffect(profile.engine, clampFactor(safeNumber(state.rotorRpmPct) / 100) * 0.35)
    }
    if (safeNumber(state.rotorRpmPct) > 5 && safeNumber(state.rotorRpmPct) < 90) {
      aeroFx += scaleEffect(
        profile.engine,
        clampFactor(((90 - safeNumber(state.rotorRpmPct)) / 90) * 0.85),
      )
    }
    if (!(safeNumber(state.onGround) > 0.5) &&
        safeNumber(state.airspeedKnots) > 8 &&
        safeNumber(state.airspeedKnots) < 35) {
      const etlFactor = 1 - Math.abs(safeNumber(state.airspeedKnots) - 20) / 13
      base += scaleEffect(profile.engine, clampFactor(Math.max(0, etlFactor) * 0.7))
    }
    if (!(safeNumber(state.onGround) > 0.5) &&
        safeNumber(state.airspeedKnots) < 30 &&
        safeNumber(state.vertSpeedFpm) < -300) {
      const vrsFactor = Math.min(1, (Math.abs(safeNumber(state.vertSpeedFpm)) - 300) / 700)
      aeroFx += scaleEffect(profile.engine, clampFactor(vrsFactor))
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
      aeroFx += scaleEffect(
        profile.gear,
        clampFactor((safeNumber(state.gearPct) / 100) * sf * 0.65),
      )
    }
    if (safeNumber(state.flapsLeftPct) > 5 && !(safeNumber(state.onGround) > 0.5)) {
      aeroFx += scaleEffect(
        profile.flaps,
        clampFactor(
          (safeNumber(state.flapsLeftPct) / 100) *
            Math.min(1, safeNumber(state.airspeedKnots) / 100) * 0.7,
        ),
      )
    }
    if (safeNumber(state.airspeedKnots) > 150) {
      aeroFx += clampFactor((safeNumber(state.airspeedKnots) - 150) * 0.004) * HID_MAX
    }
    if (safeNumber(state.speedbrakePct) > 5 && !(safeNumber(state.onGround) > 0.5)) {
      aeroFx += clampFactor(
        (safeNumber(state.speedbrakePct) / 100) *
          Math.min(1, safeNumber(state.airspeedKnots) / 200) * 0.7,
      ) * HID_MAX
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
        afterburnerFx[i] += scaleEffect(profile.afterburner, clampFactor(abPct / 100))
      }
    }
    if (safeNumber(state.gearPct) > 5 && !(safeNumber(state.onGround) > 0.5)) {
      aeroFx += scaleEffect(
        profile.gear,
        clampFactor(
          (safeNumber(state.gearPct) / 100) *
            Math.min(1, safeNumber(state.airspeedKnots) / 180),
        ),
      )
    }
    if (safeNumber(state.mach) > 0.82) {
      const mach = safeNumber(state.mach)
      const transBuff = Math.exp(-Math.pow((mach - 1.0) / 0.18, 2))
      let trans = Number.isFinite(transBuff) ? transBuff : 0
      if (mach > 1.3) trans = Math.min(1, trans + Math.min(0.25, (mach - 1.3) * 0.35))
      base += scaleEffect(profile.transonic, clampFactor(trans))
    }
    if (safeNumber(state.speedbrakePct) > 5 && !(safeNumber(state.onGround) > 0.5)) {
      aeroFx += clampFactor(
        (safeNumber(state.speedbrakePct) / 100) *
          Math.min(1, safeNumber(state.airspeedKnots) / 300),
      ) * HID_MAX
    }
    if (safeNumber(state.flapsLeftPct) > 5 && !(safeNumber(state.onGround) > 0.5)) {
      aeroFx += scaleEffect(
        profile.flaps,
        clampFactor(
          (safeNumber(state.flapsLeftPct) / 100) *
            Math.min(1, safeNumber(state.airspeedKnots) / 200) * 0.55,
        ),
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
      motorIntensities[motor.label] = applyMaster(
        profile.master,
        Number.isFinite(raw) ? raw : 0,
      )
    }
  }

  return motorIntensities
}

module.exports = {
  computeMotorIntensities,
  ENGINE_TYPE_NAMES,
}
