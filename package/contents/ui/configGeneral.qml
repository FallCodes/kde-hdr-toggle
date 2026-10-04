import QtQuick
import QtQuick.Controls as QQC2
import QtQuick.Layouts
import org.kde.kirigami as Kirigami
import org.kde.kcmutils as KCM
import org.kde.plasma.plasma5support as P5Support

import "logic.js" as Logic

KCM.SimpleKCM {
    id: page

    // Only `monitors` is declared: `sdrSnapshot` is written by the widget itself and must not be
    // overwritten with the stale copy this page would get when it opened.
    property string cfg_monitors
    property string cfg_monitorsDefault

    readonly property var settings: Logic.parseMonitors(cfg_monitors)
    // Built once when kscreen-doctor answers, so editing a row doesn't recreate the delegates.
    property var rows: []
    property bool loading: true
    property string loadError: ""

    function update(name, changes) {
        const next = Logic.parseMonitors(cfg_monitors);
        next[name] = Object.assign(next[name] || Logic.defaultMonitor(), changes);
        cfg_monitors = JSON.stringify(next);
    }

    P5Support.DataSource {
        engine: "executable"
        // Not the widget's "kscreen-doctor -j", so the shared engine never merges the two requests.
        connectedSources: ["kscreen-doctor --json"]
        onNewData: (source, data) => {
            disconnectSource(source);
            let outputs = {};
            if (data["exit code"] === 0) {
                try {
                    outputs = Logic.parseOutputs(data["stdout"]);
                } catch (e) {
                    page.loadError = i18n("Could not read the output of kscreen-doctor.");
                }
            } else {
                page.loadError = i18n("kscreen-doctor failed: %1", (data["stderr"] || "").trim() || data["exit code"]);
            }
            page.rows = Logic.monitorRows(outputs, page.settings, Logic.screenInfo(Qt.application.screens));
            page.loading = false;
        }
    }

    Kirigami.FormLayout {
        ColumnLayout {
            Kirigami.FormData.label: i18n("Monitors:")
            Kirigami.FormData.labelAlignment: Qt.AlignTop
            spacing: Kirigami.Units.largeSpacing

            QQC2.BusyIndicator {
                visible: page.loading
                running: visible
            }

            QQC2.Label {
                Layout.fillWidth: true
                visible: !page.loading && page.rows.length === 0
                text: page.loadError || i18n("No monitors found.")
                wrapMode: Text.Wrap
            }

            Repeater {
                model: page.rows

                delegate: ColumnLayout {
                    id: row

                    required property var modelData
                    readonly property var monitor: page.settings[modelData.name] || Logic.defaultMonitor()

                    spacing: 0

                    QQC2.CheckBox {
                        id: managedBox
                        text: row.modelData.connected ? row.modelData.label
                                                      : i18n("%1 (not connected)", row.modelData.label)
                        checked: row.monitor.managed
                        onToggled: page.update(row.modelData.name, { managed: checked })
                    }

                    RowLayout {
                        Layout.leftMargin: managedBox.indicator.width + managedBox.spacing
                        enabled: row.monitor.managed

                        QQC2.CheckBox {
                            id: brightnessBox
                            text: i18n("Set brightness to")
                            checked: row.monitor.setBrightness
                            onToggled: page.update(row.modelData.name, { setBrightness: checked })
                        }

                        QQC2.SpinBox {
                            from: 0
                            to: 100
                            stepSize: 5
                            editable: true
                            enabled: brightnessBox.checked
                            value: row.monitor.brightness
                            onValueModified: page.update(row.modelData.name, { brightness: value })
                        }

                        QQC2.Label {
                            enabled: brightnessBox.checked
                            text: i18nc("after the brightness spin box", "% while HDR is on")
                        }
                    }
                }
            }
        }

        Item {
            Kirigami.FormData.isSection: true
        }

        QQC2.Label {
            Layout.fillWidth: true
            Layout.maximumWidth: Kirigami.Units.gridUnit * 26
            wrapMode: Text.Wrap
            font: Kirigami.Theme.smallFont
            color: Kirigami.Theme.disabledTextColor
            text: i18n("Clicking the widget turns HDR on for the ticked monitors, together with wide color gamut as System Settings does, and applies the brightness above. Clicking again turns HDR off and restores the brightness each monitor had before.")
        }
    }
}
