'use strict';

const { BaseModule } = require('./base');

/**
 * Speicher-Regelung (Schritt 2)
 *
 * Ziele:
 * - Lastspitzenkappung über den Speicher (Entladen bei Überlast)
 * - Eigenverbrauchsoptimierung (PV-Überschuss laden, wenn verfügbar)
 * - Notstrom-Reserve (Entladen unter Mindest-SoC verhindern)
 * - Zusammenarbeit mit Tarif/VIS (manuelle Speicherleistung aus VIS berücksichtigen)
 *
 * Hinweis:
 * - In dieser Stufe wird aktiv nur im Modus "Sollleistung (W)" geschrieben (st.targetPowerW).
 * - Andere Steuerungsarten bleiben zunächst Diagnose/Zuordnung (werden später erweitert).
 */
class SpeicherRegelungModule extends BaseModule {
    constructor(adapter, dpRegistry) {
        super(adapter, dpRegistry);

        /** @type {number|null} */
        this._lastTargetW = null;
        /** @type {string} */
        this._lastReason = '';
        /** @type {string} */
        this._lastSource = '';
    }

    async init() {
        await this._ensureStates();

        // Optional: zentrale Mess-/Hilfsdatenpunkte registrieren, damit die Regelung auch ohne Peak-Shaving-Modul laufen kann.
        await this._upsertInputsFromConfig();
    }

    async tick() {
        const enabled = !!this.adapter.config.enableStorageControl;
        const cfg = this._getCfg();

        // Diagnose: aktiv
        await this._setIfChanged('speicher.regelung.aktiv', enabled);

        // Wenn deaktiviert: Sollleistung auf 0 (falls möglich) und raus.
        if (!enabled) {
            await this._applyTargetW(0, 'Deaktiviert', 'aus');
            return;
        }

        // Mindestvoraussetzungen
        const controlMode = String(cfg.controlMode || 'targetPower');
        if (controlMode !== 'targetPower') {
            await this._applyTargetW(0, 'Steuerungsart nicht unterstützt (nur Sollleistung)', 'aus');
            return;
        }

        const hasTarget = this.dp ? !!this.dp.getEntry('st.targetPowerW') : false;
        if (!hasTarget) {
            await this._applyTargetW(0, 'Sollleistung-Datenpunkt fehlt (Zuordnung)', 'aus');
            return;
        }

        // Messwerte lesen
        const now = Date.now();
        const staleMs = Math.max(1, Math.round(num(cfg.staleTimeoutSec, 15) * 1000));

        let gridW = this.dp ? this.dp.getNumberFresh('grid.powerW', staleMs, null) : null;
        if (typeof gridW !== 'number' && this.dp) gridW = this.dp.getNumberFresh('ps.gridPowerW', staleMs, null);
        const gridAge = this.dp ? (this.dp.getEntry('grid.powerW') ? this.dp.getAgeMs('grid.powerW') : this.dp.getAgeMs('ps.gridPowerW')) : null;

        // SoC für Reserve
        const soc = this.dp ? this.dp.getNumberFresh('st.socPct', staleMs, null) : null;
        const socAge = this.dp ? this.dp.getAgeMs('st.socPct') : null;

        // Wenn Netzleistung fehlt: sicher auf 0
        if (typeof gridW !== 'number') {
            await this._applyTargetW(0, 'Netzleistung fehlt oder zu alt', 'aus');
            await this._setIfChanged('speicher.regelung.netzLeistungW', null);
            await this._setIfChanged('speicher.regelung.netzAlterMs', typeof gridAge === 'number' ? Math.round(gridAge) : null);
            await this._setIfChanged('speicher.regelung.netzLadenErlaubt', null);
            return;
        }
        await this._setIfChanged('speicher.regelung.netzLeistungW', Math.round(gridW));
        await this._setIfChanged('speicher.regelung.netzAlterMs', typeof gridAge === 'number' ? Math.round(gridAge) : null);


        // Tarif-Freigabe für Netzladung (aus Tarif-Modul; konservativ bei Stale)
        let gridChargeAllowed = true;
        if (this.dp && typeof this.dp.getEntry === 'function' && this.dp.getEntry('cm.gridChargeAllowed')) {
            const age = this.dp.getAgeMs('cm.gridChargeAllowed');
            const fresh = (age === null || age === undefined) ? true : (age <= staleMs);
            gridChargeAllowed = fresh ? this.dp.getBoolean('cm.gridChargeAllowed', true) : false;
        }
        await this._setIfChanged('speicher.regelung.netzLadenErlaubt', !!gridChargeAllowed);

        const exportW = Math.max(0, -gridW); // negative Netzleistung = Einspeisung

        if (typeof soc === 'number') {
            await this._setIfChanged('speicher.regelung.socPct', Math.round(soc * 10) / 10);
            await this._setIfChanged('speicher.regelung.socAlterMs', typeof socAge === 'number' ? Math.round(socAge) : null);
        } else {
            await this._setIfChanged('speicher.regelung.socPct', null);
            await this._setIfChanged('speicher.regelung.socAlterMs', typeof socAge === 'number' ? Math.round(socAge) : null);
        }

        // Reserve-Logik (Notstrom)
        const reserveEnabled = cfg.reserveEnabled !== false;
        const reserveMin = clamp(num(cfg.reserveMinSocPct, 10), 0, 100);
        const reserveActive = reserveEnabled && (typeof soc === 'number') && (soc <= reserveMin);
        await this._setIfChanged('speicher.regelung.reserveAktiv', !!reserveActive);
        await this._setIfChanged('speicher.regelung.reserveMinSocPct', reserveMin);

        // Grenzen / Glättung
        const maxChargeW = Math.max(0, num(cfg.maxChargeW, 5000));     // Laden: negativ
        const maxDischargeW = Math.max(0, num(cfg.maxDischargeW, 5000)); // Entladen: positiv
        const stepW = Math.max(0, num(cfg.stepW, 50));
        const maxDelta = Math.max(0, num(cfg.maxDeltaWPerTick, 500));

        // 1) Lastspitzenkappung: wenn Peak-Shaving aktiv und Grenzwert überschritten → Entladen
        const peakEnabled = !!this.adapter.config.enablePeakShaving;
        let targetW = 0;
        let reason = 'Aus';
        let source = 'aus';

        if (peakEnabled) {
            const psLimitW = await this._readOwnNumber('peakShaving.control.limitW');
            const psOverW = await this._readOwnNumber('peakShaving.control.overW');
            const psReqRedW = await this._readOwnNumber('peakShaving.control.requiredReductionW');

            // fallback: wenn requiredReductionW fehlt, über overW gehen
            const needW = (typeof psReqRedW === 'number' && psReqRedW > 0) ? psReqRedW
                : ((typeof psOverW === 'number' && psOverW > 0) ? psOverW : 0);

            if (needW > 0 && (typeof psLimitW !== 'number' || psLimitW > 0)) {
                if (reserveActive) {
                    targetW = 0;
                    reason = 'Lastspitzenkappung nötig, aber Reserve aktiv';
                    source = 'lastspitze';
                } else {
                    targetW = clamp(needW, 0, maxDischargeW);
                    reason = `Lastspitzenkappung: entladen (${Math.round(needW)} W benötigt)`;
                    source = 'lastspitze';
                }
            }
        }

        // 2) Tarif/VIS (manuell), wenn keine Lastspitze aktiv
        if (targetW === 0) {
            const t = this._readTarifVis(staleMs);
            if (t.aktiv) {
                if (t.modus === 1 && typeof t.storageW === 'number') {
                    // VIS liefert Sollleistung in W: negativ = Laden, positiv = Entladen
                    let w = t.storageW;

                    // Wenn Netzladen gesperrt ist (Tarif-Logik), dann nur PV-Überschuss (Einspeisung) zum Laden nutzen
                    if (w < 0 && !gridChargeAllowed) {
                        const zeCfg = (this.adapter.config && this.adapter.config.enableGridConstraints) ? (this.adapter.config.gridConstraints || {}) : {};
                        const zeEnabled = !!((this.adapter.config && this.adapter.config.enableGridConstraints) && zeCfg.zeroExportEnabled);
                        const zeDeadband = Math.max(0, num(zeCfg.zeroExportDeadbandW, 50));
                        const thrBase = Math.max(0, num(cfg.pvExportThresholdW, 200));
                        const thr = zeEnabled ? Math.min(thrBase, zeDeadband) : thrBase;
                        const pvCapW = (exportW >= thr) ? exportW : 0;
                        const cappedW = -Math.min(Math.abs(w), pvCapW);

                        if (cappedW === 0) {
                            reason = 'Tarif: Netzladen gesperrt';
                        } else {
                            reason = 'Tarif: Netzladen gesperrt, nur PV-Überschuss';
                        }
                        source = 'tarif';
                        w = cappedW;
                    }
                    // Reserve blockiert Entladen
                    if (reserveActive && w > 0) {
                        w = 0;
                        reason = 'Tarif: Entladen blockiert (Reserve aktiv)';
                        source = 'tarif';
                    } else {
                        reason = 'Tarif: Sollleistung aus VIS';
                        source = 'tarif';
                    }
                    targetW = w;
                } else if (t.modus === 2) {
                    // Automatik wird später ergänzt
                    reason = 'Tarif: Automatik noch nicht umgesetzt';
                    source = 'tarif';
                    targetW = 0;
                }
            }
        }

        // 3) Eigenverbrauch: PV-Überschuss laden (wenn keine Lastspitze/Tarif aktiv)
        if (targetW === 0 && cfg.pvEnabled !== false) {
            // Zero-Export (Nulleinspeisung): bei Export möglichst früh (Schwellwert) in den Speicher laden.
            // Hinweis: Extra-Bias nur, wenn Netzladen erlaubt ist (sonst würde der Bias u.U. Netzenergie in den Speicher ziehen).
            const zeCfg = (this.adapter.config && this.adapter.config.enableGridConstraints) ? (this.adapter.config.gridConstraints || {}) : {};
            const zeEnabled = !!((this.adapter.config && this.adapter.config.enableGridConstraints) && zeCfg.zeroExportEnabled);
            const zeDeadband = Math.max(0, num(zeCfg.zeroExportDeadbandW, 50));
            const zeBias = Math.max(0, num(zeCfg.zeroExportBiasW, 80));

            const thrBase = Math.max(0, num(cfg.pvExportThresholdW, 200));
            const thr = zeEnabled ? Math.min(thrBase, zeDeadband) : thrBase;
            const canCharge = (typeof soc !== 'number') ? true : (soc < 100);
            if (exportW >= thr && canCharge) {
                const extraBias = (zeEnabled && gridChargeAllowed) ? zeBias : 0;
                targetW = -clamp(exportW + extraBias, 0, maxChargeW);
                reason = zeEnabled ? 'Nulleinspeisung: Export in Speicher umleiten' : 'Eigenverbrauch: PV-Überschuss laden';
                source = 'pv';
            }
        }

        // Grenzen anwenden
        targetW = clamp(targetW, -maxChargeW, maxDischargeW);

        // Schrittweite
        if (stepW > 0) {
            targetW = Math.round(targetW / stepW) * stepW;
        }

        // Rampenbegrenzung
        if (maxDelta > 0 && typeof this._lastTargetW === 'number') {
            const d = targetW - this._lastTargetW;
            if (Math.abs(d) > maxDelta) {
                targetW = this._lastTargetW + Math.sign(d) * maxDelta;
                reason = `${reason} (Rampenbegrenzung)`;
            }
        }

        // Reserve blockiert Entladen auch nach Rundung/Rampe
        if (reserveActive && targetW > 0) {
            targetW = 0;
            reason = 'Entladen blockiert (Reserve aktiv)';
            source = 'reserve';
        }

        await this._applyTargetW(targetW, reason, source);

        // Diagnose: Grenzen
        await this._setIfChanged('speicher.regelung.maxChargeW', Math.round(maxChargeW));
        await this._setIfChanged('speicher.regelung.maxDischargeW', Math.round(maxDischargeW));
        await this._setIfChanged('speicher.regelung.stepW', Math.round(stepW));
        await this._setIfChanged('speicher.regelung.maxDeltaWPerTick', Math.round(maxDelta));
        await this._setIfChanged('speicher.regelung.pvSchwelleW', Math.round(Math.max(0, num(cfg.pvExportThresholdW, 200))));
    }

    _getCfg() {
        const storage = (this.adapter.config && this.adapter.config.storage) ? this.adapter.config.storage : {};
        return {
            controlMode: storage.controlMode,
            staleTimeoutSec: storage.staleTimeoutSec,
            maxChargeW: storage.maxChargeW,
            maxDischargeW: storage.maxDischargeW,
            stepW: storage.stepW,
            maxDeltaWPerTick: storage.maxDeltaWPerTick,
            reserveEnabled: storage.reserveEnabled,
            reserveMinSocPct: storage.reserveMinSocPct,
            pvEnabled: storage.pvEnabled,
            pvExportThresholdW: storage.pvExportThresholdW,
        };
    }

    _readTarifVis(staleMs) {
        const aktiv = this.dp ? this.dp.getBoolean('vis.settings.dynamicTariff', false) : false;
        const aktivVal = !!aktiv;
        const aktivAge = this.dp ? this.dp.getAgeMs('vis.settings.dynamicTariff') : null;
        const aktivFresh = (aktivAge === null || aktivAge === undefined) ? true : (aktivAge <= staleMs);

        const modus = this.dp ? this.dp.getNumberFresh('vis.settings.tariffMode', staleMs, null) : null;
        const storageW = this.dp ? this.dp.getNumberFresh('vis.settings.storagePower', staleMs, null) : null;

        return {
            aktiv: aktivFresh && aktivVal,
            modus: (typeof modus === 'number') ? Math.round(modus) : null,
            storageW: (typeof storageW === 'number') ? storageW : null,
        };
    }

    async _applyTargetW(targetW, reason, source) {
        const w = Number.isFinite(Number(targetW)) ? Math.round(Number(targetW)) : 0;

        // schreiben (Sollleistung)
        let writeResult = null;
        if (this.dp && this.dp.getEntry('st.targetPowerW')) {
            try {
                writeResult = await this.dp.writeNumber('st.targetPowerW', w, false);
            } catch (e) {
                writeResult = false;
            }
        }

        // Diagnose-Zustände schreiben
        await this._setIfChanged('speicher.regelung.sollW', w);
        await this._setIfChanged('speicher.regelung.quelle', String(source || ''));
        await this._setIfChanged('speicher.regelung.grund', String(reason || ''));
        await this._setIfChanged('speicher.regelung.schreibStatus', (writeResult === null) ? 'unverändert' : (writeResult === true ? 'geschrieben' : 'nicht möglich'));

        this._lastTargetW = w;
        this._lastReason = String(reason || '');
        this._lastSource = String(source || '');
    }

    async _upsertInputsFromConfig() {
        if (!this.dp || typeof this.dp.upsert !== 'function') return;

        // Peak-Shaving-Konfig (Messungen) als Fallback registrieren
        const cfg = (this.adapter.config && this.adapter.config.peakShaving) ? this.adapter.config.peakShaving : {};
        const gridId = String(cfg.gridPointPowerId || '').trim();
        const pvId = String(cfg.pvPowerId || '').trim();
        const baseId = String(cfg.baseLoadPowerId || '').trim();
        const battId = String(cfg.batteryPowerId || '').trim();

        if (gridId) await this.dp.upsert({ key: 'ps.gridPowerW', objectId: gridId });
        if (pvId) await this.dp.upsert({ key: 'ps.pvW', objectId: pvId });
        if (baseId) await this.dp.upsert({ key: 'ps.baseLoadW', objectId: baseId });
        if (battId) await this.dp.upsert({ key: 'ps.batteryW', objectId: battId });
    }

    async _ensureStates() {
        await this.adapter.setObjectNotExistsAsync('speicher', {
            type: 'channel',
            common: { name: 'Speicher' },
            native: {},
        });
        await this.adapter.setObjectNotExistsAsync('speicher.regelung', {
            type: 'channel',
            common: { name: 'Speicher-Regelung' },
            native: {},
        });

        const mk = async (id, name, type, role, def = null) => {
            await this.adapter.setObjectNotExistsAsync(id, {
                type: 'state',
                common: { name, type, role, read: true, write: false, def },
                native: {},
            });
            if (def !== null && def !== undefined) {
                try { await this.adapter.setStateAsync(id, def, true); } catch { /* ignore */ }
            }
        };

        await mk('speicher.regelung.aktiv', 'Speicher-Regelung aktiv', 'boolean', 'indicator', false);
        await mk('speicher.regelung.sollW', 'Sollleistung Speicher (W)', 'number', 'value.power', 0);
        await mk('speicher.regelung.quelle', 'Quelle', 'string', 'text', '');
        await mk('speicher.regelung.grund', 'Grund', 'string', 'text', '');
        await mk('speicher.regelung.schreibStatus', 'Schreibstatus', 'string', 'text', '');

        await mk('speicher.regelung.netzLeistungW', 'Netzleistung (W)', 'number', 'value.power');
        await mk('speicher.regelung.netzAlterMs', 'Netzleistung Alter (ms)', 'number', 'value.interval');
        await mk('speicher.regelung.socPct', 'SoC (%)', 'number', 'value.battery');
        await mk('speicher.regelung.socAlterMs', 'SoC Alter (ms)', 'number', 'value.interval');

        await mk('speicher.regelung.reserveAktiv', 'Reserve aktiv', 'boolean', 'indicator', false);
        await mk('speicher.regelung.reserveMinSocPct', 'Mindest-SoC (%)', 'number', 'value', 0);

        await mk('speicher.regelung.maxChargeW', 'Max Ladeleistung (W)', 'number', 'value.power', 0);
        await mk('speicher.regelung.maxDischargeW', 'Max Entladeleistung (W)', 'number', 'value.power', 0);
        await mk('speicher.regelung.stepW', 'Schrittweite (W)', 'number', 'value', 0);
        await mk('speicher.regelung.maxDeltaWPerTick', 'Max Änderung je Takt (W)', 'number', 'value.power', 0);
        await mk('speicher.regelung.pvSchwelleW', 'PV-Überschuss-Schwelle (W)', 'number', 'value.power', 0);
    }

    async _setIfChanged(id, val) {
        const v = (val === undefined) ? null : val;
        try {
            const cur = await this.adapter.getStateAsync(id);
            const curVal = cur ? cur.val : null;
            if (cur && curVal === v) return;
            await this.adapter.setStateAsync(id, v, true);
        } catch (e) {
            // ignore
        }
    }

    async _readOwnNumber(id) {
        try {
            const s = await this.adapter.getStateAsync(id);
            const n = Number(s ? s.val : NaN);
            return Number.isFinite(n) ? n : null;
        } catch {
            return null;
        }
    }
}

function num(v, dflt = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : dflt;
}

function clamp(n, min, max) {
    if (!Number.isFinite(n)) return n;
    if (Number.isFinite(min)) n = Math.max(min, n);
    if (Number.isFinite(max)) n = Math.min(max, n);
    return n;
}

module.exports = { SpeicherRegelungModule };