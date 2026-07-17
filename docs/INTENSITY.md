# Vibration intensity model

UI intensity sliders are **hardware ceilings** on the WinWing HID motor byte (`0..255`, 256 levels, never emit `256`).

They do **not** make an effect more frequent. The bridge engine still decides *when* and *how strongly* (as a 0..1 dynamic factor) an effect fires from SimConnect conditions.

## Mapping

| Slider | Meaning |
|--------|---------|
| 0% | HID `0` |
| 50% | HID ≈ `128` |
| 100% | HID `255` when the effect’s dynamic factor is `1` |

## Formula

```text
computeMotorIntensities()  →  dynamicFactor ∈ [0, 1]  (historical curve shape)
effectOutput = dynamicFactor × (effectSlider / 100) × 255
finalOutput  = clamp(sum(activeEffects) × (master / 100), 0, 255)
```

- Effect slider — ceiling for that effect only.
- **Master** — global multiplier applied last.
- Output stored/sent as HID bytes (no second `0..100 → 0..255` conversion).

## Default profiles (historical reconstruction)

Defaults are **not** all 100%. They map former feel-unit peaks so the stock Aircraft / Helicopter profiles feel like the pre-launcher bridge when Master is 100%.

| Effect | Historical constant (feel peak) | Dynamic range (factor) | Aircraft % | Helicopter % | Justification |
|--------|----------------------------------|-------------------------|------------|--------------|---------------|
| Master | pass-through | — | 100 | 100 | Final multiplier; leave open |
| Engine | piston ≤18 / jet ≤8 / helo VRS ≤40 | 0..1 after normalize | 18 | 40 | Piston peak 18; helo VRS peak 40 |
| Afterburner | `(AB%/100)×30` | 0..1 | 30 | 0 (off) | Peak 30 feel-units |
| Gear | move 25 / jet drag ≤35 | move 0.55; drag 0..1 | 35 | 45 | Jet drag 35; helo move ≈25/0.55 |
| Flaps | jet ≤15 / piston ≤22 | 0..1 | 18 | 0 (off) | Blend of jet/piston peaks |
| Stall | jet 70 / helo 25 | jet 1.0 / helo 0.45 | 70 | 56 | 70 feel; helo 25/0.45 |
| Touchdown | `min(100, sink/6)` → factor `sink/600` | 0..1 | 100 | 100 | Hard landing can use full ceiling |
| Ground roll | reserved | unused | 40 | 40 | UI reserved; not applied in compute yet |
| Transonic | gaussian ≤55 (+supersonic) | 0..1 | 55 | 0 (off) | Peak ~55 feel-units |

Reset Defaults in the launcher restores these values.

## Pipeline

```text
Launcher sliders → preferences JSON → bridge-host → computeMotorIntensities → intensityToHidByte (clamp) → HID packet
```

CLI uses the same `createBridge()` / `computeMotorIntensities()` path with bridge preference defaults.
