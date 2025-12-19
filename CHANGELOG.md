# Changelog

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
