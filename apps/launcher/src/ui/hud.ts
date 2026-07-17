import type { SmoothFlight } from '../telemetry/interpolate'

export function hudHtml(): string {
  return `
    <div class="hud-shell" id="hud-shell" data-active="false">
      <canvas id="hud-canvas" width="480" height="420" aria-label="Flight HUD"></canvas>
      <div class="hud-readouts">
        <div><span>IAS</span><strong id="hud-ias">—</strong></div>
        <div><span>ALT</span><strong id="hud-alt">—</strong></div>
        <div><span>HDG</span><strong id="hud-hdg">—</strong></div>
        <div><span>M</span><strong id="hud-mach">—</strong></div>
        <div><span>G</span><strong id="hud-g">—</strong></div>
      </div>
    </div>
  `
}

export type HudRefs = {
  shell: HTMLElement
  canvas: HTMLCanvasElement
  ias: HTMLElement
  alt: HTMLElement
  hdg: HTMLElement
  mach: HTMLElement
  g: HTMLElement
}

export function bindHud(root: ParentNode): HudRefs {
  return {
    shell: root.querySelector('#hud-shell') as HTMLElement,
    canvas: root.querySelector('#hud-canvas') as HTMLCanvasElement,
    ias: root.querySelector('#hud-ias') as HTMLElement,
    alt: root.querySelector('#hud-alt') as HTMLElement,
    hdg: root.querySelector('#hud-hdg') as HTMLElement,
    mach: root.querySelector('#hud-mach') as HTMLElement,
    g: root.querySelector('#hud-g') as HTMLElement,
  }
}

function finite(n: number, fallback = 0): number {
  return Number.isFinite(n) ? n : fallback
}

/**
 * Flight path marker:
 * Uses AoA + sideslip when available; otherwise falls back to pitch/bank-derived
 * boresight offset (documented fallback — not inventing wind data).
 */
function flightPathOffset(flight: SmoothFlight): { x: number; y: number } {
  const hasAoA = Math.abs(flight.angleOfAttackDeg) > 0.01
    || Math.abs(flight.sideslipDeg) > 0.01
  if (hasAoA || Math.abs(flight.indicatedAirspeedKts) > 40) {
    return {
      x: finite(flight.sideslipDeg) * 2.2,
      y: -finite(flight.angleOfAttackDeg) * 2.2,
    }
  }
  return { x: 0, y: 0 }
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
  const cssW = parent?.clientWidth || 320
  const cssH = Math.max(220, Math.min(360, (parent?.clientHeight || 280) - 44))
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
  const cy = cssH / 2
  const phosphor = stale ? 'rgba(90, 140, 100, 0.45)' : '#3ec478'
  const dim = stale ? 'rgba(90, 140, 100, 0.25)' : 'rgba(62, 196, 120, 0.35)'

  ctx.fillStyle = 'rgba(6, 14, 10, 0.92)'
  ctx.fillRect(0, 0, cssW, cssH)

  if (!active) {
    ctx.strokeStyle = dim
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(cx - 18, cy)
    ctx.lineTo(cx + 18, cy)
    ctx.moveTo(cx, cy - 18)
    ctx.lineTo(cx, cy + 18)
    ctx.stroke()
    refs.ias.textContent = '—'
    refs.alt.textContent = '—'
    refs.hdg.textContent = '—'
    refs.mach.textContent = '—'
    refs.g.textContent = '—'
    return
  }

  const pitch = Math.max(-90, Math.min(90, finite(flight.pitchDeg)))
  const bank = Math.max(-180, Math.min(180, finite(flight.bankDeg)))
  const pitchPx = 4.2

  ctx.save()
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

  // Pitch ladder (bounded ±40 displayed)
  ctx.font = '11px "IBM Plex Mono", monospace'
  ctx.fillStyle = phosphor
  ctx.textAlign = 'center'
  for (let p = -40; p <= 40; p += 10) {
    if (p === 0) continue
    const y = -(p + pitch) * pitchPx
    if (Math.abs(y) > cssH * 0.45) continue
    const half = p % 20 === 0 ? 36 : 22
    ctx.strokeStyle = dim
    ctx.beginPath()
    ctx.moveTo(-half, y)
    ctx.lineTo(half, y)
    ctx.stroke()
    ctx.fillText(String(p), half + 14, y + 3)
    ctx.fillText(String(p), -half - 14, y + 3)
  }
  ctx.restore()

  // Bank scale
  ctx.strokeStyle = phosphor
  ctx.lineWidth = 1
  const bankR = Math.min(cssW, cssH) * 0.38
  ctx.beginPath()
  ctx.arc(cx, cy, bankR, (-60 * Math.PI) / 180 - Math.PI / 2, (60 * Math.PI) / 180 - Math.PI / 2)
  ctx.stroke()
  for (const mark of [-60, -30, -20, -10, 0, 10, 20, 30, 60]) {
    const a = ((mark) * Math.PI) / 180 - Math.PI / 2
    const inner = mark === 0 ? bankR - 10 : bankR - 6
    ctx.beginPath()
    ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner)
    ctx.lineTo(cx + Math.cos(a) * bankR, cy + Math.sin(a) * bankR)
    ctx.stroke()
  }
  // Bank pointer
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate((-bank * Math.PI) / 180)
  ctx.beginPath()
  ctx.moveTo(0, -bankR + 2)
  ctx.lineTo(-5, -bankR + 12)
  ctx.lineTo(5, -bankR + 12)
  ctx.closePath()
  ctx.fillStyle = phosphor
  ctx.fill()
  ctx.restore()

  // Aircraft reference (fixed)
  ctx.strokeStyle = phosphor
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(cx - 28, cy)
  ctx.lineTo(cx - 8, cy)
  ctx.moveTo(cx + 8, cy)
  ctx.lineTo(cx + 28, cy)
  ctx.moveTo(cx, cy)
  ctx.lineTo(cx, cy + 10)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(cx, cy, 3, 0, Math.PI * 2)
  ctx.stroke()

  // Flight path marker
  const fpm = flightPathOffset(flight)
  const fpx = cx + fpm.x
  const fpy = cy + fpm.y
  ctx.strokeStyle = phosphor
  ctx.beginPath()
  ctx.arc(fpx, fpy, 7, 0, Math.PI * 2)
  ctx.moveTo(fpx - 14, fpy)
  ctx.lineTo(fpx - 7, fpy)
  ctx.moveTo(fpx + 7, fpy)
  ctx.lineTo(fpx + 14, fpy)
  ctx.moveTo(fpx, fpy - 14)
  ctx.lineTo(fpx, fpy - 7)
  ctx.stroke()

  refs.ias.textContent = `${Math.round(finite(flight.indicatedAirspeedKts))}`
  refs.alt.textContent = `${Math.round(finite(flight.altitudeFt))}`
  refs.hdg.textContent = `${Math.round(finite(flight.headingDeg)) % 360}`.padStart(3, '0')
  refs.mach.textContent = finite(flight.mach).toFixed(2)
  refs.g.textContent = finite(flight.gForce, 1).toFixed(1)
}
