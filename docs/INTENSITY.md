# Vibration intensity model

UI intensity sliders are **hardware ceilings** on the WinWing HID motor byte (`0..255`, 256 levels, never emit `256`).

## Mapping

| Slider | Meaning |
|--------|---------|
| 0% | HID `0` |
| 50% | HID ≈ `128` |
| 100% | HID `255` when the effect’s dynamic factor is `1` |

## Formula

```text
effectOutput = dynamicFactor × (effectSlider / 100) × 255
finalOutput  = clamp(sum(activeEffects) × (master / 100), 0, 255)
```

- `dynamicFactor` ∈ `[0, 1]` — trigger conditions + curve shape (unchanged per effect family).
- Effect slider — ceiling for that effect only.
- **Master** — global multiplier applied last.
- Output stored/sent as HID bytes (no second `0..100 → 0..255` conversion).

## Defaults

Aircraft defaults are mostly 100% ceilings. Helicopter defaults reduce some ceilings (engine 90%, gear 70%, stall 80%, ground roll 60%) and disable afterburner / flaps / transonic.

## Pipeline

```text
Launcher sliders → preferences JSON → bridge-host → computeMotorIntensities → intensityToHidByte (clamp) → HID packet
```

CLI uses the same `createBridge()` / `computeMotorIntensities()` path with bridge preference defaults.
