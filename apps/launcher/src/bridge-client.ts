/**
 * Frontend façade over the packaged bridge-host sidecar.
 * The webview never touches SimConnect, HID, or timers.
 */

import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { LauncherPreferences } from './preferences/types'
import {
  asFlightEvent,
  asTelemetrySnapshot,
  createEmptyTelemetry,
  type FlightEvent,
  type TelemetrySnapshot,
} from './telemetry/types'

export type BridgeRuntimeState = {
  status: 'stopped' | 'starting' | 'running' | 'stopping'
  running: boolean
  simConnected: boolean
  simApplicationName: string | null
  hidOpenCount: number
  version?: string
}

function asBridgeState(value: unknown): BridgeRuntimeState | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const status = raw.status
  if (
    status !== 'stopped' &&
    status !== 'starting' &&
    status !== 'running' &&
    status !== 'stopping'
  ) {
    return null
  }
  return {
    status,
    running: Boolean(raw.running),
    simConnected: Boolean(raw.simConnected),
    simApplicationName:
      typeof raw.simApplicationName === 'string' ? raw.simApplicationName : null,
    hidOpenCount: Number(raw.hidOpenCount || 0),
    version: typeof raw.version === 'string' ? raw.version : undefined,
  }
}

export type BridgeEvent =
  | { event: 'ready' | 'state' | 'started' | 'stopped'; state: BridgeRuntimeState }
  | { event: 'preferencesUpdated'; preferences: LauncherPreferences; state: BridgeRuntimeState }
  | { event: 'telemetry'; payload: TelemetrySnapshot }
  | { event: 'event'; payload: FlightEvent }
  | { event: 'log'; level: string; message: string }
  | { event: 'error'; message: string }
  | { event: 'pong' | 'shutdownComplete' }
  | { event: string; [key: string]: unknown }

type StateListener = (state: BridgeRuntimeState) => void
type ErrorListener = (message: string) => void
type TelemetryListener = (telemetry: TelemetrySnapshot) => void
type FlightEventListener = (event: FlightEvent) => void

const DEFAULT_STATE: BridgeRuntimeState = {
  status: 'stopped',
  running: false,
  simConnected: false,
  simApplicationName: null,
  hidOpenCount: 0,
}

export class LauncherBridgeClient {
  private state: BridgeRuntimeState = { ...DEFAULT_STATE }
  private telemetry: TelemetrySnapshot = createEmptyTelemetry()
  private unlisten: UnlistenFn | null = null
  private readonly stateListeners = new Set<StateListener>()
  private readonly errorListeners = new Set<ErrorListener>()
  private readonly telemetryListeners = new Set<TelemetryListener>()
  private readonly flightEventListeners = new Set<FlightEventListener>()
  private available = false

  isAvailable(): boolean {
    return this.available
  }

  getState(): BridgeRuntimeState {
    return { ...this.state }
  }

  getTelemetry(): TelemetrySnapshot {
    return structuredClone(this.telemetry)
  }

  onState(listener: StateListener): () => void {
    this.stateListeners.add(listener)
    listener(this.getState())
    return () => this.stateListeners.delete(listener)
  }

  onTelemetry(listener: TelemetryListener): () => void {
    this.telemetryListeners.add(listener)
    listener(this.getTelemetry())
    return () => this.telemetryListeners.delete(listener)
  }

  onFlightEvent(listener: FlightEventListener): () => void {
    this.flightEventListeners.add(listener)
    return () => this.flightEventListeners.delete(listener)
  }

  onError(listener: ErrorListener): () => void {
    this.errorListeners.add(listener)
    return () => this.errorListeners.delete(listener)
  }

  async connect(): Promise<void> {
    if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
      this.available = false
      return
    }
    if (this.unlisten) {
      this.unlisten()
      this.unlisten = null
    }
    this.available = true
    this.unlisten = await listen<BridgeEvent>('bridge://event', (event) => {
      this.handleEvent(event.payload)
    })
    await invoke('bridge_ensure')
    await invoke('bridge_get_state')
    try {
      const cached = await invoke<unknown>('bridge_get_telemetry')
      const snap = asTelemetrySnapshot(cached)
      if (snap) this.setTelemetry(snap)
    } catch {
      /* optional on first boot */
    }
  }

  async start(preferences: LauncherPreferences): Promise<void> {
    this.assertAvailable()
    await invoke('bridge_start', { preferences })
  }

  async stop(): Promise<void> {
    this.assertAvailable()
    await invoke('bridge_stop')
  }

  async updatePreferences(preferences: LauncherPreferences): Promise<void> {
    this.assertAvailable()
    if (!this.state.running && this.state.status === 'stopped') return
    await invoke('bridge_update_preferences', { preferences })
  }

  async dispose(): Promise<void> {
    if (this.unlisten) {
      this.unlisten()
      this.unlisten = null
    }
    this.stateListeners.clear()
    this.telemetryListeners.clear()
    this.flightEventListeners.clear()
    this.errorListeners.clear()
    if (!this.available) return

    // Stop vibration loop first (no-op if host already down), then kill sidecar.
    try {
      await invoke('bridge_stop')
    } catch {
      /* host may already be gone */
    }
    try {
      await invoke('bridge_shutdown')
    } catch {
      /* ignore on shutdown */
    }
  }

  private assertAvailable(): void {
    if (!this.available) {
      throw new Error('Bridge runtime is only available inside the Tauri launcher')
    }
  }

  private setTelemetry(next: TelemetrySnapshot): void {
    this.telemetry = next
    for (const listener of this.telemetryListeners) listener(this.getTelemetry())
  }

  private handleEvent(payload: BridgeEvent): void {
    if (payload.event === 'error') {
      const message = String((payload as { message?: string }).message || 'bridge error')
      for (const listener of this.errorListeners) listener(message)
      if (this.telemetry.connection.simconnect === 'connected') {
        this.setTelemetry({
          ...this.telemetry,
          stale: true,
          connection: {
            ...this.telemetry.connection,
            simconnect: 'error',
          },
        })
      }
      return
    }

    if (payload.event === 'telemetry') {
      const snap = asTelemetrySnapshot((payload as { payload?: unknown }).payload)
      if (snap) this.setTelemetry(snap)
      return
    }

    if (payload.event === 'event') {
      const flightEvent = asFlightEvent((payload as { payload?: unknown }).payload)
      if (flightEvent) {
        for (const listener of this.flightEventListeners) listener(flightEvent)
      }
      return
    }

    if ('state' in payload) {
      const next = asBridgeState(payload.state)
      if (!next) return
      this.state = next
      for (const listener of this.stateListeners) listener(this.getState())
    }
  }
}
