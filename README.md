# NexoWatt Multi-Use (ioBroker Adapter)

NexoWatt Multi-Use is a modular adapter foundation for:
- Peak shaving (static/dynamic, per-phase capable)
- EVCS / wallbox charging management (priorities, PV surplus, caps)
- Extension hooks for additional controllable loads (multi-use)

## Status
- Version: **0.0.17**
- Implemented: charging management ordering + stickiness, budget engine (PV surplus/peak cap/tariff), and EVCS actuation via consumer abstraction (`applySetpoint`).

## Configuration overview
### Global datapoints (optional, recommended)
Depending on your setup you can provide these global datapoints:
- `cm.pvSurplusW` (W): PV surplus budget (preferred if available)
- `cm.gridPowerW` or `ps.gridPowerW` (W): grid import/export for deriving PV surplus (negative = export)
- `cm.tariffBudgetW` (W): optional tariff-based budget cap

### Charging management (wallbox table)
Configure wallboxes in the Charging Management tab:
- Actual power/current (read)
- Optional per-phase currents (read)
- Setpoint datapoints for current/power limits (write)
- Optional enable datapoints

The adapter exposes diagnostic states under:
- `chargingManagement.wallboxes.<key>.*`
- `chargingManagement.debug.*`

## Safety note
Actuation must be enabled explicitly. Verify your setpoint datapoints and limits before using the adapter in production.

## License
See `LICENSE`.

## Diagnostics

For troubleshooting, you can enable diagnostics logging in the Admin UI (General → Diagnostics).

- When enabled, the adapter writes `diagnostics.*` states (if "Write diagnostics states" is enabled) and emits compact decision-leading logs.
- Charging Management also exposes `chargingManagement.debug.*` (sorted order and allocation JSON).

Recommended workflow:
1. Enable diagnostics.
2. Reproduce the issue.
3. Inspect `diagnostics.summary`, `diagnostics.modules`, and `chargingManagement.debug.allocations`.

