'use strict';

/**
 * EVCS (wallbox) consumer actuation.
 *
 * Expects a consumer object:
 * {
 *   type: 'evcs',
 *   key: string,
 *   name: string,
 *   controlBasis: 'currentA'|'powerW'|'none'|'auto',
 *   setAKey?: string, // DatapointRegistry key
 *   setWKey?: string, // DatapointRegistry key
 *   enableKey?: string // DatapointRegistry key (boolean)
 * }
 */

function _basis(b) {
    const s = String(b || '').trim().toLowerCase();
    if (s === 'currenta' || s === 'current') return 'currentA';
    if (s === 'powerw' || s === 'power') return 'powerW';
    if (s === 'none') return 'none';
    if (s === 'auto') return 'auto';
    return 'auto';
}

/**
 * @param {{dp:any, adapter:any}} ctx
 * @param {any} consumer
 * @param {{targetW:number, targetA:number, basis?:string}} target
 * @returns {Promise<{applied:boolean, status:string, writes:{setA:boolean,setW:boolean,enable:boolean}}>}
 */
async function applyEvcsSetpoint(ctx, consumer, target) {
    const adapter = ctx && ctx.adapter;
    const dp = ctx && ctx.dp;

    const basis = String(target && target.basis || consumer && consumer.controlBasis || 'auto');
    const setAKey = consumer && consumer.setAKey;
    const setWKey = consumer && consumer.setWKey;
    const enableKey = consumer && consumer.enableKey;

    const targetA = Number(target && target.targetA);
    const targetW = Number(target && target.targetW);

    // Validate datapoints early to provide clear status
    const hasSetA = !!(setAKey && dp && dp.getEntry && dp.getEntry(setAKey));
    const hasSetW = !!(setWKey && dp && dp.getEntry && dp.getEntry(setWKey));
    const hasEnable = !!(enableKey && dp && dp.getEntry && dp.getEntry(enableKey));

    // Resolve basis with safe fallbacks
    let resolvedBasis = basis;
    if (resolvedBasis === 'auto') {
        if (hasSetW) resolvedBasis = 'powerW';
        else if (hasSetA) resolvedBasis = 'currentA';
        else resolvedBasis = 'none';
    }

    if (resolvedBasis === 'none') {
        return { applied: false, status: 'control_disabled', writes: { setA: null, setW: null, enable: null } };
    }

    if (!hasSetA && !hasSetW) {
        return { applied: false, status: 'no_setpoint_dp', writes: { setA: null, setW: null, enable: null } };
    }

    /** @type {true|false|null} */
    let wroteA = null;
    /** @type {true|false|null} */
    let wroteW = null;
    /** @type {true|false|null} */
    let wroteEnable = null;

    // Apply setpoint
    if (resolvedBasis === 'currentA') {
        if (hasSetA) wroteA = await dp.writeNumber(setAKey, (targetA > 0 ? targetA : 0), false);
        else if (hasSetW) wroteW = await dp.writeNumber(setWKey, Math.round(targetW > 0 ? targetW : 0), false);
    } else if (resolvedBasis === 'powerW') {
        if (hasSetW) wroteW = await dp.writeNumber(setWKey, Math.round(targetW > 0 ? targetW : 0), false);
        else if (hasSetA) wroteA = await dp.writeNumber(setAKey, (targetA > 0 ? targetA : 0), false);
    } else { // fallback
        if (hasSetW) wroteW = await dp.writeNumber(setWKey, Math.round(targetW > 0 ? targetW : 0), false);
        else if (hasSetA) wroteA = await dp.writeNumber(setAKey, (targetA > 0 ? targetA : 0), false);
    }

    // Enable/disable in tandem with target
    if (enableKey) {
        if (!hasEnable) {
            wroteEnable = false;
        } else {
            const enable = (targetW > 0) || (targetA > 0);
            wroteEnable = await dp.writeBoolean(enableKey, enable, false);
        }
    }

    const results = [wroteA, wroteW, wroteEnable].filter(v => v !== null && v !== undefined);
    const anyFalse = results.some(v => v === false);
    const anyTrue = results.some(v => v === true);

    // applied=true means "desired state in effect" (written or idempotently unchanged)
    const applied = !anyFalse;

    let status = 'unchanged';
    if (anyFalse && anyTrue) status = 'applied_partial';
    else if (anyFalse) status = 'write_failed';
    else if (anyTrue) status = 'applied';

    if (adapter && adapter.log && typeof adapter.log.debug === 'function') {
        const k = String(consumer && consumer.key || '');
        adapter.log.debug(`[consumer:evcs] apply '${k}' basis=${resolvedBasis} targetW=${Math.round(targetW || 0)} targetA=${Number.isFinite(targetA) ? targetA.toFixed(2) : '0.00'} wroteW=${wroteW} wroteA=${wroteA} wroteEnable=${wroteEnable} status=${status}`);
    }

    return { applied, status, writes: { setA: wroteA, setW: wroteW, enable: wroteEnable } };
}

module.exports = { applyEvcsSetpoint };
