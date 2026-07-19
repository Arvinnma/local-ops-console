#!/bin/zsh
set -euo pipefail

ROOT="${0:A:h:h}"
REPO_ROOT="${ROOT:h}"
BUILD="$ROOT/build"
ICONSET="$BUILD/LocalOps.iconset"
SOURCE="$BUILD/icon-1024.png"
ASSET_DIR="$ROOT/assets"
BRAND_DIR="$REPO_ROOT/assets/brand"
PUBLIC_BRAND_DIR="$REPO_ROOT/public/assets/brand"
APP_SVG="$BRAND_DIR/local-ops-app-icon-1024.svg"
MARK_SVG="$BRAND_DIR/local-ops-mark.svg"
TRAY_SVG="$BRAND_DIR/local-ops-tray-template.svg"

command mkdir -p "$ICONSET" "$ASSET_DIR" "$PUBLIC_BRAND_DIR"
command cp "$APP_SVG" "$PUBLIC_BRAND_DIR/local-ops-app-icon.svg"
command cp "$MARK_SVG" "$PUBLIC_BRAND_DIR/local-ops-mark.svg"
command cp "$TRAY_SVG" "$PUBLIC_BRAND_DIR/local-ops-tray-template.svg"
/usr/bin/swift "$ROOT/scripts/GenerateIcon.swift" "$APP_SVG" "$SOURCE" 1024
/usr/bin/swift "$ROOT/scripts/GenerateIcon.swift" "$TRAY_SVG" "$ASSET_DIR/tray-iconTemplate.png" 18
/usr/bin/swift "$ROOT/scripts/GenerateIcon.swift" "$TRAY_SVG" "$ASSET_DIR/tray-iconTemplate@2x.png" 36
command cp "$APP_SVG" "$ASSET_DIR/local-ops-app-icon.svg"
command cp "$SOURCE" "$ASSET_DIR/local-ops-app-icon-1024.png"
command cp "$SOURCE" "$PUBLIC_BRAND_DIR/local-ops-app-icon-1024.png"

/usr/bin/sips -z 16 16 "$SOURCE" --out "$ICONSET/icon_16x16.png" >/dev/null
/usr/bin/sips -z 32 32 "$SOURCE" --out "$ICONSET/icon_16x16@2x.png" >/dev/null
/usr/bin/sips -z 32 32 "$SOURCE" --out "$ICONSET/icon_32x32.png" >/dev/null
/usr/bin/sips -z 64 64 "$SOURCE" --out "$ICONSET/icon_32x32@2x.png" >/dev/null
/usr/bin/sips -z 128 128 "$SOURCE" --out "$ICONSET/icon_128x128.png" >/dev/null
/usr/bin/sips -z 256 256 "$SOURCE" --out "$ICONSET/icon_128x128@2x.png" >/dev/null
/usr/bin/sips -z 256 256 "$SOURCE" --out "$ICONSET/icon_256x256.png" >/dev/null
/usr/bin/sips -z 512 512 "$SOURCE" --out "$ICONSET/icon_256x256@2x.png" >/dev/null
/usr/bin/sips -z 512 512 "$SOURCE" --out "$ICONSET/icon_512x512.png" >/dev/null
/usr/bin/sips -z 1024 1024 "$SOURCE" --out "$ICONSET/icon_512x512@2x.png" >/dev/null

/usr/bin/iconutil -c icns "$ICONSET" -o "$BUILD/icon.icns"
