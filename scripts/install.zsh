#!/bin/zsh
set -euo pipefail

source "$HOME/.zshrc" >/dev/null 2>&1 || true
proxy_on >/dev/null 2>&1 || true

REPO_ROOT="${0:A:h:h}"
INSTALL_DIR="${LOCAL_OPS_HOME:-$HOME/.local/share/local-ops}"
LABEL="gui/$(id -u)/com.arvin.localops"
USER_PLIST="$HOME/Library/LaunchAgents/com.arvin.localops.plist"

if ! command -v brew >/dev/null 2>&1; then
  command printf '%s\n' '需要先安装 Homebrew：https://brew.sh/' >&2
  exit 1
fi

BREW_PREFIX="$(brew --prefix)"
if [[ ! -x "$BREW_PREFIX/bin/process-compose" ]]; then
  brew install f1bonacc1/tap/process-compose
fi
if [[ ! -x "$BREW_PREFIX/bin/caddy" ]]; then
  brew install caddy
fi
if [[ ! -x "$BREW_PREFIX/bin/node" ]]; then
  brew install node
fi

command mkdir -p "$INSTALL_DIR" "$INSTALL_DIR/config" "$INSTALL_DIR/generated" "$INSTALL_DIR/runtime" "$HOME/Library/LaunchAgents"

/usr/bin/rsync -a \
  --exclude '.git/' \
  --exclude 'desktop/' \
  --exclude 'runtime/' \
  --exclude 'generated/' \
  --exclude 'config/catalog.json' \
  --exclude 'config/process-compose.token' \
  "$REPO_ROOT/" "$INSTALL_DIR/"

if [[ ! -f "$INSTALL_DIR/config/catalog.json" ]]; then
  command cp "$INSTALL_DIR/config/catalog.example.json" "$INSTALL_DIR/config/catalog.json"
fi

if [[ ! -f "$INSTALL_DIR/config/process-compose.token" ]]; then
  umask 077
  "$BREW_PREFIX/bin/openssl" rand -hex 32 > "$INSTALL_DIR/config/process-compose.token" 2>/dev/null \
    || /usr/bin/openssl rand -hex 32 > "$INSTALL_DIR/config/process-compose.token"
fi

command chmod 700 "$INSTALL_DIR/scripts/start-stack.zsh" "$INSTALL_DIR/scripts/opsctl.zsh"
command chmod 600 "$INSTALL_DIR/config/catalog.json" "$INSTALL_DIR/config/process-compose.token"

"$BREW_PREFIX/bin/node" "$INSTALL_DIR/scripts/render-config.mjs"

/usr/bin/sed \
  -e "s|__HOME__|$HOME|g" \
  -e "s|__BREW_PREFIX__|$BREW_PREFIX|g" \
  "$INSTALL_DIR/launchd/com.arvin.localops.plist.template" \
  > "$INSTALL_DIR/launchd/com.arvin.localops.plist"

command ln -sfn "$INSTALL_DIR/launchd/com.arvin.localops.plist" "$USER_PLIST"
launchctl bootout "$LABEL" >/dev/null 2>&1 || true
BOOTSTRAPPED=false
for attempt in {1..20}; do
  if launchctl bootstrap "gui/$(id -u)" "$INSTALL_DIR/launchd/com.arvin.localops.plist" >/dev/null 2>&1; then
    BOOTSTRAPPED=true
    break
  fi
  /bin/sleep 0.15
done
if [[ "$BOOTSTRAPPED" != true ]]; then
  command printf '%s\n' 'LaunchAgent 注册失败，请运行 launchctl print gui/$(id -u)/com.arvin.localops 检查。' >&2
  exit 1
fi

if [[ -d "$BREW_PREFIX/bin" && -w "$BREW_PREFIX/bin" ]]; then
  command ln -sfn "$INSTALL_DIR/scripts/opsctl.zsh" "$BREW_PREFIX/bin/localops"
fi

command printf '%s\n' \
  'Local Ops 后台安装完成。' \
  '控制台：http://console.localhost:19080' \
  '状态命令：localops status'
