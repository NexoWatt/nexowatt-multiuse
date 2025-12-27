'use strict';

const { BaseModule } = require('./base');

/**
 * Liest die Tarif-Einstellungen aus der NexoWatt VIS (nexowatt-vis.0.settings.*)
 * und berechnet daraus einen Ladepark-Leistungsdeckel (W), damit Speicher/Ladepark
 * sich nicht gegenseitig aushebeln.
 *
 * Hinweis: Der Deckel wird als Datenpunkt-Schlüssel "cm.tariffBudgetW" bereitgestellt,
 * damit das Ladepark-Management ihn automatisch als Begrenzung nutzen kann.
 */
class TarifVisModule extends BaseModule {
    /**
     * @param {import('@iobroker/adapter-core').AdapterInstance} adapter
     * @param {*} dpRegistry
     */
    constructor(adapter, dpRegistry) {
        super(adapter, dpRegistry);

        /** @type {number} */
        this._lastLimitW = NaN;
    }

    async init() {
        // Eigene Zustände anlegen (nur Diagnose + berechneter Deckel)
        await this.adapter.setObjectNotExistsAsync('tarif', {
            type: 'channel',
            common: { name: 'Tarif' },
            native: {},
        });

        const mk = async (id, name, type, role) => {
            await this.adapter.setObjectNotExistsAsync(id, {
                type: 'state',
                common: { name, type, role, read: true, write: false },
                native: {},
            });
        };

        await mk('tarif.aktiv', 'Tarif aktiv (VIS)', 'boolean', 'indicator');
        await mk('tarif.modus', 'Tarif Modus (VIS)', 'number', 'value');
        await mk('tarif.preisEurProKwh', 'Tarif Preis (€/kWh, VIS)', 'number', 'value');
        await mk('tarif.prioritaet', 'Priorität Speicher↔Ladepark (VIS)', 'number', 'value');
        await mk('tarif.speicherLeistungW', 'Speicher Leistung (W, VIS)', 'number', 'value.power');
        await mk('tarif.ladeparkMaxW', 'Ladepark Max (W, VIS)', 'number', 'value.power');
        await mk('tarif.ladeparkLimitW', 'Ladepark Limit (W, berechnet)', 'number', 'value.power');
        await mk('tarif.preisGrenzeEurProKwh', 'Tarif Preisgrenze (€/kWh, VIS)', 'number', 'value');
        await mk('tarif.preisAktuellEurProKwh', 'Tarif Preis aktuell (€/kWh, Provider)', 'number', 'value');
        await mk('tarif.netzLadenErlaubt', 'Netzladung erlaubt (Tarif-Logik)', 'boolean', 'indicator');

        // VIS-Settings als Datenpunkte registrieren (nur wenn dp-Registry vorhanden ist)
        if (this.dp && typeof this.dp.upsert === 'function') {
            // Eingänge aus der VIS
            await this.dp.upsert({ key: 'vis.settings.dynamicTariff', objectId: 'nexowatt-vis.0.settings.dynamicTariff' });
            await this.dp.upsert({ key: 'vis.settings.tariffMode', objectId: 'nexowatt-vis.0.settings.tariffMode' });
            await this.dp.upsert({ key: 'vis.settings.price', objectId: 'nexowatt-vis.0.settings.price' });
            await this.dp.upsert({ key: 'vis.settings.priority', objectId: 'nexowatt-vis.0.settings.priority' });
            await this.dp.upsert({ key: 'vis.settings.storagePower', objectId: 'nexowatt-vis.0.settings.storagePower' });
            await this.dp.upsert({ key: 'vis.settings.evcsMaxPower', objectId: 'nexowatt-vis.0.settings.evcsMaxPower' });

            // Ausgabe für das Ladepark-Management (Tarif-Deckel)
            await this.dp.upsert({ key: 'cm.tariffBudgetW', objectId: `${this.adapter.namespace}.tarif.ladeparkLimitW` });

            // Ausgabe: Netzladung erlaubt (Preisfreigabe) für Engine/Consumer
            if (!this.dp.getEntry || !this.dp.getEntry('cm.gridChargeAllowed')) {
                await this.dp.upsert({ key: 'cm.gridChargeAllowed', objectId: `${this.adapter.namespace}.tarif.netzLadenErlaubt` });
            }
        }
    }

    _num(v, fallback = null) {
        const n = Number(v);
        return Number.isFinite(n) ? n : fallback;
    }

    _clamp(n, min, max) {
        if (!Number.isFinite(n)) return n;
        if (Number.isFinite(min)) n = Math.max(min, n);
        if (Number.isFinite(max)) n = Math.min(max, n);
        return n;
    }

    /**
     * Priorität normalisieren:
     * - 0..1 wird als Anteil "Ladepark" interpretiert
     * - 0..100 wird auf 0..1 skaliert
     */
    _normPrioritaet(p) {
        const n = this._num(p, 0.5);
        if (!Number.isFinite(n)) return 0.5;
        if (n >= 0 && n <= 1) return n;
        if (n >= 0 && n <= 100) return this._clamp(n / 100, 0, 1);
        return this._clamp(n, 0, 1);
    }

        async tick() {
        // Default: kein Tarif-Deckel aktiv
        let limitW = 0;

        // Default: Netzladung erlaubt (wenn Tarif nicht aktiv/invalid)
        let gridChargeAllowed = true;

        // Preise: Grenze aus VIS + (optional) aktueller Preis aus Provider-Mapping
        let priceLimit = null;
        let priceCurrent = null;

        // VIS Werte lesen (über dp-Registry Cache)
        const staleTimeoutSec = 3600; // VIS-Einstellungen sind nicht hochfrequent
        const staleTimeoutMs = staleTimeoutSec * 1000;

        // Provider-Preise (optional) sind üblicherweise häufiger als VIS-Einstellungen
        const providerStaleTimeoutSec = 15 * 60;
        const providerStaleTimeoutMs = providerStaleTimeoutSec * 1000;

        const aktiv = this.dp ? this.dp.getBoolean('vis.settings.dynamicTariff', false) : false;
        const aktivAge = this.dp ? this.dp.getAgeMs('vis.settings.dynamicTariff') : null;
        const aktivFresh = (aktivAge === null || aktivAge === undefined) ? true : (aktivAge <= staleTimeoutMs);

        const modus = this.dp ? this.dp.getNumberFresh('vis.settings.tariffMode', staleTimeoutMs, null) : null;
        const preisGrenzeVis = this.dp ? this.dp.getNumberFresh('vis.settings.price', staleTimeoutMs, null) : null;
        const prior = this.dp ? this.dp.getNumberFresh('vis.settings.priority', staleTimeoutMs, null) : null;
        const storageW = this.dp ? this.dp.getNumberFresh('vis.settings.storagePower', staleTimeoutMs, null) : null;
        const evcsMaxW = this.dp ? this.dp.getNumberFresh('vis.settings.evcsMaxPower', staleTimeoutMs, null) : null;

        // Optional: aktueller Preis aus Provider (nur wenn im Global-DP-Mapping hinterlegt)
        if (this.dp && typeof this.dp.getEntry === 'function' && this.dp.getEntry('tarif.preisAktuellEurProKwh')) {
            priceCurrent = this.dp.getNumberFresh('tarif.preisAktuellEurProKwh', providerStaleTimeoutMs, null);
        }

        // Plausibilität: Preis in €/kWh
        const hasPreisGrenze = (typeof preisGrenzeVis === 'number' && Number.isFinite(preisGrenzeVis));
        const preisGrenzePlausibel = hasPreisGrenze ? (preisGrenzeVis >= 0 && preisGrenzeVis <= 2.0) : true;

        const modusInt = (typeof modus === 'number' && Number.isFinite(modus)) ? Math.round(modus) : null;

        // In manuellem Modus setzen wir (ohne Provider-Mapping) den aktuellen Preis = Grenze (keine Auto-Sperre)
        if (modusInt === 1 && hasPreisGrenze) {
            priceCurrent = preisGrenzeVis;
        }

        const preisAktuellOk = (typeof priceCurrent === 'number' && Number.isFinite(priceCurrent)) ? (priceCurrent >= 0 && priceCurrent <= 2.0) : false;
        if (hasPreisGrenze && preisGrenzePlausibel) {
            priceLimit = preisGrenzeVis;
        }

        // Netzladung erlaubt nur, wenn Tarif aktiv + Preisgrenze gesetzt + aktueller Preis <= Grenze
        if (aktivFresh && aktiv && hasPreisGrenze && preisGrenzePlausibel) {
            if (modusInt === 1) {
                // Manuell: keine automatische Sperre
                gridChargeAllowed = true;
            } else {
                // Automatik: ohne aktuellen Preis => konservativ sperren
                gridChargeAllowed = preisAktuellOk ? (priceCurrent <= priceLimit) : false;
            }
        } else {
            gridChargeAllowed = true;
        }

        // Diagnose schreiben (nur wenn Werte vorhanden)
        await this._setIfChanged('tarif.aktiv', aktivFresh ? !!aktiv : false);
        if (typeof modus === 'number') await this._setIfChanged('tarif.modus', modus);
        if (typeof preisGrenzeVis === 'number') await this._setIfChanged('tarif.preisEurProKwh', preisGrenzeVis);
        if (typeof prior === 'number') await this._setIfChanged('tarif.prioritaet', prior);
        if (typeof storageW === 'number') await this._setIfChanged('tarif.speicherLeistungW', storageW);
        if (typeof evcsMaxW === 'number') await this._setIfChanged('tarif.ladeparkMaxW', evcsMaxW);

        await this._setIfChanged('tarif.preisGrenzeEurProKwh', (hasPreisGrenze && preisGrenzePlausibel) ? priceLimit : null);
        await this._setIfChanged('tarif.preisAktuellEurProKwh', preisAktuellOk ? priceCurrent : null);
        await this._setIfChanged('tarif.netzLadenErlaubt', !!gridChargeAllowed);

        if (aktivFresh && aktiv && preisGrenzePlausibel) {
            // Basis-Limit: aus VIS evcsMaxPower, sonst kein Tarif-Deckel
            const baseW = (typeof evcsMaxW === 'number' && evcsMaxW > 0) ? evcsMaxW : 0;

            if (baseW > 0) {
                // Wenn der Speicher laut VIS laden soll (negativ), reservieren wir Leistung
                // und reduzieren den Ladepark-Anteil entsprechend der Priorität.
                const pEv = this._normPrioritaet(prior); // Anteil Ladepark
                const pStorage = 1 - pEv;

                const sW = (typeof storageW === 'number') ? storageW : 0;
                const reserveW = Math.max(0, -sW); // nur bei Laden (negativ)

                const reductionW = reserveW * pStorage;
                limitW = Math.max(0, Math.round(baseW - reductionW));
            }
        }

        // Modus aktuell nur für Diagnose; Logik nutzt die VIS-Werte direkt.
        if (typeof modus === 'number') {
            // placeholder: keine Aktion
        }

        await this._setIfChanged('tarif.ladeparkLimitW', limitW);
    }

    async _setIfChanged(id, val) {
        const v = (val === undefined) ? null : val;
        try {
            const cur = await this.adapter.getStateAsync(id);
            const curVal = cur ? cur.val : null;
            if (cur && curVal === v) return;
            await this.adapter.setStateAsync(id, v, true);
        } catch {
            // ignore
        }
    }
}

module.exports = { TarifVisModule };
