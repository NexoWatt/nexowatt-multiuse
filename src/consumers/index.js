'use strict';

const { applyEvcsSetpoint } = require('./evcs');
const { applyLoadSetpoint } = require('./generic-load');

/**
 * Unified consumer actuation entry point.
 *
 * @param {{dp:any, adapter:any}} ctx
 * @param {any} consumer
 * @param {any} target
 */
async function applySetpoint(ctx, consumer, target) {
    const type = String(consumer?.type || '').trim().toLowerCase();

    if (type === 'evcs' || type === 'wallbox') {
        return applyEvcsSetpoint(ctx, consumer, target);
    }
    if (type === 'load') {
        return applyLoadSetpoint(ctx, consumer, target);
    }
    return { applied: false, status: 'unsupported_type', writes: {} };
}

module.exports = { applySetpoint };
