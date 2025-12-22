'use strict';

/**
 * Universal datapoint registry for manufacturer-independent configuration.
 *
 * The registry stores:
 * - key -> objectId mapping
 * - optional transforms (scale, offset, invert, min/max, deadband)
 * - a value cache fed by stateChange events
 *
 * Modules may upsert additional datapoints derived from their module configuration.
 */
class DatapointRegistry {
    /**
     * @param {import('@iobroker/adapter-core').AdapterInstance} adapter
     * @param {Array<any>} entries
     */
    constructor(adapter, entries) {
        this.adapter = adapter;

        /** @type {Map<string, any>} */
        this.byKey = new Map();

        /** @type {Map<string, string>} */
        this.keyByObjectId = new Map();

        /** @type {Map<string, {val:any, ts:number, ack:boolean}>} */
        this.cacheByObjectId = new Map();

        /** @type {Map<string, {val:any, ts:number}>} */
        this.lastWriteByObjectId = new Map();

        this._initEntries = Array.isArray(entries) ? entries : [];
    }

    async init() {
        for (const e of this._initEntries) {
            await this.upsert(e);
        }
    }

    /**
     * Add or update a datapoint mapping. Preserves existing transform settings if a new entry omits them.
     * @param {any} entry
     */
    async upsert(entry) {
        if (!entry) return;
        const key = String(entry.key || '').trim();
        const objectId = String(entry.objectId || entry.id || '').trim();
        if (!key || !objectId) return;

        const prev = this.byKey.get(key);

        const normalized = {
            key,
            name: entry.name || prev?.name || '',
            objectId,
            dataType: entry.dataType || prev?.dataType || entry.type || 'number',
            direction: entry.direction || prev?.direction || entry.dir || 'in',
            unit: entry.unit || prev?.unit || '',
            scale: (entry.scale !== undefined ? Number(entry.scale) : prev?.scale),
            offset: (entry.offset !== undefined ? Number(entry.offset) : prev?.offset),
            invert: (entry.invert !== undefined ? !!entry.invert : prev?.invert),
            deadband: (entry.deadband !== undefined ? Number(entry.deadband) : prev?.deadband),
            min: (entry.min !== undefined ? Number(entry.min) : prev?.min),
            max: (entry.max !== undefined ? Number(entry.max) : prev?.max),
            note: entry.note || prev?.note || '',
        };

        if (!Number.isFinite(normalized.scale)) normalized.scale = 1;
        if (!Number.isFinite(normalized.offset)) normalized.offset = 0;
        if (!Number.isFinite(normalized.deadband)) normalized.deadband = 0;

        // min/max: keep undefined if invalid
        if (!Number.isFinite(normalized.min)) normalized.min = undefined;
        if (!Number.isFinite(normalized.max)) normalized.max = undefined;

        this.byKey.set(key, normalized);
        this.keyByObjectId.set(objectId, key);

        // Subscribe (idempotent; ioBroker tolerates multiple subscribe calls)
        try {
            await this.adapter.subscribeForeignStatesAsync(objectId);
        } catch (e) {
            this.adapter.log.warn(`Datapoint subscribe failed for '${objectId}': ${e?.message || e}`);
        }

        // Prime cache
        try {
            const st = await this.adapter.getForeignStateAsync(objectId);
            if (st) this.handleStateChange(objectId, st);
        } catch (e) {
            // ignore (not all foreign states exist immediately)
        }
    }

    /**
     * Feed cache from adapter stateChange.
     * @param {string} id
     * @param {ioBroker.State | null | undefined} state
     */
    handleStateChange(id, state) {
        if (!id) return;
        if (!state) {
            this.cacheByObjectId.delete(id);
            return;
        }
        this.cacheByObjectId.set(id, { val: state.val, ts: state.ts || Date.now(), ack: !!state.ack });
    }

    /**
     * @param {string} key
     * @returns {any|null}
     */
    getEntry(key) {
        return this.byKey.get(String(key || '').trim()) || null;
    }

    /**
     * @param {string} key
     * @returns {any|null}
     */
    getRaw(key) {
        const e = this.getEntry(key);
        if (!e) return null;
        const c = this.cacheByObjectId.get(e.objectId);
        return c ? c.val : null;
    }

    /**
     * Age of the cached datapoint value in milliseconds.
     * If the datapoint is unknown or not cached yet, returns +Infinity.
     *
     * @param {string} key
     * @returns {number}
     */
    getAgeMs(key) {
        const e = this.getEntry(key);
        if (!e) return Number.POSITIVE_INFINITY;
        const c = this.cacheByObjectId.get(e.objectId);
        const ts = c && Number.isFinite(c.ts) ? Number(c.ts) : null;
        if (!ts) return Number.POSITIVE_INFINITY;
        const age = Date.now() - ts;
        return age >= 0 ? age : 0;
    }

    /**
     * Returns true if the cached value is older than maxAgeMs.
     * If the datapoint is unknown/not cached, it is treated as stale.
     *
     * @param {string} key
     * @param {number} maxAgeMs
     * @returns {boolean}
     */
    isStale(key, maxAgeMs) {
        const age = this.getAgeMs(key);
        if (!Number.isFinite(age)) return true;
        if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) return age === Number.POSITIVE_INFINITY;
        return age > maxAgeMs;
    }

    /**
     * Read a numeric datapoint only if it is fresh.
     *
     * @param {string} key
     * @param {number} maxAgeMs
     * @param {number|null} fallback
     * @returns {number|null}
     */
    getNumberFresh(key, maxAgeMs, fallback = null) {
        if (this.isStale(key, maxAgeMs)) return fallback;
        return this.getNumber(key, fallback);
    }

/**
     * @param {string} key
     * @param {number|null} fallback
     */
    getNumber(key, fallback = null) {
        const e = this.getEntry(key);
        if (!e) return fallback;
        const raw = this.getRaw(key);
        const n = Number(raw);
        if (!Number.isFinite(n)) return fallback;

        let v = n;
        if (e.invert) v = -v;
        v = v * e.scale + e.offset;

        if (typeof e.min === 'number' && Number.isFinite(e.min)) v = Math.max(e.min, v);
        if (typeof e.max === 'number' && Number.isFinite(e.max)) v = Math.min(e.max, v);

        return v;
    }

    /**
     * @param {string} key
     * @param {boolean|null} fallback
     */
    getBoolean(key, fallback = null) {
        const e = this.getEntry(key);
        if (!e) return fallback;
        const raw = this.getRaw(key);
        if (raw === null || raw === undefined) return fallback;

        let b = !!raw;
        if (typeof raw === 'string') {
            const s = raw.trim().toLowerCase();
            if (s === 'false' || s === '0' || s === 'off' || s === 'disabled') b = false;
            if (s === 'true' || s === '1' || s === 'on' || s === 'enabled') b = true;
        }
        if (e.invert) b = !b;
        return b;
    }

    /**
     * Writes a numeric value in *physical* units (after transform).
     * The registry performs reverse transform before writing to the raw datapoint.
     * @param {string} key
     * @param {number} value
     * @param {boolean} [ack=false]
     */
    async writeNumber(key, value, ack = false) {
        const e = this.getEntry(key);
        if (!e) return false;

        let v = Number(value);
        if (!Number.isFinite(v)) return false;

        // clamp in physical space
        if (typeof e.min === 'number' && Number.isFinite(e.min)) v = Math.max(e.min, v);
        if (typeof e.max === 'number' && Number.isFinite(e.max)) v = Math.min(e.max, v);

        // reverse transform
        let raw = (v - e.offset) / (e.scale || 1);
        if (e.invert) raw = -raw;

        // deadband in physical space against last written value
        const last = this.lastWriteByObjectId.get(e.objectId);
        if (last && Number.isFinite(last.val) && e.deadband > 0 && Math.abs(v - last.val) < e.deadband) {
            return false;
        }

        try {
            await this.adapter.setForeignStateAsync(e.objectId, raw, ack);
            this.lastWriteByObjectId.set(e.objectId, { val: v, ts: Date.now() });
            return true;
        } catch (err) {
            this.adapter.log.warn(`Datapoint write failed for '${e.objectId}': ${err?.message || err}`);
            return false;
        }
    }

    /**
     * @param {string} key
     * @param {boolean} value
     * @param {boolean} [ack=false]
     */
    async writeBoolean(key, value, ack = false) {
        const e = this.getEntry(key);
        if (!e) return false;

        let b = !!value;
        if (e.invert) b = !b;

        try {
            await this.adapter.setForeignStateAsync(e.objectId, b, ack);
            this.lastWriteByObjectId.set(e.objectId, { val: b ? 1 : 0, ts: Date.now() });
            return true;
        } catch (err) {
            this.adapter.log.warn(`Datapoint write failed for '${e.objectId}': ${err?.message || err}`);
            return false;
        }
    }
}

module.exports = { DatapointRegistry };
