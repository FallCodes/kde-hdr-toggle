// Pure helpers shared by main.qml, configGeneral.qml and tests/logic.test.js.
// No QML dependencies: everything takes plain objects and returns plain objects.
//
// Shapes used throughout:
//   outputs   { "DP-2": { name, connected, enabled, hdr, wcg, brightness } }   brightness: 0-100 or null
//   monitors  { "DP-2": { managed, setBrightness, brightness } }               widget settings per output
//   snapshot  { "DP-2": { brightness, wcg } }                                   last state seen in SDR mode
//   plan      { enable, targets: ["DP-2"], command: "kscreen-doctor ..." }

const NAME_RE = /^[A-Za-z0-9._-]+$/;

// Connector names end up in a shell command, so only accept the characters kscreen uses.
function isValidName(name) {
    return typeof name === "string" && NAME_RE.test(name);
}

function clampPercent(value, fallback) {
    const n = Math.round(Number(value));
    if (value === null || value === undefined || value === "" || !isFinite(n)) {
        return fallback;
    }
    return Math.min(100, Math.max(0, n));
}

function parseJsonObject(text) {
    try {
        const value = JSON.parse(text);
        return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    } catch (e) {
        return {};
    }
}

// Parses `kscreen-doctor -j`. Throws on malformed JSON so callers can report it.
function parseOutputs(text) {
    const data = JSON.parse(text);
    const list = data && Array.isArray(data.outputs) ? data.outputs : [];
    const result = {};
    for (const o of list) {
        if (!o || !isValidName(o.name)) {
            continue;
        }
        result[o.name] = {
            name: o.name,
            connected: !!o.connected,
            enabled: !!o.enabled,
            hdr: !!o.hdr,
            wcg: !!o.wcg,
            brightness: typeof o.brightness === "number" ? clampPercent(o.brightness * 100, null) : null,
        };
    }
    return result;
}

function isActive(output) {
    return !!output && output.connected && output.enabled;
}

function defaultMonitor() {
    return { managed: false, setBrightness: true, brightness: 100 };
}

function parseMonitors(text) {
    const raw = parseJsonObject(text);
    const result = {};
    for (const name of Object.keys(raw)) {
        if (!isValidName(name)) {
            continue;
        }
        const m = raw[name] && typeof raw[name] === "object" ? raw[name] : {};
        result[name] = {
            managed: !!m.managed,
            setBrightness: m.setBrightness === undefined ? true : !!m.setBrightness,
            brightness: clampPercent(m.brightness, 100),
        };
    }
    return result;
}

function parseSnapshot(text) {
    const raw = parseJsonObject(text);
    const result = {};
    for (const name of Object.keys(raw)) {
        if (!isValidName(name) || !raw[name] || typeof raw[name] !== "object") {
            continue;
        }
        const entry = { wcg: !!raw[name].wcg };
        const brightness = clampPercent(raw[name].brightness, null);
        if (brightness !== null) {
            entry.brightness = brightness;
        }
        result[name] = entry;
    }
    return result;
}

function managedNames(monitors) {
    return Object.keys(monitors).filter(name => monitors[name].managed).sort();
}

// `present` are managed outputs that are connected and enabled; `missing` are the rest.
// HDR counts as active when *any* present output has it, so one monitor that refuses
// HDR can never leave the toggle stuck in the "off" direction.
function computeState(outputs, monitors) {
    const present = [];
    const missing = [];
    for (const name of managedNames(monitors)) {
        (isActive(outputs[name]) ? present : missing).push(name);
    }
    return {
        present: present,
        missing: missing,
        hdrActive: present.some(name => outputs[name].hdr),
    };
}

// Records brightness and WCG of every active output currently in SDR mode.
// `excluded` lists outputs whose current values must not be trusted (e.g. HDR failed to
// come on but the HDR brightness was already applied).
function updateSnapshot(snapshot, outputs, excluded) {
    const next = Object.assign({}, snapshot);
    let changed = false;
    for (const name of Object.keys(outputs)) {
        const o = outputs[name];
        if (!isActive(o) || o.hdr || (excluded && excluded.indexOf(name) !== -1)) {
            continue;
        }
        const entry = { wcg: o.wcg };
        if (o.brightness !== null) {
            entry.brightness = o.brightness;
        }
        const prev = next[name];
        if (!prev || prev.wcg !== entry.wcg || prev.brightness !== entry.brightness) {
            next[name] = entry;
            changed = true;
        }
    }
    return { snapshot: next, changed: changed };
}

function command(args) {
    return "kscreen-doctor " + args.join(" ");
}

// HDR and WCG are switched together, exactly like the "Enable HDR" checkbox in System Settings.
function planEnable(outputs, monitors) {
    const targets = computeState(outputs, monitors).present.filter(name => !outputs[name].hdr);
    if (targets.length === 0) {
        return null;
    }
    const args = [];
    for (const name of targets) {
        args.push(`output.${name}.hdr.enable`, `output.${name}.wcg.enable`);
        if (monitors[name].setBrightness) {
            args.push(`output.${name}.brightness.${clampPercent(monitors[name].brightness, 100)}`);
        }
    }
    return { enable: true, targets: targets, command: command(args) };
}

// Brightness is only restored for monitors whose brightness the widget changes, and only
// when an SDR value is known; otherwise it is left alone.
function planDisable(outputs, monitors, snapshot) {
    const targets = computeState(outputs, monitors).present.filter(name => outputs[name].hdr);
    if (targets.length === 0) {
        return null;
    }
    const args = [];
    for (const name of targets) {
        const snap = snapshot[name];
        args.push(`output.${name}.hdr.disable`, `output.${name}.wcg.${snap && snap.wcg ? "enable" : "disable"}`);
        if (monitors[name].setBrightness && snap && snap.brightness !== undefined) {
            args.push(`output.${name}.brightness.${clampPercent(snap.brightness, 0)}`);
        }
    }
    return { enable: false, targets: targets, command: command(args) };
}

function planToggle(outputs, monitors, snapshot) {
    return computeState(outputs, monitors).hdrActive
        ? planDisable(outputs, monitors, snapshot)
        : planEnable(outputs, monitors);
}

// Targets that did not reach the state the plan asked for.
function failedTargets(outputs, plan) {
    return plan.targets.filter(name => !isActive(outputs[name]) || outputs[name].hdr !== plan.enable);
}

// For outputs where HDR failed to come on: put WCG and brightness back to the SDR snapshot
// if they differ. Returns "" when nothing needs to change.
function planRevert(outputs, names, monitors, snapshot) {
    const args = [];
    for (const name of names) {
        const o = outputs[name];
        const snap = snapshot[name];
        if (!isActive(o) || o.hdr || !snap) {
            continue;
        }
        if (o.wcg !== snap.wcg) {
            args.push(`output.${name}.wcg.${snap.wcg ? "enable" : "disable"}`);
        }
        if (monitors[name] && monitors[name].setBrightness && snap.brightness !== undefined
                && o.brightness !== snap.brightness) {
            args.push(`output.${name}.brightness.${snap.brightness}`);
        }
    }
    return args.length ? command(args) : "";
}

// Converts Qt.application.screens (a QML list) into plain { name, manufacturer, model } objects.
function screenInfo(list) {
    const result = [];
    for (let i = 0; i < (list ? list.length : 0); ++i) {
        result.push({ name: list[i].name, manufacturer: list[i].manufacturer, model: list[i].model });
    }
    return result;
}

// `screens`: result of screenInfo().
function screenLabel(name, screens, withManufacturer) {
    for (const s of screens || []) {
        if (s && s.name === name) {
            const parts = withManufacturer ? [s.manufacturer, s.model] : [s.model];
            const text = parts.filter(p => p && String(p).trim()).join(" ").trim();
            if (text) {
                return `${text} (${name})`;
            }
        }
    }
    return name;
}

// Rows for the settings page: every connected output, plus managed outputs that are unplugged.
function monitorRows(outputs, monitors, screens) {
    const connected = Object.keys(outputs).filter(name => outputs[name].connected).sort();
    const rows = connected.map(name => ({ name: name, connected: true, label: screenLabel(name, screens, true) }));
    for (const name of managedNames(monitors)) {
        if (connected.indexOf(name) === -1) {
            rows.push({ name: name, connected: false, label: name });
        }
    }
    return rows;
}

if (typeof module !== "undefined") {
    module.exports = {
        isValidName, clampPercent, parseOutputs, isActive, defaultMonitor, parseMonitors, parseSnapshot,
        managedNames, computeState, updateSnapshot, planEnable, planDisable, planToggle, failedTargets,
        planRevert, screenInfo, screenLabel, monitorRows,
    };
}
