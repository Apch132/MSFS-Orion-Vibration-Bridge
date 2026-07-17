# Telemetry model

Versioned SimConnect snapshot published by the shared bridge host to the Tauri launcher.

## Architecture

```text
MSFS SimConnect
  → createBridge()  (SIM_FRAME acquisition + 50 Hz HID)
       → normalize + rate-limit (≤15 Hz)
       → host.js stdout  { type: "telemetry" | "event" }
            → bridge_host.rs  (cache + Tauri emit)
                 → bridge-client.ts
                      → Telemetry cards / Controls / HUD
```

The vibration motor loop stays at 50 Hz and is not paced by UI telemetry.

## Frequency

| Path | Rate |
|------|------|
| SimConnect acquisition | `SIM_FRAME` |
| UI telemetry publish | ≤ 15 Hz, skip if unchanged |
| HUD / control render | ~60 FPS frontend interpolation |
| Lifecycle `state` events | immediate |

## Schema (`schemaVersion: 1`)

See `lib/bridge/telemetry.js` (`buildTelemetrySnapshot`) and `apps/launcher/src/telemetry/types.ts`.

Numeric fields are finite and bounded. Missing values use documented defaults (e.g. `gForce: 1`, empty aircraft title `""`).

## SimVars

### Float definition (id 1)

| SimVar | Unit | State key | UI use |
|--------|------|-----------|--------|
| GEAR TOTAL PCT EXTENDED | percent | gearPct | gear + vibration |
| AIRSPEED TRUE | knots | airspeedKnots | TAS + vibration |
| AIRSPEED INDICATED | knots | indicatedAirspeedKnots | IAS / HUD |
| AIRSPEED MACH | mach | mach | Mach / events |
| GROUND VELOCITY | knots | groundSpeedKnots | ground speed |
| PLANE ALTITUDE | feet | altitudeFt | altitude / HUD |
| VERTICAL SPEED | feet per minute | vertSpeedFpm | VS |
| PLANE HEADING DEGREES MAGNETIC | degrees | headingDeg | heading / HUD |
| PLANE PITCH DEGREES | degrees | pitchDeg | HUD |
| PLANE BANK DEGREES | degrees | bankDeg | HUD |
| G FORCE | GForce | gForce | G / HUD / vibration |
| INCIDENCE ALPHA | degrees | aoa | FPM / vibration |
| INCIDENCE BETA | degrees | sideslipDeg | FPM |
| SIM ON GROUND | bool | onGround | phase / events |
| GEAR LEFT/RIGHT/CENTER POSITION | percent | gear*Pct | vibration |
| TRAILING EDGE FLAPS LEFT PERCENT | percent | flapsLeftPct | flaps |
| SPOILERS HANDLE POSITION | percent | speedbrakePct | spoilers |
| STALL WARNING | bool | stallWarning | state |
| OVERSPEED WARNING | bool | overspeedWarning | state |
| AILERON POSITION | position | aileronInput | stick X |
| ELEVATOR POSITION | position | elevatorInput | stick Y |
| RUDDER POSITION | position | rudderInput | rudder |
| GENERAL ENG THROTTLE LEVER POSITION:1/2 | position | throttle1/2 | throttles |
| BRAKE LEFT/RIGHT POSITION | position | brakeLeft/Right | brakes |
| GENERAL ENG RPM:1–4 | rpm | engineRpm* | engines / vibration |
| TURB ENG N1:1–4 | percent | engN1_* | engines |
| TURB ENG N2:1–4 | percent | engN2_* | engines |
| GENERAL ENG COMBUSTION:1–4 | bool | engCombustion* | engines |
| TURB ENG AFTERBURNER PCT ACTIVE:1–2 | percent | afterburnerPct* | AB |
| ENGINE TYPE | number | engineType | type / helo |
| NUMBER OF ENGINES | number | numberOfEngines | count |
| ROTOR RPM PCT:1 | percent | rotorRpmPct | vibration |
| APU PCT RPM | percent | apuPctRpm | vibration |

### String definition (id 2)

| SimVar | Type | State key |
|--------|------|-----------|
| TITLE | STRING256 | title |
| CATEGORY | STRING256 | category |
| ATC TYPE | STRING32 | atcType |

Helicopter detection: `CATEGORY` matches `/heli/i` **or** `ENGINE TYPE === 3`.

Afterburner: approximate via `TURB ENG AFTERBURNER PCT ACTIVE` when the aircraft exposes it.

## Flight events

Emitted only on transitions (bridge-side), with ~2.5 s per-kind cooldown:

| Kind | Transition |
|------|------------|
| `takeoff` | ground → airborne with speed ≥ 25 kts |
| `touchdown` | airborne → ground |
| `gear_up` | gear extended → retracted while airborne |
| `landing` | gear retracted → extended while airborne |
| `flaps_retracted` | flaps > 10% → < 5% |
| `mach_1` | Mach crosses 1.0 upward |

Aircraft title/category/engine-count changes reset transition memory (no polluted timeline).

## Protocol

```json
{ "protocolVersion": 1, "type": "telemetry", "payload": { /* snapshot */ } }
{ "protocolVersion": 1, "type": "event", "payload": { "kind": "takeoff", "timestamp": 0 } }
```

Command `getTelemetry` returns the latest snapshot.

## HUD notes

- Horizon from pitch + bank.
- Pitch ladder display bounded about ±40°.
- Heading interpolated with wrap-around (no 359→0 jump).
- Flight path marker uses AoA + sideslip when meaningful; otherwise boresight (no invented wind).

## Without MSFS / HID

- Launcher remains usable; SimConnect shows Disconnected / Connecting.
- Missing WinWing HID does not block telemetry.
- Sidecar crash marks the last snapshot `stale` and SimConnect `error`.
