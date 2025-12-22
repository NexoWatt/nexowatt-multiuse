# Changelog

## 0.0.31 (2025-12-22)

* (MU7.1) Multi-Use Orchestrator Start: Multi-Use module is no longer stub. Reads configured consumers, exposes per-consumer targetW/targetA states, applies setpoints deterministically via applySetpoint(), and publishes applied/status/reason.
* (MU7.1) Admin: Multi-Use consumers table added (type, priority, control basis, DP-keys, default targets).

## 0.0.30 (2025-12-22)

* (MU6.13) Admin UI: added safety fields for Peak Shaving (staleTimeoutSec, safetyMarginW, fastTrip*) and Charging Management (staleTimeoutSec, pauseBehavior, ramp/step); updated i18n.

## 0.0.29 (2025-12-22)

* (MU6.12) PeakShaving + ChargingManagement: Standardize reason codes (UPPER_SNAKE_CASE) for deterministic diagnostics.
* (MU6.12) ChargingManagement: Fix failsafe applySetpoint in stale/pause paths (write 0 setpoints instead of referencing undefined vars).

## 0.0.28 (2025-12-22)

* (MU6.11) ChargingManagement: Ramp limiting + step setpoints (ramp-up only; ramp-down remains immediate for safety)

## 0.0.27 (2025-12-22)

* (MU6.10) ChargingManagement: Safe pause behavior when PeakShaving is active (pauseBehavior=rampDownToZero|followPeakBudget). No freeze of last setpoints.

## 0.0.26 (2025-12-22)

* (MU6.9) PeakShaving: add safetyMarginW headroom and fast-trip activation path (raw/max) to react to spikes while keeping smoothing for steady-state.

## 0.0.25 (2025-12-22)

* (MU6.8) ChargingManagement: Add stale-meter/budget failsafe using DatapointRegistry staleness (force safe targets=0, reason=stale_meter, status=failsafe_stale_meter)

## 0.0.24 (2025-12-22)

* (MU6.7) PeakShaving: stale meter failsafe (Reason: STALE_METER) using DatapointRegistry isStale/getAgeMs

## 0.0.23 (2025-12-22)

* (MU6.6) DatapointRegistry: add stale/fresh API (getAgeMs/isStale/getNumberFresh) for safe failsafe handling.

## 0.0.22 (2025-12-19)

* (MU6.5) Admin UI: add i18n translation files (de/en) so JSONConfig labels are translated (German instance settings).

## 0.0.21 (2025-12-19)

* (MU6.4) Fix admin JSONConfig tables: convert table column definitions to array format expected by ioBroker Admin.
* (MU6.3) Provide `admin/jsonConfig.json` and align admin UI config.
* (MU6.2) Add diagnostics rate limiting to reduce log spam and GUI load.
* (MU6.1) Add optional diagnostics logging (states + debug logs).

## 0.0.20 (2025-12-19)
- MU6.3: Fixed Admin JSON config filename (added admin/jsonConfig.json) so instance settings are visible.

## 0.0.19 (2025-12-19)
- MU6.2: Diagnostics rate limiting (log/state intervals), always-on-error behavior and reduced log flooding.

## 0.0.18 (2025-12-19)
- MU6.1: Added diagnostics logging (per-module tick timings, summary, and optional diagnostics states).
- Added diagnostics settings in Admin (enable, write states, log level).

## 0.0.17 (2025-12-19)
- MU5.1: Release packaging finalized (README/Changelog/io-package news), version alignment.

## 0.0.16 (2025-12-19)
- MU4.2: Added consumer abstraction (`applySetpoint`) for EVCS (wallboxes) and refactored charging management actuation to use it.
- Added per-wallbox `applyStatus` state for actuation transparency.

## 0.0.15 (2025-12-19)
- Charging management: budget engine mode integrating static/external caps, peak shaving, PV surplus and optional tariff cap.

## 0.0.14 (2025-12-19)
- Charging management: transparency states (`chargingRaw`, `lastActive`, `idleMs`, `allocationRank`) and debug outputs (sorted order + allocation JSON).

## 0.0.13 (2025-12-19)
- Charging management: stickiness/session tracking (stop grace + session keep) to prevent flapping and preserve arrival order on short dips.

## 0.0.12 (2025-12-19)
- Charging management: deterministic wallbox ordering (`charging` → `chargingSinceMs` → `priority`/fallback) and correct charging flags in allocation list.

## 0.0.11 (2025-12-19)
- Charging management: arrival tracking (`chargingSinceMs`) and new charging-related states.
- Added configuration for activity threshold and optional min power.

## 0.0.10 (2025-12-19)
- Peak shaving: measurement & smoothing (grid power + optional phase currents).
- Added adapter states under `peakShaving.*` for measurement and calculated averages.

## 0.0.9 (2025-12-19)
- Admin: improvements and extended configuration options for charging management and peak shaving.

## 0.0.7 (2025-12-19)
- Core: universal datapoint registry (subscribe/cache/transform).
- Admin: global datapoints table.

## 0.0.1 (2025-12-19)
- Initial architecture skeleton.
