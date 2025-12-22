'use strict';

/**
 * Generic power-limited consumer (future use).
 *
 * Expects:
 * {
 *   type: 'load',
 *   key: string,
 *   name: string,
 *   setWKey?: string,
 *   enableKey?: string
 * }
 */

/**
 * @param {{dp:any, adapter:any}} ctx
 * @param {any} consumer
 * @param {{targetW:number}} target
 */
async function applyLoadSetpoint(ctx, consumer, target) {
    const adapter = ctx && ctx.adapter;
    const dp = ctx && ctx.dp;

    const setWKey = consumer && consumer.setWKey;
    const enableKey = consumer && consumer.enableKey;
    const targetW = Number(target && target.targetW);

    const hasSetW = !!(setWKey && dp && dp.getEntry && dp.getEntry(setWKey));
    const hasEnable = !!(enableKey && dp && dp.getEntry && dp.getEntry(enableKey));

    if (!hasSetW) {
        return { applied: false, status: 'no_setpoint_dp', writes: { setW: null, enable: null } };
    }

    /** @type {true|false|null} */
    let wroteW = null;
    /** @type {true|false|null} */
    let wroteEnable = null;

    wroteW = await dp.writeNumber(setWKey, Math.round(targetW > 0 ? targetW : 0), false);

    if (enableKey) {
        if (!hasEnable) wroteEnable = false;
        else wroteEnable = await dp.writeBoolean(enableKey, targetW > 0, false);
    }

    const results = [wroteW, wroteEnable].filter(v => v !== null && v !== undefined);
    const anyFalse = results.some(v => v === false);
    const anyTrue = results.some(v => v === true);
    const applied = !anyFalse;

    let status = 'unchanged';
    if (anyFalse && anyTrue) status = 'applied_partial';
    else if (anyFalse) status = 'write_failed';
    else if (anyTrue) status = 'applied';

    if (adapter && adapter.log && typeof adapter.log.debug === 'function') {
        const k = String(consumer && consumer.key || '');
        adapter.log.debug(`[consumer:load] apply '${k}' targetW=${Math.round(targetW || 0)} wroteW=${wroteW} wroteEnable=${wroteEnable} status=${status}`);
    }

    return { applied, status, writes: { setW: wroteW, enable: wroteEnable } };
}

module.exports = { applyLoadSetpoint };
