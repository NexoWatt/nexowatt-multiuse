'use strict';

const { BaseModule } = require('./base');

function toSafeIdPart(input) {
    const s = String(input || '').trim();
    if (!s) return '';
    return s.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64);
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

function normalizeChargerType(v) {
    const s = String(v || 'AC').trim().toUpperCase();
    return (s === 'DC') ? 'DC' : 'AC';
}

function normalizeControlBasis(v) {
    const s = String(v || 'auto').trim().toLowerCase();
    if (s === 'currenta' || s === 'a' || s === 'current') return 'currentA';
    if (s === 'powerw' || s === 'w' || s === 'power') return 'powerW';
    return 'auto';
}

class ChargingManagementModule extends BaseModule {
    constructor(adapter, dpRegistry) {
        super(adapter, dpRegistry);
        this._known = new Set(); // wallbox channels created
        this._chargingSinceMs = new Map(); // safeKey -> ms since epoch
        this._chargingLastActiveMs = new Map(); // safeKey -> ms of last detected activity
        this._chargingLastSeenMs = new Map(); // safeKey -> ms of last processing (cleanup)
    }

    _isEnabled() {
        return !!this.adapter.config.enableChargingManagement;
    }

    async init() {
        if (!this._isEnabled()) return;

        await this.adapter.setObjectNotExistsAsync('chargingManagement', {
            type: 'channel',
            common: { name: 'Charging Management' },
            native: {},
        });

        await this.adapter.setObjectNotExistsAsync('chargingManagement.summary', {
            type: 'channel',
            common: { name: 'Summary' },
            native: {},
        });

        await this.adapter.setObjectNotExistsAsync('chargingManagement.control', {
            type: 'channel',
            common: { name: 'Control' },
            native: {},
        });

        const mk = async (id, name, type, role) => {
            await this.adapter.setObjectNotExistsAsync(id, {
                type: 'state',
                common: { name, type, role, read: true, write: false },
                native: {},
            });
        };

        await mk('chargingManagement.wallboxCount', 'Wallbox count', 'number', 'value');
        await mk('chargingManagement.summary.totalPowerW', 'Total power (W)', 'number', 'value.power');
        await mk('chargingManagement.summary.totalCurrentA', 'Total current (A)', 'number', 'value.current');
        await mk('chargingManagement.summary.onlineWallboxes', 'Online wallboxes', 'number', 'value');
        await mk('chargingManagement.summary.totalTargetPowerW', 'Total target power (W)', 'number', 'value.power');
        await mk('chargingManagement.summary.totalTargetCurrentA', 'Total target current (A)', 'number', 'value.current');
        await mk('chargingManagement.summary.lastUpdate', 'Last update', 'number', 'value.time');

        await mk('chargingManagement.control.active', 'Control active', 'boolean', 'indicator');
        await mk('chargingManagement.control.mode', 'Mode', 'string', 'text');
        await mk('chargingManagement.control.status', 'Status', 'string', 'text');
        await mk('chargingManagement.control.budgetMode', 'Budget mode', 'string', 'text');
        await mk('chargingManagement.control.budgetW', 'Budget (W)', 'number', 'value.power');
        await mk('chargingManagement.control.usedW', 'Used (W)', 'number', 'value.power');
        await mk('chargingManagement.control.remainingW', 'Remaining (W)', 'number', 'value.power');
        await mk('chargingManagement.control.pausedByPeakShaving', 'Paused by peak shaving', 'boolean', 'indicator');
        await this.adapter.setObjectNotExistsAsync('chargingManagement.debug', {
            type: 'channel',
            common: { name: 'Debug' },
            native: {},
        });

        await mk('chargingManagement.debug.lastRun', 'Last run', 'number', 'value.time');
        await mk('chargingManagement.debug.sortedOrder', 'Sorted order (safe keys)', 'string', 'text');
        await mk('chargingManagement.debug.allocations', 'Allocations (JSON)', 'string', 'text');
    }

    async _ensureWallboxChannel(key) {
        const safe = toSafeIdPart(key);
        const ch = `chargingManagement.wallboxes.${safe}`;
        if (this._known.has(ch)) return ch;

        await this.adapter.setObjectNotExistsAsync('chargingManagement.wallboxes', {
            type: 'channel',
            common: { name: 'Wallboxes' },
            native: {},
        });

        await this.adapter.setObjectNotExistsAsync(ch, {
            type: 'channel',
            common: { name: safe },
            native: {},
        });

        const mk = async (id, name, type, role) => {
            await this.adapter.setObjectNotExistsAsync(`${ch}.${id}`, {
                type: 'state',
                common: { name, type, role, read: true, write: false },
                native: {},
            });
        };

        await mk('name', 'Name', 'string', 'text');
        await mk('enabled', 'Enabled', 'boolean', 'indicator');
        await mk('online', 'Online', 'boolean', 'indicator');
        await mk('priority', 'Priority', 'number', 'value');
        await mk('chargerType', 'Charger type', 'string', 'text');
        await mk('controlBasis', 'Control basis', 'string', 'text');
        await mk('phases', 'Phases', 'number', 'value');
        await mk('minPowerW', 'Min power (W)', 'number', 'value.power');
        await mk('maxPowerW', 'Max power (W)', 'number', 'value.power');
        await mk('actualPowerW', 'Actual power (W)', 'number', 'value.power');
        await mk('actualCurrentA', 'Actual current (A)', 'number', 'value.current');
        await mk('charging', 'Charging', 'boolean', 'indicator');
        await mk('chargingSince', 'Charging since (ms)', 'number', 'value.time');
        await mk('chargingRaw', 'Charging raw (threshold)', 'boolean', 'indicator');
        await mk('lastActive', 'Last active (ms)', 'number', 'value.time');
        await mk('idleMs', 'Idle since last active (ms)', 'number', 'value.time');
        await mk('allocationRank', 'Allocation rank', 'number', 'value');
        await mk('targetCurrentA', 'Target current (A)', 'number', 'value.current');
        await mk('targetPowerW', 'Target power (W)', 'number', 'value.power');
        await mk('applied', 'Applied', 'boolean', 'indicator');
        await mk('reason', 'Reason', 'string', 'text');

        this._known.add(ch);
        return ch;
    }

    async _getPeakShavingActive() {
        try {
            const st = await this.adapter.getStateAsync('peakShaving.control.active');
            return st ? !!st.val : false;
        } catch {
            return false;
        }
    }

    async _getPeakShavingBudgetW() {
        try {
            const st = await this.adapter.getStateAsync('peakShaving.dynamic.availableForControlledW');
            const n = st ? Number(st.val) : NaN;
            return Number.isFinite(n) ? n : null;
        } catch {
            return null;
        }
    }

    /**
     * Step 2.2.1:
     * - Mixed AC/DC operation via per-wallbox chargerType + controlBasis
     * - Budget distribution in W (supports DC fast chargers up to 1000 kW and beyond)
     */
    async tick() {
        if (!this._isEnabled()) return;

        const cfg = this.adapter.config.chargingManagement || {};
        const mode = String(cfg.mode || 'off'); // off | pvSurplus | mixed (future)
        const wallboxes = Array.isArray(cfg.wallboxes) ? cfg.wallboxes : [];

        const voltageV = clamp(num(cfg.voltageV, 230), 50, 400);
        const defaultPhases = Number(cfg.defaultPhases || 3) === 1 ? 1 : 3;
        const defaultMinA = clamp(num(cfg.minCurrentA, 6), 0, 2000);
        const defaultMaxA = clamp(num(cfg.maxCurrentA, 16), 0, 2000);

        const acMinPower3pW = clamp(num(cfg.acMinPower3pW, 4200), 0, 1e12);
        const activityThresholdW = clamp(num(cfg.activityThresholdW, 200), 0, 1e12);
        const stopGraceSec = clamp(num(cfg.stopGraceSec, 30), 0, 3600);
        const sessionKeepSec = clamp(num(cfg.sessionKeepSec, 300), 0, 86400);
        const stopGraceMs = stopGraceSec * 1000;
        const sessionKeepMs = Math.max(sessionKeepSec, stopGraceSec) * 1000;
        const sessionCleanupStaleMs = Math.max(sessionKeepMs * 2, 30 * 60 * 1000); // avoid memory leaks for removed wallboxes
        // Budget selection
        const budgetMode = String(cfg.totalBudgetMode || 'unlimited'); // unlimited | static | fromPeakShaving | fromDatapoint
        const staticBudgetW = clamp(num(cfg.staticMaxChargingPowerW, 0), 0, 1e12);
        const budgetPowerId = String(cfg.budgetPowerId || '').trim();
        const pauseWhenPeakShavingActive = cfg.pauseWhenPeakShavingActive !== false; // default true

        if (budgetPowerId && this.dp) {
            await this.dp.upsert({ key: 'cm.budgetPowerW', objectId: budgetPowerId, dataType: 'number', direction: 'in', unit: 'W' });
        }

        // Measurements and object mapping
        let totalPowerW = 0;
        let totalCurrentA = 0;
        let onlineCount = 0;

        /** @type {Array<any>} */
        const wbList = [];

        const now = Date.now();
        await this.adapter.setStateAsync('chargingManagement.debug.lastRun', now, true);
        await this.adapter.setStateAsync('chargingManagement.debug.sortedOrder', '', true);
        await this.adapter.setStateAsync('chargingManagement.debug.allocations', '[]', true);
        for (const wb of wallboxes) {
            const key = String(wb.key || '').trim();
            if (!key) continue;

            const safe = toSafeIdPart(key);
            const ch = await this._ensureWallboxChannel(key);

            const enabled = wb.enabled !== false;
            const priority = clamp(num(wb.priority, 999), 1, 999);
            const chargerType = normalizeChargerType(wb.chargerType);
            const controlBasisCfg = normalizeControlBasis(wb.controlBasis);

            // For AC: phases/current bounds apply. For DC: phases are informational; distribution is watt-based.
            const phases = Number(wb.phases || defaultPhases) === 1 ? 1 : 3;
            let minA = clamp(num(wb.minA, defaultMinA), 0, 2000);
            const maxA = clamp(num(wb.maxA, defaultMaxA), 0, 2000);

            const minPowerWCfg = clamp(num(wb.minPowerW, null), 0, 1e12);
            const maxPowerWCfg = clamp(num(wb.maxPowerW, null), 0, 1e12);

            // datapoint IDs
            const actualPowerWId = String(wb.actualPowerWId || '').trim();
            const actualCurrentAId = String(wb.actualCurrentAId || '').trim();
            const setCurrentAId = String(wb.setCurrentAId || '').trim();
            const setPowerWId = String(wb.setPowerWId || '').trim();
            const enableId = String(wb.enableId || '').trim();
            const statusId = String(wb.statusId || '').trim();

            // phase measurement IDs (optional)
            const l1Id = String(wb.phaseL1AId || '').trim();
            const l2Id = String(wb.phaseL2AId || '').trim();
            const l3Id = String(wb.phaseL3AId || '').trim();

            // Register dp mappings
            if (this.dp) {
                if (actualPowerWId) await this.dp.upsert({ key: `cm.wb.${safe}.pW`, objectId: actualPowerWId, dataType: 'number', direction: 'in', unit: 'W' });
                if (actualCurrentAId) await this.dp.upsert({ key: `cm.wb.${safe}.iA`, objectId: actualCurrentAId, dataType: 'number', direction: 'in', unit: 'A' });
                if (setCurrentAId) await this.dp.upsert({ key: `cm.wb.${safe}.setA`, objectId: setCurrentAId, dataType: 'number', direction: 'out', unit: 'A', deadband: 0.1 });
                if (setPowerWId) await this.dp.upsert({ key: `cm.wb.${safe}.setW`, objectId: setPowerWId, dataType: 'number', direction: 'out', unit: 'W', deadband: 25 });
                if (enableId) await this.dp.upsert({ key: `cm.wb.${safe}.en`, objectId: enableId, dataType: 'boolean', direction: 'out' });
                if (statusId) await this.dp.upsert({ key: `cm.wb.${safe}.st`, objectId: statusId, dataType: 'mixed', direction: 'in' });

                if (l1Id) await this.dp.upsert({ key: `cm.wb.${safe}.l1A`, objectId: l1Id, dataType: 'number', direction: 'in', unit: 'A' });
                if (l2Id) await this.dp.upsert({ key: `cm.wb.${safe}.l2A`, objectId: l2Id, dataType: 'number', direction: 'in', unit: 'A' });
                if (l3Id) await this.dp.upsert({ key: `cm.wb.${safe}.l3A`, objectId: l3Id, dataType: 'number', direction: 'in', unit: 'A' });
            }

            // Read measurements (cache-based)
            const pW = (actualPowerWId && this.dp) ? this.dp.getNumber(`cm.wb.${safe}.pW`, null) : null;
            const iA = (actualCurrentAId && this.dp) ? this.dp.getNumber(`cm.wb.${safe}.iA`, null) : null;

            // Online detection: status if present, otherwise assume online when enabled
            const statusRaw = (statusId && this.dp) ? this.dp.getRaw(`cm.wb.${safe}.st`) : null;
            let online = enabled;
            if (statusId) {
                if (statusRaw === null || statusRaw === undefined) online = false;
                else if (typeof statusRaw === 'boolean') online = statusRaw;
                else if (typeof statusRaw === 'number') online = statusRaw !== 0;
                else if (typeof statusRaw === 'string') {
                    const s = statusRaw.trim().toLowerCase();
                    online = !(s === '' || s === 'offline' || s === 'false' || s === '0' || s === 'disconnected');
                } else {
                    online = true;
                }
            }

            // Charging detection (used for arrival-based stepwise allocation)
            const pWNum = (typeof pW === 'number' && Number.isFinite(pW)) ? pW : 0;
            const pWAbs = Math.abs(pWNum);
            const isChargingRaw = online && enabled && pWAbs >= activityThresholdW;
            
            // Session tracking / stickiness
            this._chargingLastSeenMs.set(safe, now);
            
            let chargingSince = 0;
            let lastActive = 0;
            const prevSince = this._chargingSinceMs.get(safe);
            if (typeof prevSince === 'number' && Number.isFinite(prevSince) && prevSince > 0) chargingSince = prevSince;
            const prevLastActive = this._chargingLastActiveMs.get(safe);
            if (typeof prevLastActive === 'number' && Number.isFinite(prevLastActive) && prevLastActive > 0) lastActive = prevLastActive;
            
            if (!enabled) {
                // Disabled by config: clear immediately
                chargingSince = 0;
                lastActive = 0;
                this._chargingSinceMs.delete(safe);
                this._chargingLastActiveMs.delete(safe);
            } else if (isChargingRaw) {
                // If we were idle longer than sessionKeepMs, start a new session
                if (!chargingSince || !lastActive || (now - lastActive) > sessionKeepMs) chargingSince = now;
                lastActive = now;
                this._chargingSinceMs.set(safe, chargingSince);
                this._chargingLastActiveMs.set(safe, lastActive);
            } else {
                // Not actively charging: keep session for a while to avoid splits on short dips
                if (chargingSince && lastActive) {
                    const idleMs = now - lastActive;
                    const offlineTooLong = (!online && idleMs > stopGraceMs);
                    if (idleMs > sessionKeepMs || offlineTooLong) {
                        chargingSince = 0;
                        lastActive = 0;
                        this._chargingSinceMs.delete(safe);
                        this._chargingLastActiveMs.delete(safe);
                    }
                } else {
                    this._chargingSinceMs.delete(safe);
                    this._chargingLastActiveMs.delete(safe);
                }
            }
            
            const isCharging = online && enabled && (isChargingRaw || (chargingSince && lastActive && (now - lastActive) <= stopGraceMs));
            const chargingSinceForState = isCharging ? chargingSince : 0;
            
            // Determine effective control basis for this device
            const hasSetA = !!setCurrentAId;
            const hasSetW = !!setPowerWId;

            let controlBasis = controlBasisCfg;
            if (controlBasis === 'currentA') {
                controlBasis = hasSetA ? 'currentA' : (hasSetW ? 'powerW' : 'auto');
            } else if (controlBasis === 'powerW') {
                controlBasis = hasSetW ? 'powerW' : (hasSetA ? 'currentA' : 'auto');
            }

            if (controlBasis === 'auto') {
                if (chargerType === 'DC') {
                    controlBasis = hasSetW ? 'powerW' : (hasSetA ? 'currentA' : 'none');
                } else {
                    controlBasis = hasSetA ? 'currentA' : (hasSetW ? 'powerW' : 'none');
                }
            }

            // Compute min/max power caps for distribution (W)
            const vFactor = voltageV * phases;

            let minPW = 0;
            let maxPW = 0;

            if (chargerType === 'DC') {
                // For DC we primarily operate in W.
                minPW = (typeof minPowerWCfg === 'number' && Number.isFinite(minPowerWCfg)) ? minPowerWCfg : 0;

                // Default DC max to 1000kW if not configured
                const DEFAULT_DC_MAX_W = 1_000_000;
                if (typeof maxPowerWCfg === 'number' && Number.isFinite(maxPowerWCfg) && maxPowerWCfg > 0) {
                    maxPW = maxPowerWCfg;
                } else {
                    maxPW = DEFAULT_DC_MAX_W;
                }

                if (maxPW < minPW) minPW = maxPW;
            } else {
                // AC: if controlling by power, allow explicit min/max power, else derive from min/max current
                const minFromA = Math.max(0, minA) * vFactor;
                const maxFromA = Math.max(0, maxA) * vFactor;

                if (controlBasis === 'powerW') {
                    minPW = (typeof minPowerWCfg === 'number' && Number.isFinite(minPowerWCfg) && minPowerWCfg > 0) ? minPowerWCfg : minFromA;
                    maxPW = (typeof maxPowerWCfg === 'number' && Number.isFinite(maxPowerWCfg) && maxPowerWCfg > 0) ? maxPowerWCfg : maxFromA;
                } else {
                    minPW = minFromA;
                    maxPW = maxFromA;
                }

                if (maxPW < minPW) minPW = maxPW;

                if (phases === 3 && acMinPower3pW > 0) {
                    // Practical AC 3-phase minimum: avoid 3p chargers dropping below ~4.2kW.
                    minPW = Math.max(minPW, acMinPower3pW);
                }

                // Quantize min power to 0.1A steps for current-based control (avoid unreachable minPW)
                if (controlBasis === 'currentA' && vFactor > 0 && minPW > 0) {
                    const minAFromMinPW = Math.ceil((minPW / vFactor) * 10) / 10;
                    if (Number.isFinite(minAFromMinPW) && minAFromMinPW > 0) {
                        minA = Math.max(minA, minAFromMinPW);
                        minPW = minAFromMinPW * vFactor;
                    }
                }

                // Note: if maxPW < minPW after enforcement, this wallbox cannot be started.
            }

            if (typeof pW === 'number') totalPowerW += pW;
            if (typeof iA === 'number') totalCurrentA += iA;
            if (online) onlineCount += 1;

            await this.adapter.setStateAsync(`${ch}.name`, String(wb.name || key), true);
            await this.adapter.setStateAsync(`${ch}.enabled`, enabled, true);
            await this.adapter.setStateAsync(`${ch}.online`, online, true);
            await this.adapter.setStateAsync(`${ch}.priority`, priority, true);
            await this.adapter.setStateAsync(`${ch}.chargerType`, chargerType, true);
            await this.adapter.setStateAsync(`${ch}.controlBasis`, controlBasis, true);
            await this.adapter.setStateAsync(`${ch}.phases`, phases, true);
            await this.adapter.setStateAsync(`${ch}.minPowerW`, minPW, true);
            await this.adapter.setStateAsync(`${ch}.maxPowerW`, maxPW, true);
            await this.adapter.setStateAsync(`${ch}.actualPowerW`, typeof pW === 'number' ? pW : 0, true);
            await this.adapter.setStateAsync(`${ch}.actualCurrentA`, typeof iA === 'number' ? iA : 0, true);

            await this.adapter.setStateAsync(`${ch}.charging`, isCharging, true);
            await this.adapter.setStateAsync(`${ch}.chargingSince`, chargingSinceForState, true);
            await this.adapter.setStateAsync(`${ch}.chargingRaw`, isChargingRaw, true);
            await this.adapter.setStateAsync(`${ch}.lastActive`, lastActive || 0, true);
            await this.adapter.setStateAsync(`${ch}.idleMs`, lastActive ? (now - lastActive) : 0, true);
            await this.adapter.setStateAsync(`${ch}.allocationRank`, 0, true);
            wbList.push({
                key,
                safe,
                ch,
                name: String(wb.name || key),
                enabled,
                online,
                charging: isCharging,
                chargingSinceMs: chargingSinceForState,
                actualPowerW: pWNum,
                priority,
                chargerType,
                controlBasis,
                phases,
                voltageV,
                minA,
                maxA,
                minPW,
                maxPW,
                vFactor,
                setAKey: hasSetA ? `cm.wb.${safe}.setA` : null,
                setWKey: hasSetW ? `cm.wb.${safe}.setW` : null,
                enableKey: enableId ? `cm.wb.${safe}.en` : null,
            });
        }

        await this.adapter.setStateAsync('chargingManagement.wallboxCount', wbList.length, true);
        await this.adapter.setStateAsync('chargingManagement.summary.totalPowerW', totalPowerW, true);
        await this.adapter.setStateAsync('chargingManagement.summary.totalCurrentA', totalCurrentA, true);
        await this.adapter.setStateAsync('chargingManagement.summary.onlineWallboxes', onlineCount, true);

        // Determine budget
        let budgetW = Number.POSITIVE_INFINITY;
        let effectiveBudgetMode = budgetMode;
        /** @type {any|null} */
        let budgetDebug = null;

        const getFirstDpNumber = (keys) => {
            if (!this.dp) return null;
            for (const k of keys) {
                const v = this.dp.getNumber(k, null);
                if (typeof v === 'number' && Number.isFinite(v)) return v;
            }
            return null;
        };

        if (budgetMode === 'engine') {
            /** @type {Array<{k:string, w:number}>} */
            const components = [];

            // Static hard cap (optional)
            if (staticBudgetW > 0) components.push({ k: 'static', w: staticBudgetW });

            // External cap (optional)
            const ext = (budgetPowerId && this.dp) ? this.dp.getNumber('cm.budgetPowerW', null) : null;
            if (typeof ext === 'number' && Number.isFinite(ext) && ext > 0) components.push({ k: 'external', w: ext });

            // Peak-shaving cap (optional)
            const peak = await this._getPeakShavingBudgetW();
            if (typeof peak === 'number' && Number.isFinite(peak) && peak > 0) components.push({ k: 'peakShaving', w: peak });

            // Tariff cap (optional via globalDatapoints mapping)
            const tariff = getFirstDpNumber(['cm.tariffBudgetW', 'cm.tariffLimitW']);
            if (typeof tariff === 'number' && Number.isFinite(tariff) && tariff > 0) components.push({ k: 'tariff', w: tariff });

            // PV-surplus cap (optional; enabled by mode=pvSurplus or pvSurplusOnly)
            const pvSurplusOnly = cfg.pvSurplusOnly === true || mode === 'pvSurplus';

            let pvSurplusW = getFirstDpNumber(['cm.pvSurplusW']);
            const gridW = getFirstDpNumber(['cm.gridPowerW', 'ps.gridPowerW']);

            if (typeof pvSurplusW !== 'number' || !Number.isFinite(pvSurplusW)) {
                // Convention: negative grid power => export. If your source uses the opposite sign, invert via globalDatapoints.
                if (typeof gridW === 'number' && Number.isFinite(gridW)) {
                    pvSurplusW = Math.max(0, -gridW);
                }
            }

            if (pvSurplusOnly) {
                const pvCap = (typeof pvSurplusW === 'number' && Number.isFinite(pvSurplusW) && pvSurplusW > 0) ? pvSurplusW : 0;
                components.push({ k: 'pvSurplus', w: pvCap });
            }

            if (components.length) {
                let min = Number.POSITIVE_INFINITY;
                for (const c of components) {
                    const w = Number(c.w);
                    if (Number.isFinite(w)) min = Math.min(min, w);
                }
                budgetW = Number.isFinite(min) ? min : Number.POSITIVE_INFINITY;

                const eps = 0.001;
                const bind = components
                    .filter(c => Number.isFinite(Number(c.w)) && Math.abs(Number(c.w) - budgetW) <= eps)
                    .map(c => c.k);

                effectiveBudgetMode = `engine:${bind.length ? bind.join('+') : 'unlimited'}`;
            } else {
                budgetW = Number.POSITIVE_INFINITY;
                effectiveBudgetMode = 'engine:unlimited';
            }

            budgetDebug = {
                engine: true,
                mode,
                pvSurplusOnly,
                gridW: (typeof gridW === 'number' && Number.isFinite(gridW)) ? gridW : null,
                pvSurplusW: (typeof pvSurplusW === 'number' && Number.isFinite(pvSurplusW)) ? pvSurplusW : null,
                components,
            };
        } else if (budgetMode === 'static') {
            budgetW = staticBudgetW > 0 ? staticBudgetW : Number.POSITIVE_INFINITY;
        } else if (budgetMode === 'fromDatapoint') {
            const b = (budgetPowerId && this.dp) ? this.dp.getNumber('cm.budgetPowerW', null) : null;
            budgetW = (typeof b === 'number' && b > 0) ? b : Number.POSITIVE_INFINITY;
        } else if (budgetMode === 'fromPeakShaving') {
            const b = await this._getPeakShavingBudgetW();
            budgetW = (typeof b === 'number' && b > 0) ? b : Number.POSITIVE_INFINITY;
        } else {
            budgetW = Number.POSITIVE_INFINITY;
        }

        const peakActive = await this._getPeakShavingActive();
        const paused = pauseWhenPeakShavingActive && peakActive;

        const controlActive = mode !== 'off' && !paused;
        await this.adapter.setStateAsync('chargingManagement.control.active', controlActive, true);
        await this.adapter.setStateAsync('chargingManagement.control.mode', mode, true);
        await this.adapter.setStateAsync('chargingManagement.control.budgetMode', effectiveBudgetMode, true);
        await this.adapter.setStateAsync('chargingManagement.control.pausedByPeakShaving', paused, true);

        if (mode === 'off') {
            await this.adapter.setStateAsync('chargingManagement.control.status', 'off', true);
            await this.adapter.setStateAsync('chargingManagement.control.budgetW', Number.isFinite(budgetW) ? budgetW : 0, true);
            await this.adapter.setStateAsync('chargingManagement.control.usedW', 0, true);
            await this.adapter.setStateAsync('chargingManagement.control.remainingW', Number.isFinite(budgetW) ? budgetW : 0, true);
            // Cleanup session tracking for removed wallboxes (avoid memory leaks)
            for (const [safeKey, lastSeenTs] of this._chargingLastSeenMs.entries()) {
                const ls = (typeof lastSeenTs === 'number' && Number.isFinite(lastSeenTs)) ? lastSeenTs : 0;
                if (!ls || (now - ls) > sessionCleanupStaleMs) {
                    this._chargingLastSeenMs.delete(safeKey);
                    this._chargingLastActiveMs.delete(safeKey);
                    this._chargingSinceMs.delete(safeKey);
                }
            }

            await this.adapter.setStateAsync('chargingManagement.summary.totalTargetPowerW', 0, true);
            await this.adapter.setStateAsync('chargingManagement.summary.totalTargetCurrentA', 0, true);
            await this.adapter.setStateAsync('chargingManagement.summary.lastUpdate', Date.now(), true);
            return;
        }

        if (paused) {
            await this.adapter.setStateAsync('chargingManagement.control.status', 'paused_by_peak_shaving', true);
            await this.adapter.setStateAsync('chargingManagement.control.budgetW', Number.isFinite(budgetW) ? budgetW : 0, true);
            await this.adapter.setStateAsync('chargingManagement.control.usedW', 0, true);
            await this.adapter.setStateAsync('chargingManagement.control.remainingW', Number.isFinite(budgetW) ? budgetW : 0, true);
            // Cleanup session tracking for removed wallboxes (avoid memory leaks)
            for (const [safeKey, lastSeenTs] of this._chargingLastSeenMs.entries()) {
                const ls = (typeof lastSeenTs === 'number' && Number.isFinite(lastSeenTs)) ? lastSeenTs : 0;
                if (!ls || (now - ls) > sessionCleanupStaleMs) {
                    this._chargingLastSeenMs.delete(safeKey);
                    this._chargingLastActiveMs.delete(safeKey);
                    this._chargingSinceMs.delete(safeKey);
                }
            }

            await this.adapter.setStateAsync('chargingManagement.summary.totalTargetPowerW', 0, true);
            await this.adapter.setStateAsync('chargingManagement.summary.totalTargetCurrentA', 0, true);
            await this.adapter.setStateAsync('chargingManagement.summary.lastUpdate', Date.now(), true);
            return;
        }

        // Priority distribution in W across mixed AC/DC chargers
        const sorted = wbList
            .filter(w => w.enabled && w.online)
            .sort((a, b) => {
                const ac = a.charging ? 1 : 0;
                const bc = b.charging ? 1 : 0;
                if (ac !== bc) return bc - ac; // charging first

                // Earlier charging sessions first (arrival order). Non-charging get Infinity and fall back to priority.
                const as = (Number.isFinite(a.chargingSinceMs) && a.chargingSinceMs > 0) ? a.chargingSinceMs : Infinity;
                const bs = (Number.isFinite(b.chargingSinceMs) && b.chargingSinceMs > 0) ? b.chargingSinceMs : Infinity;
                if (as !== bs) return as - bs;

                const ap = Number.isFinite(a.priority) ? a.priority : 9999;
                const bp = Number.isFinite(b.priority) ? b.priority : 9999;
                if (ap !== bp) return ap - bp;

                const ask = String(a.safe || '');
                const bsk = String(b.safe || '');
                return ask.localeCompare(bsk);
            });

        // MU3.1: expose allocation order for transparency
        for (let i = 0; i < sorted.length; i++) {
            const w = sorted[i];
            await this.adapter.setStateAsync(`${w.ch}.allocationRank`, i + 1, true);
        }
        await this.adapter.setStateAsync('chargingManagement.debug.sortedOrder', sorted.map(w => w.safe).join(','), true);

        const debugAlloc = [];
        // MU4.1: publish budget engine inputs for transparency in debug output
        try {
            debugAlloc.push({
                type: 'budget',
                budgetW: Number.isFinite(budgetW) ? budgetW : null,
                budgetMode: effectiveBudgetMode,
                details: budgetDebug,
            });
        } catch {
            // ignore
        }

        let remainingW = budgetW;
        let usedW = 0;

        let totalTargetPowerW = 0;
        let totalTargetCurrentA = 0;

        for (const w of sorted) {
            let targetW = 0;
            let targetA = 0;
            let reason = 'limited_by_budget';

            if (w.controlBasis === 'none') {
                reason = 'no_setpoint';
                targetW = 0;
                targetA = 0;
            } else if (!Number.isFinite(remainingW)) {
                // unlimited
                targetW = w.maxPW;
                reason = 'unlimited';
            } else if (remainingW <= 0) {
                targetW = 0;
                reason = 'no_budget';
            } else if (remainingW >= w.minPW || w.minPW === 0) {
                targetW = Math.min(remainingW, w.maxPW);
                reason = 'allocated';
                if (targetW > 0 && w.minPW > 0 && targetW < w.minPW) {
                    targetW = 0;
                    reason = 'below_min';
                }
            } else {
                targetW = 0;
                reason = 'below_min';
            }

            // Convert to A for AC current-based control
            if (w.controlBasis === 'currentA' && w.setAKey) {
                const vFactor = w.vFactor;
                const maxA = w.maxA;
                const minA = w.minA;

                let aRaw = (targetW > 0 && vFactor > 0) ? (targetW / vFactor) : 0;
                aRaw = clamp(aRaw, 0, maxA);

                // round DOWN to 0.1A to avoid budget overshoot
                let aRounded = Math.floor(aRaw * 10) / 10;

                // Apply minA (avoid rounding-down dropping below min)
                if (aRounded > 0 && aRounded < minA) {
                    // try rounding up to the next 0.1A step if that would satisfy minA
                    const aUp = Math.ceil(aRaw * 10) / 10;
                    if (aUp >= minA && aUp <= maxA) {
                        aRounded = aUp;
                    } else {
                        aRounded = 0;
                    }
                }
                if (aRounded < minA) aRounded = 0;
                targetA = aRounded;
                targetW = targetA * vFactor;

                // Safety: enforce min power after quantization
                if (targetW > 0 && w.minPW > 0 && targetW < w.minPW) {
                    targetA = 0;
                    targetW = 0;
                    reason = 'below_min';
                }
            } else if (w.chargerType === 'AC') {
                // purely informational for power-based AC
                const vFactor = w.vFactor;
                targetA = (targetW > 0 && vFactor > 0) ? (targetW / vFactor) : 0;
            } else {
                // DC: current is not summed
                targetA = 0;
            }

            // Apply budget accounting
            if (Number.isFinite(remainingW)) {
                remainingW = Math.max(0, remainingW - targetW);
                usedW += targetW;
            }

            totalTargetPowerW += targetW;
            if (Number.isFinite(targetA) && targetA > 0) totalTargetCurrentA += targetA;

            // Writes
            let applied = false;

            if (this.dp) {
                if (w.controlBasis === 'currentA' && w.setAKey) {
                    applied = await this.dp.writeNumber(w.setAKey, targetA, false);
                } else if (w.controlBasis === 'powerW' && w.setWKey) {
                    applied = await this.dp.writeNumber(w.setWKey, Math.round(targetW), false);
                } else if (w.controlBasis !== 'none') {
                    // Fallback: if basis says current but we only have W, or vice versa
                    if (w.setWKey) applied = await this.dp.writeNumber(w.setWKey, Math.round(targetW), false);
                    else if (w.setAKey) applied = await this.dp.writeNumber(w.setAKey, targetA, false);
                }

                if (w.enableKey) {
                    await this.dp.writeBoolean(w.enableKey, targetW > 0, false);
                }
            }

            await this.adapter.setStateAsync(`${w.ch}.targetCurrentA`, targetA, true);
            await this.adapter.setStateAsync(`${w.ch}.targetPowerW`, targetW, true);
            await this.adapter.setStateAsync(`${w.ch}.applied`, applied, true);
            await this.adapter.setStateAsync(`${w.ch}.reason`, reason, true);
            debugAlloc.push({ safe: w.safe, name: w.name, charging: !!w.charging, chargingSinceMs: w.chargingSinceMs || 0, priority: w.priority, controlBasis: w.controlBasis, chargerType: w.chargerType, targetW, targetA, applied, reason });
        }

        // wallboxes that are disabled/offline: expose targets as 0 (no writes)
        for (const w of wbList) {
            if (w.enabled && w.online) continue;
            await this.adapter.setStateAsync(`${w.ch}.targetCurrentA`, 0, true);
            await this.adapter.setStateAsync(`${w.ch}.targetPowerW`, 0, true);
            await this.adapter.setStateAsync(`${w.ch}.applied`, false, true);
            await this.adapter.setStateAsync(`${w.ch}.reason`, w.enabled ? (w.online ? 'skipped' : 'offline') : 'disabled', true);
        }

        try {
            const s = JSON.stringify(debugAlloc);
            await this.adapter.setStateAsync('chargingManagement.debug.allocations', s.length > 20000 ? (s.slice(0, 20000) + '...') : s, true);
        } catch {
            await this.adapter.setStateAsync('chargingManagement.debug.allocations', '[]', true);
        }

        await this.adapter.setStateAsync('chargingManagement.control.status', 'ok', true);
        await this.adapter.setStateAsync('chargingManagement.control.budgetW', Number.isFinite(budgetW) ? budgetW : 0, true);
        await this.adapter.setStateAsync('chargingManagement.control.usedW', Number.isFinite(budgetW) ? usedW : totalTargetPowerW, true);
        await this.adapter.setStateAsync('chargingManagement.control.remainingW', Number.isFinite(budgetW) ? remainingW : 0, true);

            // Cleanup session tracking for removed wallboxes (avoid memory leaks)
            for (const [safeKey, lastSeenTs] of this._chargingLastSeenMs.entries()) {
                const ls = (typeof lastSeenTs === 'number' && Number.isFinite(lastSeenTs)) ? lastSeenTs : 0;
                if (!ls || (now - ls) > sessionCleanupStaleMs) {
                    this._chargingLastSeenMs.delete(safeKey);
                    this._chargingLastActiveMs.delete(safeKey);
                    this._chargingSinceMs.delete(safeKey);
                }
            }

        await this.adapter.setStateAsync('chargingManagement.summary.totalTargetPowerW', totalTargetPowerW, true);
        await this.adapter.setStateAsync('chargingManagement.summary.totalTargetCurrentA', totalTargetCurrentA, true);
        await this.adapter.setStateAsync('chargingManagement.summary.lastUpdate', Date.now(), true);
    }
}

module.exports = { ChargingManagementModule };