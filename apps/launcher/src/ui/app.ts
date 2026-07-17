import type { LauncherBridgeClient, BridgeRuntimeState } from '../bridge-client'
import { PreferencesController } from '../preferences'
import {
  EFFECT_KEYS,
  type ActiveProfile,
  type EffectKey,
  type LauncherPreferences,
  type LocaleCode,
  type SaveStatus,
  type ThemePreference,
} from '../preferences/types'
import { formatMessage, getMessages, type MessageTree } from '../i18n'
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
  onRequestQuit?: () => void | Promise<void>
}

const PANEL_COLLAPSE_KEY = 'orion.launcher.panelsCollapsed'

type PanelId = 'config' | 'flight'

type CollapsedPanels = Record<PanelId, boolean>

function loadCollapsed(): CollapsedPanels {
  try {
    const raw = localStorage.getItem(PANEL_COLLAPSE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<CollapsedPanels & { telemetry?: boolean; hud?: boolean }>
      // Migrate legacy 3-panel keys → merged flight panel
      const flight = Boolean(parsed.flight ?? (parsed.telemetry && parsed.hud))
      return {
        config: Boolean(parsed.config),
        flight,
      }
    }
    if (localStorage.getItem('orion.launcher.configCollapsed') === '1') {
      return { config: true, flight: false }
    }
  } catch {
    /* ignore */
  }
  return { config: false, flight: false }
}

function panelToggleGlyph(collapsed: boolean): string {
  return collapsed ? '>' : '<'
}

function saveStatusLabel(status: SaveStatus, messages: MessageTree): string {
  if (status === 'Saving…') return messages.save.saving
  if (status === 'Error') return messages.save.error
  return messages.save.saved
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
  let messages = getMessages(prefs.appearance.locale)

  function buildShell(): void {
    root.innerHTML = `
      <header class="titlebar" data-tauri-drag-region>
        <div class="titlebar-brand" data-tauri-drag-region>
          <div class="brand-mark" aria-hidden="true"></div>
          <div class="titlebar-titles" data-tauri-drag-region>
            <div class="titlebar-name">${messages.app.title}</div>
            <div class="brand-sub">${messages.app.subtitle}</div>
          </div>
        </div>
        <div class="titlebar-drag" data-tauri-drag-region title="${messages.app.dragHint}"></div>
        <div class="titlebar-center">
          <div class="sim-pill" id="sim-pill" data-state="offline" title="${messages.sim.title}">
            ${iconRadio(14)}
            <span class="sim-dot" aria-hidden="true"></span>
            <span id="sim-label">${messages.sim.disconnected}</span>
          </div>
          <button type="button" class="btn btn-primary" id="btn-engine" ${bridge?.isAvailable() ? '' : 'disabled'} title="${bridge?.isAvailable() ? messages.bridge.startTitle : messages.bridge.unavailableTitle}">
            ${messages.bridge.start}
          </button>
        </div>
        <div class="window-controls" role="group" aria-label="Window">
          <button type="button" class="win-btn" id="btn-win-min" title="${messages.window.minimize}" aria-label="${messages.window.minimize}">${iconMinimize()}</button>
          <button type="button" class="win-btn" id="btn-win-max" title="${messages.window.maximize}" aria-label="${messages.window.maximize}">${iconMaximize()}</button>
          <button type="button" class="win-btn win-btn-close" id="btn-win-close" title="${messages.window.close}" aria-label="${messages.window.close}">${iconClose()}</button>
        </div>
      </header>

      <main class="layout" id="layout">
        <aside class="panel-rail" id="panel-rail" aria-label="${messages.panels.railLabel}">
          <button type="button" class="panel-rail-btn" data-panel="config" title="${messages.panels.config}" aria-pressed="false">
            ${iconSliders(14)}
            <span data-glyph>&lt;</span>
          </button>
          <button type="button" class="panel-rail-btn" data-panel="flight" title="${messages.panels.flight}" aria-pressed="false">
            ${iconGauge(14)}
            <span data-glyph>&lt;</span>
          </button>
        </aside>

        <div class="panels-row" id="panels-row">
          <section class="panel panel-config" id="panel-config" aria-label="${messages.panels.config}">
            <div class="panel-header">
              ${iconSliders(16)}
              <span class="label">${messages.panels.config}</span>
            </div>
            <div class="panel-body">
              <div class="intensity-help" role="note">
                <p>${messages.config.helpLead}</p>
                <p>${messages.config.helpBody}</p>
                <ul>
                  <li>${messages.config.helpGear}</li>
                  <li>${messages.config.helpTouchdown}</li>
                  <li>${messages.config.helpStallLight}</li>
                  <li>${messages.config.helpStallHard}</li>
                </ul>
                <p>${messages.config.helpCeiling}</p>
                <p class="intensity-help-scale">${messages.config.helpScale}</p>
              </div>
              <div class="tabs" role="tablist" aria-label="Vibration profile">
                <button type="button" class="tab" role="tab" data-profile="aircraft" aria-selected="true">${messages.config.profileAircraft}</button>
                <button type="button" class="tab" role="tab" data-profile="helicopter" aria-selected="false">${messages.config.profileHelicopter}</button>
              </div>
              <div class="effect-list" id="effect-list"></div>
              <div class="field-row">
                <label for="theme-select">${messages.config.theme}</label>
                <select id="theme-select">
                  <option value="cockpit">${messages.config.themeCockpit}</option>
                  <option value="dark">${messages.config.themeDark}</option>
                  <option value="light">${messages.config.themeLight}</option>
                  <option value="system">${messages.config.themeSystem}</option>
                </select>
              </div>
              <div class="field-row">
                <label for="locale-select">${messages.config.language}</label>
                <select id="locale-select">
                  <option value="en">${messages.config.languageEn}</option>
                  <option value="fr">${messages.config.languageFr}</option>
                </select>
              </div>
              <div class="field-row">
                <span class="brand-sub">${messages.config.resetHint}</span>
                <button type="button" class="btn" id="btn-reset">${messages.config.reset}</button>
              </div>
            </div>
          </section>

          <div
            class="panel-splitter"
            id="panel-splitter"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize panels"
            title="Drag to resize · double-click to reset"
          >
            <span class="panel-splitter-grip" aria-hidden="true"></span>
          </div>

          <section class="panel panel-flight" id="panel-flight" aria-label="${messages.panels.flight}">
            <div class="panel-header">
              ${iconActivity(16)}
              <span class="label">${messages.panels.flight}</span>
            </div>
            <div class="panel-body panel-body-flight">
              <div class="flight-hud-sticky">
                ${hudHtml(messages.hud.aria)}
              </div>
              <div class="flight-tele-scroll">
                ${telemetryPanelHtml(messages)}
              </div>
            </div>
          </section>

          <div class="panels-empty" id="panels-empty" hidden>
            <p>${messages.panels.allHiddenTitle}</p>
            <p class="brand-sub">${messages.panels.allHiddenHint}</p>
          </div>
        </div>
      </main>

      <footer class="statusbar">
        <span class="save-status" id="save-status" data-status="Saved">${messages.save.saved}</span>
        <span class="brand-sub" id="bridge-footer">${messages.bridge.idleFooter}</span>
      </footer>
    `
  }

  buildShell()

  let layout = root.querySelector('#layout') as HTMLElement
  let panelsEmpty = root.querySelector('#panels-empty') as HTMLElement
  let panelConfig = root.querySelector('#panel-config') as HTMLElement
  let panelSplitter = root.querySelector('#panel-splitter') as HTMLElement
  let effectList = root.querySelector('#effect-list') as HTMLElement
  let themeSelect = root.querySelector('#theme-select') as HTMLSelectElement
  let localeSelect = root.querySelector('#locale-select') as HTMLSelectElement
  let saveStatusEl = root.querySelector('#save-status') as HTMLElement
  let resetBtn = root.querySelector('#btn-reset') as HTMLButtonElement
  let engineBtn = root.querySelector('#btn-engine') as HTMLButtonElement
  let simPill = root.querySelector('#sim-pill') as HTMLElement
  let simLabel = root.querySelector('#sim-label') as HTMLElement
  let bridgeFooter = root.querySelector('#bridge-footer') as HTMLElement
  let btnMin = root.querySelector('#btn-win-min') as HTMLButtonElement
  let btnMax = root.querySelector('#btn-win-max') as HTMLButtonElement
  let btnClose = root.querySelector('#btn-win-close') as HTMLButtonElement
  let tabs = Array.from(root.querySelectorAll<HTMLButtonElement>('.tab'))
  let collapseBtns = Array.from(root.querySelectorAll<HTMLButtonElement>('.panel-rail-btn'))
  let tele = bindTelemetryPanel(root)
  let hud = bindHud(root)

  let targetTelemetry: TelemetrySnapshot | null = bridge?.getTelemetry() ?? null
  let smoothControls = createSmoothControls()
  let smoothFlight = createSmoothFlight()
  let eventSession = 0
  let lastAircraftKey = ''
  let raf = 0
  let maximized = false
  let lastSaveStatus: SaveStatus = controller.getSaveStatus()
  let splitterDragging = false
  const DEFAULT_CONFIG_WIDTH = 360

  function persistCollapsed(): void {
    try {
      localStorage.setItem(PANEL_COLLAPSE_KEY, JSON.stringify(collapsed))
    } catch {
      /* ignore */
    }
  }

  function applyConfigWidth(widthPx: number): void {
    const w = Math.min(520, Math.max(240, Math.round(widthPx)))
    panelConfig.style.flex = `0 0 ${w}px`
    panelConfig.style.maxWidth = `${w}px`
    panelConfig.style.width = `${w}px`
  }

  function syncPanelCollapse(): void {
    layout = root.querySelector('#layout') as HTMLElement
    panelsEmpty = root.querySelector('#panels-empty') as HTMLElement
    panelConfig = root.querySelector('#panel-config') as HTMLElement
    panelSplitter = root.querySelector('#panel-splitter') as HTMLElement
    collapseBtns = Array.from(root.querySelectorAll<HTMLButtonElement>('.panel-rail-btn'))

    layout.dataset.configCollapsed = collapsed.config ? 'true' : 'false'
    layout.dataset.flightCollapsed = collapsed.flight ? 'true' : 'false'

    const allHidden = collapsed.config && collapsed.flight
    layout.dataset.allCollapsed = allHidden ? 'true' : 'false'
    if (panelsEmpty) panelsEmpty.hidden = !allHidden

    // Hide splitter when either panel is collapsed (nothing to resize).
    const splitterHidden = collapsed.config || collapsed.flight
    if (panelSplitter) {
      panelSplitter.hidden = splitterHidden
      panelSplitter.setAttribute('aria-hidden', splitterHidden ? 'true' : 'false')
    }

    if (collapsed.config && panelConfig) {
      panelConfig.style.flex = ''
      panelConfig.style.maxWidth = ''
      panelConfig.style.width = ''
    } else if (collapsed.flight && panelConfig) {
      // Config takes remaining space when Flight is hidden.
      panelConfig.style.flex = '1 1 auto'
      panelConfig.style.maxWidth = 'none'
      panelConfig.style.width = 'auto'
    } else if (panelConfig) {
      applyConfigWidth(prefs.appearance.configPanelWidthPx || DEFAULT_CONFIG_WIDTH)
    }

    for (const btn of collapseBtns) {
      const id = btn.dataset.panel as PanelId
      const isCollapsed = collapsed[id]
      const glyph = btn.querySelector('[data-glyph]')
      if (glyph) glyph.textContent = panelToggleGlyph(isCollapsed)
      btn.setAttribute('aria-pressed', isCollapsed ? 'true' : 'false')
      btn.classList.toggle('is-collapsed', isCollapsed)
      const label = id === 'config' ? messages.panels.config : messages.panels.flight
      btn.title = `${isCollapsed ? messages.panels.show : messages.panels.hide} ${label}`
    }
    persistCollapsed()
  }

  function hidHint(key: EffectKey, intensity: number): string {
    return key === 'master'
      ? messages.config.masterHint
      : formatMessage(messages.config.ceilingHint, { n: Math.round((intensity / 100) * 255) })
  }

  function renderEffects(current: LauncherPreferences): void {
    const profile = current.profiles[current.activeProfile]
    effectList.innerHTML = EFFECT_KEYS.map((key) => {
      const effect = profile[key]
      const name = messages.effects[key]
      return `
        <div class="effect-card" data-effect="${key}">
          <div class="effect-row">
            <span class="effect-name">${name}</span>
            <div class="effect-controls">
              <span class="effect-pct" title="${hidHint(key, effect.intensity)}">${Math.round(effect.intensity)}%</span>
              <label class="switch" title="${messages.config.enableEffect} ${name}">
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
    localeSelect.value = current.appearance.locale
    tele.reverseStick.checked = current.appearance.reverseStickY
    if (!collapsed.config && !collapsed.flight) {
      applyConfigWidth(current.appearance.configPanelWidthPx || DEFAULT_CONFIG_WIDTH)
    }
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
    lastSaveStatus = status
    saveStatusEl.textContent = saveStatusLabel(status, messages)
    saveStatusEl.dataset.status = status
  }

  function syncSimPillFromTelemetry(snap: TelemetrySnapshot | null, bridgeState: BridgeRuntimeState): void {
    const sim = snap?.connection.simconnect
    if (sim === 'connected') {
      simPill.dataset.state = 'online'
      simLabel.textContent = `${messages.sim.connected.replace('Connected', bridgeState.simApplicationName || 'Connected').replace('Connecté', bridgeState.simApplicationName || 'Connecté')}`
      if (bridgeState.simApplicationName) {
        simLabel.textContent = `SimConnect · ${bridgeState.simApplicationName}`
      } else {
        simLabel.textContent = messages.sim.connected
      }
      return
    }
    if (sim === 'connecting' || (bridgeState.running && !bridgeState.simConnected)) {
      simPill.dataset.state = 'connecting'
      simLabel.textContent = messages.sim.connecting
      return
    }
    if (sim === 'error' || snap?.stale) {
      simPill.dataset.state = 'error'
      simLabel.textContent = messages.sim.error
      return
    }
    simPill.dataset.state = 'offline'
    simLabel.textContent = messages.sim.disconnected
  }

  function syncBridgeUi(state: BridgeRuntimeState): void {
    const running = state.status === 'running' || state.status === 'starting'
    engineBtn.textContent = running ? messages.bridge.stop : messages.bridge.start
    engineBtn.disabled = !bridge?.isAvailable() || state.status === 'starting' || state.status === 'stopping'
    syncSimPillFromTelemetry(targetTelemetry, state)
    bridgeFooter.textContent = running ? messages.bridge.runningFooter : messages.bridge.idleFooter
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
    renderTelemetryCards(tele, snap, messages)
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
      renderControls(
        tele,
        smoothControls,
        engineCount || target.aircraft.engineCount,
        prefs.appearance.reverseStickY,
      )
      const active = target.connection.simconnect === 'connected'
      drawHud(hud, smoothFlight, active, Boolean(target.stale), messages)
    } else {
      drawHud(hud, smoothFlight, false, false, messages)
    }
    raf = requestAnimationFrame(tick)
  }

  async function syncMaximizedState(): Promise<void> {
    if (!isTauri) return
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      maximized = await getCurrentWindow().isMaximized()
      btnMax.innerHTML = maximized ? iconRestore() : iconMaximize()
      btnMax.title = maximized ? messages.window.restore : messages.window.maximize
      btnMax.setAttribute('aria-label', maximized ? messages.window.restore : messages.window.maximize)
      root.classList.toggle('is-maximized', maximized)
    } catch {
      /* preview */
    }
  }

  function wireDom(): void {
    layout = root.querySelector('#layout') as HTMLElement
    panelsEmpty = root.querySelector('#panels-empty') as HTMLElement
    panelConfig = root.querySelector('#panel-config') as HTMLElement
    panelSplitter = root.querySelector('#panel-splitter') as HTMLElement
    effectList = root.querySelector('#effect-list') as HTMLElement
    themeSelect = root.querySelector('#theme-select') as HTMLSelectElement
    localeSelect = root.querySelector('#locale-select') as HTMLSelectElement
    saveStatusEl = root.querySelector('#save-status') as HTMLElement
    resetBtn = root.querySelector('#btn-reset') as HTMLButtonElement
    engineBtn = root.querySelector('#btn-engine') as HTMLButtonElement
    simPill = root.querySelector('#sim-pill') as HTMLElement
    simLabel = root.querySelector('#sim-label') as HTMLElement
    bridgeFooter = root.querySelector('#bridge-footer') as HTMLElement
    btnMin = root.querySelector('#btn-win-min') as HTMLButtonElement
    btnMax = root.querySelector('#btn-win-max') as HTMLButtonElement
    btnClose = root.querySelector('#btn-win-close') as HTMLButtonElement
    tabs = Array.from(root.querySelectorAll<HTMLButtonElement>('.tab'))
    collapseBtns = Array.from(root.querySelectorAll<HTMLButtonElement>('.panel-rail-btn'))
    tele = bindTelemetryPanel(root)
    hud = bindHud(root)

    for (const btn of collapseBtns) {
      btn.addEventListener('click', () => {
        const id = btn.dataset.panel as PanelId
        collapsed = { ...collapsed, [id]: !collapsed[id] }
        syncPanelCollapse()
      })
    }

    // Horizontal panel splitter
    panelSplitter.addEventListener('pointerdown', (event) => {
      if (collapsed.config || collapsed.flight) return
      event.preventDefault()
      splitterDragging = true
      panelSplitter.classList.add('is-dragging')
      panelSplitter.setPointerCapture(event.pointerId)
      const startX = event.clientX
      const startW = panelConfig.getBoundingClientRect().width

      const onMove = (ev: PointerEvent) => {
        if (!splitterDragging) return
        applyConfigWidth(startW + (ev.clientX - startX))
      }
      const onUp = (ev: PointerEvent) => {
        if (!splitterDragging) return
        splitterDragging = false
        panelSplitter.classList.remove('is-dragging')
        try {
          panelSplitter.releasePointerCapture(ev.pointerId)
        } catch {
          /* ignore */
        }
        panelSplitter.removeEventListener('pointermove', onMove)
        panelSplitter.removeEventListener('pointerup', onUp)
        panelSplitter.removeEventListener('pointercancel', onUp)
        const width = Math.round(panelConfig.getBoundingClientRect().width)
        controller.updatePreferences((current) => ({
          ...current,
          appearance: {
            ...current.appearance,
            configPanelWidthPx: Math.min(520, Math.max(240, width)),
          },
        }))
      }
      panelSplitter.addEventListener('pointermove', onMove)
      panelSplitter.addEventListener('pointerup', onUp)
      panelSplitter.addEventListener('pointercancel', onUp)
    })

    panelSplitter.addEventListener('dblclick', () => {
      applyConfigWidth(DEFAULT_CONFIG_WIDTH)
      controller.updatePreferences((current) => ({
        ...current,
        appearance: {
          ...current.appearance,
          configPanelWidthPx: DEFAULT_CONFIG_WIDTH,
        },
      }))
    })

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

    localeSelect.addEventListener('change', () => {
      const locale = localeSelect.value as LocaleCode
      controller.updatePreferences((current) => ({
        ...current,
        appearance: { ...current.appearance, locale },
      }))
    })

    resetBtn.addEventListener('click', () => {
      void controller.resetPreferences()
    })

    tele.reverseStick.addEventListener('change', () => {
      const reverseStickY = tele.reverseStick.checked
      controller.updatePreferences((current) => ({
        ...current,
        appearance: { ...current.appearance, reverseStickY },
      }))
    })

    effectList.addEventListener('pointerdown', (event) => {
      const target = event.target as HTMLElement
      if (target.dataset?.role === 'intensity') sliderPointerDown = true
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
        bridgeFooter.textContent = `${messages.bridge.errorPrefix} ${err instanceof Error ? err.message : String(err)}`
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
  }

  function applyLocale(locale: LocaleCode): void {
    messages = getMessages(locale)
    document.documentElement.lang = locale
    const prevCollapsed = { ...collapsed }
    const prevTele = targetTelemetry
    cancelAnimationFrame(raf)
    buildShell()
    wireDom()
    collapsed = prevCollapsed
    syncPanelCollapse()
    syncChrome(prefs, true)
    setSaveStatus(lastSaveStatus)
    if (prevTele) {
      targetTelemetry = prevTele
      renderTelemetryCards(tele, prevTele, messages)
    }
    if (bridge) syncBridgeUi(bridge.getState())
    raf = requestAnimationFrame(tick)
  }

  wireDom()
  syncPanelCollapse()
  syncChrome(prefs)
  setSaveStatus(controller.getSaveStatus())
  document.documentElement.lang = prefs.appearance.locale
  if (targetTelemetry) {
    engineCount = targetTelemetry.aircraft.engineCount
    renderTelemetryCards(tele, targetTelemetry, messages)
  }

  window.addEventListener('pointerup', () => {
    if (!sliderPointerDown) return
    sliderPointerDown = false
    syncChrome(controller.getPreferences(), true)
  })
  window.addEventListener('pointercancel', () => {
    sliderPointerDown = false
  })

  controller.subscribe((next) => {
    const localeChanged = next.appearance.locale !== prefs.appearance.locale
    prefs = next
    if (localeChanged) {
      applyLocale(next.appearance.locale)
    } else {
      syncChrome(next, !sliderPointerDown)
    }
    if (bridge?.isAvailable()) {
      void bridge.updatePreferences(next).catch((err) => {
        console.error('[launcher] bridge updatePreferences failed:', err)
      })
    }
  })
  controller.subscribeStatus(setSaveStatus)

  const unsubs: Array<() => void> = []
  if (bridge) {
    unsubs.push(bridge.onState(syncBridgeUi))
    unsubs.push(bridge.onTelemetry(onTelemetry))
    unsubs.push(bridge.onFlightEvent((event) => {
      appendFlightEvent(tele.timeline, event, eventSession, messages)
    }))
    unsubs.push(bridge.onError((message) => {
      bridgeFooter.textContent = `${messages.bridge.errorPrefix} ${message}`
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
