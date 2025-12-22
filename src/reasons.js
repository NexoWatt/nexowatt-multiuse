'use strict';

/**
 * Canonical, module-wide reason codes for transparency and deterministic diagnostics.
 * Values are stable string constants (UPPER_SNAKE_CASE).
 */
const ReasonCodes = Object.freeze({
    // Generic
    OK: 'OK',
    UNKNOWN: 'UNKNOWN',

    // Safety / failsafe
    STALE_METER: 'STALE_METER',
    SAFETY_OVERLOAD: 'SAFETY_OVERLOAD',

    // Peak shaving
    LIMIT_POWER: 'LIMIT_POWER',
    LIMIT_PHASE: 'LIMIT_PHASE',
    LIMIT_POWER_AND_PHASE: 'LIMIT_POWER_AND_PHASE',

    // Charging / allocation
    LIMITED_BY_BUDGET: 'LIMITED_BY_BUDGET',
    NO_SETPOINT: 'NO_SETPOINT',
    UNLIMITED: 'UNLIMITED',
    NO_BUDGET: 'NO_BUDGET',
    ALLOCATED: 'ALLOCATED',
    BELOW_MIN: 'BELOW_MIN',
    PAUSED_BY_PEAK_SHAVING: 'PAUSED_BY_PEAK_SHAVING',

    // Availability / state
    DISABLED: 'DISABLED',
    OFFLINE: 'OFFLINE',
    SKIPPED: 'SKIPPED',
});

/**
 * Normalize legacy reason strings to canonical ReasonCodes where possible.
 * Unknown reasons are returned as an UPPERCASE string.
 * @param {any} input
 * @returns {string}
 */
function normalizeReason(input) {
    const raw = (input === null || input === undefined) ? '' : String(input);
    const s = raw.trim();
    if (!s) return '';
    const up = s.toUpperCase();

    // Common historical lower/underscore forms
    if (up === 'STALE_METER' || up === 'STALE-METER' || up === 'STALEMETER') return ReasonCodes.STALE_METER;
    if (up === 'PAUSED_BY_PEAK_SHAVING' || up === 'PAUSED-BY-PEAK-SHAVING') return ReasonCodes.PAUSED_BY_PEAK_SHAVING;

    // PeakShaving legacy
    if (up === 'OK') return ReasonCodes.OK;
    if (up === 'POWER') return ReasonCodes.LIMIT_POWER;
    if (up === 'PHASE') return ReasonCodes.LIMIT_PHASE;
    if (up === 'POWER_AND_PHASE') return ReasonCodes.LIMIT_POWER_AND_PHASE;
    if (up === 'UNKNOWN') return ReasonCodes.UNKNOWN;

    // Charging legacy / canonical pass-through
    if (up === 'LIMITED_BY_BUDGET') return ReasonCodes.LIMITED_BY_BUDGET;
    if (up === 'NO_SETPOINT' || up === 'NO_SETPOINTS') return ReasonCodes.NO_SETPOINT;
    if (up === 'UNLIMITED') return ReasonCodes.UNLIMITED;
    if (up === 'NO_BUDGET') return ReasonCodes.NO_BUDGET;
    if (up === 'ALLOCATED') return ReasonCodes.ALLOCATED;
    if (up === 'BELOW_MIN') return ReasonCodes.BELOW_MIN;
    if (up === 'DISABLED') return ReasonCodes.DISABLED;
    if (up === 'OFFLINE') return ReasonCodes.OFFLINE;
    if (up === 'SKIPPED') return ReasonCodes.SKIPPED;

    // If it's already one of our codes, keep it
    if (Object.values(ReasonCodes).includes(up)) return up;

    return up;
}

module.exports = { ReasonCodes, normalizeReason };
