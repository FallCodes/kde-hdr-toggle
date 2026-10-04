// Run with: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../package/contents/ui/logic.js");

// Trimmed `kscreen-doctor -j` output from the real setup (modes omitted).
function kscreenJson(overrides = {}) {
    const outputs = [
        { id: 1, name: "DP-1", connected: true, enabled: true, hdr: false, wcg: false, brightness: 0.6 },
        { id: 2, name: "DP-2", connected: true, enabled: true, hdr: false, wcg: false, brightness: 0.5 },
    ].map(o => Object.assign(o, overrides[o.name] || {}));
    return JSON.stringify({ features: 0, outputs, screen: {} });
}

const monitors = (obj) => L.parseMonitors(JSON.stringify(obj));
const ASUS_ONLY = monitors({ "DP-2": { managed: true, setBrightness: true, brightness: 100 } });
const BOTH = monitors({
    "DP-1": { managed: true, setBrightness: true, brightness: 80 },
    "DP-2": { managed: true, setBrightness: true, brightness: 100 },
});

test("parseOutputs reads state and converts brightness to percent", () => {
    const outputs = L.parseOutputs(kscreenJson());
    assert.deepEqual(outputs["DP-2"], { name: "DP-2", connected: true, enabled: true, hdr: false, wcg: false, brightness: 50 });
    assert.equal(outputs["DP-1"].brightness, 60);
});

test("parseOutputs drops names that are unsafe for the shell and throws on bad JSON", () => {
    const json = JSON.stringify({ outputs: [{ name: "DP-1; rm -rf ~", connected: true, enabled: true }] });
    assert.deepEqual(L.parseOutputs(json), {});
    assert.throws(() => L.parseOutputs("not json"));
});

test("parseMonitors sanitises names, defaults and ranges", () => {
    const m = monitors({
        "DP-2": { managed: true, brightness: 150 },
        "DP-1": { managed: 1, setBrightness: false, brightness: -4 },
        "bad name": { managed: true },
    });
    assert.deepEqual(m, {
        "DP-2": { managed: true, setBrightness: true, brightness: 100 },
        "DP-1": { managed: true, setBrightness: false, brightness: 0 },
    });
    assert.deepEqual(L.parseMonitors("garbage"), {});
});

test("computeState: HDR is active when any managed output has it; unplugged ones are missing", () => {
    const outputs = L.parseOutputs(kscreenJson({ "DP-1": { hdr: true } }));
    const m = monitors({ "DP-1": { managed: true }, "DP-2": { managed: true }, "HDMI-A-1": { managed: true } });
    assert.deepEqual(L.computeState(outputs, m), { present: ["DP-1", "DP-2"], missing: ["HDMI-A-1"], hdrActive: true });
    assert.equal(L.computeState(L.parseOutputs(kscreenJson()), ASUS_ONLY).hdrActive, false);
});

test("updateSnapshot records SDR outputs only and reports changes", () => {
    const outputs = L.parseOutputs(kscreenJson({ "DP-1": { hdr: true, brightness: 1 } }));
    const first = L.updateSnapshot({}, outputs, []);
    assert.deepEqual(first, { snapshot: { "DP-2": { brightness: 50, wcg: false } }, changed: true });
    assert.equal(L.updateSnapshot(first.snapshot, outputs, []).changed, false);
    assert.deepEqual(L.updateSnapshot({}, outputs, ["DP-2"]), { snapshot: {}, changed: false });
});

test("planEnable builds one atomic command with HDR, WCG and per-monitor brightness", () => {
    const plan = L.planEnable(L.parseOutputs(kscreenJson()), BOTH);
    assert.deepEqual(plan, {
        enable: true,
        targets: ["DP-1", "DP-2"],
        command: "kscreen-doctor output.DP-1.hdr.enable output.DP-1.wcg.enable output.DP-1.brightness.80"
            + " output.DP-2.hdr.enable output.DP-2.wcg.enable output.DP-2.brightness.100",
    });
});

test("planEnable leaves brightness alone when disabled for that monitor and skips outputs already in HDR", () => {
    const m = monitors({ "DP-1": { managed: true }, "DP-2": { managed: true, setBrightness: false } });
    const plan = L.planEnable(L.parseOutputs(kscreenJson({ "DP-1": { hdr: true } })), m);
    assert.equal(plan.command, "kscreen-doctor output.DP-2.hdr.enable output.DP-2.wcg.enable");
    assert.equal(L.planEnable(L.parseOutputs(kscreenJson()), monitors({ "HDMI-A-1": { managed: true } })), null);
});

test("planDisable restores the SDR snapshot", () => {
    const outputs = L.parseOutputs(kscreenJson({ "DP-2": { hdr: true, wcg: true, brightness: 1 } }));
    const plan = L.planDisable(outputs, ASUS_ONLY, { "DP-2": { brightness: 50, wcg: false } });
    assert.deepEqual(plan, {
        enable: false,
        targets: ["DP-2"],
        command: "kscreen-doctor output.DP-2.hdr.disable output.DP-2.wcg.disable output.DP-2.brightness.50",
    });
    const wcgWasOn = L.planDisable(outputs, ASUS_ONLY, { "DP-2": { brightness: 40, wcg: true } });
    assert.equal(wcgWasOn.command, "kscreen-doctor output.DP-2.hdr.disable output.DP-2.wcg.enable output.DP-2.brightness.40");
});

test("planDisable leaves brightness alone without a snapshot or when the widget doesn't manage it", () => {
    const outputs = L.parseOutputs(kscreenJson({ "DP-2": { hdr: true, wcg: true, brightness: 1 } }));
    assert.equal(L.planDisable(outputs, ASUS_ONLY, {}).command, "kscreen-doctor output.DP-2.hdr.disable output.DP-2.wcg.disable");
    const noBrightness = monitors({ "DP-2": { managed: true, setBrightness: false } });
    assert.equal(L.planDisable(outputs, noBrightness, { "DP-2": { brightness: 50, wcg: false } }).command,
        "kscreen-doctor output.DP-2.hdr.disable output.DP-2.wcg.disable");
});

test("planToggle turns off when any managed output is in HDR (partial state)", () => {
    const outputs = L.parseOutputs(kscreenJson({ "DP-2": { hdr: true, wcg: true, brightness: 1 } }));
    const plan = L.planToggle(outputs, BOTH, { "DP-2": { brightness: 50, wcg: false } });
    assert.equal(plan.enable, false);
    assert.deepEqual(plan.targets, ["DP-2"]);
    assert.equal(L.planToggle(L.parseOutputs(kscreenJson()), BOTH, {}).enable, true);
});

test("failedTargets and planRevert undo the HDR brightness on a monitor that refused HDR", () => {
    const plan = L.planEnable(L.parseOutputs(kscreenJson()), BOTH);
    // DP-2 switched, DP-1 stayed SDR but got the HDR brightness and WCG.
    const after = L.parseOutputs(kscreenJson({ "DP-1": { wcg: true, brightness: 0.8 }, "DP-2": { hdr: true, wcg: true, brightness: 1 } }));
    const failed = L.failedTargets(after, plan);
    assert.deepEqual(failed, ["DP-1"]);
    const snapshot = { "DP-1": { brightness: 60, wcg: false }, "DP-2": { brightness: 50, wcg: false } };
    assert.equal(L.planRevert(after, failed, BOTH, snapshot), "kscreen-doctor output.DP-1.wcg.disable output.DP-1.brightness.60");
    // Nothing to undo if the values never changed.
    assert.equal(L.planRevert(L.parseOutputs(kscreenJson()), ["DP-1"], BOTH, snapshot), "");
});

test("screenLabel and monitorRows", () => {
    const screens = [{ name: "DP-2", manufacturer: "ASUSTek COMPUTER INC", model: "XG27AQWMG" }];
    assert.equal(L.screenLabel("DP-2", screens, true), "ASUSTek COMPUTER INC XG27AQWMG (DP-2)");
    assert.equal(L.screenLabel("DP-2", screens, false), "XG27AQWMG (DP-2)");
    assert.equal(L.screenLabel("DP-1", screens, true), "DP-1");
    const rows = L.monitorRows(L.parseOutputs(kscreenJson()), monitors({ "HDMI-A-1": { managed: true }, "DP-3": {} }), screens);
    assert.deepEqual(rows, [
        { name: "DP-1", connected: true, label: "DP-1" },
        { name: "DP-2", connected: true, label: "ASUSTek COMPUTER INC XG27AQWMG (DP-2)" },
        { name: "HDMI-A-1", connected: false, label: "HDMI-A-1" },
    ]);
});
