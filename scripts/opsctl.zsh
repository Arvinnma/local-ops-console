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

control_process() {
  local action="$1"
  local process_id="$2"
  case "$action" in
    start|stop|restart) ;;
    *) command printf '不支持的进程操作：%s\n' "$action" >&2; return 2 ;;
  esac

  local console_port bootstrap token response_file http_code error_message
  console_port="$(/usr/bin/plutil -extract settings.consolePort raw -o - "$ROOT/config/catalog.json" 2>/dev/null || command printf '19090')"
  bootstrap="$(/usr/bin/curl --silent --show-error --fail --max-time 5 "http://127.0.0.1:${console_port}/api/bootstrap")" || {
    command printf '%s\n' 'Local Ops 控制面未就绪，无法执行进程操作' >&2
    return 1
  }
  token="$(command printf '%s' "$bootstrap" | /usr/bin/plutil -extract csrfToken raw -o - -- - 2>/dev/null)"
  [[ -n "$token" ]] || { command printf '%s\n' '无法读取 Local Ops 控制令牌' >&2; return 1; }

  response_file="$(/usr/bin/mktemp -t local-ops-cli)"
  http_code="$(/usr/bin/curl --silent --show-error --output "$response_file" --write-out '%{http_code}' --max-time 30 \
    --request POST \
    --header "X-Local-Ops-Token: $token" \
    "http://127.0.0.1:${console_port}/api/processes/${process_id}/${action}")" || {
      command rm -f "$response_file"
      return 1
    }
  if [[ "$http_code" != 2* ]]; then
    error_message="$(/usr/bin/plutil -extract error raw -o - "$response_file" 2>/dev/null || command printf 'HTTP %s' "$http_code")"
    command rm -f "$response_file"
    command printf '%s\n' "$error_message" >&2
    return 1
  fi
  command rm -f "$response_file"
  command printf '%s：%s\n' "$process_id" "$action"
}

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
    control_process "${2:?缺少操作 start/stop/restart}" "${3:?缺少进程 ID}"
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
