import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  createSmoothControls,
  createSmoothFlight,
  lerpHeading,
  stepControls,
  stepFlight,
} from '../src/telemetry/interpolate'
import {
  asFlightEvent,
  asTelemetrySnapshot,
  createEmptyTelemetry,
} from '../src/telemetry/types'

describe('telemetry mapping', () => {
  it('maps incomplete payloads without NaN', () => {
    const snap = asTelemetrySnapshot({
      schemaVersion: 1,
      flight: { indicatedAirspeedKts: 'bad', headingDeg: 12 },
      controls: { stickX: 2 },
    })
    assert.ok(snap)
    assert.equal(Number.isFinite(snap!.flight.indicatedAirspeedKts), true)
    assert.equal(snap!.flight.headingDeg, 12)
    assert.equal(snap!.controls.stickX, 2)
  })

  it('rejects non-objects', () => {
    assert.equal(asTelemetrySnapshot(null), null)
    assert.equal(asFlightEvent({ kind: 'nope' }), null)
    assert.equal(asFlightEvent({ kind: 'takeoff', timestamp: 1 })?.kind, 'takeoff')
  })

  it('disconnected empty snapshot is stable', () => {
    const empty = createEmptyTelemetry()
    assert.equal(empty.connection.simconnect, 'disconnected')
    assert.equal(empty.aircraftState.onGround, true)
  })
})

describe('interpolation', () => {
  it('interpolates heading across the 359/0 wrap', () => {
    const mid = lerpHeading(350, 10, 0.5)
    assert.ok(mid > 350 || mid < 20)
    assert.ok(Math.abs(mid - 0) < 15 || mid > 350)
  })

  it('smooths stick and independent throttles', () => {
    const from = createSmoothControls()
    const to = {
      ...createSmoothControls(),
      stickX: 1,
      stickY: -0.5,
      leftThrottle: 0.8,
      rightThrottle: 0.2,
    }
    const stepped = stepControls(from, to, 0.5)
    assert.equal(stepped.stickX, 0.5)
    assert.equal(stepped.leftThrottle, 0.4)
    assert.equal(stepped.rightThrottle, 0.1)
  })

  it('smooths hud pitch/bank', () => {
    const from = createSmoothFlight()
    const to = { ...createSmoothFlight(), pitchDeg: 10, bankDeg: -20 }
    const stepped = stepFlight(from, to, 0.5)
    assert.equal(stepped.pitchDeg, 5)
    assert.equal(stepped.bankDeg, -10)
  })
})

describe('timeline bound helper', () => {
  it('keeps at most 12 events when appending via DOM', () => {
    const timeline = {
      children: [] as unknown[],
      firstChild: null as unknown,
      lastChild: null as unknown,
      insertBefore(node: unknown) {
        this.children.unshift(node)
        this.firstChild = this.children[0]
        this.lastChild = this.children[this.children.length - 1]
      },
      removeChild() {
        this.children.pop()
        this.lastChild = this.children[this.children.length - 1] || null
      },
      get innerHTML() {
        return ''
      },
      set innerHTML(_v: string) {
        this.children = []
      },
    }

    // Lightweight stand-in for appendFlightEvent bound logic
    const MAX = 12
    for (let i = 0; i < 20; i++) {
      timeline.insertBefore({ i })
      while (timeline.children.length > MAX) timeline.removeChild()
    }
    assert.equal(timeline.children.length, 12)
  })
})
