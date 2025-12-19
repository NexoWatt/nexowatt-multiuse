'use strict';
systemDictionary = {
    'General': {
        'en': 'General',
        'de': 'Allgemein'
    },
    'Enable Peak Shaving': {
        'en': 'Enable Peak Shaving',
        'de': 'Lastspitzenkappung aktivieren'
    },
    'Enable Charging Management': {
        'en': 'Enable Charging Management',
        'de': 'Lademanagement aktivieren'
    },
    'Enable Multi-Use': {
        'en': 'Enable Multi-Use',
        'de': 'Multi-Use aktivieren'
    },
    'Scheduler interval (ms)': {
        'en': 'Scheduler interval (ms)',
        'de': 'Scheduler-Intervall (ms)'
    },
    'Peak Shaving': {
        'en': 'Peak Shaving',
        'de': 'Lastspitzenkappung'
    },
    'Mode': {
        'en': 'Mode',
        'de': 'Modus'
    },
    'Grid point power (W) - State ID': {
        'en': 'Grid point power (W) - State ID',
        'de': 'Einspeisepunkt Leistung (W) - State-ID'
    },
    'Max power (W)': {
        'en': 'Max power (W)',
        'de': 'Max. Leistung (W)'
    },
    'Max current per phase (A)': {
        'en': 'Max current per phase (A)',
        'de': 'Max. Strom pro Phase (A)'
    },
    'Smoothing window (s)': {
        'en': 'Smoothing window (s)',
        'de': 'Glättungsfenster (s)'
    },
    'Charging Management': {
        'en': 'Charging Management',
        'de': 'Lademanagement'
    },
    'PV surplus only': {
        'en': 'PV surplus only',
        'de': 'Nur PV-Überschuss'
    },
    'Boost enabled': {
        'en': 'Boost enabled',
        'de': 'Boost aktiv'
    },
    'Multi-Use': {
        'en': 'Multi-Use',
        'de': 'Multi-Use'
    },
    'Reserve enabled': {
        'en': 'Reserve enabled',
        'de': 'Reserve aktiv'
    },
    'Reserve minimum (W)': {
        'en': 'Reserve minimum (W)',
        'de': 'Reserve-Minimum (W)'
    },
    'tab_general': {
        'en': 'General',
        'de': 'Allgemein'
    },
    'tab_peak': {
        'en': 'Peak Shaving',
        'de': 'Lastspitzenkappung'
    },
    'tab_charging': {
        'en': 'Charging Management',
        'de': 'Lademanagement'
    },
    'tab_multiuse': {
        'en': 'Multi-Use',
        'de': 'Multi-Use'
    },
    'Phase L1 current (A) - State ID': {
        'en': 'Phase L1 current (A) - State ID',
        'de': 'Phase L1 Strom (A) - State ID'
    },
    'Phase L2 current (A) - State ID': {
        'en': 'Phase L2 current (A) - State ID',
        'de': 'Phase L2 Strom (A) - State ID'
    },
    'Phase L3 current (A) - State ID': {
        'en': 'Phase L3 current (A) - State ID',
        'de': 'Phase L3 Strom (A) - State ID'
    },
    'Budget / Priorities': {
        'en': 'Budget / Priorities',
        'de': 'Budget / Prioritäten'
    },
    'Total budget mode': {
        'en': 'Total budget mode',
        'de': 'Gesamtbudget-Modus'
    },
    'Static max charging power (W)': {
        'en': 'Static max charging power (W)',
        'de': 'Statisches max. Ladeleistungsbudget (W)'
    },
    'Budget power (W) - State ID (for fromDatapoint)': {
        'en': 'Budget power (W) - State ID (for fromDatapoint)',
        'de': 'Budget-Leistung (W) - State-ID (für fromDatapoint)'
    },
    'Pause charging management when Peak Shaving is active': {
        'en': 'Pause charging management when Peak Shaving is active',
        'de': 'Lademanagement pausieren, wenn Lastspitzenkappung aktiv ist'
    },
    'Hysteresis (W)': {
        'en': 'Hysteresis (W)',
        'de': 'Hysterese (W)'
    },
    'Activate delay (s)': {
        'en': 'Activate delay (s)',
        'de': 'Einschaltverzögerung (s)'
    },
    'Release delay (s)': {
        'en': 'Release delay (s)',
        'de': 'Ausschaltverzögerung (s)'
    },
    'Use average for decision': {
        'en': 'Use average for decision',
        'de': 'Mittelwert für Entscheidung nutzen'
    },
    'Dynamic Mode Inputs (optional)': {
        'en': 'Dynamic Mode Inputs (optional)',
        'de': 'Eingänge Dynamik-Modus (optional)'
    },
    'Allowed max power (W) - State ID (optional)': {
        'en': 'Allowed max power (W) - State ID (optional)',
        'de': 'Erlaubte Max.-Leistung (W) - State-ID (optional)'
    },
    'Reserve (W)': {
        'en': 'Reserve (W)',
        'de': 'Reserve (W)'
    },
    'Base load / house consumption (W) - State ID (optional)': {
        'en': 'Base load / house consumption (W) - State ID (optional)',
        'de': 'Grundlast / Hausverbrauch (W) - State-ID (optional)'
    },
    'PV power (W) - State ID (optional)': {
        'en': 'PV power (W) - State ID (optional)',
        'de': 'PV-Leistung (W) - State-ID (optional)'
    },
    'Battery power (W) - State ID (optional)': {
        'en': 'Battery power (W) - State ID (optional)',
        'de': 'Batterieleistung (W) - State-ID (optional)'
    },
    'Optional external limit (e.g. grid signal). In dynamic mode the effective limit is min(Max power, Allowed max power) minus Reserve.': {
        'en': 'Optional external limit (e.g. grid signal). In dynamic mode the effective limit is min(Max power, Allowed max power) minus Reserve.',
        'de': 'Optionales externes Limit (z. B. Netz-/EVU-Signal). Im Dynamik-Modus gilt: effektives Limit = min(Max. Leistung, Erlaubte Max. Leistung) minus Reserve.'
    },
    'Reserve that is subtracted from the effective limit in dynamic mode (e.g. keep headroom).': {
        'en': 'Reserve that is subtracted from the effective limit in dynamic mode (e.g. keep headroom).',
        'de': 'Reserve, die im Dynamik-Modus vom effektiven Limit abgezogen wird (z. B. um eine Reserve zu halten).'
    },
    'If set, the adapter also calculates the target power for controlled loads: availableForControlledW = effectiveLimit - (baseLoad - PV - Battery).': {
        'en': 'If set, the adapter also calculates the target power for controlled loads: availableForControlledW = effectiveLimit - (baseLoad - PV - Battery).',
        'de': 'Wenn gesetzt, berechnet der Adapter zusätzlich die Ziel-Leistung für steuerbare Lasten: availableForControlledW = effektivesLimit - (Grundlast - PV - Batterie).'
    },
    'PV generation power (W), positive. Used only for availableForControlledW calculation.': {
        'en': 'PV generation power (W), positive. Used only for availableForControlledW calculation.',
        'de': 'PV-Erzeugungsleistung (W), positiv. Wird nur für die availableForControlledW-Berechnung verwendet.'
    },
    'Battery discharge power (W), positive. Used only for availableForControlledW calculation.': {
        'en': 'Battery discharge power (W), positive. Used only for availableForControlledW calculation.',
        'de': 'Batterie-Entladeleistung (W), positiv. Wird nur für die availableForControlledW-Berechnung verwendet.'
    },
    'Phase decision mode': {
        'en': 'Phase decision mode',
        'de': 'Phasen-Entscheidungsmodus'
    },
    'Hysteresis per phase (A)': {
        'en': 'Hysteresis per phase (A)',
        'de': 'Hysterese je Phase (A)'
    },
    'Voltage (V)': {
        'en': 'Voltage (V)',
        'de': 'Spannung (V)'
    },
    'Activity threshold (W)': {
        'en': 'Activity threshold (W)',
        'de': 'Aktivitätsschwelle (W)'
    },
    'Stop grace (s)': {
        'en': 'Stop grace (s)',
        'de': 'Stopp-Nachlaufzeit (s)'
    },
    'Session keep time (s)': {
        'en': 'Session keep time (s)',
        'de': 'Sitzung beibehalten (s)'
    },

    'AC 3p min power (W)': {
        'en': 'AC 3p min power (W)',
        'de': 'AC 3p Mindestleistung (W)'
    },
    'Actuation (controlled loads / wallboxes)': {
        'en': 'Actuation (controlled loads / wallboxes)',
        'de': 'Aktorik (steuerbare Verbraucher / Wallboxen)'
    },
    'Enable actuation (apply reductions to actuators)': {
        'en': 'Enable actuation (apply reductions to actuators)',
        'de': 'Aktorik aktivieren (Reduktion auf Aktoren anwenden)'
    },
    'Actuators (controlled loads / wallboxes)': {
        'en': 'Actuators (controlled loads / wallboxes)',
        'de': 'Aktoren (steuerbare Verbraucher / Wallboxen)'
    },
    'ID (unique)': {
        'en': 'ID (unique)',
        'de': 'ID (eindeutig)'
    },
    'Priority (1=high)': {
        'en': 'Priority (1=high)',
        'de': 'Priorität (1=hoch)'
    },
    'Limit power (W)': {
        'en': 'Limit power (W)',
        'de': 'Leistungsbegrenzung (W)'
    },
    'Limit current (A)': {
        'en': 'Limit current (A)',
        'de': 'Strombegrenzung (A)'
    },
    'On/Off': {
        'en': 'On/Off',
        'de': 'Ein/Aus'
    },
    'Phases': {
        'en': 'Phases',
        'de': 'Phasen'
    },
    'Measured power (W) - State ID (optional)': {
        'en': 'Measured power (W) - State ID (optional)',
        'de': 'Gemessene Leistung (W) - State-ID (optional)'
    },
    'Setpoint State ID (W or A)': {
        'en': 'Setpoint State ID (W or A)',
        'de': 'Sollwert State-ID (W oder A)'
    },
    'Enable/OnOff State ID (optional)': {
        'en': 'Enable/OnOff State ID (optional)',
        'de': 'Enable/Ein-Aus State-ID (optional)'
    },
    'Min (W/A)': {
        'en': 'Min (W/A)',
        'de': 'Min (W/A)'
    },
    'Max (W/A)': {
        'en': 'Max (W/A)',
        'de': 'Max (W/A)'
    },
    'Wallboxes (manufacturer-independent mapping)': {
        'en': 'Wallboxes (manufacturer-independent mapping)',
        'de': 'Wallboxen (herstellerunabhängige Zuordnung)'
    },
    'Enabled': {
        'en': 'Enabled',
        'de': 'Aktiv'
    },
    'Default phases': {
        'en': 'Default phases',
        'de': 'Standard-Phasen'
    },
    'Default min current (A)': {
        'en': 'Default min current (A)',
        'de': 'Standard Min. Strom (A)'
    },
    'Default max current (A)': {
        'en': 'Default max current (A)',
        'de': 'Standard Max. Strom (A)'
    },
    'Min current (A)': {
        'en': 'Min current (A)',
        'de': 'Min. Strom (A)'
    },
    'Max current (A)': {
        'en': 'Max current (A)',
        'de': 'Max. Strom (A)'
    },
    'Actual power (W) - State ID': {
        'en': 'Actual power (W) - State ID',
        'de': 'Ist-Leistung (W) - State-ID'
    },
    'Actual current (A) - State ID': {
        'en': 'Actual current (A) - State ID',
        'de': 'Ist-Strom (A) - State-ID'
    },
    'Set current limit (A) - State ID': {
        'en': 'Set current limit (A) - State ID',
        'de': 'Soll-Stromlimit (A) - State-ID'
    },
    'Set power limit (W) - State ID': {
        'en': 'Set power limit (W) - State ID',
        'de': 'Soll-Leistungslimit (W) - State-ID'
    },
    'Enable/Disable - State ID': {
        'en': 'Enable/Disable - State ID',
        'de': 'Enable/Disable - State-ID'
    },
    'Status - State ID': {
        'en': 'Status - State ID',
        'de': 'Status - State-ID'
    },
    'Charger type': {
        'en': 'Charger type',
        'de': 'Ladegerät-Typ'
    },
    'Control basis': {
        'en': 'Control basis',
        'de': 'Regelgröße'
    },
    'Min power (W)': {
        'en': 'Min power (W)',
        'de': 'Min. Leistung (W)'
    },
    '1': {
        'en': '1',
        'de': '1'
    },
    '3': {
        'en': '3',
        'de': '3'
    },
    'AC': {
        'en': 'AC',
        'de': 'AC'
    },
    'DC': {
        'en': 'DC',
        'de': 'DC'
    },
    'Deadband': {
        'en': 'Deadband',
        'de': 'Deadband'
    },
    'Global datapoints (manufacturer-independent mapping)': {
        'en': 'Global datapoints (manufacturer-independent mapping)',
        'de': 'Global datapoints (manufacturer-independent mapping)'
    },
    'Invert': {
        'en': 'Invert',
        'de': 'Invert'
    },
    'Key (unique)': {
        'en': 'Key (unique)',
        'de': 'Key (unique)'
    },
    'Max': {
        'en': 'Max',
        'de': 'Max'
    },
    'Min': {
        'en': 'Min',
        'de': 'Min'
    },
    'Name': {
        'en': 'Name',
        'de': 'Name'
    },
    'Note': {
        'en': 'Note',
        'de': 'Note'
    },
    'Offset': {
        'en': 'Offset',
        'de': 'Offset'
    },
    'R/W': {
        'en': 'R/W',
        'de': 'R/W'
    },
    'Scale': {
        'en': 'Scale',
        'de': 'Scale'
    },
    'Type': {
        'en': 'Type',
        'de': 'Type'
    },
    'Unit': {
        'en': 'Unit',
        'de': 'Unit'
    },
    'Universal Datapoints': {
        'en': 'Universal Datapoints',
        'de': 'Universal Datapoints'
    },
    'auto': {
        'en': 'auto',
        'de': 'auto'
    },
    'boolean': {
        'en': 'boolean',
        'de': 'boolean'
    },
    'both': {
        'en': 'both',
        'de': 'both'
    },
    'currentA': {
        'en': 'currentA',
        'de': 'currentA'
    },
    'dynamic': {
        'en': 'dynamic',
        'de': 'dynamic'
    },
    'enforce': {
        'en': 'enforce',
        'de': 'enforce'
    },
    'fromDatapoint': {
        'en': 'fromDatapoint',
        'de': 'fromDatapoint'
    },
    'engine': {
        'en': 'engine',
        'de': 'engine'
    },
    'fromPeakShaving': {
        'en': 'fromPeakShaving',
        'de': 'fromPeakShaving'
    },
    'info': {
        'en': 'info',
        'de': 'info'
    },
    'ioBroker Object ID': {
        'en': 'ioBroker Object ID',
        'de': 'ioBroker Object ID'
    },
    'mixed': {
        'en': 'mixed',
        'de': 'mixed'
    },
    'number': {
        'en': 'number',
        'de': 'number'
    },
    'off': {
        'en': 'off',
        'de': 'off'
    },
    'powerW': {
        'en': 'powerW',
        'de': 'powerW'
    },
    'pvSurplus': {
        'en': 'pvSurplus',
        'de': 'pvSurplus'
    },
    'read': {
        'en': 'read',
        'de': 'read'
    },
    'static': {
        'en': 'static',
        'de': 'static'
    },
    'string': {
        'en': 'string',
        'de': 'string'
    },
    'unlimited': {
        'en': 'unlimited',
        'de': 'unlimited'
    },
    'write': {
        'en': 'write',
        'de': 'write'
    },

    'Diagnostics': {
        'en': 'Diagnostics',
        'de': 'Diagnose'
    },
    'Enable diagnostics logging': {
        'en': 'Enable diagnostics logging',
        'de': 'Diagnose-Logging aktivieren'
    },
    'Write diagnostics states': {
        'en': 'Write diagnostics states',
        'de': 'Diagnose-States schreiben'
    },
    'Diagnostics log level': {
        'en': 'Diagnostics log level',
        'de': 'Diagnose-Loglevel'
    },
    'Diagnostics max JSON length': {
        'en': 'Diagnostics max JSON length',
        'de': 'Max. JSON-Länge Diagnose'
    },
    'Enables additional debug/info logs and optional diagnostics states.': {
        'en': 'Enables additional debug/info logs and optional diagnostics states.',
        'de': 'Aktiviert zusätzliche Debug/Info-Logs sowie optionale Diagnose-States.'
    },
    'If enabled, diagnostics data is written to adapter states (diagnostics.*).': {
        'en': 'If enabled, diagnostics data is written to adapter states (diagnostics.*).',
        'de': 'Wenn aktiv, werden Diagnose-Daten in Adapter-States (diagnostics.*) geschrieben.'
    },
    'Log level used for diagnostics output (adapter log).': {
        'en': 'Log level used for diagnostics output (adapter log).',
        'de': 'Loglevel für Diagnose-Ausgaben (Adapter-Log).'
    },
    'Maximum length for JSON written to diagnostics states (prevents oversized states).': {
        'en': 'Maximum length for JSON written to diagnostics states (prevents oversized states).',
        'de': 'Maximale Länge für JSON in Diagnose-States (verhindert zu große States).'
    },
    'debug': {
        'en': 'debug',
        'de': 'debug'
    },
    'info': {
        'en': 'info',
        'de': 'info'
    },

    'Diagnostics log interval (sec)': {
        'en': 'Diagnostics log interval (sec)',
        'de': 'Diagnose-Log-Intervall (Sek.)'
    },
    'Diagnostics state interval (sec)': {
        'en': 'Diagnostics state interval (sec)',
        'de': 'Diagnose-State-Intervall (Sek.)'
    },
    'Always log/write on error': {
        'en': 'Always log/write on error',
        'de': 'Bei Fehler immer loggen/schreiben'
    },
    'Minimum seconds between diagnostics log lines (0 = every tick).': {
        'en': 'Minimum seconds between diagnostics log lines (0 = every tick).',
        'de': 'Mindestsekunden zwischen Diagnose-Logzeilen (0 = jeder Tick).'
    },
    'Minimum seconds between writing diagnostics states (0 = every tick).': {
        'en': 'Minimum seconds between writing diagnostics states (0 = every tick).',
        'de': 'Mindestsekunden zwischen Schreiben der Diagnose-States (0 = jeder Tick).'
    },
    'If a module error occurs, diagnostics are logged/written immediately (ignores intervals).': {
        'en': 'If a module error occurs, diagnostics are logged/written immediately (ignores intervals).',
        'de': 'Bei Modul-Fehler werden Diagnose-Daten sofort geloggt/geschrieben (ignoriert Intervalle).'
    },
};
