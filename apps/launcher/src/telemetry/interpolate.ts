/** Smoothed display values for HUD / control graphics. */

function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback
}

/** Shortest-path heading interpolation (avoids 359→0 jumps). */
export function lerpHeading(from: number, to: number, alpha: number): number {
  const a = ((finite(from) % 360) + 360) % 360
  const b = ((finite(to) % 360) + 360) % 360
  let delta = b - a
  if (delta > 180) delta -= 360
  if (delta < -180) delta += 360
  const t = Math.min(1, Math.max(0, alpha))
  return ((a + delta * t) % 360 + 360) % 360
}

export function lerp(from: number, to: number, alpha: number): number {
  const t = Math.min(1, Math.max(0, alpha))
  return finite(from) + (finite(to) - finite(from)) * t
}

export type SmoothControls = {
  stickX: number
  stickY: number
  rudder: number
  leftThrottle: number
  rightThrottle: number
  brakesLeft: number
  brakesRight: number
}

export type SmoothFlight = {
  headingDeg: number
  pitchDeg: number
  bankDeg: number
  indicatedAirspeedKts: number
  groundSpeedKts: number
  altitudeFt: number
  mach: number
  gForce: number
  verticalSpeedFpm: number
  angleOfAttackDeg: number
  sideslipDeg: number
  windDirectionDeg: number
  windVelocityKts: number
}

export function createSmoothControls(): SmoothControls {
  return {
    stickX: 0,
    stickY: 0,
    rudder: 0,
    leftThrottle: 0,
    rightThrottle: 0,
    brakesLeft: 0,
    brakesRight: 0,
  }
}

export function createSmoothFlight(): SmoothFlight {
  return {
    headingDeg: 0,
    pitchDeg: 0,
    bankDeg: 0,
    indicatedAirspeedKts: 0,
    groundSpeedKts: 0,
    altitudeFt: 0,
    mach: 0,
    gForce: 1,
    verticalSpeedFpm: 0,
    angleOfAttackDeg: 0,
    sideslipDeg: 0,
    windDirectionDeg: 0,
    windVelocityKts: 0,
  }
}

export function stepControls(
  current: SmoothControls,
  target: SmoothControls,
  alpha: number,
): SmoothControls {
  return {
    stickX: lerp(current.stickX, target.stickX, alpha),
    stickY: lerp(current.stickY, target.stickY, alpha),
    rudder: lerp(current.rudder, target.rudder, alpha),
    leftThrottle: lerp(current.leftThrottle, target.leftThrottle, alpha),
    rightThrottle: lerp(current.rightThrottle, target.rightThrottle, alpha),
    brakesLeft: lerp(current.brakesLeft, target.brakesLeft, alpha),
    brakesRight: lerp(current.brakesRight, target.brakesRight, alpha),
  }
}

export function stepFlight(
  current: SmoothFlight,
  target: SmoothFlight,
  alpha: number,
): SmoothFlight {
  return {
    headingDeg: lerpHeading(current.headingDeg, target.headingDeg, alpha),
    pitchDeg: lerp(current.pitchDeg, target.pitchDeg, alpha),
    bankDeg: lerp(current.bankDeg, target.bankDeg, alpha),
    indicatedAirspeedKts: lerp(current.indicatedAirspeedKts, target.indicatedAirspeedKts, alpha),
    groundSpeedKts: lerp(current.groundSpeedKts, target.groundSpeedKts, alpha),
    altitudeFt: lerp(current.altitudeFt, target.altitudeFt, alpha),
    mach: lerp(current.mach, target.mach, alpha),
    gForce: lerp(current.gForce, target.gForce, alpha),
    verticalSpeedFpm: lerp(current.verticalSpeedFpm, target.verticalSpeedFpm, alpha),
    angleOfAttackDeg: lerp(current.angleOfAttackDeg, target.angleOfAttackDeg, alpha),
    sideslipDeg: lerp(current.sideslipDeg, target.sideslipDeg, alpha),
    windDirectionDeg: lerpHeading(current.windDirectionDeg, target.windDirectionDeg, alpha),
    windVelocityKts: lerp(current.windVelocityKts, target.windVelocityKts, alpha),
  }
}
