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
        for (const m of this.modules) {
            if (!m.enabledFn()) continue;
            if (typeof m.instance.tick !== 'function') continue;

            try {
                await m.instance.tick();
            } catch (e) {
                this.adapter.log.warn(`Module '${m.key}' tick error: ${e?.message || e}`);
            }
        }
    }
}

module.exports = { ModuleManager };
