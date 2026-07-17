/**
 * Shared telemetry types for the launcher frontend.
 * Mirror of lib/bridge/telemetry.js schemaVersion 1.
 */

export type SimConnectUiStatus = 'disconnected' | 'connecting' | 'connected' | 'error'
export type HidUiStatus = 'disconnected' | 'connected' | 'error'

export type TelemetryEngine = {
  index: number
  running: boolean
  rpmPercent: number
  n1Percent: number
  n2Percent: number
  combustion: boolean
}

export type TelemetrySnapshot = {
  schemaVersion: number
  timestamp: number
  stale?: boolean
  connection: {
    simconnect: SimConnectUiStatus
    hid: HidUiStatus
  }
  aircraft: {
    title: string
    type: string
    category: string
    isHelicopter: boolean
    engineCount: number
  }
  flight: {
    indicatedAirspeedKts: number
    trueAirspeedKts: number
    groundSpeedKts: number
    altitudeFt: number
    verticalSpeedFpm: number
    headingDeg: number
    pitchDeg: number
    bankDeg: number
    mach: number
    gForce: number
    angleOfAttackDeg: number
    sideslipDeg: number
  }
  aircraftState: {
    onGround: boolean
    gearPosition: number
    flapsPosition: number
    spoilersPosition: number
    stallWarning: boolean
    overspeedWarning: boolean
    afterburnerActive: boolean
  }
  controls: {
    stickX: number
    stickY: number
    rudder: number
    leftThrottle: number
    rightThrottle: number
    brakesLeft: number
    brakesRight: number
  }
  engines: TelemetryEngine[]
}

export type FlightEventKind =
  | 'takeoff'
  | 'gear_up'
  | 'flaps_retracted'
  | 'mach_1'
  | 'landing'
  | 'touchdown'

export type FlightEvent = {
  kind: FlightEventKind
  timestamp: number
}

export const FLIGHT_EVENT_LABELS: Record<FlightEventKind, string> = {
  takeoff: 'Takeoff',
  gear_up: 'Gear Up',
  flaps_retracted: 'Flaps Retracted',
  mach_1: 'Mach 1',
  landing: 'Landing',
  touchdown: 'Touchdown',
}

export function createEmptyTelemetry(): TelemetrySnapshot {
  return {
    schemaVersion: 1,
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
  }
}

function finite(value: unknown, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function asStatus(value: unknown, allowed: string[], fallback: string): string {
  return typeof value === 'string' && allowed.includes(value) ? value : fallback
}

/** Minimal validation of a host telemetry payload. */
export function asTelemetrySnapshot(value: unknown): TelemetrySnapshot | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const flight = (raw.flight && typeof raw.flight === 'object'
    ? raw.flight
    : {}) as Record<string, unknown>
  const aircraft = (raw.aircraft && typeof raw.aircraft === 'object'
    ? raw.aircraft
    : {}) as Record<string, unknown>
  const aircraftState = (raw.aircraftState && typeof raw.aircraftState === 'object'
    ? raw.aircraftState
    : {}) as Record<string, unknown>
  const controls = (raw.controls && typeof raw.controls === 'object'
    ? raw.controls
    : {}) as Record<string, unknown>
  const connection = (raw.connection && typeof raw.connection === 'object'
    ? raw.connection
    : {}) as Record<string, unknown>

  const empty = createEmptyTelemetry()
  return {
    schemaVersion: finite(raw.schemaVersion, 1),
    timestamp: finite(raw.timestamp, 0),
    stale: Boolean(raw.stale),
    connection: {
      simconnect: asStatus(
        connection.simconnect,
        ['disconnected', 'connecting', 'connected', 'error'],
        'disconnected',
      ) as TelemetrySnapshot['connection']['simconnect'],
      hid: asStatus(
        connection.hid,
        ['disconnected', 'connected', 'error'],
        'disconnected',
      ) as TelemetrySnapshot['connection']['hid'],
    },
    aircraft: {
      title: typeof aircraft.title === 'string' ? aircraft.title : '',
      type: typeof aircraft.type === 'string' ? aircraft.type : '',
      category: typeof aircraft.category === 'string' ? aircraft.category : '',
      isHelicopter: Boolean(aircraft.isHelicopter),
      engineCount: Math.max(0, Math.round(finite(aircraft.engineCount, 0))),
    },
    flight: {
      indicatedAirspeedKts: finite(flight.indicatedAirspeedKts, empty.flight.indicatedAirspeedKts),
      trueAirspeedKts: finite(flight.trueAirspeedKts, empty.flight.trueAirspeedKts),
      groundSpeedKts: finite(flight.groundSpeedKts, empty.flight.groundSpeedKts),
      altitudeFt: finite(flight.altitudeFt, empty.flight.altitudeFt),
      verticalSpeedFpm: finite(flight.verticalSpeedFpm, empty.flight.verticalSpeedFpm),
      headingDeg: finite(flight.headingDeg, empty.flight.headingDeg),
      pitchDeg: finite(flight.pitchDeg, empty.flight.pitchDeg),
      bankDeg: finite(flight.bankDeg, empty.flight.bankDeg),
      mach: finite(flight.mach, empty.flight.mach),
      gForce: finite(flight.gForce, empty.flight.gForce),
      angleOfAttackDeg: finite(flight.angleOfAttackDeg, empty.flight.angleOfAttackDeg),
      sideslipDeg: finite(flight.sideslipDeg, empty.flight.sideslipDeg),
    },
    aircraftState: {
      onGround: Boolean(aircraftState.onGround),
      gearPosition: finite(aircraftState.gearPosition, 0),
      flapsPosition: finite(aircraftState.flapsPosition, 0),
      spoilersPosition: finite(aircraftState.spoilersPosition, 0),
      stallWarning: Boolean(aircraftState.stallWarning),
      overspeedWarning: Boolean(aircraftState.overspeedWarning),
      afterburnerActive: Boolean(aircraftState.afterburnerActive),
    },
    controls: {
      stickX: finite(controls.stickX, 0),
      stickY: finite(controls.stickY, 0),
      rudder: finite(controls.rudder, 0),
      leftThrottle: finite(controls.leftThrottle, 0),
      rightThrottle: finite(controls.rightThrottle, 0),
      brakesLeft: finite(controls.brakesLeft, 0),
      brakesRight: finite(controls.brakesRight, 0),
    },
    engines: Array.isArray(raw.engines)
      ? raw.engines.map((eng, idx) => {
          const e = (eng && typeof eng === 'object' ? eng : {}) as Record<string, unknown>
          return {
            index: Math.round(finite(e.index, idx + 1)),
            running: Boolean(e.running),
            rpmPercent: finite(e.rpmPercent, 0),
            n1Percent: finite(e.n1Percent, 0),
            n2Percent: finite(e.n2Percent, 0),
            combustion: Boolean(e.combustion),
          }
        })
      : [],
  }
}

export function asFlightEvent(value: unknown): FlightEvent | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const kind = raw.kind
  const allowed: FlightEventKind[] = [
    'takeoff',
    'gear_up',
    'flaps_retracted',
    'mach_1',
    'landing',
    'touchdown',
  ]
  if (typeof kind !== 'string' || !allowed.includes(kind as FlightEventKind)) return null
  return {
    kind: kind as FlightEventKind,
    timestamp: finite(raw.timestamp, Date.now()),
  }
}
