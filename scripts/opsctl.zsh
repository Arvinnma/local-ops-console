#!/bin/zsh
set -euo pipefail

source "$HOME/.zshrc" >/dev/null 2>&1 || true
proxy_on >/dev/null 2>&1 || true

ROOT="${LOCAL_OPS_HOME:-$HOME/.local/share/local-ops}"
PROCESS_COMPOSE="${LOCAL_OPS_PROCESS_COMPOSE:-}"
if [[ -z "$PROCESS_COMPOSE" ]]; then
  for candidate in "$ROOT/bin/process-compose" /opt/homebrew/bin/process-compose /usr/local/bin/process-compose; do
    if [[ -x "$candidate" ]]; then PROCESS_COMPOSE="$candidate"; break; fi
  done
fi
[[ -x "$PROCESS_COMPOSE" ]] || { command printf '%s\n' '找不到 Process Compose' >&2; exit 1; }
CORE=($PROCESS_COMPOSE --address 127.0.0.1 --port 19091 --token-file "$ROOT/config/process-compose.token")
WORKER=($PROCESS_COMPOSE --address 127.0.0.1 --port 19093 --token-file "$ROOT/config/process-compose.token")
LABEL="gui/$(id -u)/com.arvin.localops"
PLIST="$ROOT/launchd/com.arvin.localops.plist"

case "${1:-help}" in
  status)
    command printf '%s\n' '控制面：'
    "${CORE[@]}" process list --output wide
    command printf '\n%s\n' '用户服务与 SSH 隧道：'
    "${WORKER[@]}" process list --output wide
    ;;
  start)
    if launchctl print "$LABEL" >/dev/null 2>&1; then
      launchctl kickstart "$LABEL"
    else
      launchctl bootstrap "gui/$(id -u)" "$PLIST"
    fi
    ;;
  stop)
    launchctl bootout "$LABEL"
    ;;
  restart)
    if launchctl print "$LABEL" >/dev/null 2>&1; then
      launchctl kickstart -k "$LABEL"
    else
      launchctl bootstrap "gui/$(id -u)" "$PLIST"
    fi
    ;;
  logs)
    if [[ -n "${2:-}" ]]; then
      if "${CORE[@]}" process get "$2" --output json >/dev/null 2>&1; then
        "${CORE[@]}" process logs "$2" --tail "${3:-200}"
      else
        "${WORKER[@]}" process logs "$2" --tail "${3:-200}"
      fi
    else
      tail -n "${3:-200}" "$ROOT/runtime/process-compose.log"
    fi
    ;;
  tui)
    "${WORKER[@]}" attach
    ;;
  tui-core)
    "${CORE[@]}" attach
    ;;
  process)
    "${WORKER[@]}" process "${2:?缺少操作 start/stop/restart}" "${3:?缺少进程 ID}"
    ;;
  open)
    PUBLIC_PORT="$(/usr/bin/plutil -extract settings.publicProxyPort raw -o - "$ROOT/config/catalog.json" 2>/dev/null || /usr/bin/plutil -extract settings.proxyPort raw -o - "$ROOT/config/catalog.json" 2>/dev/null || command printf '19080')"
    if [[ "$PUBLIC_PORT" == "80" ]]; then
      open "http://console.localhost"
    else
      open "http://console.localhost:$PUBLIC_PORT"
    fi
    ;;
  *)
    command printf '%s\n' \
      'Local Ops 命令：' \
      '  opsctl.zsh status              查看进程状态' \
      '  opsctl.zsh start               启动控制面' \
      '  opsctl.zsh stop                停止控制面' \
      '  opsctl.zsh restart             重启控制面' \
      '  opsctl.zsh logs [进程] [行数]  查看日志' \
      '  opsctl.zsh process 操作 进程   启停用户服务' \
      '  opsctl.zsh tui                 打开用户服务 TUI' \
      '  opsctl.zsh tui-core            打开控制面 TUI' \
      '  opsctl.zsh open                打开网页控制台'
    ;;
esac
