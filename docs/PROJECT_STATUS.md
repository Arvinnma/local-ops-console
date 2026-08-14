# Authoritative Project Status

[简体中文](#简体中文)

This file is the project-owned source of truth for the currently installed build, public distribution baseline, private verified baseline, and release-readiness behavior. Update it after every release or verified post-release hotfix. Roadmap ideas and external knowledge bases are not authoritative for shipped state.

Status date: **2026-08-14**

Source update date: **2026-08-14**

## English

### Version and repository baselines

| Scope | Version / commit | Meaning |
| --- | --- | --- |
| Installed application / runtime | App and bundled backend `1.8.6` | `/Applications/Local Ops.app` and `/Users/arvin/.local/share/local-ops/.bundle-manifest.json`, verified after installing the release candidate |
| Public GitHub runtime baseline | Tag `v1.8.6` | Source baseline published with the `v1.8.6` release |
| Public `v1.8.6` DMG | SHA-256 `726e1f52c1ff8da1ac334d187b69ffc335396e8240404ed6136190c08979fe40` | GitHub Release artifact, Apple Silicon only |
| Public `v1.8.6` tag | `v1.8.6` | Immutable released source baseline; resolve the tag for the exact commit |
| Private Forgejo runtime baseline | Tag `v1.8.6` | Matches the public released runtime source and private tag |
| Verified release DMG | SHA-256 `726e1f52c1ff8da1ac334d187b69ffc335396e8240404ed6136190c08979fe40` | `Local-Ops-1.8.6-arm64.dmg`; checksum, ad-hoc signature, arm64 architecture, mounted layout, version, bundled tools, and packaged desktop files verified |

Documentation-only commits may advance either `main`; the immutable `v1.8.6` tag remains the released runtime baseline.

Version 1.8.6 ships the refresh-consistency work plus a per-tunnel consecutive-failure supervisor. Atomic catalog/state snapshots, serialized ordinary/forced refreshes, stale-snapshot protection, menu-bar health debounce, and a shared SSH action contract are now packaged and installed. Each tunnel gets ten consecutive attempts; listener readiness, optional HTTP readiness, and a ten-second stable window reset that tunnel's counter to zero so a later outage starts at one.

### Verified cold-start and SSH-readiness behavior

- Effective SSH aliases are resolved with `ssh -G`. Direct connections still probe the real `HostName/Port` before starting SSH.
- Aliases with `ProxyJump` or `ProxyCommand` delegate reachability to OpenSSH instead of incorrectly probing the final loopback endpoint. The runtime records `ssh-managed` / `delegated` with `ok: null`; the UI reports **Managed by SSH** rather than inventing a successful TCP probe.
- An unavailable boot-time network remains **Connecting / Waiting for Network**. It does not report a false connection and does not use a fixed long sleep.
- SSH uses `ConnectTimeout=5` and `ConnectionAttempts=1`; Process Compose retries at an approximately three-second cadence.
- Every managed SSH tunnel has an independent ten-consecutive-failure budget. Attempts 1 through 9 continue retrying at the existing cadence; the tenth failure is terminal until an explicit retry.
- A successful child start does not reset the counter. Reset requires the SSH forward, local listener, optional HTTP readiness, and a ten-second stable window.
- A configured tunnel HTTP health URL has a ten-second timeout and treats HTTP `100` through `499` as proof that the forwarded application responded.
- SSH/TCP liveness is independent from optional HTTP application readiness. Repeated `503`, connection failure, or readiness timeout degrades the application signal without terminating the SSH process or consuming its restart budget.
- A matching complete `.localhost` domain entry accepts `2xx`, `3xx`, `401`, and `403`. `401/403` prove that routing reached an authentication-protected application; they do **not** prove that user authentication succeeded.
- `404`, `5xx`, connection failures, and timeouts keep the domain entry unready.
- Exhausting the domain-entry retry budget no longer locks the card permanently. Terminal failures receive one low-frequency recovery probe every 30 seconds and automatically return to **Connected** when the entry recovers.
- Domain-entry recovery probes are throttled and do not restart an otherwise healthy SSH process.
- Generated worker configuration contains no HTTP readiness/liveness probes for user services or tunnels. Service health failures report **Service Degraded** while the process remains alive.
- Desired process state and stop audit are persisted in `runtime/process-lifecycle.json`; UI, API, menu-bar, startup, app-quit, health, and orchestrator sources retain a reason and timestamp.
- Menu-bar service and tunnel stops require a trusted user click and explicit confirmation. Unconfirmed tray tunnel stops are rejected with HTTP `409`; audit records retain the event name, action ID, call path, and confirmed intent.
- Session capture preserves desired-running resources across a transient Process Compose restart window; an explicit stop still removes the resource from the remembered session.
- Session capture also preserves a previously remembered tunnel after an unconfirmed menu-bar stop, so an accidental tray incident cannot become the next-launch baseline.
- Services with loopback HTTP health URLs run through a managed supervisor that records the real child PID and reconciles a false Process Compose exit without launching a duplicate.
- An occupied health port blocks the child command and leaves one stable degraded supervisor instead of consuming an unlimited restart loop.
- Managed stop and restart operations clean the complete child process tree. Services without a health URL keep their direct Process Compose lifecycle.
- The Caddy internal port is editable only while portless access is disabled. Local Ops validates the range, control-plane collisions, and active listeners before atomically rendering and reloading the configuration.
- The privileged PF anchor is generated from the selected Caddy port for both IPv4 and IPv6. A stale installed rule is reported as **Repair Portless Access** rather than as a failed SSH tunnel.

The installed build was verified with private Git HTTP and `git ls-remote`, authentication-protected routes, and degraded-upstream recovery. The 2026-07-29 proxy hotfix was additionally verified with `office-server-01` (`HostName 127.0.0.1`, port `10022`, `ProxyJump frp-relay-01`): Open WebUI and Grafana tunnels both reached **Connected**, TCP/HTTP/domain checks passed, and `fullyAvailable` became true. Every pre-existing tunnel retained the same PID and restart count.

The main-console synchronization fix was runtime-verified against nine configured tunnels. The menu-bar panel and `/api/bootstrap` already exposed all nine; after the frontend overlay and a window-only reload, the main console loaded the same catalog while every running SSH tunnel retained its existing PID. Normal polling now refreshes both `/api/state` and `/api/bootstrap`, so resources created by another Local Ops client appear without reopening the App.

### Current limitations and follow-up

- Replacing the bundled backend currently restarts the Local Ops control plane. The verified v1.8.6 installation restarted Process Compose worker SSH processes once, restored the remembered session, and reset stable tunnel counters to zero. Schedule upgrades after active transfers complete until backend upgrades can preserve worker processes.
- Distribution remains Apple Silicon only, ad-hoc signed, and not notarized.
- A terminal domain-entry probe runs every 30 seconds until recovery. This is intentionally low frequency, but it still sends a real HTTP request to the configured local entry.
- Two configured speech-service tunnels remained in **Connecting** after installation because their application readiness checks were still failing even though their local TCP listeners were present. This is an upstream-readiness condition, not a duplicate SSH listener or a supervisor retry leak.

Use [Release and Hotfix Regression Manual](RELEASE_REGRESSION.md) for the mandatory verification sequence.

## 简体中文

### 版本与仓库双基线

| 范围 | 版本 / 提交 | 含义 |
| --- | --- | --- |
| 当前安装 App / 运行副本 | App 与内置后台 `1.8.6` | `/Applications/Local Ops.app` 与 `/Users/arvin/.local/share/local-ops/.bundle-manifest.json`，已在安装候选包后核验 |
| 公开 GitHub 运行代码基线 | 标签 `v1.8.6` | 随 `v1.8.6` Release 发布的源码基线 |
| 公开 `v1.8.6` DMG | SHA-256 `726e1f52c1ff8da1ac334d187b69ffc335396e8240404ed6136190c08979fe40` | GitHub Release 制品，仅支持 Apple Silicon |
| 公开 `v1.8.6` 标签 | `v1.8.6` | 不可变的已发布源码基线；精确提交以标签解析结果为准 |
| 私有 Forgejo 运行代码基线 | 标签 `v1.8.6` | 与公开已发布运行源码及私有标签一致 |
| 已验证 Release DMG | SHA-256 `726e1f52c1ff8da1ac334d187b69ffc335396e8240404ed6136190c08979fe40` | `Local-Ops-1.8.6-arm64.dmg` 已通过校验和、ad-hoc 签名、arm64 架构、挂载布局、版本、内置工具和桌面端打包文件检查 |

后续纯文档提交可能继续推进任一 `main`；不可变的 `v1.8.6` 标签仍是已发布运行代码基线。

v1.8.6 正式包含刷新一致性修复和逐隧道连续失败监督器：原子 catalog/state 快照、普通/强制刷新串行化、旧快照保护、菜单栏健康去抖和统一 SSH 动作契约均已打包并安装。每条隧道独立拥有 10 次连续失败额度；本地监听、可选 HTTP readiness 与 10 秒稳定窗口通过后，该隧道计数清零，后续新故障从 1 开始。

### 已验证的冷启动与 SSH readiness 行为

- Local Ops 先用 `ssh -G` 解析 SSH 别名。直连 SSH 仍会先探测真实 `HostName/Port`。
- 带 `ProxyJump` 或 `ProxyCommand` 的别名由 OpenSSH 自己判断完整链路，不再错误探测最终的回环端点。运行状态记录 `ssh-managed` / `delegated` 和 `ok: null`，界面显示“由 SSH 建立”，不会伪造 TCP 探测成功。
- 开机网络尚未就绪时保持“连接中 / 等待网络”，不误报已连接，也不使用固定长时间 `sleep`。
- SSH 使用 `ConnectTimeout=5`、`ConnectionAttempts=1`，Process Compose 约每 3 秒发起下一轮。
- 每条托管 SSH 隧道独立拥有 10 次连续失败额度；第 1–9 次继续按现有节奏重试，第 10 次才进入终态并等待显式重试。
- SSH 子进程刚启动不会提前清零。必须完成转发、本地监听、可选 HTTP readiness 和 10 秒稳定窗口后才归零。
- 隧道 HTTP 健康地址的超时为 10 秒；收到 HTTP `100–499` 说明转发后的应用已经响应。
- SSH/TCP 存活与可选 HTTP 应用就绪已经分离。连续 `503`、连接失败或 readiness 超时只把应用标成降级，不结束 SSH 进程，也不消耗 SSH 重启额度。
- 匹配到的完整 `.localhost` 域名入口接受 `2xx`、`3xx`、`401` 和 `403`。`401/403` 只证明请求到达了受认证保护的应用，不代表用户认证已经成功。
- `404`、`5xx`、连接失败和超时仍表示域名入口未就绪。
- 域名入口耗尽重试额度后不会永久锁死。终态每 30 秒进行一次低频恢复探测，入口恢复后自动回到“已连接”。
- 域名入口恢复探测有节流，不会重启本身仍然健康的 SSH 进程。
- 生成的 Worker 配置不再给用户服务或隧道写入 HTTP readiness/liveness 探针；服务检查失败显示“服务降级”，进程继续存活。
- 进程期望状态和停止审计保存在 `runtime/process-lifecycle.json`，网页 UI、API、菜单栏、启动、退出、健康逻辑和编排器来源都会留下原因与时间。
- 菜单栏停止服务或隧道时必须来自可信的真实点击，并经过明确确认。未经确认的托盘隧道停止会返回 HTTP `409`；审计会保存事件名、动作 ID、调用路径和确认结果。
- 会话捕获会在 Process Compose 短暂重启窗口保留期望运行的资源；显式停止仍会把资源从记忆会话移除。
- 会话捕获遇到未经确认的菜单栏停止时，也会继续保留此前记忆的隧道，不让托盘异常固化成下次不恢复。
- 配置回环 HTTP 健康地址的服务通过监督器运行，记录真实子进程 PID；Process Compose 误报退出时会按真实 PID 对账，不会重复拉起。
- 健康端口被占用时阻止子命令启动，只保留一个稳定的降级监督器，不再消耗无限重启。
- 托管停止与重启会清理完整子进程树；未配置健康地址的服务继续使用 Process Compose 直接生命周期。
- 只有关闭无端口访问后才能修改 Caddy 内部端口。Local Ops 会校验端口范围、控制面端口冲突和现有监听，再原子生成配置并热加载。
- 特权 PF anchor 会按所选 Caddy 端口动态生成 IPv4 和 IPv6 规则；已安装规则过期时显示“修复无端口访问”，不再误报为 SSH 隧道失败。

当前安装副本已完成私有 Git HTTP 与 `git ls-remote`、认证型入口和降级恢复验收。2026-07-29 又以 `office-server-01`（`HostName 127.0.0.1`、端口 `10022`、`ProxyJump frp-relay-01`）验证了代理热修：Open WebUI 与 Grafana 隧道均进入“已连接”，TCP、HTTP、域名检查通过，`fullyAvailable=true`；全部既有隧道的 PID 与重启次数保持不变。

主控制台资源同步修复已用 9 条现有隧道完成运行验收：菜单栏面板和 `/api/bootstrap` 原本都能读取 9 条；覆盖前端并只重新载入窗口后，主控制台显示相同资源目录，所有运行中的 SSH 隧道 PID 均未变化。普通轮询现在会同时刷新 `/api/state` 与 `/api/bootstrap`，其他 Local Ops 客户端新增资源后无需重新打开 App。

### 尚未解决与后续事项

- 当前替换内置后台会重启 Local Ops 控制面。v1.8.6 安装验收时，Process Compose Worker 下的 SSH 进程随之重启一次，记忆会话恢复，稳定隧道计数回到 0。在升级流程能够保留 Worker 前，应避开正在进行的数据传输。
- 当前只提供 Apple Silicon 包，使用 ad-hoc 签名，尚未公证。
- 终态恢复期间每 30 秒会向配置的本地域名入口发送一次真实 HTTP 请求；频率已刻意降低，但并非零流量。
- 安装后有两条语音服务隧道仍处于“连接中”：本地 TCP listener 已存在，但其应用 readiness 尚未通过。这属于上游应用就绪问题，不是重复 SSH listener 或监督器重试泄漏。

强制回归流程见[发布与热修回归手册](RELEASE_REGRESSION.md)。
