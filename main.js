'use strict';

/**
 * NexoWatt Multi-Use Adapter (ioBroker)
 *
 * Implements:
 * - Peak Shaving (static/dynamic, phase-aware, optional actuation table)
 * - Charging Management (wallbox table, priority distribution)
 * - Multi-Use (stub for later)
 *
 * This repository is intentionally manufacturer-independent: all object IDs are configured via admin tables.
 */

const utils = require('@iobroker/adapter-core');
const { ModuleManager } = require('./src/module-manager');
const { DatapointRegistry } = require('./src/datapoints');

class NexoWattMultiUse extends utils.Adapter {
    constructor(options = {}) {
        super({
            ...options,
            name: 'nexowatt-multiuse',
        });

        /** @type {DatapointRegistry|null} */
        this.dp = null;

        /** @type {ModuleManager|null} */
        this.modules = null;

        /** @type {NodeJS.Timeout|null} */
        this._timer = null;

        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }

    async onReady() {
        try {
            // Basic adapter states
            await this.setObjectNotExistsAsync('info', {
                type: 'channel',
                common: { name: 'Information' },
                native: {},
            });
            await this.setObjectNotExistsAsync('info.lastTick', {
                type: 'state',
                common: { name: 'Last tick', type: 'number', role: 'value.time', read: true, write: false },
                native: {},
            });

            const intervalMs = Number(this.config.schedulerIntervalMs || 1000);
            const safeIntervalMs = Number.isFinite(intervalMs) && intervalMs >= 250 ? intervalMs : 1000;

            // Datapoint registry: global mapping table from admin (manufacturer-independent)
            const globalEntries = Array.isArray(this.config.globalDatapoints) ? this.config.globalDatapoints : [];
            this.dp = new DatapointRegistry(this, globalEntries);
            await this.dp.init();

            // Module manager (loads enabled modules, modules will also upsert their own datapoints)
            this.modules = new ModuleManager(this, this.dp);
            await this.modules.init();

            // Start scheduler
            this._timer = setInterval(async () => {
                try {
                    if (!this.modules) return;
                    await this.modules.tick();
                    await this.setStateAsync('info.lastTick', Date.now(), true);
                } catch (e) {
                    this.log.warn(`Scheduler tick failed: ${e?.message || e}`);
                }
            }, safeIntervalMs);

            // Run one immediate tick
            if (this.modules) {
                await this.modules.tick();
                await this.setStateAsync('info.lastTick', Date.now(), true);
            }

            this.log.info(`Started. Scheduler interval: ${safeIntervalMs} ms`);
        } catch (e) {
            this.log.error(`onReady error: ${e?.stack || e}`);
        }
    }

    /**
     * @param {string} id
     * @param {ioBroker.State | null | undefined} state
     */
    onStateChange(id, state) {
        if (!this.dp) return;
        this.dp.handleStateChange(id, state);
    }

    /**
     * @param {() => void} callback
     */
    onUnload(callback) {
        try {
            if (this._timer) {
                clearInterval(this._timer);
                this._timer = null;
            }
            callback();
        } catch (e) {
            callback();
        }
    }
}

if (module.parent) {
    module.exports = (options) => new NexoWattMultiUse(options);
} else {
    // @ts-ignore
    new NexoWattMultiUse();
}
