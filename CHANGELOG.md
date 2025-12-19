## 0.0.10 (2025-12-19)
- Step 2.2.1: Mixed AC/DC operation (chargerType + controlBasis) with watt-based budget distribution and DC fast-chargers support
- Admin: wallbox table extended with chargerType/controlBasis and min/max power limits (W)

## 0.0.9 (2025-12-19)
- Step 2.2: Priority distribution for charging management (wallbox targets by priority, min/max, phases)
- Charging Management: total budget modes (unlimited/static/from Peak Shaving/from datapoint) and optional pause when Peak Shaving is active
- Core runtime: repaired and finalized adapter runtime files (main/module manager/datapoint registry/modules) to ensure a runnable baseline

## 0.0.8 (2025-12-19)
- Step 2.1: Charging Management wallbox table model (manufacturer-independent mapping)
- Create chargingManagement states per wallbox and basic measurement aggregation

## 0.0.6 (Step 1.4) - Phase Logic (physically correct)

## 0.0.7 (Step 1.5 – Actuator table + priority control)

- Peak Shaving: added actuator table (controlled loads / wallboxes) with priority-based reduction strategy
- Peak Shaving: optional actuation (apply computed reductions to configured setpoints)
- Datapoints: added writeValue() with inverse transform for numeric datapoints
- Peak Shaving: fixed stray '(optional)' line causing syntax error


- Peak Shaving: implemented **phase-aware** logic using L1/L2/L3 currents:
  - configurable **phase decision mode** (off/info/enforce)
  - configurable **phase hysteresis (A)** and **voltage (V)** for reduction estimation
  - phase limit can **activate** peak shaving even without a power limit (when enforced and phase data is available)
- Added new control diagnostics: reason, requiredReductionA, phase-based reduction estimates (1p/3p).

## 0.0.5 (Step 1.3) - Dynamic Peak Shaving

- Implemented **dynamic** peak-shaving mode:
  - Optional external limit datapoint (allowed max power)
  - Reserve (headroom) subtraction
  - Optional base-load/PV/battery inputs to calculate `availableForControlledW` for downstream control modules
- Improved datapoint `upsert()` to preserve transformation settings when a key already exists (scale/offset/invert/min/max).

## 0.0.4 (2025-12-19)

- Peak Shaving: add static decision logic (limit/hysteresis/delays) and control states.
- Admin: extend Peak Shaving settings (hysteresis, delays, decision average).
## 0.0.3 (Step 1.1) - 2025-12-18

- Implemented runnable adapter core (scheduler, module manager)
- Implemented universal datapoint registry (subscribe/cache/transform)
- Implemented Peak Shaving measurement & smoothing (grid power + optional phase currents)
- Added adapter states under peakShaving.* for measurement and calculated averages
- Admin: added optional phase current IDs for peak shaving

# Changelog

## 0.0.2 (Step 0.2)
- Added universal datapoint registry (manufacturer-independent mapping)
- Added admin table for global datapoints
- Wired registry into module manager and state change caching

## 0.0.1 (Step 0.1)
- Initial architecture skeleton