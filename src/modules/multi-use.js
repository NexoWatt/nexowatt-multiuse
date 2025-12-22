'use strict';

const { BaseModule } = require('./base');
const { applySetpoint } = require('../consumers');
const { ReasonCodes, normalizeReason } = require('../reasons');

function num(v, dflt = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : dflt;
}

function safeIdPart(s) {
    return String(s || '').trim().replace(/[^a-zA-Z0-9_-]/g, '_');
}

function normalizeType(t) {
    const s = String(t || '').trim().toLowerCase();
    if (s === 'wallbox') return 'evcs';
    return s;
}

function normalizeControlBasis(b) {
    const s = String(b || '').trim().toLowerCase();
    if (s === 'a') return 'currentA';
    if (s === 'w') return 'powerW';
    if (s === 'current' || s === 'currenta') return 'currentA';
    if (s === 'power' || s === 'powerw') return 'powerW';
    if (s === 'none') return 'none';
    return s || 'auto';
}


function clamp(v, minV, maxV) {
    const n = Number(v);
    if (!Number.isFinite(n)) return minV;
    if (n < minV) return minV;
    if (n > maxV) return maxV;
    return n;
}

function floorToStep(v, step) {
    const n = Number(v);
    const s = Number(step);
    if (!Number.isFinite(n)) return 0;
    if (!Number.isFinite(s) || s <= 0) return n;
    // Always round down to avoid overshoot
    const k = Math.floor(n / s);
    const out = k * s;
    // avoid -0
    return out > 0 ? out : 0;
}

function wattsFromA(amps, voltageV, phases) {
    const a = Number(amps);
    const v = Number(voltageV);
    const p = Number(phases);
    if (!Number.isFinite(a) || !Number.isFinite(v) || !Number.isFinite(p) || a <= 0) return 0;
    return a * v * p;
}

function ampsFromW(watts, voltageV, phases) {
    const w = Number(watts);
    const v = Number(voltageV);
    const p = Number(phases);
    if (!Number.isFinite(w) || !Number.isFinite(v) || !Number.isFinite(p) || w <= 0) return 0;
    const denom = v * p;
    if (denom <= 0) return 0;
    return w / denom;
}

function stateAgeMs(st) {
    if (!st) return Number.POSITIVE_INFINITY;
    const ts = Number(st.ts);
    const lc = Number(st.lc);
    const t = Number.isFinite(lc) ? lc : (Number.isFinite(ts) ? ts : NaN);
    if (!Number.isFinite(t) || t <= 0) return Number.POSITIVE_INFINITY;
    const age = Date.now() - t;
    return Number.isFinite(age) && age >= 0 ? age : Number.POSITIVE_INFINITY;
}

function stateNum(st, dflt = null) {
    const n = Number(st && st.val);
    return Number.isFinite(n) ? n : dflt;
}

/**
 * MU7.1: Multi-Use Orchestrator Start
 *
 * Goal: MultiUse is no longer a stub:
 * - reads configured consumers
 * - exposes per-consumer command states (targetW/targetA)
 * - applies targets deterministically via unified applySetpoint()
 * - publishes results (applied/status/reason)
 */
class MultiUseModule extends BaseModule {
    constructor(adapter, dpRegistry) {
        super(adapter, dpRegistry);

        /** @type {Array<any>} */
        this._consumers = [];
        /** @type {Map<string, {targetW:number,targetA:number,applied:boolean,status:string,reason:string}>} */
        this._last = new Map();
    
        /** @type {Map<string, any>} */
        this._stateCache = new Map();
}

    _isEnabled() {
        return !!this.adapter?.config?.enableMultiUse;
    }

    _getCfg() {
        const cfg = this.adapter?.config?.multiUse || {};
        return cfg && typeof cfg === 'object' ? cfg : {};
    }

    _loadConsumersFromConfig() {
        const cfg = this._getCfg();
        const rows = Array.isArray(cfg.consumers) ? cfg.consumers : [];

        /** @type {Array<any>} */
        const consumers = [];

        const usedIds = new Set();
        for (let i = 0; i < rows.length; i++) {
            const r = rows[i] || {};
            const key = String(r.key || '').trim();
            if (!key) continue;

            const idBase = safeIdPart(key) || `consumer_${i + 1}`;
            let id = idBase;
            let n = 2;
            while (usedIds.has(id)) {
                id = `${idBase}_${n++}`;
            }
            usedIds.add(id);

            const consumer = {
                id, // safe id-part for state tree
                key,
                name: String(r.name || key),
                type: normalizeType(r.type || 'load'),
                priority: num(r.priority, 100),
                controlBasis: normalizeControlBasis(r.controlBasis || 'auto'),
                setAKey: String(r.setAKey || '').trim(),
                setWKey: String(r.setWKey || '').trim(),
                enableKey: String(r.enableKey || '').trim(),
                defaultTargetW: num(r.defaultTargetW, 0),
                defaultTargetA: num(r.defaultTargetA, 0),
            };

            consumers.push(consumer);
        }

        // Deterministic order: priority asc, then key asc
        consumers.sort((a, b) => {
            const pa = num(a.priority, 100);
            const pb = num(b.priority, 100);
            if (pa !== pb) return pa - pb;
            const ka = String(a.key || '');
            const kb = String(b.key || '');
            return ka.localeCompare(kb);
        });

        this._consumers = consumers;
    }


    async _setStateIfChanged(id, val) {
        const v = (typeof val === 'number' && !Number.isFinite(val)) ? null : val;
        const prev = this._stateCache.get(id);
        if (prev === v) return;
        this._stateCache.set(id, v);
        await this.adapter.setStateAsync(id, v, true);
    }

    async _seedLastFromStates() {
        // Seed per-consumer last-result cache from existing states to reduce write churn after restart.
        for (const c of this._consumers) {
            const base = `multiUse.consumers.${c.id}`;
            const read = async (id) => this.adapter.getStateAsync(id).catch(() => null);

            const stTargetW = await read(`${base}.targetW`);
            const stTargetA = await read(`${base}.targetA`);
            const stBasis = await read(`${base}.basis`);
            const stReqW = await read(`${base}.requestW`);
            const stAllocW = await read(`${base}.allocatedW`);
            const stAllocA = await read(`${base}.allocatedA`);
            const stApplied = await read(`${base}.applied`);
            const stStatus = await read(`${base}.status`);
            const stReason = await read(`${base}.reason`);

            const next = {
                reqTargetW: num(stTargetW?.val, 0),
                reqTargetA: num(stTargetA?.val, 0),
                requestedW: num(stReqW?.val, 0),
                allocatedW: num(stAllocW?.val, 0),
                allocatedA: num(stAllocA?.val, 0),
                basis: String(stBasis?.val || c.controlBasis || 'auto'),
                applied: !!stApplied?.val,
                status: String(stStatus?.val || ''),
                reason: normalizeReason(stReason?.val || ReasonCodes.OK),
            };

            this._last.set(c.id, next);
        }
    }


    async init() {
        if (!this._isEnabled()) return;

        this._loadConsumersFromConfig();

        await this.adapter.setObjectNotExistsAsync('multiUse', {
            type: 'channel',
            common: { name: 'Multi-Use' },
            native: {},
        });

        await this.adapter.setObjectNotExistsAsync('multiUse.control', {
            type: 'channel',
            common: { name: 'Control' },
            native: {},
        });

        await this.adapter.setObjectNotExistsAsync('multiUse.summary', {
            type: 'channel',
            common: { name: 'Summary' },
            native: {},
        });

        await this.adapter.setObjectNotExistsAsync('multiUse.consumers', {
            type: 'channel',
            common: { name: 'Consumers' },
            native: {},
        });

        await this.adapter.setObjectNotExistsAsync('multiUse.control.active', {
            type: 'state',
            common: { name: 'Active', type: 'boolean', role: 'indicator.working', read: true, write: false, def: false },
            native: {},
        });

        await this.adapter.setObjectNotExistsAsync('multiUse.control.status', {
            type: 'state',
            common: { name: 'Status', type: 'string', role: 'text', read: true, write: false, def: 'init' },
            native: {},
        });

        await this.adapter.setObjectNotExistsAsync('multiUse.control.lastTickTs', {
            type: 'state',
            common: { name: 'Last tick (ts)', type: 'number', role: 'value.time', read: true, write: false, def: 0 },
            native: {},
        });


        await this.adapter.setObjectNotExistsAsync('multiUse.control.reason', {
            type: 'state',
            common: { name: 'Reason', type: 'string', role: 'text', read: true, write: false, def: ReasonCodes.OK },
            native: {},
        });

        await this.adapter.setObjectNotExistsAsync('multiUse.control.requestW', {
            type: 'state',
            common: { name: 'Requested budget (W)', type: 'number', role: 'value.power', unit: 'W', read: true, write: false, def: 0 },
            native: {},
        });

        await this.adapter.setObjectNotExistsAsync('multiUse.control.capW', {
            type: 'state',
            common: { name: 'Budget cap (W)', type: 'number', role: 'value.power', unit: 'W', read: true, write: false, def: 0 },
            native: {},
        });

        await this.adapter.setObjectNotExistsAsync('multiUse.control.budgetW', {
            type: 'state',
            common: { name: 'Effective budget (W)', type: 'number', role: 'value.power', unit: 'W', read: true, write: false, def: 0 },
            native: {},
        });

        await this.adapter.setObjectNotExistsAsync('multiUse.control.budgetSource', {
            type: 'state',
            common: { name: 'Budget source', type: 'string', role: 'text', read: true, write: false, def: 'NONE' },
            native: {},
        });

        await this.adapter.setObjectNotExistsAsync('multiUse.control.capSources', {
            type: 'state',
            common: { name: 'Cap sources', type: 'string', role: 'text', read: true, write: false, def: '' },
            native: {},
        });

        await this.adapter.setObjectNotExistsAsync('multiUse.control.reserveW', {
            type: 'state',
            common: { name: 'Reserve deducted (W)', type: 'number', role: 'value.power', unit: 'W', read: true, write: false, def: 0 },
            native: {},
        });

        await this.adapter.setObjectNotExistsAsync('multiUse.summary.remainingBudgetW', {
            type: 'state',
            common: { name: 'Remaining budget (W)', type: 'number', role: 'value.power', unit: 'W', read: true, write: false, def: 0 },
            native: {},
        });


        await this.adapter.setObjectNotExistsAsync('multiUse.summary.consumerCount', {
            type: 'state',
            common: { name: 'Consumers configured', type: 'number', role: 'value', read: true, write: false, def: 0 },
            native: {},
        });

        await this.adapter.setObjectNotExistsAsync('multiUse.summary.appliedCount', {
            type: 'state',
            common: { name: 'Consumers applied (this tick)', type: 'number', role: 'value', read: true, write: false, def: 0 },
            native: {},
        });

        // Per-consumer command and status states
        for (const c of this._consumers) {
            const base = `multiUse.consumers.${c.id}`;

            await this.adapter.setObjectNotExistsAsync(base, {
                type: 'channel',
                common: { name: c.name || c.key },
                native: { key: c.key, type: c.type },
            });

            await this.adapter.setObjectNotExistsAsync(`${base}.key`, {
                type: 'state',
                common: { name: 'Key', type: 'string', role: 'text', read: true, write: false, def: c.key },
                native: {},
            });

            await this.adapter.setObjectNotExistsAsync(`${base}.type`, {
                type: 'state',
                common: { name: 'Type', type: 'string', role: 'text', read: true, write: false, def: c.type },
                native: {},
            });

            await this.adapter.setObjectNotExistsAsync(`${base}.priority`, {
                type: 'state',
                common: { name: 'Priority', type: 'number', role: 'value', read: true, write: false, def: num(c.priority, 100) },
                native: {},
            });

            await this.adapter.setObjectNotExistsAsync(`${base}.targetW`, {
                type: 'state',
                common: { name: 'Target power (W)', type: 'number', role: 'level.power', unit: 'W', read: true, write: true, def: num(c.defaultTargetW, 0) },
                native: {},
            });

            await this.adapter.setObjectNotExistsAsync(`${base}.targetA`, {
                type: 'state',
                common: { name: 'Target current (A)', type: 'number', role: 'level.current', unit: 'A', read: true, write: true, def: num(c.defaultTargetA, 0) },
                native: {},
            });


            await this.adapter.setObjectNotExistsAsync(`${base}.basis`, {
                type: 'state',
                common: { name: 'Applied control basis', type: 'string', role: 'text', read: true, write: false, def: c.controlBasis },
                native: {},
            });

            await this.adapter.setObjectNotExistsAsync(`${base}.requestW`, {
                type: 'state',
                common: { name: 'Requested power (W)', type: 'number', role: 'value.power', unit: 'W', read: true, write: false, def: 0 },
                native: {},
            });

            await this.adapter.setObjectNotExistsAsync(`${base}.allocatedW`, {
                type: 'state',
                common: { name: 'Allocated power (W)', type: 'number', role: 'value.power', unit: 'W', read: true, write: false, def: 0 },
                native: {},
            });

            await this.adapter.setObjectNotExistsAsync(`${base}.allocatedA`, {
                type: 'state',
                common: { name: 'Allocated current (A)', type: 'number', role: 'value.current', unit: 'A', read: true, write: false, def: 0 },
                native: {},
            });


            await this.adapter.setObjectNotExistsAsync(`${base}.applied`, {
                type: 'state',
                common: { name: 'Applied', type: 'boolean', role: 'indicator', read: true, write: false, def: false },
                native: {},
            });

            await this.adapter.setObjectNotExistsAsync(`${base}.status`, {
                type: 'state',
                common: { name: 'Status', type: 'string', role: 'text', read: true, write: false, def: 'init' },
                native: {},
            });

            await this.adapter.setObjectNotExistsAsync(`${base}.reason`, {
                type: 'state',
                common: { name: 'Reason', type: 'string', role: 'text', read: true, write: false, def: ReasonCodes.OK },
                native: {},
            });

            await this.adapter.setObjectNotExistsAsync(`${base}.lastAppliedTs`, {
                type: 'state',
                common: { name: 'Last applied (ts)', type: 'number', role: 'value.time', read: true, write: false, def: 0 },
                native: {},
            });
        }

        await this._setStateIfChanged('multiUse.summary.consumerCount', this._consumers.length);
        await this._seedLastFromStates().catch(() => undefined);
    }

    async tick() {
        if (!this._isEnabled()) return;

        const now = Date.now();
        const dp = this.dp;
        const cfg = this.adapter.config.multiUse || {};
        const ctx = { adapter: this.adapter, dp };

        const staleTimeoutSec = clamp(num(cfg.staleTimeoutSec, 15), 1, 3600);
        const staleTimeoutMs = staleTimeoutSec * 1000;

        const voltageV = clamp(num(cfg.voltageV, 230), 100, 260);
        const defaultPhases = clamp(num(cfg.defaultPhases, 3), 1, 3);

        const stepW = clamp(num(cfg.stepW, 0), 0, 5000);
        const stepA = clamp(num(cfg.stepA, 0), 0, 100);

        const reserveEnabled = !!cfg.reserveEnabled;
        const reserveMinW = clamp(num(cfg.reserveMinW, 0), 0, 100000);
        const reserveW = reserveEnabled ? reserveMinW : 0;

        // ---- Determine requested budget (lower precedence sources) ----
        let requestW = 0;
        let budgetSource = 'NONE';

        const tariffKey = String(cfg.tariffBudgetWKey || '').trim();
        const pvKey = String(cfg.pvBudgetWKey || '').trim();

        if (tariffKey && dp && typeof dp.getNumberFresh === 'function') {
            const v = dp.getNumberFresh(tariffKey, staleTimeoutMs, null);
            if (Number.isFinite(v)) {
                requestW = Math.max(0, v);
                budgetSource = 'TARIFF';
            }
        }

        if (budgetSource === 'NONE' && pvKey && dp && typeof dp.getNumberFresh === 'function') {
            const v = dp.getNumberFresh(pvKey, staleTimeoutMs, null);
            if (Number.isFinite(v)) {
                requestW = Math.max(0, v);
                budgetSource = 'PV';
            }
        }

        if (budgetSource === 'NONE') {
            requestW = Math.max(0, num(cfg.comfortBudgetW, 0));
            budgetSource = 'COMFORT';
        }

        // Reserve (always deducted to keep headroom for uncontrolled loads)
        const requestAfterReserveW = Math.max(0, requestW - reserveW);

        // ---- Apply higher-precedence caps (Netzschutz > external > peakshaving) ----
        let capW = Number.POSITIVE_INFINITY;
        /** @type {Array<string>} */
        const capSources = [];

        let controlReason = ReasonCodes.OK;

        // Netzschutz: if PeakShaving reports STALE_METER we force budget to 0
        const psReasonSt = await this.adapter.getStateAsync('peakShaving.control.reason').catch(() => null);
        const psReason = String(psReasonSt?.val || '').trim();
        if (psReason === ReasonCodes.STALE_METER) {
            capW = 0;
            capSources.push('NET_STALE');
            controlReason = ReasonCodes.STALE_METER;
        }

        // External limit cap (strict: if configured but stale/invalid => failsafe)
        const externalKey = String(cfg.externalLimitWKey || '').trim();
        if (externalKey && dp && typeof dp.isStale === 'function' && typeof dp.getNumberFresh === 'function') {
            const stale = dp.isStale(externalKey, staleTimeoutMs);
            if (stale) {
                capW = 0;
                capSources.push('EXTERNAL_STALE');
                controlReason = ReasonCodes.STALE_METER;
            } else {
                const ext = dp.getNumberFresh(externalKey, staleTimeoutMs, null);
                if (!Number.isFinite(ext)) {
                    capW = 0;
                    capSources.push('EXTERNAL_INVALID');
                    controlReason = ReasonCodes.STALE_METER;
                } else {
                    capW = Math.min(capW, Math.max(0, ext));
                    capSources.push('EXTERNAL');
                }
            }
        }

        // PeakShaving cap (only when PS is active; prevents MU from "re-increasing" after PS reductions)
        const psActiveSt = await this.adapter.getStateAsync('peakShaving.control.active').catch(() => null);
        const psActive = !!psActiveSt?.val;
        if (psActive) {
            const availSt = await this.adapter.getStateAsync('peakShaving.dynamic.availableForControlledW').catch(() => null);
            const age = stateAgeMs(availSt);
            const avail = stateNum(availSt, null);
            if (!(Number.isFinite(avail)) || age > staleTimeoutMs) {
                capW = Math.min(capW, 0);
                capSources.push('PEAK_SHAVING_STALE');
            } else {
                capW = Math.min(capW, Math.max(0, avail));
                capSources.push('PEAK_SHAVING');
            }
        }

        // Final effective budget
        let budgetW = Math.min(requestAfterReserveW, capW);
        if (!Number.isFinite(budgetW) || budgetW < 0) budgetW = 0;

        if (controlReason === ReasonCodes.OK) {
            if (requestAfterReserveW <= 0) controlReason = ReasonCodes.NO_BUDGET;
            else if (budgetW + 0.0001 < requestAfterReserveW) controlReason = ReasonCodes.LIMITED_BY_BUDGET;
            else controlReason = ReasonCodes.OK;
        }

        // Publish control states
        await this._setStateIfChanged('multiUse.control.reason', controlReason);
        await this._setStateIfChanged('multiUse.control.requestW', Math.round(requestAfterReserveW));
        await this._setStateIfChanged('multiUse.control.capW', Number.isFinite(capW) ? Math.round(capW) : 0);
        await this._setStateIfChanged('multiUse.control.budgetW', Math.round(budgetW));
        await this._setStateIfChanged('multiUse.control.budgetSource', budgetSource);
        await this._setStateIfChanged('multiUse.control.capSources', capSources.join(','));
        await this._setStateIfChanged('multiUse.control.reserveW', Math.round(reserveW));

        // ---- Allocate budget to consumers deterministically ----
        let remainingW = budgetW;
        let appliedCount = 0;
        let totalRequestedW = 0;

        for (const c of this._consumers) {
            const base = `multiUse.consumers.${c.id}`;

            const stW = await this.adapter.getStateAsync(`${base}.targetW`).catch(() => null);
            const stA = await this.adapter.getStateAsync(`${base}.targetA`).catch(() => null);

            const reqTargetW = num(stW?.val, 0);
            const reqTargetA = num(stA?.val, 0);

            const hasRequest = (reqTargetW > 0) || (reqTargetA > 0);

            let reason = ReasonCodes.OK;
            let status = 'skipped';
            let applied = false;

            // Determine consumer basis (auto resolves to available setpoint dp)
            let basis = String(c.controlBasis || 'auto');
            if (basis === 'auto') {
                if (c.type === 'load') basis = 'powerW';
                else if (c.setWKey) basis = 'powerW';
                else if (c.setAKey) basis = 'currentA';
                else basis = 'none';
            }

            // Requested in W (unified)
            const requestedW = reqTargetW > 0 ? reqTargetW : wattsFromA(reqTargetA, voltageV, defaultPhases);
            totalRequestedW += Math.max(0, requestedW);

            // Allocation
            let allocatedW = 0;
            let allocatedA = 0;

            if (!hasRequest) {
                // A zero target means "off" – enforce by actively driving the consumer to 0.
                allocatedW = 0;
                allocatedA = 0;
                reason = ReasonCodes.SKIPPED;
                status = 'target_zero';

                if (basis !== 'none') {
                    const res = await applySetpoint(ctx, c, { targetW: 0, targetA: 0, basis });
                    applied = !!res?.applied;
                    status = String(res?.status || status);

                    // Map actuator status to canonical reasons
                    if (status === 'no_setpoint_dp') reason = ReasonCodes.NO_SETPOINT;
                    else if (status === 'control_disabled') reason = ReasonCodes.SKIPPED;
                    else if (status === 'write_failed' || status === 'applied_partial') reason = ReasonCodes.UNKNOWN;
                    else if (status === 'unsupported_type') reason = ReasonCodes.SKIPPED;

                    if (applied) appliedCount++;
                } else {
                    applied = false;
                }
            } else if (controlReason === ReasonCodes.STALE_METER) {
                // Safety: always drive to 0 when our upstream safety signal is stale
                allocatedW = 0;
                allocatedA = 0;
                reason = ReasonCodes.STALE_METER;
                status = 'failsafe_stale';
                const res = await applySetpoint(ctx, c, { targetW: 0, targetA: 0, basis });
                applied = !!res?.applied;
                status = String(res?.status || status);

                // Map low-level actuator status to canonical reasons (transparency)
                if (status === 'no_setpoint_dp') reason = ReasonCodes.NO_SETPOINT;
                else if (status === 'control_disabled') reason = ReasonCodes.SKIPPED;
                else if (status === 'write_failed' || status === 'applied_partial') reason = ReasonCodes.UNKNOWN;
                    else if (status === 'unsupported_type') reason = ReasonCodes.SKIPPED;

                if (applied) appliedCount++;
            } else if (basis === 'none') {
                reason = ReasonCodes.SKIPPED;
                status = 'control_disabled';
                applied = false;
            } else {
                // Budget allocation in W first
                const wantW = Math.max(0, requestedW);
                const takeW = Math.min(wantW, Math.max(0, remainingW));

                if (basis === 'powerW') {
                    allocatedW = floorToStep(takeW, stepW);
                    allocatedA = 0;
                    remainingW = Math.max(0, remainingW - allocatedW);
                } else { // currentA
                    // convert W->A, step, then back to W for remaining
                    const rawA = ampsFromW(takeW, voltageV, defaultPhases);
                    allocatedA = floorToStep(rawA, stepA);
                    allocatedW = wattsFromA(allocatedA, voltageV, defaultPhases);
                    remainingW = Math.max(0, remainingW - allocatedW);
                }

                // Determine reason
                if (allocatedW <= 0.0001) {
                    reason = ReasonCodes.NO_BUDGET;
                    status = 'budget_zero';
                } else if (allocatedW + 0.0001 < wantW) {
                    reason = ReasonCodes.LIMITED_BY_BUDGET;
                    status = 'allocated_limited';
                } else {
                    reason = ReasonCodes.ALLOCATED;
                    status = 'allocated';
                }

                const res = await applySetpoint(ctx, c, { targetW: allocatedW, targetA: allocatedA, basis });
                applied = !!res?.applied;
                status = String(res?.status || status);

                // Map low-level actuator status to canonical reasons (transparency)
                if (status === 'no_setpoint_dp') reason = ReasonCodes.NO_SETPOINT;
                else if (status === 'control_disabled') reason = ReasonCodes.SKIPPED;
                else if (status === 'write_failed' || status === 'applied_partial') reason = ReasonCodes.UNKNOWN;
                    else if (status === 'unsupported_type') reason = ReasonCodes.SKIPPED;

                if (applied) appliedCount++;
            }

            // Write per-consumer result only if changed (reduce state spam)
            const prev = this._last.get(c.id);
            const next = { reqTargetW, reqTargetA, requestedW: Math.round(requestedW), allocatedW: Math.round(allocatedW), allocatedA, basis, applied, status, reason };
            const changed = !prev
                || prev.reqTargetW !== next.reqTargetW
                || prev.reqTargetA !== next.reqTargetA
                || prev.requestedW !== next.requestedW
                || prev.allocatedW !== next.allocatedW
                || prev.allocatedA !== next.allocatedA
                || prev.basis !== next.basis
                || prev.applied !== next.applied
                || prev.status !== next.status
                || prev.reason !== next.reason;

            if (changed) {
                this._last.set(c.id, next);
                await this.adapter.setStateAsync(`${base}.basis`, basis, true);
                await this.adapter.setStateAsync(`${base}.requestW`, next.requestedW, true);
                await this.adapter.setStateAsync(`${base}.allocatedW`, next.allocatedW, true);
                await this.adapter.setStateAsync(`${base}.allocatedA`, Number.isFinite(next.allocatedA) ? Number(next.allocatedA.toFixed(3)) : 0, true);
                await this.adapter.setStateAsync(`${base}.applied`, applied, true);
                await this.adapter.setStateAsync(`${base}.status`, status, true);
                await this.adapter.setStateAsync(`${base}.reason`, reason, true);
                await this.adapter.setStateAsync(`${base}.lastAppliedTs`, now, true);
            }
        }

        const status = (this._consumers.length === 0)
            ? 'no_consumers'
            : ((controlReason === ReasonCodes.STALE_METER)
                ? 'failsafe_stale_meter'
                : (totalRequestedW > 0 ? 'ok' : 'idle'));

        await this._setStateIfChanged('multiUse.control.active', (totalRequestedW > 0) || (controlReason === ReasonCodes.STALE_METER));
        await this._setStateIfChanged('multiUse.control.status', status);
        await this._setStateIfChanged('multiUse.control.lastTickTs', now);
        await this._setStateIfChanged('multiUse.summary.appliedCount', appliedCount);
        await this._setStateIfChanged('multiUse.summary.remainingBudgetW', Math.round(Math.max(0, remainingW)));

        if (this.adapter?.log?.debug) {
            this.adapter.log.debug(`[multiUse] tick consumers=${this._consumers.length} applied=${appliedCount} status=${status} budgetW=${Math.round(budgetW)} remainingW=${Math.round(remainingW)} reason=${controlReason}`);
        }
    }
}

module.exports = { MultiUseModule };
