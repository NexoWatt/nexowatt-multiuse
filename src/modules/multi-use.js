'use strict';

const { BaseModule } = require('./base');
const { applySetpoint } = require('../consumers');
const { ReasonCodes } = require('../reasons');

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

        await this.adapter.setStateAsync('multiUse.summary.consumerCount', this._consumers.length, true);
    }

    async tick() {
        if (!this._isEnabled()) return;

        // Lazy init if adapter restarted without calling init (defensive)
        if (!Array.isArray(this._consumers) || this._consumers.length === 0) {
            this._loadConsumersFromConfig();
        }

        const now = Date.now();
        let appliedCount = 0;

        const ctx = { dp: this.dp, adapter: this.adapter };

        for (const c of this._consumers) {
            const base = `multiUse.consumers.${c.id}`;

            const stW = await this.adapter.getStateAsync(`${base}.targetW`);
            const stA = await this.adapter.getStateAsync(`${base}.targetA`);
            const targetW = num(stW?.val, num(c.defaultTargetW, 0));
            const targetA = num(stA?.val, num(c.defaultTargetA, 0));

            let reason = ReasonCodes.OK;
            let status = 'skipped';
            let applied = false;

            // If no target is set, we still act deterministically but do not write setpoints
            if (!(targetW > 0 || targetA > 0)) {
                reason = ReasonCodes.NO_SETPOINT;
                status = 'no_target';
                applied = false;
            } else {
                const res = await applySetpoint(ctx, c, { targetW, targetA });
                applied = !!res?.applied;
                status = String(res?.status || (applied ? 'applied' : 'unknown'));

                if (status === 'no_setpoint_dp') reason = ReasonCodes.NO_SETPOINT;
                else if (status === 'unsupported_type') reason = ReasonCodes.SKIPPED;
                else if (!applied) reason = ReasonCodes.UNKNOWN;
                else reason = ReasonCodes.OK;

                if (applied) appliedCount++;
            }

            // Write per-consumer result only if changed (reduce state spam)
            const prev = this._last.get(c.id);
            const next = { targetW, targetA, applied, status, reason };
            const changed = !prev
                || prev.targetW !== next.targetW
                || prev.targetA !== next.targetA
                || prev.applied !== next.applied
                || prev.status !== next.status
                || prev.reason !== next.reason;

            if (changed) {
                this._last.set(c.id, next);
                await this.adapter.setStateAsync(`${base}.applied`, applied, true);
                await this.adapter.setStateAsync(`${base}.status`, status, true);
                await this.adapter.setStateAsync(`${base}.reason`, reason, true);
                await this.adapter.setStateAsync(`${base}.lastAppliedTs`, now, true);
            }
        }

        const status = (this._consumers.length === 0)
            ? 'no_consumers'
            : (appliedCount > 0 ? 'ok' : 'no_targets');

        await this.adapter.setStateAsync('multiUse.control.active', appliedCount > 0, true);
        await this.adapter.setStateAsync('multiUse.control.status', status, true);
        await this.adapter.setStateAsync('multiUse.control.lastTickTs', now, true);
        await this.adapter.setStateAsync('multiUse.summary.appliedCount', appliedCount, true);

        if (this.adapter?.log?.debug) {
            this.adapter.log.debug(`[multiUse] tick consumers=${this._consumers.length} applied=${appliedCount} status=${status}`);
        }
    }
}

module.exports = { MultiUseModule };
