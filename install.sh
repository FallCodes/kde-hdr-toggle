#!/usr/bin/env bash
# Installs (or updates) the HDR Toggle widget for the current user.
#
#   ./install.sh            install / update the package
#   ./install.sh --restart  also restart plasmashell, so a widget already on a panel loads the new code
#
# Uninstall: kpackagetool6 -t Plasma/Applet -r com.fallcodes.hdrtoggle
set -euo pipefail

ID=com.fallcodes.hdrtoggle
cd "$(dirname "$(readlink -f "$0")")"

if kpackagetool6 -t Plasma/Applet --show "$ID" >/dev/null 2>&1; then
    kpackagetool6 -t Plasma/Applet --upgrade package
else
    kpackagetool6 -t Plasma/Applet --install package
fi

if [[ "${1:-}" == "--restart" ]]; then
    systemctl --user restart plasma-plasmashell.service
    echo "plasmashell restarted"
else
    echo "To add it: right-click the panel > Add Widgets... > search \"HDR Toggle\"."
fi
