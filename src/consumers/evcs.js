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
    const dp = ctx?.dp;
    const adapter = ctx?.adapter;

    if (!dp || typeof dp.writeNumber !== 'function') {
        return { applied: false, status: 'no_dp_registry', writes: { setA: false, setW: false, enable: false } };
    }

    const setAKey = String(consumer?.setAKey || '').trim();
    const setWKey = String(consumer?.setWKey || '').trim();
    const enableKey = String(consumer?.enableKey || '').trim();

    const basis = _basis(target?.basis || consumer?.controlBasis || 'auto');

    const targetW = Number(target?.targetW || 0);
    const targetA = Number(target?.targetA || 0);

    let wroteA = false;
    let wroteW = false;
    let wroteEnable = false;

    // Prefer requested basis, with safe fallbacks
    if (basis === 'currentA') {
        if (setAKey) wroteA = await dp.writeNumber(setAKey, targetA > 0 ? targetA : 0, false);
        else if (setWKey) wroteW = await dp.writeNumber(setWKey, Math.round(targetW > 0 ? targetW : 0), false);
        else return { applied: false, status: 'no_setpoint_dp', writes: { setA: false, setW: false, enable: false } };
    } else if (basis === 'powerW') {
        if (setWKey) wroteW = await dp.writeNumber(setWKey, Math.round(targetW > 0 ? targetW : 0), false);
        else if (setAKey) wroteA = await dp.writeNumber(setAKey, targetA > 0 ? targetA : 0, false);
        else return { applied: false, status: 'no_setpoint_dp', writes: { setA: false, setW: false, enable: false } };
    } else if (basis === 'none') {
        return { applied: false, status: 'control_disabled', writes: { setA: false, setW: false, enable: false } };
    } else { // auto
        if (setWKey) wroteW = await dp.writeNumber(setWKey, Math.round(targetW > 0 ? targetW : 0), false);
        else if (setAKey) wroteA = await dp.writeNumber(setAKey, targetA > 0 ? targetA : 0, false);
        else return { applied: false, status: 'no_setpoint_dp', writes: { setA: false, setW: false, enable: false } };
    }

    if (enableKey) {
        // enable if any target is non-zero
        const enable = (targetW > 0) || (targetA > 0);
        wroteEnable = await dp.writeBoolean(enableKey, enable, false);
    }

    const applied = !!(wroteA || wroteW || wroteEnable);
    const status = applied ? 'applied' : 'write_failed';

    // Best-effort debug log (avoid spamming at info level)
    if (adapter?.log?.debug) {
        const k = String(consumer?.key || '');
        adapter.log.debug(`[consumer:evcs] apply '${k}' basis=${basis} targetW=${Math.round(targetW)} targetA=${targetA} wroteW=${wroteW} wroteA=${wroteA} wroteEnable=${wroteEnable}`);
    }

    return { applied, status, writes: { setA: wroteA, setW: wroteW, enable: wroteEnable } };
}

module.exports = { applyEvcsSetpoint };
