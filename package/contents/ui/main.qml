/*
 * HDR Toggle: one click turns HDR (and wide color gamut, like System Settings) on for the
 * selected monitors and applies their HDR brightness; the next click turns it off and
 * restores the brightness each monitor had in SDR mode. Everything goes through kscreen-doctor.
 */
import QtQuick
import QtQuick.Layouts
import org.kde.kirigami as Kirigami
import org.kde.kcmutils as KCMUtils
import org.kde.notification
import org.kde.plasma.components as PlasmaComponents
import org.kde.plasma.core as PlasmaCore
import org.kde.plasma.plasma5support as P5Support
import org.kde.plasma.plasmoid

import "logic.js" as Logic

PlasmoidItem {
    id: root

    readonly property string queryCommand: "kscreen-doctor -j"

    property var outputs: ({})
    property bool queryFailed: false
    property bool busy: false
    property string lastError: ""

    readonly property var monitors: Logic.parseMonitors(Plasmoid.configuration.monitors)
    readonly property var hdrState: Logic.computeState(outputs, monitors)
    readonly property bool hdrActive: hdrState.hdrActive
    readonly property bool configured: Logic.managedNames(monitors).length > 0

    // command -> callbacks waiting for its result (the executable engine runs a command once at a time)
    property var pending: ({})

    preferredRepresentation: compactRepresentation
    activationTogglesExpanded: false
    Plasmoid.onActivated: toggle()

    toolTipTextFormat: Text.PlainText
    toolTipMainText: !configured ? i18n("HDR Toggle") : hdrActive ? i18n("HDR is on") : i18n("HDR is off")
    toolTipSubText: {
        if (!configured) {
            return i18n("No monitor selected. Click to choose which monitors to manage.");
        }
        const screens = Logic.screenInfo(Qt.application.screens);
        const lines = [];
        if (queryFailed) {
            lines.push(i18n("Cannot read the display configuration (kscreen-doctor -j failed)."));
        }
        for (const name of hdrState.present) {
            const o = outputs[name];
            const state = o.hdr ? i18n("HDR on") : i18n("HDR off");
            const brightness = o.brightness === null ? "" : " · " + i18n("brightness %1%", o.brightness);
            lines.push(Logic.screenLabel(name, screens, false) + ": " + state + brightness);
        }
        for (const name of hdrState.missing) {
            lines.push(i18n("%1: not connected", name));
        }
        lines.push("");
        if (busy) {
            lines.push(i18n("Applying…"));
        } else if (hdrState.present.length > 0) {
            lines.push(hdrActive ? i18n("Click to turn HDR off") : i18n("Click to turn HDR on"));
        }
        if (lastError) {
            lines.push(lastError);
        }
        return lines.join("\n").trim();
    }

    Plasmoid.contextualActions: [
        PlasmaCore.Action {
            text: root.hdrActive ? i18n("Turn HDR Off") : i18n("Turn HDR On")
            icon.name: "video-display-brightness"
            enabled: !root.busy && root.hdrState.present.length > 0
            onTriggered: root.toggle()
        },
        PlasmaCore.Action {
            text: i18n("Display Configuration…")
            icon.name: "preferences-desktop-display"
            onTriggered: KCMUtils.KCMLauncher.openSystemSettings("kcm_kscreen")
        }
    ]

    // Plasma never creates the compact representation of an applet without a full one: it
    // treats it as permanently expanded. This widget has no popup, so the full representation
    // is an empty placeholder that is never shown (clicks toggle HDR instead of expanding).
    fullRepresentation: Item {}

    compactRepresentation: MouseArea {
        id: compact

        Layout.minimumWidth: {
            switch (Plasmoid.formFactor) {
            case PlasmaCore.Types.Vertical:
                return 0;
            case PlasmaCore.Types.Horizontal:
                return height;
            default:
                return Kirigami.Units.gridUnit * 3;
            }
        }
        Layout.minimumHeight: {
            switch (Plasmoid.formFactor) {
            case PlasmaCore.Types.Vertical:
                return width;
            case PlasmaCore.Types.Horizontal:
                return 0;
            default:
                return Kirigami.Units.gridUnit * 3;
            }
        }

        hoverEnabled: true
        activeFocusOnTab: true
        Accessible.name: Plasmoid.title
        Accessible.description: root.toolTipMainText
        Accessible.role: Accessible.Button

        onClicked: root.toggle()
        onContainsMouseChanged: {
            if (containsMouse) {
                root.poll();
            }
        }
        Keys.onPressed: event => {
            if ([Qt.Key_Space, Qt.Key_Enter, Qt.Key_Return, Qt.Key_Select].includes(event.key)) {
                root.toggle();
                event.accepted = true;
            }
        }

        Kirigami.Icon {
            anchors.fill: parent
            source: Qt.resolvedUrl(root.hdrActive ? "../icons/hdr-on.svg" : "../icons/hdr-off.svg")
            isMask: true
            color: Kirigami.Theme.textColor
            active: compact.containsMouse
            opacity: root.busy ? 0.3 : root.hdrState.present.length > 0 ? 1 : 0.5
        }

        PlasmaComponents.BusyIndicator {
            anchors.centerIn: parent
            width: Math.min(parent.width, parent.height)
            height: width
            running: root.busy
            visible: running
        }
    }

    P5Support.DataSource {
        id: executable
        engine: "executable"
        connectedSources: []
        onNewData: (source, data) => {
            disconnectSource(source);
            const callbacks = root.pending[source] || [];
            delete root.pending[source];
            for (const callback of callbacks) {
                callback(data["exit code"], data["stdout"] || "", data["stderr"] || "");
            }
        }
    }

    Component {
        id: notificationComponent
        Notification {
            componentName: "plasma_workspace"
            eventId: "notification"
            title: i18n("HDR Toggle")
            iconName: "dialog-warning"
        }
    }

    Timer {
        interval: 3000
        running: true
        repeat: true
        triggeredOnStart: true
        onTriggered: root.poll()
    }

    // Never stay busy forever if kscreen-doctor hangs.
    Timer {
        id: watchdog
        interval: 20000
        onTriggered: {
            for (const command of Object.keys(root.pending)) {
                executable.disconnectSource(command);
            }
            root.pending = {};
            root.finish(i18n("kscreen-doctor did not respond."));
        }
    }
    onBusyChanged: busy ? watchdog.restart() : watchdog.stop()

    function run(command, callback) {
        if (pending[command]) {
            pending[command].push(callback);
            return;
        }
        pending[command] = [callback];
        executable.connectSource(command);
    }

    // Reads the current display state; callback(outputs) gets null when kscreen-doctor failed.
    function refresh(callback) {
        run(queryCommand, (exitCode, stdout, stderr) => {
            let parsed = null;
            if (exitCode === 0) {
                try {
                    parsed = Logic.parseOutputs(stdout);
                } catch (e) {
                    console.warn("hdrtoggle: cannot parse kscreen-doctor output:", e);
                }
            } else {
                console.warn("hdrtoggle: kscreen-doctor -j failed with exit code", exitCode, stderr);
            }
            queryFailed = parsed === null;
            if (parsed !== null) {
                outputs = parsed;
            }
            callback(parsed);
        });
    }

    function poll() {
        if (busy) {
            return;
        }
        refresh(parsed => {
            if (parsed) {
                recordSnapshot(parsed, []);
            }
        });
    }

    function recordSnapshot(parsed, excluded) {
        const result = Logic.updateSnapshot(Logic.parseSnapshot(Plasmoid.configuration.sdrSnapshot), parsed, excluded);
        if (result.changed) {
            Plasmoid.configuration.sdrSnapshot = JSON.stringify(result.snapshot);
            Plasmoid.configuration.writeConfig();
        }
    }

    function toggle() {
        if (busy) {
            return;
        }
        if (!configured) {
            Plasmoid.internalAction("configure").trigger();
            return;
        }
        busy = true;
        lastError = "";
        // Always act on fresh state, and record the SDR values right before switching.
        refresh(parsed => {
            if (!parsed) {
                finish(i18n("Could not read the display configuration."));
                return;
            }
            recordSnapshot(parsed, []);
            const snapshot = Logic.parseSnapshot(Plasmoid.configuration.sdrSnapshot);
            const plan = Logic.planToggle(parsed, monitors, snapshot);
            if (!plan) {
                finish(i18n("None of the selected monitors is connected."));
                return;
            }
            run(plan.command, (exitCode, stdout, stderr) => verify(plan, snapshot, exitCode, stderr));
        });
    }

    // Checks the outcome before the snapshot is updated, so a monitor that refused HDR never
    // has its HDR brightness recorded as its SDR brightness.
    function verify(plan, snapshot, exitCode, stderr) {
        refresh(parsed => {
            if (!parsed) {
                finish(i18n("Could not read the display configuration."));
                return;
            }
            const failed = Logic.failedTargets(parsed, plan);
            recordSnapshot(parsed, failed);
            if (failed.length === 0) {
                if (exitCode !== 0) {
                    console.warn("hdrtoggle:", plan.command, "exited with", exitCode, stderr);
                }
                finish("");
                return;
            }
            const names = failed.map(name => Logic.screenLabel(name, Logic.screenInfo(Qt.application.screens), false)).join(", ");
            let error = plan.enable ? i18n("HDR could not be turned on for %1.", names)
                                    : i18n("HDR could not be turned off for %1.", names);
            const detail = stderr.trim().split("\n").pop().trim();
            if (exitCode !== 0 && detail) {
                error += " " + i18n("kscreen-doctor: %1", detail);
            }
            const revert = plan.enable ? Logic.planRevert(parsed, failed, monitors, snapshot) : "";
            if (revert) {
                run(revert, () => {
                    finish(error);
                    poll();
                });
            } else {
                finish(error);
            }
        });
    }

    function finish(error) {
        busy = false;
        lastError = error;
        if (error) {
            notificationComponent.createObject(root, { text: error }).sendEvent();
        }
    }
}
