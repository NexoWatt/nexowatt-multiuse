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
    const dp = ctx?.dp;
    const adapter = ctx?.adapter;

    if (!dp || typeof dp.writeNumber !== 'function') {
        return { applied: false, status: 'no_dp_registry', writes: { setW: false, enable: false } };
    }

    const setWKey = String(consumer?.setWKey || '').trim();
    const enableKey = String(consumer?.enableKey || '').trim();
    const targetW = Number(target?.targetW || 0);

    let wroteW = false;
    let wroteEnable = false;

    if (!setWKey) return { applied: false, status: 'no_setpoint_dp', writes: { setW: false, enable: false } };

    wroteW = await dp.writeNumber(setWKey, Math.round(targetW > 0 ? targetW : 0), false);

    if (enableKey) {
        wroteEnable = await dp.writeBoolean(enableKey, targetW > 0, false);
    }

    const applied = !!(wroteW || wroteEnable);
    if (adapter?.log?.debug) {
        const k = String(consumer?.key || '');
        adapter.log.debug(`[consumer:load] apply '${k}' targetW=${Math.round(targetW)} wroteW=${wroteW} wroteEnable=${wroteEnable}`);
    }

    return { applied, status: applied ? 'applied' : 'write_failed', writes: { setW: wroteW, enable: wroteEnable } };
}

module.exports = { applyLoadSetpoint };
