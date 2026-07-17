/**
 * WinWing MSFS2024 Vibration Bridge  v0.1.0
 *
 * Reads flight data from MSFS2024 via SimConnect and sends
 * vibration commands to WinWing Orion 2 controllers via HID.
 *
 * Per-motor routing:
 *   F15EX L  (engineIdx 0) — engine 1 RPM + afterburner + universal effects
 *   F15EX R  (engineIdx 1) — engine 2 RPM + afterburner + universal effects
 *   F16 JGRIP (engineIdx null) — aerodynamic buffet + universal effects
 *
 * Universal effects (all motors): touchdown, G-force, stall, transonic,
 *   gear transit, ETL/VRS (helo)
 *
 * Correct packet format (14 bytes):
 *   [0x02][subId0][subId1][subId2][subId3][0x03][0x49][motor][value][0x5]
 *
 * Usage:  node vibration.js
 */

'use strict'

const HID = require('node-hid')
const {
  open,
  Protocol,
  SimConnectDataType,
  SimConnectPeriod,
  SimConnectConstants,
} = require('node-simconnect')

const {
  safeNumber,
  buildVibPacket,
  intensityToHidByte,
  engFxForHandle,
  pistonTurbopropEngineFx,
  jetEngineRpmFx,
  createTouchdownTracker,
  updateTouchdown,
  resetTouchdown,
} = require('./lib/vibration-core')

// ─── Device config ────────────────────────────────────────────────────────────

const WINWING_VID = 0x4098
const APP_VERSION = '0.1.0'

// engineIdx: which engine this motor follows (0-based).
//   null  → aerodynamic/joystick channel (no engine-specific effects)
//   0..3  → follows engine N combustion state and RPM
const DEVICE_CONFIG = [
  {
    pid:  0xBD64,
    name: 'Throttle Base II',
    motors: [
      { subId: [0x01, 0xBF, 0x00, 0x00], motorIdx: 0, label: 'F15EX L', engineIdx: 0 },
      { subId: [0x02, 0xBF, 0x00, 0x00], motorIdx: 0, label: 'F15EX R', engineIdx: 1 },
    ],
  },
  {
    pid:  0xBEA8,
    name: 'Joystick Base 2',
    motors: [
      { subId: [0x07, 0xBE, 0x00, 0x00], motorIdx: 0, label: 'F16 JGRIP', engineIdx: null },
    ],
  },
]

// ─── Runtime handles / timers ─────────────────────────────────────────────────

const openDevices = {}
const motorIntensities = {}
const hidErrorLogAt = {}

const HID_ERROR_COOLDOWN_MS = 5000
const HID_REDISCOVER_MS = 3000
const SIM_RECONNECT_MS = 5000

let shuttingDown = false
let sendInterval = null
let rediscoverInterval = null
let reconnectTimer = null
let activeSimHandle = null
let connectingSim = false

const touchdown = createTouchdownTracker()

// ─── Shared intensity helpers ─────────────────────────────────────────────────

function zeroAllMotors() {
  for (const cfg of DEVICE_CONFIG) {
    for (const motor of cfg.motors) motorIntensities[motor.label] = 0
  }
}

function logHidError(key, message) {
  const now = Date.now()
  if ((hidErrorLogAt[key] || 0) + HID_ERROR_COOLDOWN_MS > now) return
  hidErrorLogAt[key] = now
  console.error(`[HID] ${message}`)
}

function dropDevice(pid, reason) {
  const dev = openDevices[pid]
  if (!dev) return
  try { dev.removeAllListeners('error') } catch (_) {}
  try { dev.close() } catch (_) {}
  delete openDevices[pid]
  const hex = pid.toString(16).toUpperCase()
  logHidError(`drop-${pid}`, `Closed PID 0x${hex}: ${reason}`)
}

function tryOpenDevice(cfg) {
  if (openDevices[cfg.pid] || shuttingDown) return Boolean(openDevices[cfg.pid])

  const all = HID.devices()
  const d = all.find(x => x.vendorId === WINWING_VID && x.productId === cfg.pid)
  if (!d) return false

  try {
    const dev = new HID.HID(d.path)
    dev.on('error', (err) => {
      logHidError(`err-${cfg.pid}`, `${cfg.name}: ${err && err.message ? err.message : 'error'}`)
      dropDevice(cfg.pid, 'device error')
    })
    openDevices[cfg.pid] = dev
    const labels = cfg.motors.map(m => m.label).join(', ')
    console.log(`[HID] Opened: ${cfg.name}  [${labels}]`)
    return true
  } catch (e) {
    logHidError(`open-${cfg.pid}`, `Could not open ${cfg.name}: ${e.message}`)
    return false
  }
}

function openOrRefreshHidDevices() {
  let opened = 0
  for (const cfg of DEVICE_CONFIG) {
    if (openDevices[cfg.pid] || tryOpenDevice(cfg)) opened++
  }
  return opened
}

function closeHidDevices() {
  for (const pid of Object.keys(openDevices)) {
    const n = Number(pid)
    const dev = openDevices[n]
    try { if (dev) { dev.removeAllListeners('error'); dev.close() } } catch (_) {}
    delete openDevices[n]
  }
}

// ─── Vibration output ─────────────────────────────────────────────────────────

function sendVibration() {
  for (const cfg of DEVICE_CONFIG) {
    const dev = openDevices[cfg.pid]
    if (!dev) continue
    for (const motor of cfg.motors) {
      const value = intensityToHidByte(motorIntensities[motor.label])
      try {
        dev.write(buildVibPacket(motor.subId, motor.motorIdx, value))
      } catch (e) {
        logHidError(`write-${cfg.pid}`, `${cfg.name} write failed: ${e.message}`)
        dropDevice(cfg.pid, 'write failed')
        break
      }
    }
  }
}

// ─── SimConnect variables ─────────────────────────────────────────────────────

const DEF_ID = 1
const REQ_ID = 1

// ENGINE TYPE enum: 0=Piston, 1=Jet, 2=None/Glider, 3=Helicopter, 4=Rocket, 5=Turboprop
const SIM_VARS = [
  ['GEAR TOTAL PCT EXTENDED',            'percent',          'gearPct'         ],
  ['AIRSPEED TRUE',                      'knots',            'airspeedKnots'   ],
  ['AIRSPEED MACH',                      'mach',             'mach'            ],
  ['G FORCE',                            'GForce',           'gForce'          ],
  ['INCIDENCE ALPHA',                    'degrees',          'aoa'             ],
  ['VERTICAL SPEED',                     'feet per minute',  'vertSpeedFpm'    ],
  ['SIM ON GROUND',                      'bool',             'onGround'        ],
  ['GEAR LEFT POSITION',                 'percent',          'gearLeftPct'     ],
  ['GEAR RIGHT POSITION',                'percent',          'gearRightPct'    ],
  ['GEAR CENTER POSITION',               'percent',          'gearNosePct'     ],
  ['GENERAL ENG RPM:1',                  'rpm',              'engineRpm1'      ],
  ['GENERAL ENG RPM:2',                  'rpm',              'engineRpm2'      ],
  ['GENERAL ENG RPM:3',                  'rpm',              'engineRpm3'      ],
  ['GENERAL ENG RPM:4',                  'rpm',              'engineRpm4'      ],
  ['STALL WARNING',                      'bool',             'stallWarning'    ],
  ['TURB ENG AFTERBURNER PCT ACTIVE:1',  'percent',          'afterburnerPct1' ],
  ['TURB ENG AFTERBURNER PCT ACTIVE:2',  'percent',          'afterburnerPct2' ],
  ['SPOILERS HANDLE POSITION',           'percent',          'speedbrakePct'   ],
  ['ENGINE TYPE',                        'number',           'engineType'      ],
  ['ROTOR RPM PCT:1',                    'percent',          'rotorRpmPct'     ],
  ['TRAILING EDGE FLAPS LEFT PERCENT',   'percent',          'flapsLeftPct'    ],
  ['NUMBER OF ENGINES',                  'number',           'numberOfEngines' ],
  ['GENERAL ENG COMBUSTION:1',           'bool',             'engCombustion1'  ],
  ['GENERAL ENG COMBUSTION:2',           'bool',             'engCombustion2'  ],
  ['GENERAL ENG COMBUSTION:3',           'bool',             'engCombustion3'  ],
  ['GENERAL ENG COMBUSTION:4',           'bool',             'engCombustion4'  ],
  ['APU PCT RPM',                        'percent',          'apuPctRpm'       ],
]

// ─── Flight state ─────────────────────────────────────────────────────────────

const state = {
  gearPct: 0, airspeedKnots: 0, mach: 0, gForce: 1.0, aoa: 0,
  vertSpeedFpm: 0, onGround: 1,
  gearLeftPct: 0, gearRightPct: 0, gearNosePct: 0,
  engineRpm1: 0, engineRpm2: 0, engineRpm3: 0, engineRpm4: 0,
  stallWarning: 0,
  afterburnerPct1: 0, afterburnerPct2: 0,
  speedbrakePct: 0,
  engineType: 1,
  rotorRpmPct: 0,
  flapsLeftPct: 0,
  numberOfEngines: 1,
  engCombustion1: 0, engCombustion2: 0, engCombustion3: 0, engCombustion4: 0,
  apuPctRpm: 0,
}

let lastEngineType     = -1
let lastEnginesRunning = -1

const ENGINE_TYPE_NAMES = {
  0: 'Piston', 1: 'Jet', 2: 'Glider/Unpowered',
  3: 'Helicopter', 4: 'Rocket', 5: 'Turboprop',
}

const AFTERBURNER_BY_ENGINE = [
  () => state.afterburnerPct1,
  () => state.afterburnerPct2,
  () => 0,
  () => 0,
]

function engineRpms() {
  return [
    safeNumber(state.engineRpm1),
    safeNumber(state.engineRpm2),
    safeNumber(state.engineRpm3),
    safeNumber(state.engineRpm4),
  ]
}

// Returns { base, engFx: [e0,e1,e2,e3], aeroFx }
function computeVibration() {
  const totalEngines   = Math.max(1, Math.round(safeNumber(state.numberOfEngines, 1)))
  const combustion     = [
    safeNumber(state.engCombustion1) > 0.5,
    safeNumber(state.engCombustion2) > 0.5,
    safeNumber(state.engCombustion3) > 0.5,
    safeNumber(state.engCombustion4) > 0.5,
  ]
  const rpms           = engineRpms()
  const enginesRunning = combustion.slice(0, totalEngines).filter(Boolean).length
  const anyEngineOn    = enginesRunning > 0

  if (enginesRunning !== lastEnginesRunning) {
    console.log(`[VIB] Engines running: ${enginesRunning}/${totalEngines}`)
    lastEnginesRunning = enginesRunning
  }

  if (!anyEngineOn) {
    resetTouchdown(touchdown)
    touchdown.prevOnGround = safeNumber(state.onGround) > 0.5

    const apuVib = safeNumber(state.apuPctRpm) > 10
      ? Math.min(8, (safeNumber(state.apuPctRpm) / 100) * 8)
      : 0
    return { base: apuVib, engFx: [0, 0, 0, 0], aeroFx: 0 }
  }

  const engineTypeInt = Math.round(safeNumber(state.engineType, 1))
  const isHelo        = engineTypeInt === 3
  const isPiston      = engineTypeInt === 0
  const isTurboProp   = engineTypeInt === 5

  if (engineTypeInt !== lastEngineType) {
    console.log(`[VIB] Aircraft type: ${ENGINE_TYPE_NAMES[engineTypeInt] || `Unknown(${engineTypeInt})`}`)
    lastEngineType = engineTypeInt
  }

  let base    = 0
  let aeroFx  = 0
  const engFx = [0, 0, 0, 0]

  // ── Universal: TOUCHDOWN PULSE (wall-clock, last airborne VS) ───────────────
  const td = updateTouchdown(touchdown, {
    onGround: state.onGround,
    vertSpeedFpm: state.vertSpeedFpm,
  }, performance.now())

  if (td.triggered) {
    console.log(`[VIB] Touchdown! sink=${td.sinkFpm.toFixed(0)} fpm → ${td.intensity.toFixed(0)}%`)
  }
  base += td.intensity

  // ── Universal: GEAR IN TRANSIT ─────────────────────────────────────────────
  const gearMoving =
    (safeNumber(state.gearLeftPct)  > 3 && safeNumber(state.gearLeftPct)  < 97) ||
    (safeNumber(state.gearRightPct) > 3 && safeNumber(state.gearRightPct) < 97) ||
    (safeNumber(state.gearNosePct)  > 3 && safeNumber(state.gearNosePct)  < 97)
  if (gearMoving) base += 25

  // ── Universal: STALL BUFFET ────────────────────────────────────────────────
  if (safeNumber(state.stallWarning)) base += isHelo ? 25 : 70

  // ── Universal: G-FORCE BUFFET ──────────────────────────────────────────────
  const gThreshold = isHelo ? 1.8 : (isPiston || isTurboProp) ? 2.5 : 3.0
  const gExcess    = Math.max(0, Math.abs(safeNumber(state.gForce, 1)) - gThreshold)
  base += Math.min(50, gExcess * 18)

  if (isHelo) {
    if (safeNumber(state.rotorRpmPct) > 5) {
      base += Math.min(1, safeNumber(state.rotorRpmPct) / 100) * 10
    }

    if (safeNumber(state.rotorRpmPct) > 5 && safeNumber(state.rotorRpmPct) < 90) {
      aeroFx += (90 - safeNumber(state.rotorRpmPct)) * 1.2
    }

    if (!(safeNumber(state.onGround) > 0.5) &&
        safeNumber(state.airspeedKnots) > 8 &&
        safeNumber(state.airspeedKnots) < 35) {
      const etlFactor = 1 - Math.abs(safeNumber(state.airspeedKnots) - 20) / 13
      base += Math.max(0, etlFactor) * 22
    }

    if (!(safeNumber(state.onGround) > 0.5) &&
        safeNumber(state.airspeedKnots) < 30 &&
        safeNumber(state.vertSpeedFpm) < -300) {
      const vrsFactor = Math.min(1, (Math.abs(safeNumber(state.vertSpeedFpm)) - 300) / 700)
      aeroFx += vrsFactor * 40
    }

  } else if (isPiston || isTurboProp) {
    for (let i = 0; i < totalEngines; i++) {
      engFx[i] += pistonTurbopropEngineFx(rpms[i], combustion[i], isTurboProp)
    }

    if (safeNumber(state.gearPct) > 5 && !(safeNumber(state.onGround) > 0.5)) {
      const sf = Math.min(1, safeNumber(state.airspeedKnots) / 120)
      aeroFx += (safeNumber(state.gearPct) / 100) * sf * 20
    }

    if (safeNumber(state.flapsLeftPct) > 5 && !(safeNumber(state.onGround) > 0.5)) {
      aeroFx += (safeNumber(state.flapsLeftPct) / 100) *
        Math.min(1, safeNumber(state.airspeedKnots) / 100) * 22
    }

    if (safeNumber(state.airspeedKnots) > 150) {
      aeroFx += Math.min(15, (safeNumber(state.airspeedKnots) - 150) * 0.15)
    }

    if (safeNumber(state.speedbrakePct) > 5 && !(safeNumber(state.onGround) > 0.5)) {
      aeroFx += (safeNumber(state.speedbrakePct) / 100) *
        Math.min(1, safeNumber(state.airspeedKnots) / 200) * 25
    }

  } else {
    for (let i = 0; i < totalEngines; i++) {
      if (!combustion[i]) continue
      engFx[i] += jetEngineRpmFx(rpms[i], true)
      const abPct = safeNumber(AFTERBURNER_BY_ENGINE[i]())
      if (abPct > 5) engFx[i] += (abPct / 100) * 30
    }

    if (safeNumber(state.gearPct) > 5 && !(safeNumber(state.onGround) > 0.5)) {
      aeroFx += (safeNumber(state.gearPct) / 100) *
        Math.min(1, safeNumber(state.airspeedKnots) / 180) * 35
    }

    if (safeNumber(state.mach) > 0.82) {
      const mach = safeNumber(state.mach)
      const transBuff = Math.exp(-Math.pow((mach - 1.0) / 0.18, 2))
      base += Number.isFinite(transBuff) ? transBuff * 55 : 0
      if (mach > 1.3) base += Math.min(15, (mach - 1.3) * 20)
    }

    if (safeNumber(state.speedbrakePct) > 5 && !(safeNumber(state.onGround) > 0.5)) {
      aeroFx += (safeNumber(state.speedbrakePct) / 100) *
        Math.min(1, safeNumber(state.airspeedKnots) / 300) * 40
    }

    if (safeNumber(state.flapsLeftPct) > 5 && !(safeNumber(state.onGround) > 0.5)) {
      aeroFx += (safeNumber(state.flapsLeftPct) / 100) *
        Math.min(1, safeNumber(state.airspeedKnots) / 200) * 15
    }
  }

  return {
    base: Number.isFinite(base) ? base : 0,
    engFx: engFx.map(v => (Number.isFinite(v) ? v : 0)),
    aeroFx: Number.isFinite(aeroFx) ? aeroFx : 0,
  }
}

function applyIntensities() {
  const { base, engFx, aeroFx } = computeVibration()
  const totalEngines = Math.max(1, Math.round(safeNumber(state.numberOfEngines, 1)))

  for (const cfg of DEVICE_CONFIG) {
    for (const motor of cfg.motors) {
      if (motor.engineIdx === null) {
        motorIntensities[motor.label] = Math.min(100, base + aeroFx)
      } else {
        const eFx = engFxForHandle(motor.engineIdx, engFx, totalEngines)
        motorIntensities[motor.label] = Math.min(100, base + eFx)
      }
    }
  }
}

// ─── SimConnect connection ────────────────────────────────────────────────────

function clearSimHandle() {
  if (!activeSimHandle) return
  try {
    activeSimHandle.removeAllListeners()
  } catch (_) {}
  try {
    if (typeof activeSimHandle.close === 'function') activeSimHandle.close()
  } catch (_) {}
  activeSimHandle = null
}

function cancelReconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
}

function scheduleReconnect(reason) {
  if (shuttingDown) return
  zeroAllMotors()
  if (reconnectTimer) return
  if (reason) console.log(`[SIM] ${reason} — retrying in ${SIM_RECONNECT_MS / 1000}s`)
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connectMSFS()
  }, SIM_RECONNECT_MS)
}

function connectMSFS() {
  if (shuttingDown || connectingSim) return
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }

  connectingSim = true
  clearSimHandle()
  console.log('[SIM] Connecting to MSFS2024...')

  open('WinWing Vibration Bridge', Protocol.FSX_SP2)
    .then(({ recvOpen, handle }) => {
      connectingSim = false
      if (shuttingDown) {
        try { handle.close() } catch (_) {}
        return
      }

      activeSimHandle = handle
      console.log(`[SIM] Connected: ${recvOpen.applicationName}`)

      for (const [varName, unit] of SIM_VARS) {
        handle.addToDataDefinition(
          DEF_ID, varName, unit,
          SimConnectDataType.FLOAT64, 0.0,
          SimConnectConstants.UNUSED
        )
      }

      handle.requestDataOnSimObject(
        REQ_ID, DEF_ID,
        SimConnectConstants.OBJECT_ID_USER,
        SimConnectPeriod.SIM_FRAME,
        0, 0, 0, 0
      )

      handle.on('simObjectData', (recv) => {
        if (recv.requestID !== REQ_ID || shuttingDown) return
        for (const [, , key] of SIM_VARS) {
          state[key] = safeNumber(recv.data.readFloat64())
        }
        applyIntensities()
      })

      handle.on('exception', (e) => {
        console.error('[SIM] Exception:', JSON.stringify(e))
      })

      handle.on('quit', () => {
        console.log('[SIM] MSFS quit — vibration stopped')
        clearSimHandle()
        scheduleReconnect('simulator quit')
      })

      handle.on('close', () => {
        clearSimHandle()
        scheduleReconnect('connection closed')
      })
    })
    .catch((err) => {
      connectingSim = false
      if (shuttingDown) return
      console.warn(`[SIM] Not connected: ${err.message}`)
      scheduleReconnect('waiting for MSFS2024')
    })
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────

function shutdown(exitCode = 0) {
  if (shuttingDown) return
  shuttingDown = true
  console.log('\n[EXIT] Stopping...')

  cancelReconnect()
  if (sendInterval) { clearInterval(sendInterval); sendInterval = null }
  if (rediscoverInterval) { clearInterval(rediscoverInterval); rediscoverInterval = null }

  zeroAllMotors()
  try { sendVibration() } catch (_) {}

  setTimeout(() => {
    closeHidDevices()
    clearSimHandle()
    process.exit(exitCode)
  }, 300)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

process.on('uncaughtException', (err) => {
  console.error('[FATAL] uncaughtException:', err && err.stack ? err.stack : err)
  shutdown(1)
})

process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] unhandledRejection:', reason)
  shutdown(1)
})

// ─── Start ────────────────────────────────────────────────────────────────────

console.log('╔══════════════════════════════════════════════╗')
console.log(`║  WinWing MSFS2024 Vibration Bridge  v${APP_VERSION}   ║`)
console.log('╚══════════════════════════════════════════════╝')
console.log('  Ctrl+C to stop\n')

const openedAtStart = openOrRefreshHidDevices()
if (openedAtStart === 0) {
  console.warn('[HID] No compatible WinWing device found yet.')
  console.warn('[HID] Waiting for hardware (will keep looking)...')
}

// 50 Hz send loop — motors need continuous refresh to stay vibrating
sendInterval = setInterval(sendVibration, 20)

// Periodic rediscovery for hot-plug / recovery after disconnect
rediscoverInterval = setInterval(() => {
  if (shuttingDown) return
  openOrRefreshHidDevices()
}, HID_REDISCOVER_MS)

connectMSFS()
