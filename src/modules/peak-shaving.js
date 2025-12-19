'use strict';

const { BaseModule } = require('./base');

class SlidingWindow {
    constructor(maxSeconds) {
        this.maxSeconds = Math.max(1, Number(maxSeconds) || 30);
        /** @type {Array<{t:number, v:number}>} */
        this.samples = [];
    }

    setMaxSeconds(maxSeconds) {
        const s = Math.max(1, Number(maxSeconds) || 30);
        if (s !== this.maxSeconds) {
            this.maxSeconds = s;
            this.prune(Date.now());
        }
    }

    push(v, t = Date.now()) {
        if (!Number.isFinite(v)) return;
        this.samples.push({ t, v });
        this.prune(t);
    }

    prune(nowTs) {
        const cutoff = nowTs - this.maxSeconds * 1000;
        while (this.samples.length && this.samples[0].t < cutoff) {
            this.samples.shift();
        }
    }

    mean() {
        if (!this.samples.length) return null;
        let sum = 0;
        for (const s of this.samples) sum += s.v;
        return sum / this.samples.length;
    }

    count() {
        return this.samples.length;
    }
}

function num(v, fallback = null) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

function clamp(n, min, max) {
    if (!Number.isFinite(n)) return n;
    if (Number.isFinite(min)) n = Math.max(min, n);
    if (Number.isFinite(max)) n = Math.min(max, n);
    return n;
}

class PeakShavingModule extends BaseModule {
    constructor(adapter, dpRegistry) {
        super(adapter, dpRegistry);

        this._winPower = new SlidingWindow(10);
        this._winL1 = new SlidingWindow(10);
        this._winL2 = new SlidingWindow(10);
        this._winL3 = new SlidingWindow(10);

        this._status = 'inactive'; // inactive | pending_on | active | pending_off
        this._pendingSince = 0;
        this._activeSince = 0;

        /** @type {Map<string, {mode:string, phases:number, baseline:number|null, baselineEnabled:boolean|null}>} */
        this._baselines = new Map();
        this._wasActive = false;
    }

    _isEnabled() {
        return !!this.adapter.config.enablePeakShaving;
    }

    async init() {
        if (!this._isEnabled()) return;

        // Channels
        await this.adapter.setObjectNotExistsAsync('peakShaving', {
            type: 'channel',
            common: { name: 'Peak Shaving' },
            native: {},
        });

        for (const ch of ['measure', 'calc', 'control', 'dynamic', 'actuators']) {
            await this.adapter.setObjectNotExistsAsync(`peakShaving.${ch}`, {
                type: 'channel',
                common: { name: ch },
                native: {},
            });
        }

        // States (created lazily too, but create the core set)
        const mk = async (id, name, type, role) => {
            await this.adapter.setObjectNotExistsAsync(id, {
                type: 'state',
                common: { name, type, role, read: true, write: false },
                native: {},
            });
        };

        await mk('peakShaving.control.active', 'Active', 'boolean', 'indicator');
        await mk('peakShaving.control.status', 'Status', 'string', 'text');
        await mk('peakShaving.control.reason', 'Reason', 'string', 'text');
        await mk('peakShaving.control.limitW', 'Effective limit (W)', 'number', 'value.power');
        await mk('peakShaving.control.effectivePowerW', 'Effective power (W)', 'number', 'value.power');
        await mk('peakShaving.control.overW', 'Over limit (W)', 'number', 'value.power');
        await mk('peakShaving.control.requiredReductionW', 'Required reduction (W)', 'number', 'value.power');
        await mk('peakShaving.control.requiredReductionA', 'Required reduction (A)', 'number', 'value.current');
        await mk('peakShaving.control.phaseViolation', 'Phase violation', 'boolean', 'indicator');
        await mk('peakShaving.control.worstPhase', 'Worst phase', 'string', 'text');
        await mk('peakShaving.control.worstPhaseOverA', 'Worst phase over (A)', 'number', 'value.current');
        await mk('peakShaving.control.lastUpdate', 'Last update', 'number', 'value.time');

        await mk('peakShaving.dynamic.allowedPowerW', 'Allowed power (W)', 'number', 'value.power');
        await mk('peakShaving.dynamic.reserveW', 'Reserve (W)', 'number', 'value.power');
        await mk('peakShaving.dynamic.effectiveLimitW', 'Dynamic effective limit (W)', 'number', 'value.power');
        await mk('peakShaving.dynamic.baseLoadW', 'Base load (W)', 'number', 'value.power');
        await mk('peakShaving.dynamic.pvW', 'PV power (W)', 'number', 'value.power');
        await mk('peakShaving.dynamic.batteryW', 'Battery power (W)', 'number', 'value.power');
        await mk('peakShaving.dynamic.availableForControlledW', 'Available for controlled loads (W)', 'number', 'value.power');

        await mk('peakShaving.calc.avgPowerW', 'Average power (W)', 'number', 'value.power');
        await mk('peakShaving.calc.samples', 'Samples', 'number', 'value');
    }

    async tick() {
        if (!this._isEnabled()) return;

        const cfg = this.adapter.config.peakShaving || {};
        const now = Date.now();

        // Normalize config
        const mode = String(cfg.mode || 'static');
        const smoothingSeconds = clamp(num(cfg.smoothingSeconds, 10), 1, 600);
        const useAverage = cfg.useAverage !== false; // default true

        const maxPowerW = num(cfg.maxPowerW, 0);
        const hysteresisW = clamp(num(cfg.hysteresisW, 500), 0, 1e9);
        const activateDelayS = clamp(num(cfg.activateDelaySeconds, 2), 0, 3600);
        const releaseDelayS = clamp(num(cfg.releaseDelaySeconds, 5), 0, 3600);

        const maxPhaseA = num(cfg.maxPhaseA, 0);
        const phaseMode = String(cfg.phaseMode || (maxPhaseA > 0 ? 'enforce' : 'off')); // off|info|enforce
        const hysteresisA = clamp(num(cfg.hysteresisA, 1), 0, 100);
        const voltageV = clamp(num(cfg.voltageV, 230), 50, 400);

        // Bind datapoints from config (manufacturer-independent)
        if (cfg.gridPointPowerId) {
            await this.dp.upsert({ key: 'ps.gridPowerW', objectId: cfg.gridPointPowerId, dataType: 'number', direction: 'in', unit: 'W' });
        }
        if (cfg.allowedPowerId) {
            await this.dp.upsert({ key: 'ps.allowedPowerW', objectId: cfg.allowedPowerId, dataType: 'number', direction: 'in', unit: 'W' });
        }
        if (cfg.baseLoadPowerId) {
            await this.dp.upsert({ key: 'ps.baseLoadW', objectId: cfg.baseLoadPowerId, dataType: 'number', direction: 'in', unit: 'W' });
        }
        if (cfg.pvPowerId) {
            await this.dp.upsert({ key: 'ps.pvW', objectId: cfg.pvPowerId, dataType: 'number', direction: 'in', unit: 'W' });
        }
        if (cfg.batteryPowerId) {
            await this.dp.upsert({ key: 'ps.batteryW', objectId: cfg.batteryPowerId, dataType: 'number', direction: 'in', unit: 'W' });
        }
        if (cfg.l1CurrentId) await this.dp.upsert({ key: 'ps.l1A', objectId: cfg.l1CurrentId, dataType: 'number', direction: 'in', unit: 'A' });
        if (cfg.l2CurrentId) await this.dp.upsert({ key: 'ps.l2A', objectId: cfg.l2CurrentId, dataType: 'number', direction: 'in', unit: 'A' });
        if (cfg.l3CurrentId) await this.dp.upsert({ key: 'ps.l3A', objectId: cfg.l3CurrentId, dataType: 'number', direction: 'in', unit: 'A' });

        // Measurements
        const gridPowerRaw = this.dp.getNumber('ps.gridPowerW', null);
        const l1Raw = this.dp.getNumber('ps.l1A', null);
        const l2Raw = this.dp.getNumber('ps.l2A', null);
        const l3Raw = this.dp.getNumber('ps.l3A', null);

        // Update windows
        this._winPower.setMaxSeconds(smoothingSeconds);
        this._winL1.setMaxSeconds(smoothingSeconds);
        this._winL2.setMaxSeconds(smoothingSeconds);
        this._winL3.setMaxSeconds(smoothingSeconds);

        if (typeof gridPowerRaw === 'number') this._winPower.push(gridPowerRaw, now);
        if (typeof l1Raw === 'number') this._winL1.push(l1Raw, now);
        if (typeof l2Raw === 'number') this._winL2.push(l2Raw, now);
        if (typeof l3Raw === 'number') this._winL3.push(l3Raw, now);

        const avgPower = this._winPower.mean();
        const effPower = useAverage && typeof avgPower === 'number' ? avgPower : gridPowerRaw;

        const samples = this._winPower.count();
        await this.adapter.setStateAsync('peakShaving.calc.avgPowerW', typeof avgPower === 'number' ? avgPower : 0, true);
        await this.adapter.setStateAsync('peakShaving.calc.samples', samples, true);

        // Determine power limit
        let limitW = 0;
        let allowedPowerW = null;
        let reserveW = num(cfg.reserveW, 0);

        if (mode === 'dynamic') {
            allowedPowerW = this.dp.getNumber('ps.allowedPowerW', null);
            const baseMax = (typeof maxPowerW === 'number' && maxPowerW > 0) ? maxPowerW : Number.POSITIVE_INFINITY;
            const allowed = (typeof allowedPowerW === 'number' && allowedPowerW > 0) ? allowedPowerW : Number.POSITIVE_INFINITY;
            limitW = Math.min(baseMax, allowed) - Math.max(0, reserveW);
            if (!Number.isFinite(limitW)) limitW = 0;
        } else {
            limitW = (typeof maxPowerW === 'number' && maxPowerW > 0) ? maxPowerW : 0;
        }

        // Phase analysis
        const l1 = useAverage ? this._winL1.mean() : l1Raw;
        const l2 = useAverage ? this._winL2.mean() : l2Raw;
        const l3 = useAverage ? this._winL3.mean() : l3Raw;

        const phases = [
            { k: 'L1', v: typeof l1 === 'number' ? l1 : null },
            { k: 'L2', v: typeof l2 === 'number' ? l2 : null },
            { k: 'L3', v: typeof l3 === 'number' ? l3 : null },
        ].filter(p => typeof p.v === 'number');

        let worstPhase = '';
        let worstPhaseOverA = 0;
        if (phases.length && typeof maxPhaseA === 'number' && maxPhaseA > 0) {
            let best = { k: '', over: 0 };
            for (const p of phases) {
                const over = (p.v - maxPhaseA);
                if (over > best.over) best = { k: p.k, over };
            }
            worstPhase = best.k;
            worstPhaseOverA = best.over > 0 ? best.over : 0;
        }

        const phaseViolation = worstPhaseOverA > 0;
        const requiredReductionA = phaseViolation ? worstPhaseOverA : 0;
        const requiredReductionWPhase1p = phaseViolation ? requiredReductionA * voltageV : 0;
        const requiredReductionWPhase3p = phaseViolation ? requiredReductionA * voltageV * 3 : 0;

        // Power violation
        const overW = (typeof effPower === 'number' && limitW > 0) ? (effPower - limitW) : 0;
        const powerViolation = overW > 0;

        // Determine whether we consider phase for activation
        const considerPhase = phaseMode === 'info' || phaseMode === 'enforce';
        const canActivateFromPhaseOnly = phaseMode === 'enforce';

        const hasPowerLimit = limitW > 0;
        const violationNow =
            (hasPowerLimit && powerViolation) ||
            (considerPhase && phaseViolation && (hasPowerLimit || canActivateFromPhaseOnly));

        // Determine requested reduction (W)
        const reqFromPower = powerViolation ? overW : 0;
        const reqFromPhase = (considerPhase && phaseViolation) ? requiredReductionWPhase3p : 0;
        const requiredReductionW = Math.max(0, reqFromPower, reqFromPhase);

        // State machine with delays/hysteresis
        const underPowerRelease = !hasPowerLimit ? true : (typeof effPower === 'number' ? effPower <= (limitW - hysteresisW) : true);
        const underPhaseRelease = !considerPhase ? true : (phaseViolation ? false : true); // if no violation, ok
        const releaseConditionNow = underPowerRelease && underPhaseRelease;

        let status = this._status;
        let active = status === 'active';

        if (status === 'inactive') {
            if (violationNow) {
                status = activateDelayS > 0 ? 'pending_on' : 'active';
                this._pendingSince = now;
                if (status === 'active') this._activeSince = now;
            }
        } else if (status === 'pending_on') {
            if (!violationNow) {
                status = 'inactive';
                this._pendingSince = 0;
            } else if ((now - this._pendingSince) >= activateDelayS * 1000) {
                status = 'active';
                this._activeSince = now;
            }
        } else if (status === 'active') {
            if (releaseConditionNow) {
                status = releaseDelayS > 0 ? 'pending_off' : 'inactive';
                this._pendingSince = now;
                if (status === 'inactive') this._pendingSince = 0;
            }
        } else if (status === 'pending_off') {
            if (!releaseConditionNow) {
                status = 'active';
                this._pendingSince = 0;
            } else if ((now - this._pendingSince) >= releaseDelayS * 1000) {
                status = 'inactive';
                this._pendingSince = 0;
            }
        }

        this._status = status;
        active = status === 'active';

        // Reason
        let reason = 'ok';
        if (active || status.startsWith('pending')) {
            if (powerViolation && phaseViolation && considerPhase) reason = 'power_and_phase';
            else if (powerViolation) reason = 'power';
            else if (phaseViolation && considerPhase) reason = 'phase';
            else reason = 'unknown';
        }

        // Dynamic diagnostics
        if (mode === 'dynamic') {
            const baseLoadW = this.dp.getNumber('ps.baseLoadW', 0) || 0;
            const pvW = this.dp.getNumber('ps.pvW', 0) || 0;
            const batteryW = this.dp.getNumber('ps.batteryW', 0) || 0;

            // A heuristic: baseLoad minus PV minus (discharging battery positive?) user-defined conventions differ.
            // We store values as-is and compute a conservative available budget.
            const availableForControlledW = Math.max(0, limitW - Math.max(0, baseLoadW - pvW - batteryW));

            await this.adapter.setStateAsync('peakShaving.dynamic.allowedPowerW', typeof allowedPowerW === 'number' ? allowedPowerW : 0, true);
            await this.adapter.setStateAsync('peakShaving.dynamic.reserveW', reserveW || 0, true);
            await this.adapter.setStateAsync('peakShaving.dynamic.effectiveLimitW', limitW || 0, true);
            await this.adapter.setStateAsync('peakShaving.dynamic.baseLoadW', baseLoadW, true);
            await this.adapter.setStateAsync('peakShaving.dynamic.pvW', pvW, true);
            await this.adapter.setStateAsync('peakShaving.dynamic.batteryW', batteryW, true);
            await this.adapter.setStateAsync('peakShaving.dynamic.availableForControlledW', availableForControlledW, true);

            // Mirror for easier consumption by other modules
            await this.adapter.setStateAsync('peakShaving.control.availableForControlledW', availableForControlledW, true).catch(() => {});
        } else {
            // ensure mirror exists
            await this.adapter.setObjectNotExistsAsync('peakShaving.control.availableForControlledW', {
                type: 'state',
                common: { name: 'Available for controlled loads (W)', type: 'number', role: 'value.power', read: true, write: false },
                native: {},
            }).catch(() => {});
            await this.adapter.setStateAsync('peakShaving.control.availableForControlledW', 0, true).catch(() => {});
        }

        // Publish control states
        await this.adapter.setStateAsync('peakShaving.control.active', active, true);
        await this.adapter.setStateAsync('peakShaving.control.status', status, true);
        await this.adapter.setStateAsync('peakShaving.control.reason', reason, true);
        await this.adapter.setStateAsync('peakShaving.control.limitW', limitW || 0, true);
        await this.adapter.setStateAsync('peakShaving.control.effectivePowerW', typeof effPower === 'number' ? effPower : 0, true);
        await this.adapter.setStateAsync('peakShaving.control.overW', powerViolation ? overW : 0, true);
        await this.adapter.setStateAsync('peakShaving.control.requiredReductionW', active ? requiredReductionW : 0, true);
        await this.adapter.setStateAsync('peakShaving.control.requiredReductionA', active ? requiredReductionA : 0, true);
        await this.adapter.setStateAsync('peakShaving.control.phaseViolation', phaseViolation, true);
        await this.adapter.setStateAsync('peakShaving.control.worstPhase', worstPhase, true);
        await this.adapter.setStateAsync('peakShaving.control.worstPhaseOverA', worstPhaseOverA || 0, true);
        await this.adapter.setStateAsync('peakShaving.control.lastUpdate', now, true);

        // Actuation (Step 1.5)
        const actEnabled = !!cfg.actuationEnabled;
        const actuators = Array.isArray(cfg.actuators) ? cfg.actuators : [];

        // detect transitions to store/restore baselines
        if (active && !this._wasActive) {
            this._baselines.clear();
        }

        if (actEnabled && active && requiredReductionW > 0) {
            await this._applyActuators(actuators, requiredReductionW, voltageV);
        } else if (this._wasActive && !active) {
            await this._restoreActuators(actuators);
        }


        // MU6.1: diagnostics logging (compact)
        const diagCfg = (this.adapter && this.adapter.config && this.adapter.config.diagnostics) ? this.adapter.config.diagnostics : null;
        if (diagCfg && diagCfg.enabled) {
            const lvl = (diagCfg.logLevel === 'info' || diagCfg.logLevel === 'debug') ? diagCfg.logLevel : 'debug';
            const fn = (this.adapter && this.adapter.log && typeof this.adapter.log[lvl] === 'function') ? this.adapter.log[lvl] : this.adapter.log.debug;
            try {
                fn.call(this.adapter.log, `[PS] mode=${mode} active=${active} limit=${Math.round(Number(limitW || 0))}W eff=${Math.round(Number(effPower || 0))}W over=${Math.round(Number(overW || 0))}W availCtl=${Math.round(Number(availableForControlledW || 0))}W reqRed=${Math.round(Number(requiredReductionW || 0))}W`);
            } catch {
                // ignore
            }
        }

        this._wasActive = active;
    }

    async _ensureActuatorChannel(idPart) {
        const ch = `peakShaving.actuators.${idPart}`;
        await this.adapter.setObjectNotExistsAsync(ch, {
            type: 'channel',
            common: { name: idPart },
            native: {},
        });
        const mk = async (sid, name, type, role) => {
            await this.adapter.setObjectNotExistsAsync(`${ch}.${sid}`, {
                type: 'state',
                common: { name, type, role, read: true, write: false },
                native: {},
            });
        };
        await mk('target', 'Target (W/A)', 'number', 'value');
        await mk('appliedReductionW', 'Applied reduction (W)', 'number', 'value.power');
        await mk('status', 'Status', 'string', 'text');
        await mk('lastWrite', 'Last write', 'number', 'value.time');
        return ch;
    }

    async _applyActuators(actuators, requestedReductionW, voltageV) {
        let remainingW = requestedReductionW;

        // stable ordering: enabled, then priority ascending
        const list = actuators
            .filter(a => a && a.enabled !== false)
            .map(a => ({
                id: String(a.id || '').trim(),
                name: a.name || '',
                mode: String(a.mode || 'limitW'),
                phases: Number(a.phases || 3),
                priority: Number(a.priority || 999),
                measurePowerId: String(a.measurePowerId || '').trim(),
                setpointId: String(a.setpointId || '').trim(),
                enableId: String(a.enableId || '').trim(),
                min: num(a.min, null),
                max: num(a.max, null),
            }))
            .filter(a => a.id && (a.setpointId || a.enableId))
            .sort((x, y) => (x.priority - y.priority) || x.id.localeCompare(y.id));

        for (const a of list) {
            if (remainingW <= 0) break;
            const safeId = a.id.toLowerCase().replace(/[^a-z0-9_]+/g, '_').slice(0, 64);
            const ch = await this._ensureActuatorChannel(safeId);

            // Upsert datapoints
            if (a.measurePowerId) await this.dp.upsert({ key: `ps.act.${safeId}.measureW`, objectId: a.measurePowerId, dataType: 'number', direction: 'in', unit: 'W' });
            if (a.setpointId) await this.dp.upsert({ key: `ps.act.${safeId}.setpoint`, objectId: a.setpointId, dataType: 'number', direction: 'out' });
            if (a.enableId) await this.dp.upsert({ key: `ps.act.${safeId}.enable`, objectId: a.enableId, dataType: 'boolean', direction: 'out' });

            const phases = (a.phases === 1 ? 1 : 3);
            const vFactor = voltageV * phases;

            // Baseline capture (once per activation)
            let baseline = null;
            let baselineEnabled = null;

            const mem = this._baselines.get(safeId);
            if (mem) {
                baseline = mem.baseline;
                baselineEnabled = mem.baselineEnabled;
            } else {
                // baseline from measured power, else from current setpoint, else from configured max
                if (a.mode === 'limitW') {
                    const meas = a.measurePowerId ? this.dp.getNumber(`ps.act.${safeId}.measureW`, null) : null;
                    const curSet = a.setpointId ? this.dp.getNumber(`ps.act.${safeId}.setpoint`, null) : null;
                    baseline = typeof meas === 'number' ? meas : (typeof curSet === 'number' ? curSet : (typeof a.max === 'number' ? a.max : null));
                } else if (a.mode === 'limitA') {
                    const curSet = a.setpointId ? this.dp.getNumber(`ps.act.${safeId}.setpoint`, null) : null;
                    baseline = typeof curSet === 'number' ? curSet : (typeof a.max === 'number' ? a.max : null);
                } else if (a.mode === 'onOff') {
                    baseline = null;
                }

                baselineEnabled = a.enableId ? this.dp.getBoolean(`ps.act.${safeId}.enable`, null) : null;
                this._baselines.set(safeId, { mode: a.mode, phases, baseline, baselineEnabled });
            }

            if (a.mode === 'onOff') {
                // if we can cover a chunk of remaining, disable the load
                const measW = a.measurePowerId ? this.dp.getNumber(`ps.act.${safeId}.measureW`, null) : null;
                const assumedW = typeof measW === 'number' && measW > 0 ? measW : (typeof a.max === 'number' ? a.max : 0);
                if (assumedW > 0 && remainingW >= assumedW * 0.5) {
                    if (a.enableId) await this.dp.writeBoolean(`ps.act.${safeId}.enable`, false, false);
                    await this.adapter.setStateAsync(`${ch}.target`, 0, true);
                    await this.adapter.setStateAsync(`${ch}.appliedReductionW`, assumedW, true);
                    await this.adapter.setStateAsync(`${ch}.status`, 'disabled', true);
                    await this.adapter.setStateAsync(`${ch}.lastWrite`, Date.now(), true);
                    remainingW -= assumedW;
                } else {
                    await this.adapter.setStateAsync(`${ch}.status`, 'skipped', true);
                }
                continue;
            }

            if (typeof baseline !== 'number' || !Number.isFinite(baseline)) {
                await this.adapter.setStateAsync(`${ch}.status`, 'no_baseline', true);
                continue;
            }

            if (a.mode === 'limitW') {
                const minW = typeof a.min === 'number' ? a.min : 0;
                const maxW = typeof a.max === 'number' ? a.max : baseline;
                const baseW = clamp(baseline, minW, maxW);
                const reducibleW = Math.max(0, baseW - minW);
                const useW = Math.min(remainingW, reducibleW);
                const targetW = baseW - useW;

                if (a.setpointId) await this.dp.writeNumber(`ps.act.${safeId}.setpoint`, targetW, false);
                if (a.enableId) await this.dp.writeBoolean(`ps.act.${safeId}.enable`, targetW > 0, false);

                await this.adapter.setStateAsync(`${ch}.target`, targetW, true);
                await this.adapter.setStateAsync(`${ch}.appliedReductionW`, useW, true);
                await this.adapter.setStateAsync(`${ch}.status`, 'limited', true);
                await this.adapter.setStateAsync(`${ch}.lastWrite`, Date.now(), true);

                remainingW -= useW;
                continue;
            }

            if (a.mode === 'limitA') {
                const minA = typeof a.min === 'number' ? a.min : 0;
                const maxA = typeof a.max === 'number' ? a.max : baseline;
                const baseA = clamp(baseline, minA, maxA);

                const reducibleA = Math.max(0, baseA - minA);
                const reducibleW = reducibleA * vFactor;
                const useW = Math.min(remainingW, reducibleW);
                const useA = useW / vFactor;
                const targetA = baseA - useA;

                if (a.setpointId) await this.dp.writeNumber(`ps.act.${safeId}.setpoint`, targetA, false);
                if (a.enableId) await this.dp.writeBoolean(`ps.act.${safeId}.enable`, targetA > 0, false);

                await this.adapter.setStateAsync(`${ch}.target`, targetA, true);
                await this.adapter.setStateAsync(`${ch}.appliedReductionW`, useW, true);
                await this.adapter.setStateAsync(`${ch}.status`, 'limited', true);
                await this.adapter.setStateAsync(`${ch}.lastWrite`, Date.now(), true);

                remainingW -= useW;
                continue;
            }

            await this.adapter.setStateAsync(`${ch}.status`, 'unsupported_mode', true);
        }
    }

    async _restoreActuators(actuators) {
        const list = (Array.isArray(actuators) ? actuators : [])
            .filter(a => a && a.enabled !== false)
            .map(a => ({
                id: String(a.id || '').trim(),
                mode: String(a.mode || 'limitW'),
                setpointId: String(a.setpointId || '').trim(),
                enableId: String(a.enableId || '').trim(),
            }))
            .filter(a => a.id && (a.setpointId || a.enableId));

        for (const a of list) {
            const safeId = a.id.toLowerCase().replace(/[^a-z0-9_]+/g, '_').slice(0, 64);
            const mem = this._baselines.get(safeId);
            if (!mem) continue;

            if (a.setpointId) await this.dp.upsert({ key: `ps.act.${safeId}.setpoint`, objectId: a.setpointId, dataType: 'number', direction: 'out' });
            if (a.enableId) await this.dp.upsert({ key: `ps.act.${safeId}.enable`, objectId: a.enableId, dataType: 'boolean', direction: 'out' });

            if (typeof mem.baseline === 'number' && Number.isFinite(mem.baseline) && a.setpointId) {
                await this.dp.writeNumber(`ps.act.${safeId}.setpoint`, mem.baseline, false);
            }
            if (a.enableId && typeof mem.baselineEnabled === 'boolean') {
                await this.dp.writeBoolean(`ps.act.${safeId}.enable`, mem.baselineEnabled, false);
            }
        }
        this._baselines.clear();
    }
}

module.exports = { PeakShavingModule };
