'use strict';

class BaseModule {
    /**
     * @param {import('@iobroker/adapter-core').AdapterInstance} adapter
     * @param {*} dpRegistry
     */
    constructor(adapter, dpRegistry) {
        this.adapter = adapter;
        this.dp = dpRegistry || null;
    }

    /**
     * Optional initialization hook.
     */
    async init() {
        // no-op
    }

    /**
     * Called by scheduler.
     * Subclasses should implement their logic here.
     */
    async tick() {
        // no-op
    }
}

module.exports = { BaseModule };
