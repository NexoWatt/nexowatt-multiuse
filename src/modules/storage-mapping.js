'use strict';

const { BaseModule } = require('./base');

/**
 * Speicher-Datenpunkt-Zuordnung (Installateur)
 * - liest die Konfiguration (storage.*)
 * - legt Diagnose-Zustände im Adapter an
 * - registriert die gemappten Datenpunkte in der internen Datenpunkt-Registry (st.*)
 *
 * Hinweis: Diese Stufe macht noch keine aktive Speicher-Regelung.
 * Sie stellt nur sicher, dass die Zuordnung sauber vorhanden ist und später
 * herstellerunabhängig genutzt werden kann.
 */
class SpeicherMappingModule extends BaseModule {
    constructor(adapter, dpRegistry) {
        super(adapter, dpRegistry);

        /** @type {string} */
        this._lastMissing = '';
        /** @type {boolean} */
        this._lastOk = false;
    }

    async init() {
        await this._ensureStates();
        await this._upsertFromConfig();
    }

    async tick() {
        // Nur Diagnose: aktuellen SoC-Wert spiegeln (wenn vorhanden)
        const enabled = !!this.adapter.config.enableStorageControl;

        await this._setIfChanged('speicher.mapping.aktiv', enabled);

        if (!this.dp) return;

        const soc = this.dp.getNumber('st.socPct', null);
        const socAge = this.dp.getAgeMs('st.socPct');

        if (typeof soc === 'number') {
            await this._setIfChanged('speicher.socPct', soc);
        }
        if (typeof socAge === 'number') {
            await this._setIfChanged('speicher.socAlterMs', Math.round(socAge));
        }
    }

    async _ensureStates() {
        const base = 'speicher';
        const defs = [
            { id: `${base}.mapping.aktiv`, name: 'Speicher-Zuordnung aktiv', type: 'boolean', role: 'indicator', def: false },
            { id: `${base}.mapping.modus`, name: 'Speicher Steuerungsart', type: 'string', role: 'text', def: '' },
            { id: `${base}.mapping.ok`, name: 'Speicher-Zuordnung vollständig', type: 'boolean', role: 'indicator', def: false },
            { id: `${base}.mapping.fehlt`, name: 'Fehlende Datenpunkte (Liste)', type: 'string', role: 'text', def: '' },

            { id: `${base}.mapping.socId`, name: 'SoC Datenpunkt-ID', type: 'string', role: 'text', def: '' },
            { id: `${base}.mapping.istLeistungId`, name: 'Ist-Leistung Datenpunkt-ID', type: 'string', role: 'text', def: '' },
            { id: `${base}.mapping.sollLeistungId`, name: 'Sollleistung Datenpunkt-ID', type: 'string', role: 'text', def: '' },
            { id: `${base}.mapping.maxLadeId`, name: 'Max Ladeleistung Datenpunkt-ID', type: 'string', role: 'text', def: '' },
            { id: `${base}.mapping.maxEntladeId`, name: 'Max Entladeleistung Datenpunkt-ID', type: 'string', role: 'text', def: '' },
            { id: `${base}.mapping.ladenErlaubtId`, name: 'Laden erlaubt Datenpunkt-ID', type: 'string', role: 'text', def: '' },
            { id: `${base}.mapping.entladenErlaubtId`, name: 'Entladen erlaubt Datenpunkt-ID', type: 'string', role: 'text', def: '' },
            { id: `${base}.mapping.reserveSocId`, name: 'Reserve-SoC Datenpunkt-ID', type: 'string', role: 'text', def: '' },

            { id: `${base}.socPct`, name: 'Speicher Ladezustand (SoC)', type: 'number', role: 'value.battery', def: 0 },
            { id: `${base}.socAlterMs`, name: 'SoC Alter (ms)', type: 'number', role: 'value.interval', def: 0 },
        ];

        for (const d of defs) {
            await this.adapter.extendObjectAsync(d.id, {
                type: 'state',
                common: {
                    name: d.name,
                    type: d.type,
                    role: d.role,
                    read: true,
                    write: false,
                    def: d.def,
                },
                native: {},
            });

            // Default nur setzen, wenn noch kein State vorhanden ist
            try {
                const cur = await this.adapter.getStateAsync(d.id);
                if (!cur) {
                    await this.adapter.setStateAsync(d.id, d.def, true);
                }
            } catch {
                // ignore
            }
        }
    }

    _getCfg() {
        const storage = (this.adapter.config && this.adapter.config.storage) ? this.adapter.config.storage : {};
        const controlMode = (storage && typeof storage.controlMode === 'string') ? storage.controlMode : 'targetPower';
        const dp = (storage && storage.datapoints && typeof storage.datapoints === 'object') ? storage.datapoints : {};
        return { controlMode, dp };
    }

    async _upsertFromConfig() {
        if (!this.dp) return;

        const { controlMode, dp } = this._getCfg();

        const socId = String(dp.socObjectId || '').trim();
        const socScale = Number.isFinite(Number(dp.socScale)) ? Number(dp.socScale) : 1;

        const istId = String(dp.batteryPowerObjectId || '').trim();
        const istScale = Number.isFinite(Number(dp.batteryPowerScale)) ? Number(dp.batteryPowerScale) : 1;
        const istInv = !!dp.batteryPowerInvert;

        const sollId = String(dp.targetPowerObjectId || '').trim();
        const sollScale = Number.isFinite(Number(dp.targetPowerScale)) ? Number(dp.targetPowerScale) : 1;
        const sollInv = !!dp.targetPowerInvert;

        const maxChargeId = String(dp.maxChargeObjectId || '').trim();
        const maxDischargeId = String(dp.maxDischargeObjectId || '').trim();
        const chargeEnId = String(dp.chargeEnableObjectId || '').trim();
        const dischargeEnId = String(dp.dischargeEnableObjectId || '').trim();
        const reserveSocId = String(dp.reserveSocObjectId || '').trim();

        // Diagnose schreiben
        await this._setIfChanged('speicher.mapping.modus', String(controlMode || ''));
        await this._setIfChanged('speicher.mapping.socId', socId);
        await this._setIfChanged('speicher.mapping.istLeistungId', istId);
        await this._setIfChanged('speicher.mapping.sollLeistungId', sollId);
        await this._setIfChanged('speicher.mapping.maxLadeId', maxChargeId);
        await this._setIfChanged('speicher.mapping.maxEntladeId', maxDischargeId);
        await this._setIfChanged('speicher.mapping.ladenErlaubtId', chargeEnId);
        await this._setIfChanged('speicher.mapping.entladenErlaubtId', dischargeEnId);
        await this._setIfChanged('speicher.mapping.reserveSocId', reserveSocId);

        // Datenpunkte registrieren (st.*)
        if (socId) {
            await this.dp.upsert({
                key: 'st.socPct',
                name: 'Speicher SoC',
                objectId: socId,
                dataType: 'number',
                direction: 'in',
                unit: '%',
                scale: socScale,
                offset: 0,
                invert: false,
                deadband: 0,
                min: 0,
                max: 100,
                note: 'Speicher Ladezustand'
            });
        }

        if (istId) {
            await this.dp.upsert({
                key: 'st.batteryPowerW',
                name: 'Speicher Ist-Leistung',
                objectId: istId,
                dataType: 'number',
                direction: 'in',
                unit: 'W',
                scale: istScale,
                offset: 0,
                invert: istInv,
                deadband: 0,
                note: 'Optional'
            });
        }

        if (sollId) {
            await this.dp.upsert({
                key: 'st.targetPowerW',
                name: 'Speicher Sollleistung',
                objectId: sollId,
                dataType: 'number',
                direction: 'out',
                unit: 'W',
                scale: sollScale,
                offset: 0,
                invert: sollInv,
                deadband: 0,
                note: 'Schreiben'
            });
        }

        if (maxChargeId) {
            await this.dp.upsert({
                key: 'st.maxChargeW',
                name: 'Max Ladeleistung',
                objectId: maxChargeId,
                dataType: 'number',
                direction: 'out',
                unit: 'W',
                note: 'Schreiben'
            });
        }

        if (maxDischargeId) {
            await this.dp.upsert({
                key: 'st.maxDischargeW',
                name: 'Max Entladeleistung',
                objectId: maxDischargeId,
                dataType: 'number',
                direction: 'out',
                unit: 'W',
                note: 'Schreiben'
            });
        }

        if (chargeEnId) {
            await this.dp.upsert({
                key: 'st.chargeEnable',
                name: 'Laden erlaubt',
                objectId: chargeEnId,
                dataType: 'boolean',
                direction: 'out',
                note: 'Schreiben'
            });
        }

        if (dischargeEnId) {
            await this.dp.upsert({
                key: 'st.dischargeEnable',
                name: 'Entladen erlaubt',
                objectId: dischargeEnId,
                dataType: 'boolean',
                direction: 'out',
                note: 'Schreiben'
            });
        }

        if (reserveSocId) {
            await this.dp.upsert({
                key: 'st.reserveSocPct',
                name: 'Reserve-SoC',
                objectId: reserveSocId,
                dataType: 'number',
                direction: 'out',
                unit: '%',
                min: 0,
                max: 100,
                note: 'Optional'
            });
        }

        // Prüfen, ob Zuordnung je Modus vollständig ist
        const missing = [];
        if (!socId) missing.push('SoC');

        if (String(controlMode) === 'targetPower') {
            if (!sollId) missing.push('Sollleistung (W)');
        } else if (String(controlMode) === 'limits') {
            if (!maxChargeId) missing.push('Max Ladeleistung (W)');
            if (!maxDischargeId) missing.push('Max Entladeleistung (W)');
        } else if (String(controlMode) === 'enableFlags') {
            if (!chargeEnId) missing.push('Laden erlaubt');
            if (!dischargeEnId) missing.push('Entladen erlaubt');
        }

        const ok = missing.length === 0;
        const missingStr = missing.join(', ');

        if (missingStr !== this._lastMissing) {
            this._lastMissing = missingStr;
            await this._setIfChanged('speicher.mapping.fehlt', missingStr);
        }
        if (ok !== this._lastOk) {
            this._lastOk = ok;
            await this._setIfChanged('speicher.mapping.ok', ok);
        }
    }

    async _setIfChanged(id, val) {
        const v = (val === undefined) ? null : val;
        try {
            const cur = await this.adapter.getStateAsync(id);
            const curVal = cur ? cur.val : null;
            if (cur && curVal === v) return;
            await this.adapter.setStateAsync(id, v, true);
        } catch (e) {
            try {
                this.adapter.log.debug(`speicher: setState ${id} Fehler: ${e?.message || e}`);
            } catch {
                // ignore
            }
        }
    }
}

module.exports = { SpeicherMappingModule };
