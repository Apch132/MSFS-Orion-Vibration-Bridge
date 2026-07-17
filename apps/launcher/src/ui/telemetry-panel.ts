import type { FlightEvent, TelemetryEngine, TelemetrySnapshot } from '../telemetry/types'
import type { SmoothControls } from '../telemetry/interpolate'
import type { MessageTree } from '../i18n'
import { applyStickPipPosition } from './stick'

function fmt(value: number, digits = 0): string {
  if (!Number.isFinite(value)) return '—'
  return value.toFixed(digits)
}

function pct(value: number): string {
  if (!Number.isFinite(value)) return '—'
  return `${Math.round(value * 100)}%`
}

export function telemetryPanelHtml(messages: MessageTree): string {
  const t = messages.flight
  return `
    <div class="telemetry-stack" id="telemetry-root" data-stale="false">
      <div class="tele-status-row">
        <span class="tele-chip" id="tele-sim">${messages.sim.disconnected}</span>
        <span class="tele-chip" id="tele-hid">${messages.hid.disconnected}</span>
      </div>

      <div class="tele-card">
        <div class="tele-card-title" data-i18n="flight.aircraft">${t.aircraft}</div>
        <div class="tele-grid">
          <div><span class="tele-k" data-i18n="flight.name">${t.name}</span><span class="tele-v" id="tele-title">—</span></div>
          <div><span class="tele-k" data-i18n="flight.category">${t.category}</span><span class="tele-v" id="tele-category">—</span></div>
          <div><span class="tele-k" data-i18n="flight.type">${t.type}</span><span class="tele-v" id="tele-type">—</span></div>
          <div><span class="tele-k" data-i18n="flight.engines">${t.engines}</span><span class="tele-v" id="tele-engines">—</span></div>
        </div>
      </div>

      <div class="tele-card">
        <div class="tele-card-title" data-i18n="flight.flightData">${t.flightData}</div>
        <div class="tele-grid tele-grid-dense">
          <div><span class="tele-k">IAS</span><span class="tele-v" id="tele-ias">—</span></div>
          <div><span class="tele-k">GS</span><span class="tele-v" id="tele-gs">—</span></div>
          <div><span class="tele-k">ALT</span><span class="tele-v" id="tele-alt">—</span></div>
          <div><span class="tele-k">VS</span><span class="tele-v" id="tele-vs">—</span></div>
          <div><span class="tele-k">HDG</span><span class="tele-v" id="tele-hdg">—</span></div>
          <div><span class="tele-k">MACH</span><span class="tele-v" id="tele-mach">—</span></div>
          <div><span class="tele-k">G</span><span class="tele-v" id="tele-g">—</span></div>
          <div><span class="tele-k">WIND</span><span class="tele-v" id="tele-wind">—</span></div>
        </div>
      </div>

      <div class="tele-card">
        <div class="tele-card-title" data-i18n="flight.aircraftState">${t.aircraftState}</div>
        <div class="tele-grid tele-grid-dense">
          <div><span class="tele-k" data-i18n="flight.phase">${t.phase}</span><span class="tele-v" id="tele-phase">—</span></div>
          <div><span class="tele-k">Gear</span><span class="tele-v" id="tele-gear">—</span></div>
          <div><span class="tele-k">Flaps</span><span class="tele-v" id="tele-flaps">—</span></div>
          <div><span class="tele-k">Spoilers</span><span class="tele-v" id="tele-spoilers">—</span></div>
          <div><span class="tele-k">Stall</span><span class="tele-v" id="tele-stall">—</span></div>
          <div><span class="tele-k">Overspeed</span><span class="tele-v" id="tele-overspeed">—</span></div>
          <div><span class="tele-k">AB</span><span class="tele-v" id="tele-ab">—</span></div>
        </div>
      </div>

      <div class="tele-card">
        <div class="tele-card-title" data-i18n="flight.controls">${t.controls}</div>
        <div class="controls-viz" id="controls-viz" aria-hidden="true">
          <div class="stick-box">
            <div class="stick-cross"></div>
            <div class="stick-pip" id="stick-pip"></div>
          </div>
          <div class="throttle-col" id="thr-col-l" data-engine="1">
            <div class="throttle-track"><div class="throttle-fill" id="thr-l"></div></div>
            <span class="tele-k" id="thr-label-l">1</span>
          </div>
          <div class="throttle-col" id="thr-col-r" data-engine="2">
            <div class="throttle-track"><div class="throttle-fill" id="thr-r"></div></div>
            <span class="tele-k" id="thr-label-r">2</span>
          </div>
          <div class="rudder-brake">
            <div class="rudder-track"><div class="rudder-pip" id="rudder-pip"></div></div>
            <div class="brake-row">
              <div class="brake-bar"><div id="brake-l"></div></div>
              <div class="brake-bar"><div id="brake-r"></div></div>
            </div>
          </div>
        </div>
        <label class="stick-reverse">
          <input type="checkbox" id="reverse-stick-y" />
          <span data-i18n="flight.reverseStick">${t.reverseStick}</span>
        </label>
        <p class="wind-convention brand-sub" data-i18n="flight.windConvention">${t.windConvention}</p>
      </div>

      <div class="tele-card">
        <div class="tele-card-title" data-i18n="flight.enginesCard">${t.enginesCard}</div>
        <div class="engine-gauges" id="engine-gauges"></div>
      </div>

      <div class="tele-card">
        <div class="tele-card-title" data-i18n="flight.events">${t.events}</div>
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
  gs: HTMLElement
  alt: HTMLElement
  vs: HTMLElement
  hdg: HTMLElement
  mach: HTMLElement
  g: HTMLElement
  wind: HTMLElement
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
  thrColR: HTMLElement
  thrLabelR: HTMLElement
  rudderPip: HTMLElement
  brakeL: HTMLElement
  brakeR: HTMLElement
  reverseStick: HTMLInputElement
  engineGauges: HTMLElement
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
    gs: root.querySelector('#tele-gs') as HTMLElement,
    alt: root.querySelector('#tele-alt') as HTMLElement,
    vs: root.querySelector('#tele-vs') as HTMLElement,
    hdg: root.querySelector('#tele-hdg') as HTMLElement,
    mach: root.querySelector('#tele-mach') as HTMLElement,
    g: root.querySelector('#tele-g') as HTMLElement,
    wind: root.querySelector('#tele-wind') as HTMLElement,
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
    thrColR: root.querySelector('#thr-col-r') as HTMLElement,
    thrLabelR: root.querySelector('#thr-label-r') as HTMLElement,
    rudderPip: root.querySelector('#rudder-pip') as HTMLElement,
    brakeL: root.querySelector('#brake-l') as HTMLElement,
    brakeR: root.querySelector('#brake-r') as HTMLElement,
    reverseStick: root.querySelector('#reverse-stick-y') as HTMLInputElement,
    engineGauges: root.querySelector('#engine-gauges') as HTMLElement,
    timeline: root.querySelector('#event-timeline') as HTMLOListElement,
  }
}

function enginePrimary(eng: TelemetryEngine, messages: MessageTree): string {
  if (eng.n1Percent > 0.5) return `${fmt(eng.n1Percent, 0)}% N1`
  if (eng.rpmPercent > 0.5) return `${fmt(eng.rpmPercent, 0)}% RPM`
  return eng.combustion ? messages.flight.idle : messages.flight.off
}

function renderEngineGauges(
  el: HTMLElement,
  engines: TelemetryEngine[],
  engineCount: number,
  connected: boolean,
  messages: MessageTree,
): void {
  if (!connected || engineCount <= 0) {
    el.innerHTML = `<div class="engine-na">—</div>`
    return
  }

  const slots = Math.max(1, Math.min(2, engineCount))
  const parts: string[] = []
  for (let i = 0; i < slots; i++) {
    const eng = engines[i]
    if (!eng) {
      parts.push(`
        <div class="engine-gauge" data-na="true">
          <span class="tele-k">${messages.flight.eng} ${i + 1}</span>
          <strong>${messages.flight.na}</strong>
        </div>
      `)
      continue
    }
    const level = Math.min(100, Math.max(0, eng.n1Percent > 0.5 ? eng.n1Percent : eng.rpmPercent))
    parts.push(`
      <div class="engine-gauge" data-running="${eng.running ? 'true' : 'false'}">
        <span class="tele-k">${messages.flight.eng} ${eng.index}</span>
        <div class="engine-bar"><div style="width:${level}%"></div></div>
        <strong>${enginePrimary(eng, messages)}</strong>
      </div>
    `)
  }

  if (engineCount === 1) {
    parts.push(`
      <div class="engine-gauge" data-na="true">
        <span class="tele-k">${messages.flight.eng} 2</span>
        <strong>${messages.flight.na}</strong>
      </div>
    `)
  }

  el.innerHTML = parts.join('')
}

export function renderTelemetryCards(
  refs: TelemetryPanelRefs,
  snap: TelemetrySnapshot,
  messages: MessageTree,
): void {
  refs.root.dataset.stale = snap.stale ? 'true' : 'false'

  const simMap = {
    disconnected: messages.sim.disconnected,
    connecting: messages.sim.connecting,
    connected: messages.sim.connected,
    error: messages.sim.error,
  } as const
  refs.sim.textContent = simMap[snap.connection.simconnect]
  refs.sim.dataset.state = snap.connection.simconnect

  const hidMap = {
    disconnected: messages.hid.disconnected,
    connected: messages.hid.connected,
    error: messages.hid.error,
  } as const
  refs.hid.textContent = hidMap[snap.connection.hid] ?? messages.hid.disconnected
  refs.hid.dataset.state = snap.connection.hid

  const connected = snap.connection.simconnect === 'connected' && !snap.stale
  refs.title.textContent = connected && snap.aircraft.title ? snap.aircraft.title : '—'
  refs.category.textContent = connected
    ? (snap.aircraft.category || (snap.aircraft.isHelicopter ? messages.flight.helicopter : messages.flight.airplane) || '—')
    : '—'
  refs.type.textContent = connected
    ? (snap.aircraft.isHelicopter ? messages.flight.helicopter : (snap.aircraft.type || messages.flight.airplane))
    : '—'
  refs.engines.textContent = connected && snap.aircraft.engineCount
    ? String(snap.aircraft.engineCount)
    : '—'

  refs.ias.textContent = connected ? `${fmt(snap.flight.indicatedAirspeedKts, 0)} kts` : '—'
  refs.gs.textContent = connected ? `${fmt(snap.flight.groundSpeedKts, 0)} kts` : '—'
  refs.alt.textContent = connected ? `${fmt(snap.flight.altitudeFt, 0)} ft` : '—'
  refs.vs.textContent = connected ? `${fmt(snap.flight.verticalSpeedFpm, 0)} fpm` : '—'
  refs.hdg.textContent = connected ? `${fmt(snap.flight.headingDeg, 0)}°` : '—'
  refs.mach.textContent = connected ? fmt(snap.flight.mach, 2) : '—'
  refs.g.textContent = connected ? fmt(snap.flight.gForce, 2) : '—'
  refs.wind.textContent = connected
    ? `${String(Math.round(snap.flight.windDirectionDeg) % 360).padStart(3, '0')}° / ${fmt(snap.flight.windVelocityKts, 0)} kts`
    : '—'

  refs.phase.textContent = connected
    ? (snap.aircraftState.onGround ? messages.flight.onGround : messages.flight.airborne)
    : '—'
  refs.gear.textContent = connected ? pct(snap.aircraftState.gearPosition) : '—'
  refs.flaps.textContent = connected ? pct(snap.aircraftState.flapsPosition) : '—'
  refs.spoilers.textContent = connected ? pct(snap.aircraftState.spoilersPosition) : '—'
  refs.stall.textContent = connected
    ? (snap.aircraftState.stallWarning ? messages.flight.on : messages.flight.off)
    : '—'
  refs.overspeed.textContent = connected
    ? (snap.aircraftState.overspeedWarning ? messages.flight.on : messages.flight.off)
    : '—'
  refs.ab.textContent = connected
    ? (snap.aircraftState.afterburnerActive ? messages.flight.on : messages.flight.off)
    : '—'

  const engineCount = connected ? snap.aircraft.engineCount : 0
  const twin = engineCount >= 2
  refs.thrColR.hidden = connected && !twin
  refs.thrColR.dataset.na = connected && !twin ? 'true' : 'false'
  if (connected && !twin) {
    refs.thrLabelR.textContent = messages.flight.na
    refs.thrR.style.height = '0%'
  } else {
    refs.thrLabelR.textContent = '2'
  }

  renderEngineGauges(refs.engineGauges, snap.engines, engineCount, connected, messages)
}

export function renderControls(
  refs: TelemetryPanelRefs,
  controls: SmoothControls,
  engineCount = 2,
  reverseStickY = false,
): void {
  applyStickPipPosition(refs.stickPip, controls, { reverseStickY })

  const l = Math.min(1, Math.max(0, controls.leftThrottle))
  refs.thrL.style.height = `${l * 100}%`

  if (engineCount >= 2) {
    const r = Math.min(1, Math.max(0, controls.rightThrottle))
    refs.thrR.style.height = `${r * 100}%`
    refs.thrColR.hidden = false
    refs.thrLabelR.textContent = '2'
  } else if (engineCount === 1) {
    refs.thrR.style.height = '0%'
    refs.thrColR.hidden = false
    refs.thrColR.dataset.na = 'true'
  }

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
  messages: MessageTree,
): void {
  const li = document.createElement('li')
  li.dataset.session = String(sessionId)
  const time = new Date(event.timestamp)
  const stamp = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const label = messages.events[event.kind] ?? event.kind
  li.innerHTML = `<span class="event-time">${stamp}</span><span class="event-kind">${label}</span>`
  timeline.insertBefore(li, timeline.firstChild)
  while (timeline.children.length > MAX_EVENTS) {
    timeline.removeChild(timeline.lastChild as Node)
  }
}

export function resetFlightEvents(timeline: HTMLOListElement): void {
  timeline.innerHTML = ''
}
