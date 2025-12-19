'use strict';

const { BaseModule } = require('./base');

class MultiUseModule extends BaseModule {
    async tick() {
        // Step 3.x will implement:
        // - reserve / notstrom preparation
        // - consumption optimization hooks
        this.adapter.log.debug('[multiUse] tick (stub)');
    }
}

module.exports = { MultiUseModule };
