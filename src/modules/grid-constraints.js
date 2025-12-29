
'use strict';

const { BaseModule } = require('./base');
const { ReasonCodes } = require('../reasons');

/**
 * Grid constraints module (Netz & EVU):
 * - RLM (15-min demand) dynamic cap
 * - Zero export (Nulleinspeisung) via PV/WR curtail control if available
 *
 * This module is designed to be manufacturer-independent by mapping datapoints
 * (Modbus/REST/etc.) to generic keys.
 */
class GridConstraintsModule extends BaseModule {
    constructor(adapter, dpRegistry) {
        super(adapter, dpRegistry);

        this._lastStateWriteMs = 0;

        // RLM accumulator
        this._rlm = {
            intervalMs: 15 * 60 * 1000,
            intervalStartMs: 0,
            importedWs: 0,
            lastUpdateMs: 0,
        };

        // PV curtail setpoints (if no readback)
        this._pv = {
            lastMode: 'off', // resolved mode
            limitW: null,
            limitPct: null,
        };
    }

    _isEnabled() {
        return !!this.adapter.config.enableGridConstraints;
    }

    _cfg() {
        return this.adapter.config.gridConstraints || {};
    }

    _num(v, dflt = 0) {
        const n = Number(v);
        return Number.isFinite(n) ? n : dflt;
    }

    _clamp(v, minV, maxV) {
        const n = Number(v);
        if (!Number.isFinite(n)) return minV;
        return Math.min(Math.max(n, minV), maxV);
    }

    async init() {
        if (!this._isEnabled()) return;

        // Channel tree
        await this.adapter.setObjectNotExistsAsync('gridConstraints', {
            type: 'channel',
            common: { name: 'Netz-Constraints (RLM / Nulleinspeisung)' },
            native: {},
        });

        for (const ch of ['control', 'rlm', 'zeroExport', 'pvCurtail']) {
            await this.adapter.setObjectNotExistsAsync(`gridConstraints.${ch}`, {
                type: 'channel',
                common: { name: ch },
                native: {},
            });
        }

        const mk = async (id, name, type = 'number', role = 'value') => {
            await this.adapter.setObjectNotExistsAsync(id, {
                type: 'state',
                common: { name, type, role, read: true, write: false },
                native: {},
            });
        };

        await mk('gridConstraints.control.status', 'Status', 'string', 'text');
        await mk('gridConstraints.control.reason', 'Reason', 'string', 'text');
        await mk('gridConstraints.control.maxImportW_final', 'Max allowed import (W) final', 'number', 'value.power');
        await mk('gridConstraints.control.minImportTargetW', 'Min import target (W) for zero export', 'number', 'value.power');
        await mk('gridConstraints.control.lastUpdate', 'Last update (ts)', 'number', 'value.time');

        // RLM
        await mk('gridConstraints.rlm.enabled', 'RLM enabled', 'boolean', 'indicator');
        await mk('gridConstraints.rlm.limitW', 'RLM limit (W)', 'number', 'value.power');
        await mk('gridConstraints.rlm.safetyMarginW', 'RLM safety margin (W)', 'number', 'value.power');
        await mk('gridConstraints.rlm.intervalStart', 'Interval start (ts)', 'number', 'value.time');
        await mk('gridConstraints.rlm.elapsedSec', 'Elapsed (s)', 'number', 'value.interval');
        await mk('gridConstraints.rlm.remainingSec', 'Remaining (s)', 'number', 'value.interval');
        await mk('gridConstraints.rlm.importedWs', 'Imported energy (Ws) in interval', 'number', 'value');
        await mk('gridConstraints.rlm.avgW', 'Average import power in interval (W)', 'number', 'value.power');
        await mk('gridConstraints.rlm.capNowW', 'Cap now (W) to stay within 15-min avg', 'number', 'value.power');

        // Zero export
        await mk('gridConstraints.zeroExport.enabled', 'Zero export enabled', 'boolean', 'indicator');
        await mk('gridConstraints.zeroExport.targetImportBiasW', 'Target import bias (W)', 'number', 'value.power');
        await mk('gridConstraints.zeroExport.deadbandW', 'Deadband (W)', 'number', 'value.power');
        await mk('gridConstraints.zeroExport.exportW', 'Current export (W)', 'number', 'value.power');
        await mk('gridConstraints.zeroExport.action', 'Action', 'string', 'text');

        // PV curtail debug
        await mk('gridConstraints.pvCurtail.mode', 'Curtail mode (resolved)', 'string', 'text');
        await mk('gridConstraints.pvCurtail.setpointW', 'PV limit setpoint (W)', 'number', 'value.power');
        await mk('gridConstraints.pvCurtail.setpointPct', 'PV limit setpoint (%)', 'number', 'value');
        await mk('gridConstraints.pvCurtail.applied', 'Curtail applied', 'boolean', 'indicator');

        // Datapoint mapping
        const cfg = this._cfg();
        const dp = this.dp;

        // Grid power: prefer explicit mapping; fallback to PeakShaving mapping
        const gridPowerId = String(cfg.gridPowerId || this.adapter.config.peakShaving?.gridPointPowerId || '').trim();
        if (gridPowerId) {
            await dp.upsert({ key: 'grid.powerW', objectId: gridPowerId, dataType: 'number', direction: 'in', unit: 'W' });
        }

        // PV/WR curtail controls
        if (cfg.pvFeedInLimitWId) {
            await dp.upsert({ key: 'pv.feedInLimitW', objectId: String(cfg.pvFeedInLimitWId).trim(), dataType: 'number', direction: 'out', unit: 'W' });
        }
        if (cfg.pvLimitWId) {
            await dp.upsert({ key: 'pv.limitW', objectId: String(cfg.pvLimitWId).trim(), dataType: 'number', direction: 'out', unit: 'W' });
        }
        if (cfg.pvLimitPctId) {
            await dp.upsert({ key: 'pv.limitPct', objectId: String(cfg.pvLimitPctId).trim(), dataType: 'number', direction: 'out', unit: '%' });
        }
        if (cfg.pvRatedPowerWId) {
            await dp.upsert({ key: 'pv.ratedPowerW', objectId: String(cfg.pvRatedPowerWId).trim(), dataType: 'number', direction: 'in', unit: 'W' });
        }
    }

    _resolveCurtailMode(cfg) {
        const mode = String(cfg.pvCurtailMode || 'auto');
        if (mode && mode !== 'auto') return mode;

        if (cfg.pvFeedInLimitWId) return 'feedInLimitW';
        if (cfg.pvLimitWId) return 'pvLimitW';
        if (cfg.pvLimitPctId) return 'pvLimitPct';
        return 'off';
    }

    _isStaleGrid(cfg) {
        const staleTimeoutSec = this._num(cfg.staleTimeoutSec, 15);
        const staleMs = Math.max(1, Math.round(staleTimeoutSec * 1000));
        return this.dp?.isStale('grid.powerW', staleMs);
    }

    async _tickRlm(nowMs, gridW, cfg) {
        const enabled = !!cfg.rlmEnabled;
        const aligned = cfg.rlmAligned !== false;
        const safetyMarginW = Math.max(0, this._num(cfg.rlmSafetyMarginW, 0));
        const limitWraw = this._num(cfg.rlmLimitW, 0);
        const limitW = Math.max(0, limitWraw - safetyMarginW);

        // Update states for visibility (even if disabled)
        await this.adapter.setStateAsync('gridConstraints.rlm.enabled', enabled, true);
        await this.adapter.setStateAsync('gridConstraints.rlm.limitW', Math.round(limitWraw), true);
        await this.adapter.setStateAsync('gridConstraints.rlm.safetyMarginW', Math.round(safetyMarginW), true);

        if (!enabled || !Number.isFinite(limitW) || limitW <= 0) {
            await this.adapter.setStateAsync('gridConstraints.rlm.capNowW', 0, true);
            return { enabled: false, capNowW: null, avgW: null, limitW: null };
        }

        const intervalMs = this._rlm.intervalMs;

        const intervalStartMs = aligned ? (Math.floor(nowMs / intervalMs) * intervalMs) : (this._rlm.intervalStartMs || nowMs);
        if (!this._rlm.intervalStartMs || intervalStartMs !== this._rlm.intervalStartMs) {
            // New interval
            this._rlm.intervalStartMs = intervalStartMs;
            this._rlm.importedWs = 0;
            this._rlm.lastUpdateMs = nowMs;
        }

        // dt
        let dtSec = (nowMs - (this._rlm.lastUpdateMs || nowMs)) / 1000;
        if (!Number.isFinite(dtSec) || dtSec < 0) dtSec = 0;
        // clamp dt to avoid huge catch-ups after pauses/restarts
        dtSec = Math.min(dtSec, 10);

        this._rlm.lastUpdateMs = nowMs;

        const importW = Math.max(0, Number(gridW) || 0);
        this._rlm.importedWs += importW * dtSec;

        const elapsedSec = Math.max(0, (nowMs - this._rlm.intervalStartMs) / 1000);
        const remainingSec = Math.max(1, (intervalMs / 1000) - elapsedSec);

        const allowWs = limitW * (intervalMs / 1000);
        const remWs = allowWs - this._rlm.importedWs;

        let capNowW = remWs / remainingSec;
        if (!Number.isFinite(capNowW)) capNowW = 0;
        capNowW = this._clamp(capNowW, 0, limitW);

        const avgW = (elapsedSec > 0) ? (this._rlm.importedWs / elapsedSec) : 0;

        await this.adapter.setStateAsync('gridConstraints.rlm.intervalStart', this._rlm.intervalStartMs, true);
        await this.adapter.setStateAsync('gridConstraints.rlm.elapsedSec', Math.round(elapsedSec), true);
        await this.adapter.setStateAsync('gridConstraints.rlm.remainingSec', Math.round(remainingSec), true);
        await this.adapter.setStateAsync('gridConstraints.rlm.importedWs', Math.round(this._rlm.importedWs), true);
        await this.adapter.setStateAsync('gridConstraints.rlm.avgW', Math.round(avgW), true);
        await this.adapter.setStateAsync('gridConstraints.rlm.capNowW', Math.round(capNowW), true);

        return { enabled: true, capNowW, avgW, limitW };
    }

    async _tickZeroExport(nowMs, gridW, cfg, gridStale) {
        const enabled = !!cfg.zeroExportEnabled;

        const biasW = Math.max(0, this._num(cfg.zeroExportBiasW, 80));
        const deadbandW = Math.max(0, this._num(cfg.zeroExportDeadbandW, 50));

        await this.adapter.setStateAsync('gridConstraints.zeroExport.enabled', enabled, true);
        await this.adapter.setStateAsync('gridConstraints.zeroExport.targetImportBiasW', Math.round(biasW), true);
        await this.adapter.setStateAsync('gridConstraints.zeroExport.deadbandW', Math.round(deadbandW), true);

        const exportW = Math.max(0, -(Number(gridW) || 0));
        await this.adapter.setStateAsync('gridConstraints.zeroExport.exportW', Math.round(exportW), true);

        if (!enabled) {
            await this.adapter.setStateAsync('gridConstraints.zeroExport.action', 'off', true);
            return { enabled: false, biasW, deadbandW, exportW };
        }

        // Determine curtail mode
        const modeResolved = this._resolveCurtailMode(cfg);
        this._pv.lastMode = modeResolved;
        await this.adapter.setStateAsync('gridConstraints.pvCurtail.mode', modeResolved, true);

        // If we cannot measure grid power reliably, go failsafe (if possible)
        if (gridStale) {
            const ok = await this._applyCurtailFailsafe(cfg, modeResolved);
            await this.adapter.setStateAsync('gridConstraints.zeroExport.action', 'failsafe_stale', true);
            await this.adapter.setStateAsync('gridConstraints.pvCurtail.applied', !!ok, true);
            return { enabled: true, biasW, deadbandW, exportW };
        }

        // Nothing to do if we have no control channel
        if (modeResolved === 'off') {
            await this.adapter.setStateAsync('gridConstraints.zeroExport.action', 'no_control', true);
            await this.adapter.setStateAsync('gridConstraints.pvCurtail.applied', false, true);
            return { enabled: true, biasW, deadbandW, exportW };
        }

        // feed-in limit: best for "hard 0 export"
        if (modeResolved === 'feedInLimitW') {
            const ok = await this.dp.writeNumber('pv.feedInLimitW', 0, false);
            await this.adapter.setStateAsync('gridConstraints.zeroExport.action', 'feedInLimitW=0', true);
            await this.adapter.setStateAsync('gridConstraints.pvCurtail.applied', ok === true || ok === null, true);
            await this.adapter.setStateAsync('gridConstraints.pvCurtail.setpointW', 0, true);
            await this.adapter.setStateAsync('gridConstraints.pvCurtail.setpointPct', 0, true);
            return { enabled: true, biasW, deadbandW, exportW };
        }

        // limit by PV power (W/%): closed-loop based on grid power error
        const errorW = biasW - Number(gridW || 0); // positive => exporting or too low import

        if (Math.abs(errorW) <= deadbandW) {
            await this.adapter.setStateAsync('gridConstraints.zeroExport.action', 'within_deadband', true);
            await this.adapter.setStateAsync('gridConstraints.pvCurtail.applied', false, true);
            return { enabled: true, biasW, deadbandW, exportW };
        }

        const fastTripW = Math.max(0, this._num(cfg.pvCurtailFastTripExportW, 500));
        const fastTrip = exportW >= fastTripW;

        if (modeResolved === 'pvLimitW') {
            const maxDeltaW = Math.max(0, this._num(cfg.pvCurtailMaxDeltaWPerTick, 8000));
            const ratedW = this._getRatedPvW(cfg);
            const maxW = (ratedW > 0) ? ratedW : 1_000_000;

            if (typeof this._pv.limitW !== 'number') {
                this._pv.limitW = (ratedW > 0) ? ratedW : maxW;
            }

            const prev = this._pv.limitW;
            const rawNext = this._clamp(prev - errorW, 0, maxW);

            let next = rawNext;
            const effMaxDelta = fastTrip ? Math.max(maxDeltaW, Math.abs(prev - rawNext)) : maxDeltaW;
            if (effMaxDelta > 0) {
                const d = rawNext - prev;
                if (Math.abs(d) > effMaxDelta) next = prev + Math.sign(d) * effMaxDelta;
            }

            next = this._clamp(next, 0, maxW);
            this._pv.limitW = next;

            const ok = await this.dp.writeNumber('pv.limitW', next, false);

            await this.adapter.setStateAsync('gridConstraints.zeroExport.action', fastTrip ? 'pvLimitW_fast' : 'pvLimitW', true);
            await this.adapter.setStateAsync('gridConstraints.pvCurtail.applied', ok === true || ok === null, true);
            await this.adapter.setStateAsync('gridConstraints.pvCurtail.setpointW', Math.round(next), true);
            await this.adapter.setStateAsync('gridConstraints.pvCurtail.setpointPct', 0, true);

            return { enabled: true, biasW, deadbandW, exportW };
        }

        if (modeResolved === 'pvLimitPct') {
            const ratedW = this._getRatedPvW(cfg);
            if (!(ratedW > 0)) {
                await this.adapter.setStateAsync('gridConstraints.zeroExport.action', 'pvLimitPct_missing_rated', true);
                await this.adapter.setStateAsync('gridConstraints.pvCurtail.applied', false, true);
                return { enabled: true, biasW, deadbandW, exportW };
            }

            const maxDeltaPct = Math.max(0, this._num(cfg.pvCurtailMaxDeltaPctPerTick, 10));
            if (typeof this._pv.limitPct !== 'number') {
                this._pv.limitPct = 100;
            }

            const prev = this._pv.limitPct;
            const deltaPct = (errorW / ratedW) * 100;
            const rawNext = this._clamp(prev - deltaPct, 0, 100);

            let next = rawNext;
            const effMaxDeltaPct = fastTrip ? Math.max(maxDeltaPct, Math.abs(prev - rawNext)) : maxDeltaPct;
            if (effMaxDeltaPct > 0) {
                const d = rawNext - prev;
                if (Math.abs(d) > effMaxDeltaPct) next = prev + Math.sign(d) * effMaxDeltaPct;
            }

            next = this._clamp(next, 0, 100);
            this._pv.limitPct = next;

            const ok = await this.dp.writeNumber('pv.limitPct', next, false);

            await this.adapter.setStateAsync('gridConstraints.zeroExport.action', fastTrip ? 'pvLimitPct_fast' : 'pvLimitPct', true);
            await this.adapter.setStateAsync('gridConstraints.pvCurtail.applied', ok === true || ok === null, true);
            await this.adapter.setStateAsync('gridConstraints.pvCurtail.setpointW', 0, true);
            await this.adapter.setStateAsync('gridConstraints.pvCurtail.setpointPct', Math.round(next * 10) / 10, true);

            return { enabled: true, biasW, deadbandW, exportW };
        }

        await this.adapter.setStateAsync('gridConstraints.zeroExport.action', 'unknown_mode', true);
        await this.adapter.setStateAsync('gridConstraints.pvCurtail.applied', false, true);
        return { enabled: true, biasW, deadbandW, exportW };
    }

    _getRatedPvW(cfg) {
        const explicit = this._num(cfg.pvRatedPowerW, 0);
        if (explicit > 0) return explicit;
        const dp = this.dp;
        const v = dp ? dp.getNumber('pv.ratedPowerW', 0) : 0;
        return this._num(v, 0);
    }

    async _applyCurtailFailsafe(cfg, modeResolved) {
        try {
            if (modeResolved === 'feedInLimitW') {
                const ok = await this.dp.writeNumber('pv.feedInLimitW', 0, false);
                await this.adapter.setStateAsync('gridConstraints.pvCurtail.setpointW', 0, true);
                await this.adapter.setStateAsync('gridConstraints.pvCurtail.setpointPct', 0, true);
                return ok === true || ok === null;
            }
            if (modeResolved === 'pvLimitW') {
                const ok = await this.dp.writeNumber('pv.limitW', 0, false);
                this._pv.limitW = 0;
                await this.adapter.setStateAsync('gridConstraints.pvCurtail.setpointW', 0, true);
                await this.adapter.setStateAsync('gridConstraints.pvCurtail.setpointPct', 0, true);
                return ok === true || ok === null;
            }
            if (modeResolved === 'pvLimitPct') {
                const ok = await this.dp.writeNumber('pv.limitPct', 0, false);
                this._pv.limitPct = 0;
                await this.adapter.setStateAsync('gridConstraints.pvCurtail.setpointW', 0, true);
                await this.adapter.setStateAsync('gridConstraints.pvCurtail.setpointPct', 0, true);
                return ok === true || ok === null;
            }
        } catch {
            // ignore
        }
        return false;
    }

    async tick() {
        if (!this._isEnabled()) return;

        const cfg = this._cfg();
        const nowMs = Date.now();

        // grid power
        const gridStale = this._isStaleGrid(cfg);
        const gridW = this.dp ? this.dp.getNumber('grid.powerW', NaN) : NaN;

        let status = 'ok';
        let reason = ReasonCodes.OK || 'OK';

        if (gridStale || !Number.isFinite(gridW)) {
            status = 'stale_meter';
            reason = ReasonCodes.STALE_METER || 'STALE_METER';
        }

        // RLM tick (works only with valid/stable grid)
        let rlm = { enabled: false, capNowW: null };
        if (!gridStale && Number.isFinite(gridW)) {
            rlm = await this._tickRlm(nowMs, gridW, cfg);
        } else {
            // still update disabled/limit states
            await this._tickRlm(nowMs, 0, { ...cfg, rlmEnabled: !!cfg.rlmEnabled });
        }

        // Zero export tick (may work even if grid stale via failsafe)
        const ze = await this._tickZeroExport(nowMs, Number.isFinite(gridW) ? gridW : 0, cfg, gridStale);

        // Compute final "max import" cap: min(connectionLimit, rlmCapNow)
        const connectionLimitW = this._num(this.adapter.config.peakShaving?.maxPowerW, 0);
        let maxImportFinal = 0;

        if (connectionLimitW > 0) {
            maxImportFinal = connectionLimitW;
        } else {
            maxImportFinal = 0;
        }

        if (cfg.rlmEnabled && rlm && typeof rlm.capNowW === 'number' && Number.isFinite(rlm.capNowW) && rlm.capNowW > 0) {
            maxImportFinal = maxImportFinal > 0 ? Math.min(maxImportFinal, rlm.capNowW) : rlm.capNowW;
        }

        // If no caps configured, set to 0 (means "unknown" here; peak shaving still uses its own)
        await this.adapter.setStateAsync('gridConstraints.control.maxImportW_final', Math.round(maxImportFinal || 0), true);

        const minImportTargetW = (cfg.zeroExportEnabled ? Math.round(Math.max(0, this._num(cfg.zeroExportBiasW, 80))) : 0);
        await this.adapter.setStateAsync('gridConstraints.control.minImportTargetW', minImportTargetW, true);

        await this.adapter.setStateAsync('gridConstraints.control.status', status, true);
        await this.adapter.setStateAsync('gridConstraints.control.reason', reason, true);
        await this.adapter.setStateAsync('gridConstraints.control.lastUpdate', nowMs, true);
    }
}

module.exports = { GridConstraintsModule };
