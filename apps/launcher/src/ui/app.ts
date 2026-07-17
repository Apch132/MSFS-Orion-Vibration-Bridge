import type { LauncherBridgeClient, BridgeRuntimeState } from '../bridge-client'
import { PreferencesController } from '../preferences'
import {
  EFFECT_KEYS,
  EFFECT_LABELS,
  type ActiveProfile,
  type EffectKey,
  type LauncherPreferences,
  type SaveStatus,
  type ThemePreference,
} from '../preferences/types'
import {
  createSmoothControls,
  createSmoothFlight,
  stepControls,
  stepFlight,
} from '../telemetry/interpolate'
import type { TelemetrySnapshot } from '../telemetry/types'
import { iconActivity, iconGauge, iconRadio, iconSliders } from './icons'
import { bindHud, drawHud, hudHtml } from './hud'
import {
  appendFlightEvent,
  bindTelemetryPanel,
  renderControls,
  renderTelemetryCards,
  resetFlightEvents,
  telemetryPanelHtml,
} from './telemetry-panel'
import { iconClose, iconMaximize, iconMinimize, iconRestore } from './window-chrome'

function resolveTheme(theme: ThemePreference): Exclude<ThemePreference, 'system'> {
  if (theme !== 'system') return theme
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

function applyTheme(theme: ThemePreference): void {
  document.documentElement.setAttribute('data-theme', resolveTheme(theme))
}

export type MountAppOptions = {
  bridge?: LauncherBridgeClient | null
  /** Tauri-only: flush prefs, stop bridge-host, destroy window. */
  onRequestQuit?: () => void | Promise<void>
}

const PANEL_COLLAPSE_KEY = 'orion.launcher.panelsCollapsed'

type PanelId = 'config' | 'telemetry' | 'hud'

type CollapsedPanels = Record<PanelId, boolean>

function loadCollapsed(): CollapsedPanels {
  try {
    const raw = localStorage.getItem(PANEL_COLLAPSE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<CollapsedPanels>
      return {
        config: Boolean(parsed.config),
        telemetry: Boolean(parsed.telemetry),
        hud: Boolean(parsed.hud),
      }
    }
    // Migrate legacy single-panel key
    if (localStorage.getItem('orion.launcher.configCollapsed') === '1') {
      return { config: true, telemetry: false, hud: false }
    }
  } catch {
    /* ignore */
  }
  return { config: false, telemetry: false, hud: false }
}

function panelToggleGlyph(collapsed: boolean): string {
  return collapsed ? '>' : '<'
}

export async function mountApp(
  root: HTMLElement,
  controller: PreferencesController,
  options: MountAppOptions = {},
): Promise<void> {
  let prefs = controller.getPreferences()
  const bridge = options.bridge ?? null
  const onRequestQuit = options.onRequestQuit
  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

  let collapsed = loadCollapsed()
  let sliderPointerDown = false
  let engineCount = 0

  root.innerHTML = `
    <header class="titlebar" data-tauri-drag-region>
      <div class="titlebar-brand" data-tauri-drag-region>
        <div class="brand-mark" aria-hidden="true"></div>
        <div class="titlebar-titles" data-tauri-drag-region>
          <div class="titlebar-name">WinWing MSFS Vibration Bridge</div>
          <div class="brand-sub">Desktop launcher</div>
        </div>
      </div>
      <div class="titlebar-drag" data-tauri-drag-region title="Drag to move · double-click to maximize"></div>
      <div class="titlebar-center">
        <div class="sim-pill" id="sim-pill" data-state="offline" title="SimConnect status from the shared bridge runtime">
          ${iconRadio(14)}
          <span class="sim-dot" aria-hidden="true"></span>
          <span id="sim-label">SimConnect · Disconnected</span>
        </div>
        <button type="button" class="btn btn-primary" id="btn-engine" ${bridge?.isAvailable() ? '' : 'disabled'} title="${bridge?.isAvailable() ? 'Start or stop the shared vibration bridge' : 'Bridge runtime requires the Tauri desktop app'}">
          Start
        </button>
      </div>
      <div class="window-controls" role="group" aria-label="Window">
        <button type="button" class="win-btn" id="btn-win-min" title="Minimize" aria-label="Minimize">${iconMinimize()}</button>
        <button type="button" class="win-btn" id="btn-win-max" title="Maximize" aria-label="Maximize">${iconMaximize()}</button>
        <button type="button" class="win-btn win-btn-close" id="btn-win-close" title="Close" aria-label="Close">${iconClose()}</button>
      </div>
    </header>

    <main class="layout" id="layout">
      <aside class="panel-rail" id="panel-rail" aria-label="Panel visibility">
        <button type="button" class="panel-rail-btn" data-panel="config" title="Configuration" aria-pressed="false">
          ${iconSliders(14)}
          <span data-glyph>&lt;</span>
        </button>
        <button type="button" class="panel-rail-btn" data-panel="telemetry" title="Telemetry" aria-pressed="false">
          ${iconActivity(14)}
          <span data-glyph>&lt;</span>
        </button>
        <button type="button" class="panel-rail-btn" data-panel="hud" title="HUD" aria-pressed="false">
          ${iconGauge(14)}
          <span data-glyph>&lt;</span>
        </button>
      </aside>

      <div class="panels-row" id="panels-row">
        <section class="panel panel-config" id="panel-config" aria-label="Configuration">
          <div class="panel-header">
            ${iconSliders(16)}
            <span class="label">Configuration</span>
          </div>
          <div class="panel-body">
            <div class="intensity-help" role="note">
              <p>Les curseurs ne rendent pas un effet plus fréquent. Ils définissent uniquement sa puissance maximale.</p>
              <p>Le moteur de vibration adapte automatiquement l’intensité selon la situation de vol.</p>
              <ul>
                <li>Train rentrant : faible vibration.</li>
                <li>Atterrissage dur : vibration beaucoup plus forte.</li>
                <li>Décrochage léger : vibration modérée.</li>
                <li>Décrochage prononcé : vibration importante.</li>
              </ul>
              <p>Réduire un curseur limite uniquement la puissance maximale de cet effet. Le réglage Master agit sur l’ensemble des effets.</p>
              <p class="intensity-help-scale">Échelle HID : 0 % = 0 · 50 % ≈ 128 · 100 % = 255</p>
            </div>
            <div class="tabs" role="tablist" aria-label="Vibration profile">
              <button type="button" class="tab" role="tab" data-profile="aircraft" aria-selected="true">Aircraft</button>
              <button type="button" class="tab" role="tab" data-profile="helicopter" aria-selected="false">Helicopter</button>
            </div>
            <div class="effect-list" id="effect-list"></div>
            <div class="field-row">
              <label for="theme-select">Theme</label>
              <select id="theme-select">
                <option value="cockpit">Cockpit</option>
                <option value="dark">Dark</option>
                <option value="light">Light</option>
                <option value="system">System</option>
              </select>
            </div>
            <div class="field-row">
              <span class="brand-sub">Restore both profiles and theme</span>
              <button type="button" class="btn" id="btn-reset">Reset defaults</button>
            </div>
          </div>
        </section>

        <section class="panel panel-telemetry" id="panel-telemetry" aria-label="SimConnect Telemetry">
          <div class="panel-header">
            ${iconActivity(16)}
            <span class="label">SimConnect Telemetry</span>
          </div>
          <div class="panel-body panel-body-telemetry">
            ${telemetryPanelHtml()}
          </div>
        </section>

        <section class="panel panel-hud" id="panel-hud" aria-label="Flight HUD">
          <div class="panel-header">
            ${iconGauge(16)}
            <span class="label">Flight HUD</span>
          </div>
          <div class="panel-body panel-body-hud">
            ${hudHtml()}
          </div>
        </section>

        <div class="panels-empty" id="panels-empty" hidden>
          <p>All panels are hidden.</p>
          <p class="brand-sub">Use the buttons on the left to show Configuration, Telemetry, or HUD.</p>
        </div>
      </div>
    </main>

    <footer class="statusbar">
      <span class="save-status" id="save-status" data-status="Saved">Saved</span>
      <span class="brand-sub" id="bridge-footer">Preferences stored in the OS app data directory</span>
    </footer>
  `

  const layout = root.querySelector('#layout') as HTMLElement
  const panelsEmpty = root.querySelector('#panels-empty') as HTMLElement
  const effectList = root.querySelector('#effect-list') as HTMLElement
  const themeSelect = root.querySelector('#theme-select') as HTMLSelectElement
  const saveStatusEl = root.querySelector('#save-status') as HTMLElement
  const resetBtn = root.querySelector('#btn-reset') as HTMLButtonElement
  const engineBtn = root.querySelector('#btn-engine') as HTMLButtonElement
  const simPill = root.querySelector('#sim-pill') as HTMLElement
  const simLabel = root.querySelector('#sim-label') as HTMLElement
  const bridgeFooter = root.querySelector('#bridge-footer') as HTMLElement
  const btnMin = root.querySelector('#btn-win-min') as HTMLButtonElement
  const btnMax = root.querySelector('#btn-win-max') as HTMLButtonElement
  const btnClose = root.querySelector('#btn-win-close') as HTMLButtonElement
  const tabs = Array.from(root.querySelectorAll<HTMLButtonElement>('.tab'))
  const collapseBtns = Array.from(root.querySelectorAll<HTMLButtonElement>('.panel-rail-btn'))
  const tele = bindTelemetryPanel(root)
  const hud = bindHud(root)

  let targetTelemetry: TelemetrySnapshot | null = bridge?.getTelemetry() ?? null
  let smoothControls = createSmoothControls()
  let smoothFlight = createSmoothFlight()
  let eventSession = 0
  let lastAircraftKey = ''
  let raf = 0
  let maximized = false

  function persistCollapsed(): void {
    try {
      localStorage.setItem(PANEL_COLLAPSE_KEY, JSON.stringify(collapsed))
    } catch {
      /* ignore */
    }
  }

  function syncPanelCollapse(): void {
    layout.dataset.configCollapsed = collapsed.config ? 'true' : 'false'
    layout.dataset.telemetryCollapsed = collapsed.telemetry ? 'true' : 'false'
    layout.dataset.hudCollapsed = collapsed.hud ? 'true' : 'false'

    const allHidden = collapsed.config && collapsed.telemetry && collapsed.hud
    layout.dataset.allCollapsed = allHidden ? 'true' : 'false'
    panelsEmpty.hidden = !allHidden

    for (const btn of collapseBtns) {
      const id = btn.dataset.panel as PanelId
      const isCollapsed = collapsed[id]
      const glyph = btn.querySelector('[data-glyph]')
      if (glyph) glyph.textContent = panelToggleGlyph(isCollapsed)
      btn.setAttribute('aria-pressed', isCollapsed ? 'true' : 'false')
      btn.classList.toggle('is-collapsed', isCollapsed)
      const labels: Record<PanelId, string> = {
        config: 'configuration',
        telemetry: 'telemetry',
        hud: 'HUD',
      }
      btn.title = isCollapsed ? `Show ${labels[id]}` : `Hide ${labels[id]}`
    }
    persistCollapsed()
  }

  function hidHint(key: EffectKey, intensity: number): string {
    return key === 'master'
      ? 'Final HID multiplier'
      : `Ceiling ≈ ${Math.round((intensity / 100) * 255)} HID`
  }

  function renderEffects(current: LauncherPreferences): void {
    const profile = current.profiles[current.activeProfile]
    effectList.innerHTML = EFFECT_KEYS.map((key) => {
      const effect = profile[key]
      return `
        <div class="effect-card" data-effect="${key}">
          <div class="effect-row">
            <span class="effect-name">${EFFECT_LABELS[key]}</span>
            <div class="effect-controls">
              <span class="effect-pct" title="${hidHint(key, effect.intensity)}">${Math.round(effect.intensity)}%</span>
              <label class="switch" title="Enable ${EFFECT_LABELS[key]}">
                <input type="checkbox" data-role="enabled" ${effect.enabled ? 'checked' : ''} />
                <span></span>
              </label>
            </div>
          </div>
          <input
            class="slider"
            type="range"
            min="0"
            max="100"
            step="1"
            data-role="intensity"
            value="${effect.intensity}"
            ${effect.enabled ? '' : 'disabled'}
            title="${hidHint(key, effect.intensity)}"
          />
        </div>
      `
    }).join('')
  }

  /** Update labels/checkboxes without rebuilding range inputs (keeps drag fluid). */
  function softSyncEffects(current: LauncherPreferences): void {
    const profile = current.profiles[current.activeProfile]
    for (const key of EFFECT_KEYS) {
      const card = effectList.querySelector<HTMLElement>(`[data-effect="${key}"]`)
      if (!card) continue
      const effect = profile[key]
      const pct = card.querySelector('.effect-pct')
      const slider = card.querySelector<HTMLInputElement>('input[data-role="intensity"]')
      const enabled = card.querySelector<HTMLInputElement>('input[data-role="enabled"]')
      if (pct) {
        pct.textContent = `${Math.round(effect.intensity)}%`
        pct.setAttribute('title', hidHint(key, effect.intensity))
      }
      if (slider && document.activeElement !== slider) {
        slider.value = String(effect.intensity)
        slider.disabled = !effect.enabled
        slider.title = hidHint(key, effect.intensity)
      } else if (slider) {
        slider.disabled = !effect.enabled
      }
      if (enabled && document.activeElement !== enabled) {
        enabled.checked = effect.enabled
      }
    }
  }

  function syncChrome(current: LauncherPreferences, rebuildEffects = true): void {
    applyTheme(current.appearance.theme)
    themeSelect.value = current.appearance.theme
    for (const tab of tabs) {
      const selected = tab.dataset.profile === current.activeProfile
      tab.setAttribute('aria-selected', selected ? 'true' : 'false')
    }
    if (rebuildEffects && !sliderPointerDown) {
      renderEffects(current)
    } else {
      softSyncEffects(current)
    }
  }

  function setSaveStatus(status: SaveStatus): void {
    saveStatusEl.textContent = status
    saveStatusEl.dataset.status = status
  }

  function syncSimPillFromTelemetry(snap: TelemetrySnapshot | null, bridgeState: BridgeRuntimeState): void {
    const sim = snap?.connection.simconnect
    if (sim === 'connected') {
      simPill.dataset.state = 'online'
      simLabel.textContent = `SimConnect · ${bridgeState.simApplicationName || 'Connected'}`
      return
    }
    if (sim === 'connecting' || (bridgeState.running && !bridgeState.simConnected)) {
      simPill.dataset.state = 'connecting'
      simLabel.textContent = 'SimConnect · Connecting'
      return
    }
    if (sim === 'error' || snap?.stale) {
      simPill.dataset.state = 'error'
      simLabel.textContent = 'SimConnect · Error'
      return
    }
    simPill.dataset.state = 'offline'
    simLabel.textContent = 'SimConnect · Disconnected'
  }

  function syncBridgeUi(state: BridgeRuntimeState): void {
    const running = state.status === 'running' || state.status === 'starting'
    engineBtn.textContent = running ? 'Stop' : 'Start'
    engineBtn.disabled = !bridge?.isAvailable() || state.status === 'starting' || state.status === 'stopping'

    syncSimPillFromTelemetry(targetTelemetry, state)
    bridgeFooter.textContent = running
      ? 'Bridge running — preference changes apply live'
      : 'Preferences stored in the OS app data directory'
  }

  function onTelemetry(snap: TelemetrySnapshot): void {
    const key = `${snap.aircraft.title}|${snap.aircraft.category}|${snap.aircraft.engineCount}`
    if (lastAircraftKey && key !== lastAircraftKey) {
      eventSession += 1
      resetFlightEvents(tele.timeline)
    }
    lastAircraftKey = key
    engineCount = snap.aircraft.engineCount
    targetTelemetry = snap
    renderTelemetryCards(tele, snap)
    syncSimPillFromTelemetry(snap, bridge?.getState() ?? {
      status: 'stopped',
      running: false,
      simConnected: false,
      simApplicationName: null,
      hidOpenCount: 0,
    })
  }

  function tick(): void {
    const target = targetTelemetry
    if (target) {
      smoothControls = stepControls(smoothControls, target.controls, 0.22)
      smoothFlight = stepFlight(smoothFlight, {
        headingDeg: target.flight.headingDeg,
        pitchDeg: target.flight.pitchDeg,
        bankDeg: target.flight.bankDeg,
        indicatedAirspeedKts: target.flight.indicatedAirspeedKts,
        groundSpeedKts: target.flight.groundSpeedKts,
        altitudeFt: target.flight.altitudeFt,
        mach: target.flight.mach,
        gForce: target.flight.gForce,
        verticalSpeedFpm: target.flight.verticalSpeedFpm,
        angleOfAttackDeg: target.flight.angleOfAttackDeg,
        sideslipDeg: target.flight.sideslipDeg,
        windDirectionDeg: target.flight.windDirectionDeg,
        windVelocityKts: target.flight.windVelocityKts,
      }, 0.18)
      renderControls(tele, smoothControls, engineCount || target.aircraft.engineCount)
      const active = target.connection.simconnect === 'connected'
      drawHud(hud, smoothFlight, active, Boolean(target.stale))
    } else {
      drawHud(hud, smoothFlight, false, false)
    }
    raf = requestAnimationFrame(tick)
  }

  async function syncMaximizedState(): Promise<void> {
    if (!isTauri) return
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      maximized = await getCurrentWindow().isMaximized()
      btnMax.innerHTML = maximized ? iconRestore() : iconMaximize()
      btnMax.title = maximized ? 'Restore' : 'Maximize'
      btnMax.setAttribute('aria-label', maximized ? 'Restore' : 'Maximize')
      root.classList.toggle('is-maximized', maximized)
    } catch {
      /* preview */
    }
  }

  syncPanelCollapse()
  syncChrome(prefs)
  setSaveStatus(controller.getSaveStatus())
  if (targetTelemetry) {
    engineCount = targetTelemetry.aircraft.engineCount
    renderTelemetryCards(tele, targetTelemetry)
  }

  controller.subscribe((next) => {
    prefs = next
    syncChrome(next, !sliderPointerDown)
    if (bridge?.isAvailable()) {
      void bridge.updatePreferences(next).catch((err) => {
        console.error('[launcher] bridge updatePreferences failed:', err)
      })
    }
  })
  controller.subscribeStatus(setSaveStatus)

  for (const btn of collapseBtns) {
    btn.addEventListener('click', () => {
      const id = btn.dataset.panel as PanelId
      collapsed = { ...collapsed, [id]: !collapsed[id] }
      syncPanelCollapse()
    })
  }

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const profile = tab.dataset.profile as ActiveProfile
      controller.updatePreferences((current) => ({
        ...current,
        activeProfile: profile,
      }))
    })
  })

  themeSelect.addEventListener('change', () => {
    const theme = themeSelect.value as ThemePreference
    controller.updatePreferences((current) => ({
      ...current,
      appearance: { ...current.appearance, theme },
    }))
  })

  resetBtn.addEventListener('click', () => {
    void controller.resetPreferences()
  })

  effectList.addEventListener('pointerdown', (event) => {
    const target = event.target as HTMLElement
    if (target.dataset?.role === 'intensity') sliderPointerDown = true
  })
  window.addEventListener('pointerup', () => {
    if (!sliderPointerDown) return
    sliderPointerDown = false
    syncChrome(controller.getPreferences(), true)
  })
  window.addEventListener('pointercancel', () => {
    sliderPointerDown = false
  })

  effectList.addEventListener('input', (event) => {
    const target = event.target as HTMLInputElement
    if (target.dataset.role !== 'intensity') return
    const card = target.closest<HTMLElement>('[data-effect]')
    const key = card?.dataset.effect as EffectKey | undefined
    if (!key) return
    const intensity = Number(target.value)
    const pct = card?.querySelector('.effect-pct')
    if (pct) {
      pct.textContent = `${Math.round(intensity)}%`
      pct.setAttribute('title', hidHint(key, intensity))
    }
    target.title = hidHint(key, intensity)

    controller.updatePreferences((current) => {
      const active = current.activeProfile
      return {
        ...current,
        profiles: {
          ...current.profiles,
          [active]: {
            ...current.profiles[active],
            [key]: {
              ...current.profiles[active][key],
              intensity,
            },
          },
        },
      }
    })
  })

  effectList.addEventListener('change', (event) => {
    const target = event.target as HTMLInputElement
    if (target.dataset.role !== 'enabled') return
    const card = target.closest<HTMLElement>('[data-effect]')
    const key = card?.dataset.effect as EffectKey | undefined
    if (!key) return
    const enabled = target.checked
    controller.updatePreferences((current) => {
      const active = current.activeProfile
      return {
        ...current,
        profiles: {
          ...current.profiles,
          [active]: {
            ...current.profiles[active],
            [key]: {
              ...current.profiles[active][key],
              enabled,
            },
          },
        },
      }
    })
  })

  engineBtn.addEventListener('click', () => {
    if (!bridge?.isAvailable()) return
    const state = bridge.getState()
    const running = state.status === 'running' || state.status === 'starting'
    engineBtn.disabled = true
    if (!running) {
      eventSession += 1
      resetFlightEvents(tele.timeline)
      lastAircraftKey = ''
    }
    const action = running
      ? bridge.stop()
      : bridge.start(controller.getPreferences())
    void action.catch((err) => {
      console.error('[launcher] bridge start/stop failed:', err)
      bridgeFooter.textContent = `Bridge error: ${err instanceof Error ? err.message : String(err)}`
    })
  })

  if (isTauri) {
    void (async () => {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      const win = getCurrentWindow()
      await syncMaximizedState()

      btnMin.addEventListener('click', () => {
        void win.minimize()
      })
      btnMax.addEventListener('click', async () => {
        await win.toggleMaximize()
        await syncMaximizedState()
      })
      btnClose.addEventListener('click', () => {
        if (onRequestQuit) {
          void onRequestQuit()
          return
        }
        void win.close()
      })

      const drag = root.querySelector('.titlebar-drag') as HTMLElement
      drag.addEventListener('dblclick', async () => {
        await win.toggleMaximize()
        await syncMaximizedState()
      })

      await win.onResized(() => {
        void syncMaximizedState()
      })
    })()
  } else {
    btnMin.disabled = true
    btnMax.disabled = true
    btnClose.disabled = true
  }

  const unsubs: Array<() => void> = []
  if (bridge) {
    unsubs.push(bridge.onState(syncBridgeUi))
    unsubs.push(bridge.onTelemetry(onTelemetry))
    unsubs.push(bridge.onFlightEvent((event) => {
      appendFlightEvent(tele.timeline, event, eventSession)
    }))
    unsubs.push(bridge.onError((message) => {
      bridgeFooter.textContent = `Bridge error: ${message}`
    }))
  }

  raf = requestAnimationFrame(tick)

  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (prefs.appearance.theme === 'system') applyTheme('system')
  })

  window.addEventListener('beforeunload', () => {
    cancelAnimationFrame(raf)
    for (const unsub of unsubs) unsub()
    void controller.flushPendingSave()
  })
}
