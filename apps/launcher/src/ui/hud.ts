import type { SmoothFlight } from '../telemetry/interpolate'
import type { MessageTree } from '../i18n'

export function hudHtml(ariaLabel: string): string {
  return `
    <div class="hud-shell" id="hud-shell" data-active="false">
      <canvas id="hud-canvas" width="320" height="320" aria-label="${ariaLabel}"></canvas>
    </div>
  `
}

export type HudRefs = {
  shell: HTMLElement
  canvas: HTMLCanvasElement
}

export function bindHud(root: ParentNode): HudRefs {
  return {
    shell: root.querySelector('#hud-shell') as HTMLElement,
    canvas: root.querySelector('#hud-canvas') as HTMLCanvasElement,
  }
}

function finite(n: number, fallback = 0): number {
  return Number.isFinite(n) ? n : fallback
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

/**
 * Wind FROM direction (meteorological): 0° = wind coming from north, 90° = from east.
 * Arrow tip points toward where the wind blows TO (FROM + 180°), so the shaft
 * shows the flow. Documented in UI help (`flight.windConvention`).
 */
export function windArrowAngleDeg(windFromDeg: number): number {
  const from = ((finite(windFromDeg) % 360) + 360) % 360
  return (from + 180) % 360
}

export function windArrowLengthPx(speedKts: number, maxPx = 28): number {
  const s = Math.max(0, finite(speedKts))
  if (s <= 0) return 0
  return Math.min(maxPx, 8 + (s / 40) * (maxPx - 8))
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
  const tapeH = 20
  const half = Math.min(100, width * 0.4)
  ctx.save()
  ctx.beginPath()
  ctx.rect(cx - half, top, half * 2, tapeH)
  ctx.clip()

  ctx.fillStyle = 'rgba(6, 14, 10, 0.55)'
  ctx.fillRect(cx - half, top, half * 2, tapeH)

  const pxPerDeg = 2.0
  const hdg = ((heading % 360) + 360) % 360
  ctx.strokeStyle = dim
  ctx.fillStyle = color
  ctx.font = '9px "IBM Plex Mono", monospace'
  ctx.textAlign = 'center'
  ctx.lineWidth = 1

  const cardinals: Record<number, string> = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }

  for (let d = Math.floor(hdg - 50); d <= Math.ceil(hdg + 50); d += 5) {
    const norm = ((d % 360) + 360) % 360
    const x = cx + (d - hdg) * pxPerDeg
    const major = norm % 10 === 0
    ctx.beginPath()
    ctx.moveTo(x, top + tapeH)
    ctx.lineTo(x, top + tapeH - (major ? 9 : 4))
    ctx.stroke()
    if (norm % 30 === 0) {
      const label = cardinals[Math.round(norm) % 360]
        ?? String(Math.round(norm) % 360).padStart(3, '0')
      ctx.fillText(label, x, top + 10)
    }
  }
  ctx.restore()

  const boxW = 40
  const boxH = 18
  ctx.fillStyle = 'rgba(6, 14, 10, 0.92)'
  ctx.strokeStyle = color
  ctx.lineWidth = 1.25
  ctx.fillRect(cx - boxW / 2, top - 1, boxW, boxH)
  ctx.strokeRect(cx - boxW / 2, top - 1, boxW, boxH)
  ctx.fillStyle = color
  ctx.font = '600 11px "IBM Plex Mono", monospace'
  ctx.textAlign = 'center'
  ctx.fillText(String(Math.round(hdg) % 360).padStart(3, '0'), cx, top + 12)

  ctx.beginPath()
  ctx.moveTo(cx, top + tapeH)
  ctx.lineTo(cx - 3.5, top + tapeH + 4)
  ctx.lineTo(cx + 3.5, top + tapeH + 4)
  ctx.closePath()
  ctx.fillStyle = color
  ctx.fill()
}

function drawTapeValue(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  label: string,
  value: string,
  color: string,
  align: 'left' | 'right',
): void {
  ctx.font = '8px "IBM Plex Mono", monospace'
  ctx.fillStyle = color
  ctx.globalAlpha = 0.7
  ctx.textAlign = align
  ctx.fillText(label, x, y)
  ctx.globalAlpha = 1
  ctx.font = '600 12px "IBM Plex Mono", monospace'
  ctx.fillText(value, x, y + 13)
}

/**
 * Compact square jet-inspired HUD. All values from SimConnect SmoothFlight only.
 */
export function drawHud(
  refs: HudRefs,
  flight: SmoothFlight,
  active: boolean,
  stale: boolean,
  _messages?: MessageTree,
): void {
  refs.shell.dataset.active = active ? 'true' : 'false'
  refs.shell.dataset.stale = stale ? 'true' : 'false'

  const canvas = refs.canvas
  const parent = canvas.parentElement
  const box = Math.max(200, Math.min(320, parent?.clientWidth || 280, parent?.clientHeight || 280))
  const cssW = box
  const cssH = box
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
  const cy = cssH / 2 + 8
  const phosphor = stale ? 'rgba(90, 140, 100, 0.45)' : '#3ec478'
  const dim = stale ? 'rgba(90, 140, 100, 0.25)' : 'rgba(62, 196, 120, 0.35)'

  ctx.fillStyle = 'rgba(6, 14, 10, 0.92)'
  ctx.fillRect(0, 0, cssW, cssH)

  if (!active) {
    ctx.strokeStyle = dim
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(cx - 14, cy)
    ctx.lineTo(cx + 14, cy)
    ctx.moveTo(cx, cy - 14)
    ctx.lineTo(cx, cy + 14)
    ctx.stroke()
    return
  }

  const pitch = Math.max(-90, Math.min(90, finite(flight.pitchDeg)))
  const bank = Math.max(-180, Math.min(180, finite(flight.bankDeg)))
  const pitchPx = 3.2
  const heading = finite(flight.headingDeg)

  drawCompassTape(ctx, cx, 6, cssW, heading, phosphor, dim)

  ctx.save()
  ctx.beginPath()
  ctx.rect(8, 30, cssW - 16, cssH - 38)
  ctx.clip()

  ctx.translate(cx, cy)
  ctx.rotate((-bank * Math.PI) / 180)

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

  ctx.font = '9px "IBM Plex Mono", monospace'
  ctx.fillStyle = phosphor
  ctx.textAlign = 'center'
  for (let p = -40; p <= 40; p += 10) {
    if (p === 0) continue
    const y = -(p + pitch) * pitchPx
    if (Math.abs(y) > cssH * 0.36) continue
    const half = p % 20 === 0 ? 26 : 16
    ctx.strokeStyle = dim
    ctx.beginPath()
    ctx.moveTo(-half, y)
    ctx.lineTo(half, y)
    ctx.stroke()
    ctx.fillText(String(p), half + 10, y + 3)
    ctx.fillText(String(p), -half - 10, y + 3)
  }
  ctx.restore()

  // Roll scale + reference triangle
  ctx.strokeStyle = phosphor
  ctx.lineWidth = 1
  const bankR = Math.min(cssW, cssH) * 0.32
  ctx.beginPath()
  ctx.arc(cx, cy, bankR, (-60 * Math.PI) / 180 - Math.PI / 2, (60 * Math.PI) / 180 - Math.PI / 2)
  ctx.stroke()
  for (const mark of [-60, -30, -20, -10, 0, 10, 20, 30, 60]) {
    const a = (mark * Math.PI) / 180 - Math.PI / 2
    const inner = mark === 0 ? bankR - 8 : bankR - 4
    ctx.beginPath()
    ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner)
    ctx.lineTo(cx + Math.cos(a) * bankR, cy + Math.sin(a) * bankR)
    ctx.stroke()
  }
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate((-bank * Math.PI) / 180)
  ctx.beginPath()
  ctx.moveTo(0, -bankR + 1)
  ctx.lineTo(-4, -bankR + 9)
  ctx.lineTo(4, -bankR + 9)
  ctx.closePath()
  ctx.fillStyle = phosphor
  ctx.fill()
  ctx.restore()

  // Aircraft reference
  ctx.strokeStyle = phosphor
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(cx - 22, cy)
  ctx.lineTo(cx - 6, cy)
  ctx.moveTo(cx + 6, cy)
  ctx.lineTo(cx + 22, cy)
  ctx.moveTo(cx, cy)
  ctx.lineTo(cx, cy + 7)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(cx, cy, 2.2, 0, Math.PI * 2)
  ctx.stroke()

  const fpm = flightPathOffset(flight)
  if (fpm) {
    const fpx = cx + fpm.x
    const fpy = cy + fpm.y
    ctx.strokeStyle = phosphor
    ctx.beginPath()
    ctx.arc(fpx, fpy, 5.5, 0, Math.PI * 2)
    ctx.moveTo(fpx - 11, fpy)
    ctx.lineTo(fpx - 5.5, fpy)
    ctx.moveTo(fpx + 5.5, fpy)
    ctx.lineTo(fpx + 11, fpy)
    ctx.moveTo(fpx, fpy - 11)
    ctx.lineTo(fpx, fpy - 5.5)
    ctx.stroke()
  }

  // Left tape: IAS / GS
  drawTapeValue(ctx, 14, 48, 'IAS', `${Math.round(finite(flight.indicatedAirspeedKts))}`, phosphor, 'left')
  drawTapeValue(ctx, 14, 78, 'GS', `${Math.round(finite(flight.groundSpeedKts))}`, phosphor, 'left')

  // Right tape: ALT / M / G / VS
  drawTapeValue(ctx, cssW - 14, 48, 'ALT', `${Math.round(finite(flight.altitudeFt))}`, phosphor, 'right')
  drawTapeValue(ctx, cssW - 14, 78, 'M', finite(flight.mach).toFixed(2), phosphor, 'right')
  drawTapeValue(ctx, cssW - 14, 108, 'G', finite(flight.gForce, 1).toFixed(1), phosphor, 'right')
  const vs = finite(flight.verticalSpeedFpm)
  drawTapeValue(ctx, cssW - 14, 138, 'VS', `${vs >= 0 ? '+' : ''}${Math.round(vs)}`, phosphor, 'right')

  // Wind: FROM convention — arrow points TO (from+180)
  const windSpd = finite(flight.windVelocityKts)
  if (windSpd > 0.5) {
    const windDir = finite(flight.windDirectionDeg)
    const angle = (windArrowAngleDeg(windDir) * Math.PI) / 180
    const len = windArrowLengthPx(windSpd)
    const wx = 28
    const wy = cssH - 28
    ctx.save()
    ctx.translate(wx, wy)
    ctx.rotate(angle)
    ctx.strokeStyle = phosphor
    ctx.fillStyle = phosphor
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(0, len * 0.35)
    ctx.lineTo(0, -len * 0.55)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(0, -len * 0.55)
    ctx.lineTo(-4, -len * 0.55 + 8)
    ctx.lineTo(4, -len * 0.55 + 8)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
    ctx.font = '9px "IBM Plex Mono", monospace'
    ctx.textAlign = 'left'
    ctx.fillStyle = phosphor
    const fromLabel = String(Math.round(windDir) % 360).padStart(3, '0')
    ctx.fillText(`${fromLabel}°/${Math.round(windSpd)}`, wx + 14, wy + 3)
  }
}
