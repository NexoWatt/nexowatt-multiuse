'use strict';

const { PeakShavingModule } = require('./modules/peak-shaving');
const { ChargingManagementModule } = require('./modules/charging-management');
const { MultiUseModule } = require('./modules/multi-use');

class ModuleManager {
    /**
     * @param {import('@iobroker/adapter-core').AdapterInstance} adapter
     * @param {*} dpRegistry
     */
    constructor(adapter, dpRegistry) {
        this.adapter = adapter;
        this.dp = dpRegistry || null;

        /** @type {Array<{key: string, instance: any, enabledFn: () => boolean}>} */
        this.modules = [];
    }

    _getDiagCfg() {
        const cfg = (this.adapter && this.adapter.config && this.adapter.config.diagnostics) ? this.adapter.config.diagnostics : null;
        const enabled = !!(cfg && cfg.enabled);
        const writeStates = enabled && (cfg.writeStates !== false);
        const logLevel = (cfg && (cfg.logLevel === 'info' || cfg.logLevel === 'debug')) ? cfg.logLevel : 'debug';
        const maxJsonLenNum = cfg ? Number(cfg.maxJsonLen) : NaN;
        const maxJsonLen = (Number.isFinite(maxJsonLenNum) && maxJsonLenNum >= 1000) ? maxJsonLenNum : 20000;
        return { enabled, writeStates, logLevel, maxJsonLen };
    }

    _diagLog(level, msg) {
        const lvl = (level === 'info' || level === 'debug') ? level : 'debug';
        const fn = (this.adapter && this.adapter.log && typeof this.adapter.log[lvl] === 'function')
            ? this.adapter.log[lvl]
            : (this.adapter && this.adapter.log ? this.adapter.log.debug : null);
        try {
            if (fn) fn.call(this.adapter.log, msg);
        } catch {
            // ignore
        }
    }

    _limitJson(obj, maxLen) {
        let s = '';
        try {
            s = JSON.stringify(obj);
        } catch {
            s = '[]';
        }
        if (!maxLen || !Number.isFinite(maxLen) || maxLen < 1000) maxLen = 20000;
        return s.length > maxLen ? (s.slice(0, maxLen) + '...') : s;
    }

    async init() {
        // Peak shaving
        this.modules.push({
            key: 'peakShaving',
            instance: new PeakShavingModule(this.adapter, this.dp),
            enabledFn: () => !!this.adapter.config.enablePeakShaving,
        });

        // Charging management
        this.modules.push({
            key: 'chargingManagement',
            instance: new ChargingManagementModule(this.adapter, this.dp),
            enabledFn: () => !!this.adapter.config.enableChargingManagement,
        });

        // Multi use (future)
        this.modules.push({
            key: 'multiUse',
            instance: new MultiUseModule(this.adapter, this.dp),
            enabledFn: () => !!this.adapter.config.enableMultiUse,
        });

        // Init enabled modules
        for (const m of this.modules) {
            if (!m.enabledFn()) continue;
            if (typeof m.instance.init !== 'function') continue;
            try {
                await m.instance.init();
            } catch (e) {
                this.adapter.log.warn(`Module '${m.key}' init error: ${e?.message || e}`);
            }
        }
    }

    async tick() {
        const diag = this._getDiagCfg();
        const t0 = Date.now();

        /** @type {Array<{key: string, enabled: boolean, ok: boolean, ms: number, error?: string}>} */
        const results = [];
        /** @type {Array<string>} */
        const errors = [];

        for (const m of this.modules) {
            const enabled = !!(m && typeof m.enabledFn === 'function' && m.enabledFn());
            if (!enabled || !m || !m.instance || typeof m.instance.tick !== 'function') {
                results.push({ key: String(m && m.key || 'unknown'), enabled: false, ok: true, ms: 0 });
                continue;
            }

            const t1 = Date.now();
            let ok = true;
            let errMsg = '';
            try {
                await m.instance.tick();
            } catch (e) {
                ok = false;
                errMsg = String(e?.message || e);
                errors.push(`${m.key}: ${errMsg}`);
                this.adapter.log.warn(`Module '${m.key}' tick error: ${errMsg}`);
            }
            const ms = Date.now() - t1;
            results.push({ key: String(m.key), enabled: true, ok, ms, ...(ok ? {} : { error: errMsg }) });
        }

        const totalMs = Date.now() - t0;

        if (diag.enabled) {
            const parts = results
                .filter(r => r.enabled)
                .map(r => `${r.key}:${r.ms}ms${r.ok ? '' : '!'}`);
            const summary = `tick ${totalMs}ms` + (parts.length ? (' | ' + parts.join(' ')) : '');

            this._diagLog(diag.logLevel, `[DIAG] ${summary}`);

            if (diag.writeStates) {
                try {
                    await this.adapter.setStateAsync('diagnostics.lastTick', t0, true);
                    await this.adapter.setStateAsync('diagnostics.lastTickMs', totalMs, true);
                    await this.adapter.setStateAsync('diagnostics.summary', summary, true);

                    const modulesJson = this._limitJson(results, diag.maxJsonLen);
                    await this.adapter.setStateAsync('diagnostics.modules', modulesJson, true);

                    const errText = errors.length ? errors.slice(0, 10).join(' | ') : '';
                    await this.adapter.setStateAsync('diagnostics.errors', errText, true);
                } catch (e) {
                    // Do not break the scheduler on diagnostics issues
                    this.adapter.log.debug(`Diagnostics state write failed: ${e?.message || e}`);
                }
            }
        }
    }
}

module.exports = { ModuleManager };
