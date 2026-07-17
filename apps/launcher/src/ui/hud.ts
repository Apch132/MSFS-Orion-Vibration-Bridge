import type { SmoothFlight } from '../telemetry/interpolate'

export function hudHtml(): string {
  return `
    <div class="hud-shell" id="hud-shell" data-active="false">
      <canvas id="hud-canvas" width="360" height="300" aria-label="Flight HUD"></canvas>
      <div class="hud-readouts">
        <div><span>IAS</span><strong id="hud-ias">—</strong></div>
        <div><span>GS</span><strong id="hud-gs">—</strong></div>
        <div><span>ALT</span><strong id="hud-alt">—</strong></div>
        <div><span>M</span><strong id="hud-mach">—</strong></div>
        <div><span>G</span><strong id="hud-g">—</strong></div>
        <div><span>WIND</span><strong id="hud-wind">—</strong></div>
      </div>
    </div>
  `
}

export type HudRefs = {
  shell: HTMLElement
  canvas: HTMLCanvasElement
  ias: HTMLElement
  gs: HTMLElement
  alt: HTMLElement
  mach: HTMLElement
  g: HTMLElement
  wind: HTMLElement
}

export function bindHud(root: ParentNode): HudRefs {
  return {
    shell: root.querySelector('#hud-shell') as HTMLElement,
    canvas: root.querySelector('#hud-canvas') as HTMLCanvasElement,
    ias: root.querySelector('#hud-ias') as HTMLElement,
    gs: root.querySelector('#hud-gs') as HTMLElement,
    alt: root.querySelector('#hud-alt') as HTMLElement,
    mach: root.querySelector('#hud-mach') as HTMLElement,
    g: root.querySelector('#hud-g') as HTMLElement,
    wind: root.querySelector('#hud-wind') as HTMLElement,
  }
}

function finite(n: number, fallback = 0): number {
  return Number.isFinite(n) ? n : fallback
}

function clearReadouts(refs: HudRefs): void {
  refs.ias.textContent = '—'
  refs.gs.textContent = '—'
  refs.alt.textContent = '—'
  refs.mach.textContent = '—'
  refs.g.textContent = '—'
  refs.wind.textContent = '—'
}

/**
 * Real flight-path / velocity vector from SimConnect incidence (α / β).
 * No invented offsets when data is unavailable.
 */
function flightPathOffset(flight: SmoothFlight): { x: number; y: number } | null {
  const aoa = finite(flight.angleOfAttackDeg)
  const beta = finite(flight.sideslipDeg)
  const ias = finite(flight.indicatedAirspeedKts)
  if (ias < 30 && Math.abs(aoa) < 0.05 && Math.abs(beta) < 0.05) return null
  const px = 2.0
  return { x: beta * px, y: -aoa * px }
}

function drawCompassTape(
  ctx: CanvasRenderingContext2D,
  cx: number,
  top: number,
  width: number,
  heading: number,
  color: string,
  dim: string,
): void {
  const tapeH = 22
  const half = Math.min(110, width * 0.42)
  ctx.save()
  ctx.beginPath()
  ctx.rect(cx - half, top, half * 2, tapeH)
  ctx.clip()

  ctx.fillStyle = 'rgba(6, 14, 10, 0.55)'
  ctx.fillRect(cx - half, top, half * 2, tapeH)

  const pxPerDeg = 2.2
  const hdg = ((heading % 360) + 360) % 360
  ctx.strokeStyle = dim
  ctx.fillStyle = color
  ctx.font = '10px "IBM Plex Mono", monospace'
  ctx.textAlign = 'center'
  ctx.lineWidth = 1

  for (let d = Math.floor(hdg - 50); d <= Math.ceil(hdg + 50); d += 5) {
    const norm = ((d % 360) + 360) % 360
    const x = cx + (d - hdg) * pxPerDeg
    const major = norm % 10 === 0
    ctx.beginPath()
    ctx.moveTo(x, top + tapeH)
    ctx.lineTo(x, top + tapeH - (major ? 10 : 5))
    ctx.stroke()
    if (norm % 30 === 0) {
      const label = String(Math.round(norm) % 360).padStart(3, '0')
      ctx.fillText(label, x, top + 11)
    }
  }
  ctx.restore()

  // Boxed heading
  const boxW = 44
  const boxH = 20
  ctx.fillStyle = 'rgba(6, 14, 10, 0.92)'
  ctx.strokeStyle = color
  ctx.lineWidth = 1.25
  ctx.fillRect(cx - boxW / 2, top - 1, boxW, boxH)
  ctx.strokeRect(cx - boxW / 2, top - 1, boxW, boxH)
  ctx.fillStyle = color
  ctx.font = '600 12px "IBM Plex Mono", monospace'
  ctx.textAlign = 'center'
  ctx.fillText(String(Math.round(hdg) % 360).padStart(3, '0'), cx, top + 13)

  // Lubber line
  ctx.beginPath()
  ctx.moveTo(cx, top + tapeH)
  ctx.lineTo(cx - 4, top + tapeH + 5)
  ctx.lineTo(cx + 4, top + tapeH + 5)
  ctx.closePath()
  ctx.fillStyle = color
  ctx.fill()
}

export function drawHud(
  refs: HudRefs,
  flight: SmoothFlight,
  active: boolean,
  stale: boolean,
): void {
  refs.shell.dataset.active = active ? 'true' : 'false'
  refs.shell.dataset.stale = stale ? 'true' : 'false'

  const canvas = refs.canvas
  const parent = canvas.parentElement
  const cssW = parent?.clientWidth || 280
  const cssH = Math.max(180, Math.min(280, (parent?.clientHeight || 240) - 52))
  const dpr = window.devicePixelRatio || 1
  canvas.width = Math.round(cssW * dpr)
  canvas.height = Math.round(cssH * dpr)
  canvas.style.width = `${cssW}px`
  canvas.style.height = `${cssH}px`

  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, cssW, cssH)

  const cx = cssW / 2
  const cy = cssH / 2 + 6
  const phosphor = stale ? 'rgba(90, 140, 100, 0.45)' : '#3ec478'
  const dim = stale ? 'rgba(90, 140, 100, 0.25)' : 'rgba(62, 196, 120, 0.35)'

  ctx.fillStyle = 'rgba(6, 14, 10, 0.92)'
  ctx.fillRect(0, 0, cssW, cssH)

  if (!active) {
    ctx.strokeStyle = dim
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(cx - 16, cy)
    ctx.lineTo(cx + 16, cy)
    ctx.moveTo(cx, cy - 16)
    ctx.lineTo(cx, cy + 16)
    ctx.stroke()
    clearReadouts(refs)
    return
  }

  const pitch = Math.max(-90, Math.min(90, finite(flight.pitchDeg)))
  const bank = Math.max(-180, Math.min(180, finite(flight.bankDeg)))
  const pitchPx = 3.6
  const heading = finite(flight.headingDeg)

  drawCompassTape(ctx, cx, 8, cssW, heading, phosphor, dim)

  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 34, cssW, cssH - 34)
  ctx.clip()

  ctx.translate(cx, cy)
  ctx.rotate((-bank * Math.PI) / 180)

  // Artificial horizon
  ctx.fillStyle = 'rgba(28, 70, 48, 0.35)'
  ctx.fillRect(-cssW, -pitch * pitchPx, cssW * 2, cssH * 2)
  ctx.fillStyle = 'rgba(10, 22, 16, 0.55)'
  ctx.fillRect(-cssW, -cssH * 2, cssW * 2, cssH * 2 - pitch * pitchPx)

  ctx.strokeStyle = phosphor
  ctx.lineWidth = 1.25
  ctx.beginPath()
  ctx.moveTo(-cssW, -pitch * pitchPx)
  ctx.lineTo(cssW, -pitch * pitchPx)
  ctx.stroke()

  // Pitch ladder
  ctx.font = '10px "IBM Plex Mono", monospace'
  ctx.fillStyle = phosphor
  ctx.textAlign = 'center'
  for (let p = -40; p <= 40; p += 10) {
    if (p === 0) continue
    const y = -(p + pitch) * pitchPx
    if (Math.abs(y) > cssH * 0.4) continue
    const half = p % 20 === 0 ? 30 : 18
    ctx.strokeStyle = dim
    ctx.beginPath()
    ctx.moveTo(-half, y)
    ctx.lineTo(half, y)
    ctx.stroke()
    ctx.fillText(String(p), half + 12, y + 3)
    ctx.fillText(String(p), -half - 12, y + 3)
  }
  ctx.restore()

  // Roll scale
  ctx.strokeStyle = phosphor
  ctx.lineWidth = 1
  const bankR = Math.min(cssW, cssH) * 0.34
  ctx.beginPath()
  ctx.arc(cx, cy, bankR, (-60 * Math.PI) / 180 - Math.PI / 2, (60 * Math.PI) / 180 - Math.PI / 2)
  ctx.stroke()
  for (const mark of [-60, -30, -20, -10, 0, 10, 20, 30, 60]) {
    const a = (mark * Math.PI) / 180 - Math.PI / 2
    const inner = mark === 0 ? bankR - 9 : bankR - 5
    ctx.beginPath()
    ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner)
    ctx.lineTo(cx + Math.cos(a) * bankR, cy + Math.sin(a) * bankR)
    ctx.stroke()
  }
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate((-bank * Math.PI) / 180)
  ctx.beginPath()
  ctx.moveTo(0, -bankR + 2)
  ctx.lineTo(-4, -bankR + 10)
  ctx.lineTo(4, -bankR + 10)
  ctx.closePath()
  ctx.fillStyle = phosphor
  ctx.fill()
  ctx.restore()

  // Aircraft reference (fixed)
  ctx.strokeStyle = phosphor
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(cx - 24, cy)
  ctx.lineTo(cx - 7, cy)
  ctx.moveTo(cx + 7, cy)
  ctx.lineTo(cx + 24, cy)
  ctx.moveTo(cx, cy)
  ctx.lineTo(cx, cy + 8)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(cx, cy, 2.5, 0, Math.PI * 2)
  ctx.stroke()

  // Flight path / velocity vector (SimConnect α/β only)
  const fpm = flightPathOffset(flight)
  if (fpm) {
    const fpx = cx + fpm.x
    const fpy = cy + fpm.y
    ctx.strokeStyle = phosphor
    ctx.beginPath()
    ctx.arc(fpx, fpy, 6, 0, Math.PI * 2)
    ctx.moveTo(fpx - 12, fpy)
    ctx.lineTo(fpx - 6, fpy)
    ctx.moveTo(fpx + 6, fpy)
    ctx.lineTo(fpx + 12, fpy)
    ctx.moveTo(fpx, fpy - 12)
    ctx.lineTo(fpx, fpy - 6)
    ctx.stroke()
  }

  refs.ias.textContent = `${Math.round(finite(flight.indicatedAirspeedKts))}`
  refs.gs.textContent = `${Math.round(finite(flight.groundSpeedKts))}`
  refs.alt.textContent = `${Math.round(finite(flight.altitudeFt))}`
  refs.mach.textContent = finite(flight.mach).toFixed(2)
  refs.g.textContent = finite(flight.gForce, 1).toFixed(1)
  const windDir = Math.round(finite(flight.windDirectionDeg)) % 360
  const windSpd = Math.round(finite(flight.windVelocityKts))
  refs.wind.textContent = `${String(windDir).padStart(3, '0')}°/${windSpd}`
}
