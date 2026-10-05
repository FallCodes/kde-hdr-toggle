#!/usr/bin/env bash
# Builds dist/hdr-toggle-<Version>.plasmoid, the file to upload to the KDE Store.
# A .plasmoid is a zip with metadata.json at its root, installed by KPackage
# ("Get New Widgets" uses the same installer as kpackagetool6).
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")"

version=$(sed -n 's/.*"Version": *"\([^"]*\)".*/\1/p' package/metadata.json)
[[ -n "$version" ]] || { echo "No Version in package/metadata.json" >&2; exit 1; }

out="dist/hdr-toggle-$version.plasmoid"
mkdir -p dist
rm -f "$out"
bsdtar --format zip -cf "$out" -C package metadata.json contents

echo "Built $out:"
bsdtar -tf "$out"
