/** Window control icons for the custom titlebar. */

export function iconMinimize(size = 12): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6h8" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/></svg>`
}

export function iconMaximize(size = 12): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 12 12" aria-hidden="true"><rect x="2.25" y="2.25" width="7.5" height="7.5" rx="0.5" fill="none" stroke="currentColor" stroke-width="1.25"/></svg>`
}

export function iconRestore(size = 12): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 12 12" aria-hidden="true"><path d="M3.5 4.25h4.25V8.5H3.5z" fill="none" stroke="currentColor" stroke-width="1.1"/><path d="M4.75 3.25h4V7" fill="none" stroke="currentColor" stroke-width="1.1"/></svg>`
}

export function iconClose(size = 12): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3L3 9" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/></svg>`
}
