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
import { iconActivity, iconGauge, iconPlane, iconRadio, iconSliders } from './icons'

function resolveTheme(theme: ThemePreference): Exclude<ThemePreference, 'system'> {
  if (theme !== 'system') return theme
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

function applyTheme(theme: ThemePreference): void {
  document.documentElement.setAttribute('data-theme', resolveTheme(theme))
}

export type MountAppOptions = {
  bridge?: LauncherBridgeClient | null
}

export async function mountApp(
  root: HTMLElement,
  controller: PreferencesController,
  options: MountAppOptions = {},
): Promise<void> {
  let prefs = controller.getPreferences()
  const bridge = options.bridge ?? null

  root.innerHTML = `
    <header class="topbar">
      <div class="brand">
        <div class="brand-mark" aria-hidden="true"></div>
        <div>
          <div>WinWing MSFS Vibration Bridge</div>
          <div class="brand-sub">Desktop launcher</div>
        </div>
      </div>
      <div class="sim-pill" id="sim-pill" data-state="offline" title="SimConnect status from the shared bridge runtime">
        ${iconRadio(14)}
        <span class="sim-dot" aria-hidden="true"></span>
        <span id="sim-label">SimConnect · Not connected</span>
      </div>
      <div class="actions">
        <button type="button" class="btn btn-primary" id="btn-engine" ${bridge?.isAvailable() ? '' : 'disabled'} title="${bridge?.isAvailable() ? 'Start or stop the shared vibration bridge' : 'Bridge runtime requires the Tauri desktop app'}">
          Start
        </button>
      </div>
    </header>

    <main class="layout">
      <section class="panel" aria-label="Configuration">
        <div class="panel-header">${iconSliders(16)}<span class="label">Configuration</span></div>
        <div class="panel-body">
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

      <section class="panel" aria-label="SimConnect Telemetry">
        <div class="panel-header">${iconActivity(16)}<span class="label">SimConnect Telemetry</span></div>
        <div class="panel-body">
          <div class="placeholder">
            <strong>Telemetry panel</strong>
            <span>Live SimVars will appear here in a later release. No simulated flight data is shown.</span>
            <code id="telemetry-status">Status: bridge idle</code>
          </div>
        </div>
      </section>

      <section class="panel" aria-label="Flight HUD">
        <div class="panel-header">${iconGauge(16)}<span class="label">Flight HUD</span></div>
        <div class="panel-body">
          <div class="placeholder">
            <strong>Flight HUD</strong>
            <span>Structured HUD layout reserved for a later task.</span>
            <code id="engine-status">${iconPlane(14)} Engine bridge: ${bridge?.isAvailable() ? 'ready' : 'unavailable in browser preview'}</code>
          </div>
        </div>
      </section>
    </main>

    <footer class="statusbar">
      <span class="save-status" id="save-status" data-status="Saved">Saved</span>
      <span class="brand-sub" id="bridge-footer">Preferences stored in the OS app data directory</span>
    </footer>
  `

  const effectList = root.querySelector('#effect-list') as HTMLElement
  const themeSelect = root.querySelector('#theme-select') as HTMLSelectElement
  const saveStatusEl = root.querySelector('#save-status') as HTMLElement
  const resetBtn = root.querySelector('#btn-reset') as HTMLButtonElement
  const engineBtn = root.querySelector('#btn-engine') as HTMLButtonElement
  const simPill = root.querySelector('#sim-pill') as HTMLElement
  const simLabel = root.querySelector('#sim-label') as HTMLElement
  const telemetryStatus = root.querySelector('#telemetry-status') as HTMLElement
  const engineStatus = root.querySelector('#engine-status') as HTMLElement
  const bridgeFooter = root.querySelector('#bridge-footer') as HTMLElement
  const tabs = Array.from(root.querySelectorAll<HTMLButtonElement>('.tab'))

  function renderEffects(current: LauncherPreferences): void {
    const profile = current.profiles[current.activeProfile]
    effectList.innerHTML = EFFECT_KEYS.map((key) => {
      const effect = profile[key]
      return `
        <div class="effect-card" data-effect="${key}">
          <div class="effect-row">
            <span class="effect-name">${EFFECT_LABELS[key]}</span>
            <div style="display:flex;align-items:center;gap:10px">
              <span class="effect-pct">${Math.round(effect.intensity)}%</span>
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
          />
        </div>
      `
    }).join('')
  }

  function syncChrome(current: LauncherPreferences): void {
    applyTheme(current.appearance.theme)
    themeSelect.value = current.appearance.theme
    for (const tab of tabs) {
      const selected = tab.dataset.profile === current.activeProfile
      tab.setAttribute('aria-selected', selected ? 'true' : 'false')
    }
    renderEffects(current)
  }

  function setSaveStatus(status: SaveStatus): void {
    saveStatusEl.textContent = status
    saveStatusEl.dataset.status = status
  }

  function syncBridgeUi(state: BridgeRuntimeState): void {
    const running = state.status === 'running' || state.status === 'starting'
    engineBtn.textContent = running ? 'Stop' : 'Start'
    engineBtn.disabled = !bridge?.isAvailable() || state.status === 'starting' || state.status === 'stopping'

    if (state.simConnected) {
      simPill.dataset.state = 'online'
      simLabel.textContent = `SimConnect · ${state.simApplicationName || 'Connected'}`
    } else {
      simPill.dataset.state = 'offline'
      simLabel.textContent = running ? 'SimConnect · Waiting…' : 'SimConnect · Not connected'
    }

    telemetryStatus.textContent = `Status: bridge ${state.status}` +
      (state.hidOpenCount ? ` · HID ${state.hidOpenCount}` : '')
    engineStatus.innerHTML = `${iconPlane(14)} Engine bridge: ${state.status}`
    bridgeFooter.textContent = running
      ? 'Bridge running — preference changes apply live'
      : 'Preferences stored in the OS app data directory'
  }

  syncChrome(prefs)
  setSaveStatus(controller.getSaveStatus())

  controller.subscribe((next) => {
    prefs = next
    syncChrome(next)
    if (bridge?.isAvailable()) {
      void bridge.updatePreferences(next).catch((err) => {
        console.error('[launcher] bridge updatePreferences failed:', err)
      })
    }
  })
  controller.subscribeStatus(setSaveStatus)

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

  effectList.addEventListener('input', (event) => {
    const target = event.target as HTMLInputElement
    if (target.dataset.role !== 'intensity') return
    const card = target.closest<HTMLElement>('[data-effect]')
    const key = card?.dataset.effect as EffectKey | undefined
    if (!key) return
    const intensity = Number(target.value)
    const pct = card?.querySelector('.effect-pct')
    if (pct) pct.textContent = `${Math.round(intensity)}%`

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
    const action = running
      ? bridge.stop()
      : bridge.start(controller.getPreferences())
    void action.catch((err) => {
      console.error('[launcher] bridge start/stop failed:', err)
      bridgeFooter.textContent = `Bridge error: ${err instanceof Error ? err.message : String(err)}`
    })
  })

  if (bridge) {
    bridge.onState(syncBridgeUi)
    bridge.onError((message) => {
      bridgeFooter.textContent = `Bridge error: ${message}`
    })
  }

  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (prefs.appearance.theme === 'system') applyTheme('system')
  })

  window.addEventListener('beforeunload', () => {
    void controller.flushPendingSave()
  })
}
