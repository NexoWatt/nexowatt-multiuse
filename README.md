# NexoWatt Multi-Use (ioBroker Adapter)

This repository contains the **architecture skeleton** for a modular ioBroker adapter that will provide:

- Peak shaving (static & dynamic, per-phase capable)
- Charging management for EVSE / Wallboxes (priorities, PV surplus, boost)
- Multi-use logic extensions (e.g., reserve / backup hooks)

## Status
- Version: **0.0.9**
- Roadmap step: **2.2 – Charging Management priority logic**

## Notes
- The concrete control logic will be implemented step-by-step.
- All device/state bindings are intended to be configured via Admin UI (tables) to stay manufacturer-independent.

## License
See `LICENSE`.


## Universal datapoint model (Step 0.2)

This adapter is designed to be manufacturer-independent. Object IDs are mapped in the admin UI via a global datapoint table.

Each datapoint supports optional transform settings (scale/offset/invert) to normalize values.


## Peak Shaving – Actuation (Step 1.5)

You can optionally configure a list of actuators (controlled loads / wallboxes) in the Peak Shaving tab.
The adapter can then apply the computed reduction (W) to these actuators by priority (greedy strategy).

Important: actuation is disabled by default. Enable it explicitly and verify your setpoint datapoints.


## Charging Management – Wallbox table (Step 2.1)

Configure your wallboxes in the Charging Management tab using the wallbox table. Each wallbox can map:
- Actual power/current (read)
- Optional per-phase currents (read)
- Setpoint datapoints for current/power limits (write, used in later steps)
- Optional enable/status datapoints

The adapter creates diagnostic states under `chargingManagement.wallboxes.<key>.*` and a summary under `chargingManagement.summary.*`.
