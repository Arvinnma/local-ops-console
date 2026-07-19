#!/bin/zsh
set -euo pipefail

source "$HOME/.zshrc" >/dev/null 2>&1 || true
proxy_on >/dev/null 2>&1 || true

ROOT="${LOCAL_OPS_HOME:-$HOME/.local/share/local-ops}"
NODE_BIN="${LOCAL_OPS_NODE:-}"
PROCESS_COMPOSE_BIN="${LOCAL_OPS_PROCESS_COMPOSE:-}"

if [[ -z "$NODE_BIN" ]]; then
  for candidate in "$ROOT/bin/node" /opt/homebrew/bin/node /usr/local/bin/node; do
    if [[ -x "$candidate" ]]; then NODE_BIN="$candidate"; break; fi
  done
fi
if [[ -z "$PROCESS_COMPOSE_BIN" ]]; then
  for candidate in "$ROOT/bin/process-compose" /opt/homebrew/bin/process-compose /usr/local/bin/process-compose; do
    if [[ -x "$candidate" ]]; then PROCESS_COMPOSE_BIN="$candidate"; break; fi
  done
fi

[[ -x "$NODE_BIN" ]] || { command printf '%s\n' '找不到 Local Ops Node 运行时' >&2; exit 1; }
[[ -x "$PROCESS_COMPOSE_BIN" ]] || { command printf '%s\n' '找不到 Process Compose' >&2; exit 1; }

export PATH="$ROOT/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export LOCAL_OPS_NODE="$NODE_BIN"
export LOCAL_OPS_PROCESS_COMPOSE="$PROCESS_COMPOSE_BIN"
export LOCAL_OPS_CADDY="${LOCAL_OPS_CADDY:-$ROOT/bin/caddy}"
export LOCAL_OPS_KEYCHAIN_HELPER="${LOCAL_OPS_KEYCHAIN_HELPER:-$ROOT/bin/local-ops-keychain}"
export LOCAL_OPS_SSH_ASKPASS="${LOCAL_OPS_SSH_ASKPASS:-$ROOT/scripts/local-ops-ssh-askpass.zsh}"
export NO_PROXY="${NO_PROXY:-},127.0.0.1,localhost,.localhost,::1"
export no_proxy="$NO_PROXY"

"$NODE_BIN" "$ROOT/scripts/render-config.mjs"

exec "$PROCESS_COMPOSE_BIN" \
  --address 127.0.0.1 \
  --port 19091 \
  --token-file "$ROOT/config/process-compose.token" \
  --config "$ROOT/generated/process-compose.yaml" \
  --log-file "$ROOT/runtime/process-compose.log" \
  --log-no-color \
  --disable-dotenv \
  --ordered-shutdown \
  --tui=false \
  up
