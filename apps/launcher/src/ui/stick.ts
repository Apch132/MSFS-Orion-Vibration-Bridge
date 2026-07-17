import type { SmoothControls } from '../telemetry/interpolate'

/** Fraction of stick-box half-size used at full deflection (left/top %). */
export const STICK_TRAVEL = 0.88

/**
 * Map a raw axis into [-1, 1].
 * Prefer signed MSFS POSITION. Percent-style (0..100, 50 = center) only when
 * clearly outside POSITION overshoot (values ≥ 5).
 */
export function normalizeStickAxis(raw: unknown): number {
  const n = Number(raw)
  if (!Number.isFinite(n)) return 0
  if (n >= 5 && n <= 100) {
    return Math.min(1, Math.max(-1, (n - 50) / 50))
  }
  if (n < -1) return -1
  if (n > 1) return 1
  return n
}

/**
 * Display Y for the stick pip.
 * Default (reverse=false): push (negative elevator / nose-down) → pip UP;
 * pull (positive elevator) → pip DOWN. Matches MSFS POSITION + product convention.
 * reverse=true flips only the UI, not SimConnect data.
 */
export function stickDisplayY(stickY: number, reverseVertical: boolean): number {
  const y = Math.min(1, Math.max(-1, stickY))
  const out = reverseVertical ? -y : y
  return out === 0 ? 0 : out
}

export type StickRenderOptions = {
  reverseStickY?: boolean
}

/**
 * Position the stick pip using left/top % of the stick-box (not transform % of the pip).
 * CSS translate(%) is relative to the element itself — that was why vertical travel
 * looked dead (≈9px on a 10px pip).
 */
export function applyStickPipPosition(
  pip: HTMLElement,
  controls: Pick<SmoothControls, 'stickX' | 'stickY'>,
  options: StickRenderOptions = {},
): void {
  const x = Math.min(1, Math.max(-1, controls.stickX))
  const y = stickDisplayY(controls.stickY, Boolean(options.reverseStickY))
  pip.style.left = `${50 + x * STICK_TRAVEL * 50}%`
  pip.style.top = `${50 + y * STICK_TRAVEL * 50}%`
  pip.style.transform = 'translate(-50%, -50%)'
}
