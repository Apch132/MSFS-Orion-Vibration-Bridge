import type { FlightEvent, TelemetrySnapshot } from '../telemetry/types'
import { FLIGHT_EVENT_LABELS } from '../telemetry/types'
import type { SmoothControls } from '../telemetry/interpolate'

function fmt(value: number, digits = 0): string {
  if (!Number.isFinite(value)) return '—'
  return value.toFixed(digits)
}

function pct(value: number): string {
  if (!Number.isFinite(value)) return '—'
  return `${Math.round(value * 100)}%`
}

function flag(on: boolean): string {
  return on ? 'ON' : 'off'
}

export function telemetryPanelHtml(): string {
  return `
    <div class="telemetry-stack" id="telemetry-root" data-stale="false">
      <div class="tele-status-row">
        <span class="tele-chip" id="tele-sim">SimConnect · Disconnected</span>
        <span class="tele-chip" id="tele-hid">HID · Disconnected</span>
      </div>

      <div class="tele-card">
        <div class="tele-card-title">Aircraft</div>
        <div class="tele-grid">
          <div><span class="tele-k">Name</span><span class="tele-v" id="tele-title">—</span></div>
          <div><span class="tele-k">Category</span><span class="tele-v" id="tele-category">—</span></div>
          <div><span class="tele-k">Type</span><span class="tele-v" id="tele-type">—</span></div>
          <div><span class="tele-k">Engines</span><span class="tele-v" id="tele-engines">—</span></div>
        </div>
      </div>

      <div class="tele-card">
        <div class="tele-card-title">Flight Data</div>
        <div class="tele-grid tele-grid-dense">
          <div><span class="tele-k">IAS</span><span class="tele-v" id="tele-ias">—</span></div>
          <div><span class="tele-k">ALT</span><span class="tele-v" id="tele-alt">—</span></div>
          <div><span class="tele-k">VS</span><span class="tele-v" id="tele-vs">—</span></div>
          <div><span class="tele-k">HDG</span><span class="tele-v" id="tele-hdg">—</span></div>
          <div><span class="tele-k">MACH</span><span class="tele-v" id="tele-mach">—</span></div>
          <div><span class="tele-k">G</span><span class="tele-v" id="tele-g">—</span></div>
        </div>
      </div>

      <div class="tele-card">
        <div class="tele-card-title">Aircraft State</div>
        <div class="tele-grid tele-grid-dense">
          <div><span class="tele-k">Phase</span><span class="tele-v" id="tele-phase">—</span></div>
          <div><span class="tele-k">Gear</span><span class="tele-v" id="tele-gear">—</span></div>
          <div><span class="tele-k">Flaps</span><span class="tele-v" id="tele-flaps">—</span></div>
          <div><span class="tele-k">Spoilers</span><span class="tele-v" id="tele-spoilers">—</span></div>
          <div><span class="tele-k">Stall</span><span class="tele-v" id="tele-stall">—</span></div>
          <div><span class="tele-k">Overspeed</span><span class="tele-v" id="tele-overspeed">—</span></div>
          <div><span class="tele-k">AB</span><span class="tele-v" id="tele-ab">—</span></div>
        </div>
      </div>

      <div class="tele-card">
        <div class="tele-card-title">Controls</div>
        <div class="controls-viz" id="controls-viz" aria-hidden="true">
          <div class="stick-box">
            <div class="stick-cross"></div>
            <div class="stick-pip" id="stick-pip"></div>
          </div>
          <div class="throttle-col">
            <div class="throttle-track"><div class="throttle-fill" id="thr-l"></div></div>
            <span class="tele-k">L</span>
          </div>
          <div class="throttle-col">
            <div class="throttle-track"><div class="throttle-fill" id="thr-r"></div></div>
            <span class="tele-k">R</span>
          </div>
          <div class="rudder-brake">
            <div class="rudder-track"><div class="rudder-pip" id="rudder-pip"></div></div>
            <div class="brake-row">
              <div class="brake-bar"><div id="brake-l"></div></div>
              <div class="brake-bar"><div id="brake-r"></div></div>
            </div>
          </div>
        </div>
      </div>

      <div class="tele-card">
        <div class="tele-card-title">Flight Events</div>
        <ol class="event-timeline" id="event-timeline"></ol>
      </div>
    </div>
  `
}

export type TelemetryPanelRefs = {
  root: HTMLElement
  sim: HTMLElement
  hid: HTMLElement
  title: HTMLElement
  category: HTMLElement
  type: HTMLElement
  engines: HTMLElement
  ias: HTMLElement
  alt: HTMLElement
  vs: HTMLElement
  hdg: HTMLElement
  mach: HTMLElement
  g: HTMLElement
  phase: HTMLElement
  gear: HTMLElement
  flaps: HTMLElement
  spoilers: HTMLElement
  stall: HTMLElement
  overspeed: HTMLElement
  ab: HTMLElement
  stickPip: HTMLElement
  thrL: HTMLElement
  thrR: HTMLElement
  rudderPip: HTMLElement
  brakeL: HTMLElement
  brakeR: HTMLElement
  timeline: HTMLOListElement
}

export function bindTelemetryPanel(root: ParentNode): TelemetryPanelRefs {
  return {
    root: root.querySelector('#telemetry-root') as HTMLElement,
    sim: root.querySelector('#tele-sim') as HTMLElement,
    hid: root.querySelector('#tele-hid') as HTMLElement,
    title: root.querySelector('#tele-title') as HTMLElement,
    category: root.querySelector('#tele-category') as HTMLElement,
    type: root.querySelector('#tele-type') as HTMLElement,
    engines: root.querySelector('#tele-engines') as HTMLElement,
    ias: root.querySelector('#tele-ias') as HTMLElement,
    alt: root.querySelector('#tele-alt') as HTMLElement,
    vs: root.querySelector('#tele-vs') as HTMLElement,
    hdg: root.querySelector('#tele-hdg') as HTMLElement,
    mach: root.querySelector('#tele-mach') as HTMLElement,
    g: root.querySelector('#tele-g') as HTMLElement,
    phase: root.querySelector('#tele-phase') as HTMLElement,
    gear: root.querySelector('#tele-gear') as HTMLElement,
    flaps: root.querySelector('#tele-flaps') as HTMLElement,
    spoilers: root.querySelector('#tele-spoilers') as HTMLElement,
    stall: root.querySelector('#tele-stall') as HTMLElement,
    overspeed: root.querySelector('#tele-overspeed') as HTMLElement,
    ab: root.querySelector('#tele-ab') as HTMLElement,
    stickPip: root.querySelector('#stick-pip') as HTMLElement,
    thrL: root.querySelector('#thr-l') as HTMLElement,
    thrR: root.querySelector('#thr-r') as HTMLElement,
    rudderPip: root.querySelector('#rudder-pip') as HTMLElement,
    brakeL: root.querySelector('#brake-l') as HTMLElement,
    brakeR: root.querySelector('#brake-r') as HTMLElement,
    timeline: root.querySelector('#event-timeline') as HTMLOListElement,
  }
}

export function renderTelemetryCards(refs: TelemetryPanelRefs, snap: TelemetrySnapshot): void {
  refs.root.dataset.stale = snap.stale ? 'true' : 'false'

  const simLabel = {
    disconnected: 'Disconnected',
    connecting: 'Connecting',
    connected: 'Connected',
    error: 'Error',
  }[snap.connection.simconnect]
  refs.sim.textContent = `SimConnect · ${simLabel}`
  refs.sim.dataset.state = snap.connection.simconnect

  refs.hid.textContent = `HID · ${
    snap.connection.hid === 'connected' ? 'Connected' : snap.connection.hid === 'error' ? 'Error' : 'Disconnected'
  }`
  refs.hid.dataset.state = snap.connection.hid

  const connected = snap.connection.simconnect === 'connected' && !snap.stale
  refs.title.textContent = connected && snap.aircraft.title ? snap.aircraft.title : '—'
  refs.category.textContent = connected
    ? (snap.aircraft.category || (snap.aircraft.isHelicopter ? 'Helicopter' : 'Airplane') || '—')
    : '—'
  refs.type.textContent = connected
    ? (snap.aircraft.isHelicopter ? 'Helicopter' : (snap.aircraft.type || 'Airplane'))
    : '—'
  refs.engines.textContent = connected && snap.aircraft.engineCount
    ? String(snap.aircraft.engineCount)
    : '—'

  refs.ias.textContent = connected ? `${fmt(snap.flight.indicatedAirspeedKts, 0)} kts` : '—'
  refs.alt.textContent = connected ? `${fmt(snap.flight.altitudeFt, 0)} ft` : '—'
  refs.vs.textContent = connected ? `${fmt(snap.flight.verticalSpeedFpm, 0)} fpm` : '—'
  refs.hdg.textContent = connected ? `${fmt(snap.flight.headingDeg, 0)}°` : '—'
  refs.mach.textContent = connected ? fmt(snap.flight.mach, 2) : '—'
  refs.g.textContent = connected ? fmt(snap.flight.gForce, 2) : '—'

  refs.phase.textContent = connected
    ? (snap.aircraftState.onGround ? 'On ground' : 'Airborne')
    : '—'
  refs.gear.textContent = connected ? pct(snap.aircraftState.gearPosition) : '—'
  refs.flaps.textContent = connected ? pct(snap.aircraftState.flapsPosition) : '—'
  refs.spoilers.textContent = connected ? pct(snap.aircraftState.spoilersPosition) : '—'
  refs.stall.textContent = connected ? flag(snap.aircraftState.stallWarning) : '—'
  refs.overspeed.textContent = connected ? flag(snap.aircraftState.overspeedWarning) : '—'
  refs.ab.textContent = connected ? flag(snap.aircraftState.afterburnerActive) : '—'
}

export function renderControls(refs: TelemetryPanelRefs, controls: SmoothControls): void {
  const x = Math.min(1, Math.max(-1, controls.stickX))
  const y = Math.min(1, Math.max(-1, controls.stickY))
  refs.stickPip.style.transform = `translate(${x * 42}%, ${-y * 42}%)`

  const l = Math.min(1, Math.max(0, controls.leftThrottle))
  const r = Math.min(1, Math.max(0, controls.rightThrottle))
  refs.thrL.style.height = `${l * 100}%`
  refs.thrR.style.height = `${r * 100}%`

  const rudder = Math.min(1, Math.max(-1, controls.rudder))
  refs.rudderPip.style.left = `${50 + rudder * 45}%`

  refs.brakeL.style.width = `${Math.min(1, Math.max(0, controls.brakesLeft)) * 100}%`
  refs.brakeR.style.width = `${Math.min(1, Math.max(0, controls.brakesRight)) * 100}%`
}

const MAX_EVENTS = 12

export function appendFlightEvent(
  timeline: HTMLOListElement,
  event: FlightEvent,
  sessionId: number,
): void {
  const li = document.createElement('li')
  li.dataset.session = String(sessionId)
  const time = new Date(event.timestamp)
  const stamp = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  li.innerHTML = `<span class="event-time">${stamp}</span><span class="event-kind">${FLIGHT_EVENT_LABELS[event.kind]}</span>`
  timeline.insertBefore(li, timeline.firstChild)
  while (timeline.children.length > MAX_EVENTS) {
    timeline.removeChild(timeline.lastChild as Node)
  }
}

export function resetFlightEvents(timeline: HTMLOListElement): void {
  timeline.innerHTML = ''
}
