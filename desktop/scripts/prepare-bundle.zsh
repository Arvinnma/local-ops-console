#!/bin/zsh
set -euo pipefail

source "$HOME/.zshrc" >/dev/null 2>&1 || true
proxy_on >/dev/null 2>&1 || true

DESKTOP_ROOT="${0:A:h:h}"
REPO_ROOT="${DESKTOP_ROOT:h}"
STAGE_ROOT="$DESKTOP_ROOT/bundle/local-ops"

find_binary() {
  local name="$1"
  local candidate
  for candidate in "/opt/homebrew/bin/$name" "/usr/local/bin/$name" "$(command -v "$name" 2>/dev/null || true)"; do
    if [[ -n "$candidate" && -x "$candidate" ]]; then
      command printf '%s\n' "$candidate"
      return 0
    fi
  done
  command printf '缺少构建依赖：%s\n' "$name" >&2
  return 1
}

NODE_BIN="$(find_binary node)"
CADDY_BIN="$(find_binary caddy)"
PROCESS_COMPOSE_BIN="$(find_binary process-compose)"

command rm -rf "$DESKTOP_ROOT/bundle"
command mkdir -p "$STAGE_ROOT/bin" "$STAGE_ROOT/config" "$STAGE_ROOT/licenses"

for directory in public src scripts; do
  /usr/bin/rsync -a "$REPO_ROOT/$directory/" "$STAGE_ROOT/$directory/"
done

command cp "$REPO_ROOT/config/catalog.example.json" "$STAGE_ROOT/config/catalog.example.json"
command cp "$REPO_ROOT/package.json" "$STAGE_ROOT/package.json"
command cp "$REPO_ROOT/LICENSE" "$STAGE_ROOT/LICENSE"
command cp "$REPO_ROOT/THIRD_PARTY_NOTICES.md" "$STAGE_ROOT/THIRD_PARTY_NOTICES.md"
command cp "$REPO_ROOT/THIRD_PARTY_LICENSES/Apache-2.0.txt" "$STAGE_ROOT/licenses/Apache-2.0.txt"
command cp -L "$CADDY_BIN" "$STAGE_ROOT/bin/caddy"
command cp -L "$PROCESS_COMPOSE_BIN" "$STAGE_ROOT/bin/process-compose"
"$REPO_ROOT/scripts/build-keychain-helper.zsh" "$STAGE_ROOT/bin/local-ops-keychain"
command chmod 755 "$STAGE_ROOT/bin/caddy" "$STAGE_ROOT/bin/process-compose" "$STAGE_ROOT/bin/local-ops-keychain" "$STAGE_ROOT/scripts/"*.zsh
/usr/bin/xattr -cr "$STAGE_ROOT" >/dev/null 2>&1 || true

APP_VERSION="$(cd "$DESKTOP_ROOT" && "$NODE_BIN" -p 'require("./package.json").version')"
CADDY_VERSION="$($CADDY_BIN version 2>/dev/null | /usr/bin/head -1)"
PROCESS_COMPOSE_VERSION="$($PROCESS_COMPOSE_BIN version 2>/dev/null | /usr/bin/awk '/^Version:/ { print $2; exit }')"

STAGE_ROOT="$STAGE_ROOT" \
APP_VERSION="$APP_VERSION" \
CADDY_VERSION="$CADDY_VERSION" \
PROCESS_COMPOSE_VERSION="$PROCESS_COMPOSE_VERSION" \
"$NODE_BIN" -e '
  const fs = require("node:fs");
  const path = require("node:path");
  const manifest = {
    version: process.env.APP_VERSION,
    architecture: process.arch,
    builtAt: new Date().toISOString(),
    components: {
      caddy: process.env.CADDY_VERSION,
      processCompose: process.env.PROCESS_COMPOSE_VERSION,
      keychainHelper: "Security.framework"
    }
  };
  fs.writeFileSync(
    path.join(process.env.STAGE_ROOT, "bundle-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`
  );
'

command printf '%s\n' "已准备自包含后台组件：$STAGE_ROOT"
