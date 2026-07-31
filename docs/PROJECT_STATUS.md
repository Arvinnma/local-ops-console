# Authoritative Project Status

[简体中文](#简体中文)

This file is the project-owned source of truth for the currently installed build, public distribution baseline, private verified baseline, and release-readiness behavior. Update it after every release or verified post-release hotfix. Roadmap ideas and external knowledge bases are not authoritative for shipped state.

Status date: **2026-08-01**

## English

### Version and repository baselines

| Scope | Version / commit | Meaning |
| --- | --- | --- |
| Installed application / runtime | App `1.8.2`; runtime overlay `95e0fa2` | `/Applications/Local Ops.app` has not been replaced by this release; the installed backend contains the accepted v1.8.3 lifecycle implementation |
| Public GitHub runtime baseline | `95e0fa2843fc156cf0a35c32a79f780c174df033` | Source commit behind the public `v1.8.3` tag and DMG |
| Public `v1.8.3` DMG | SHA-256 `b5fc2973b098af01141fc33d569fb67fe7999df8c396dd8d580b28103d15f39e` | Published GitHub Release artifact, Apple Silicon only |
| Public `v1.8.3` tag | `95e0fa2843fc156cf0a35c32a79f780c174df033` | Immutable released source baseline |
| Private Forgejo runtime baseline | `95e0fa2843fc156cf0a35c32a79f780c174df033` | Matches the public released runtime source |
| Verified release DMG | SHA-256 `b5fc2973b098af01141fc33d569fb67fe7999df8c396dd8d580b28103d15f39e` | `Local-Ops-1.8.3-arm64.dmg`; checksum, signature, architecture, mounted layout, version, and packaged lifecycle files verified |

Documentation-only commits may advance either `main`; `95e0fa2` remains the latest runtime-affecting baseline for both repositories.

The ProxyJump, resource-synchronization, SSH/readiness, and managed-service lifecycle fixes are committed and packaged in v1.8.3. The currently installed 1.8.2 App has the lifecycle implementation as a verified backend overlay, but the new public DMG has not been installed over `/Applications/Local Ops.app` in this release task.

### Verified cold-start and SSH-readiness behavior

- Effective SSH aliases are resolved with `ssh -G`. Direct connections still probe the real `HostName/Port` before starting SSH.
- Aliases with `ProxyJump` or `ProxyCommand` delegate reachability to OpenSSH instead of incorrectly probing the final loopback endpoint. The runtime records `ssh-managed` / `delegated` with `ok: null`; the UI reports **Managed by SSH** rather than inventing a successful TCP probe.
- An unavailable boot-time network remains **Connecting / Waiting for Network**. It does not report a false connection and does not use a fixed long sleep.
- SSH uses `ConnectTimeout=5` and `ConnectionAttempts=1`; Process Compose retries at an approximately three-second cadence.
- User-triggered starts have a three-retry budget. Previous-session restoration has a 40-retry budget.
- A configured tunnel HTTP health URL has a ten-second timeout and treats HTTP `100` through `499` as proof that the forwarded application responded.
- SSH/TCP liveness is independent from optional HTTP application readiness. Repeated `503`, connection failure, or readiness timeout degrades the application signal without terminating the SSH process or consuming its restart budget.
- A matching complete `.localhost` domain entry accepts `2xx`, `3xx`, `401`, and `403`. `401/403` prove that routing reached an authentication-protected application; they do **not** prove that user authentication succeeded.
- `404`, `5xx`, connection failures, and timeouts keep the domain entry unready.
- Exhausting the domain-entry retry budget no longer locks the card permanently. Terminal failures receive one low-frequency recovery probe every 30 seconds and automatically return to **Connected** when the entry recovers.
- Domain-entry recovery probes are throttled and do not restart an otherwise healthy SSH process.
- Generated worker configuration contains no HTTP readiness/liveness probes for user services or tunnels. Service health failures report **Service Degraded** while the process remains alive.
- Desired process state and stop audit are persisted in `runtime/process-lifecycle.json`; UI, API, menu-bar, startup, app-quit, health, and orchestrator sources retain a reason and timestamp.
- Session capture preserves desired-running resources across a transient Process Compose restart window; an explicit stop still removes the resource from the remembered session.
- Services with loopback HTTP health URLs run through a managed supervisor that records the real child PID and reconciles a false Process Compose exit without launching a duplicate.
- An occupied health port blocks the child command and leaves one stable degraded supervisor instead of consuming an unlimited restart loop.
- Managed stop and restart operations clean the complete child process tree. Services without a health URL keep their direct Process Compose lifecycle.

The installed build was verified with private Git HTTP and `git ls-remote`, authentication-protected routes, and degraded-upstream recovery. The 2026-07-29 proxy hotfix was additionally verified with `office-server-01` (`HostName 127.0.0.1`, port `10022`, `ProxyJump frp-relay-01`): Open WebUI and Grafana tunnels both reached **Connected**, TCP/HTTP/domain checks passed, and `fullyAvailable` became true. Every pre-existing tunnel retained the same PID and restart count.

The main-console synchronization fix was runtime-verified against nine configured tunnels. The menu-bar panel and `/api/bootstrap` already exposed all nine; after the frontend overlay and a window-only reload, the main console loaded the same catalog while every running SSH tunnel retained its existing PID. Normal polling now refreshes both `/api/state` and `/api/bootstrap`, so resources created by another Local Ops client appear without reopening the App.

### Current limitations and follow-up

- `/Applications/Local Ops.app` remains version 1.8.2 until the user explicitly installs the new v1.8.3 DMG. The released v1.8.3 artifact already contains the accepted runtime fixes.
- Replacing the bundled backend currently restarts the Local Ops control plane. During the verified private installation this also restarted Process Compose worker SSH processes once. Schedule upgrades after active transfers complete until backend upgrades can preserve worker processes.
- Distribution remains Apple Silicon only, ad-hoc signed, and not notarized.
- A terminal domain-entry probe runs every 30 seconds until recovery. This is intentionally low frequency, but it still sends a real HTTP request to the configured local entry.

Use [Release and Hotfix Regression Manual](RELEASE_REGRESSION.md) for the mandatory verification sequence.

## 简体中文

### 版本与仓库双基线

| 范围 | 版本 / 提交 | 含义 |
| --- | --- | --- |
| 当前安装 App / 运行副本 | App `1.8.2`；运行覆盖 `95e0fa2` | `/Applications/Local Ops.app` 尚未由本次发布替换；安装后台已包含 v1.8.3 的已验收生命周期实现 |
| 公开 GitHub 运行代码基线 | `95e0fa2843fc156cf0a35c32a79f780c174df033` | 公开 `v1.8.3` 标签和 DMG 对应的源码提交 |
| 公开 `v1.8.3` DMG | SHA-256 `b5fc2973b098af01141fc33d569fb67fe7999df8c396dd8d580b28103d15f39e` | GitHub Release 已发布制品，仅支持 Apple Silicon |
| 公开 `v1.8.3` 标签 | `95e0fa2843fc156cf0a35c32a79f780c174df033` | 不可变的已发布源码基线 |
| 私有 Forgejo 运行代码基线 | `95e0fa2843fc156cf0a35c32a79f780c174df033` | 与公开已发布运行源码一致 |
| 已验证 Release DMG | SHA-256 `b5fc2973b098af01141fc33d569fb67fe7999df8c396dd8d580b28103d15f39e` | `Local-Ops-1.8.3-arm64.dmg` 已通过校验和、签名、架构、挂载布局、版本和打包生命周期文件检查 |

后续纯文档提交可能继续推进任一 `main`；`95e0fa2` 仍是两个仓库最新的运行代码基线。

ProxyJump、资源同步、SSH/readiness 和托管服务生命周期修复都已提交并打入 v1.8.3。当前安装的 1.8.2 App 已通过后台覆盖使用生命周期实现，但本次发布任务没有用新公开 DMG 覆盖 `/Applications/Local Ops.app`。

### 已验证的冷启动与 SSH readiness 行为

- Local Ops 先用 `ssh -G` 解析 SSH 别名。直连 SSH 仍会先探测真实 `HostName/Port`。
- 带 `ProxyJump` 或 `ProxyCommand` 的别名由 OpenSSH 自己判断完整链路，不再错误探测最终的回环端点。运行状态记录 `ssh-managed` / `delegated` 和 `ok: null`，界面显示“由 SSH 建立”，不会伪造 TCP 探测成功。
- 开机网络尚未就绪时保持“连接中 / 等待网络”，不误报已连接，也不使用固定长时间 `sleep`。
- SSH 使用 `ConnectTimeout=5`、`ConnectionAttempts=1`，Process Compose 约每 3 秒发起下一轮。
- 人工触发最多重试 3 次；恢复上次会话最多重试 40 次。
- 隧道 HTTP 健康地址的超时为 10 秒；收到 HTTP `100–499` 说明转发后的应用已经响应。
- SSH/TCP 存活与可选 HTTP 应用就绪已经分离。连续 `503`、连接失败或 readiness 超时只把应用标成降级，不结束 SSH 进程，也不消耗 SSH 重启额度。
- 匹配到的完整 `.localhost` 域名入口接受 `2xx`、`3xx`、`401` 和 `403`。`401/403` 只证明请求到达了受认证保护的应用，不代表用户认证已经成功。
- `404`、`5xx`、连接失败和超时仍表示域名入口未就绪。
- 域名入口耗尽重试额度后不会永久锁死。终态每 30 秒进行一次低频恢复探测，入口恢复后自动回到“已连接”。
- 域名入口恢复探测有节流，不会重启本身仍然健康的 SSH 进程。
- 生成的 Worker 配置不再给用户服务或隧道写入 HTTP readiness/liveness 探针；服务检查失败显示“服务降级”，进程继续存活。
- 进程期望状态和停止审计保存在 `runtime/process-lifecycle.json`，网页 UI、API、菜单栏、启动、退出、健康逻辑和编排器来源都会留下原因与时间。
- 会话捕获会在 Process Compose 短暂重启窗口保留期望运行的资源；显式停止仍会把资源从记忆会话移除。
- 配置回环 HTTP 健康地址的服务通过监督器运行，记录真实子进程 PID；Process Compose 误报退出时会按真实 PID 对账，不会重复拉起。
- 健康端口被占用时阻止子命令启动，只保留一个稳定的降级监督器，不再消耗无限重启。
- 托管停止与重启会清理完整子进程树；未配置健康地址的服务继续使用 Process Compose 直接生命周期。

当前安装副本已完成私有 Git HTTP 与 `git ls-remote`、认证型入口和降级恢复验收。2026-07-29 又以 `office-server-01`（`HostName 127.0.0.1`、端口 `10022`、`ProxyJump frp-relay-01`）验证了代理热修：Open WebUI 与 Grafana 隧道均进入“已连接”，TCP、HTTP、域名检查通过，`fullyAvailable=true`；全部既有隧道的 PID 与重启次数保持不变。

主控制台资源同步修复已用 9 条现有隧道完成运行验收：菜单栏面板和 `/api/bootstrap` 原本都能读取 9 条；覆盖前端并只重新载入窗口后，主控制台显示相同资源目录，所有运行中的 SSH 隧道 PID 均未变化。普通轮询现在会同时刷新 `/api/state` 与 `/api/bootstrap`，其他 Local Ops 客户端新增资源后无需重新打开 App。

### 尚未解决与后续事项

- `/Applications/Local Ops.app` 在用户明确安装 v1.8.3 DMG 前仍是 1.8.2；新发布的 v1.8.3 制品已经包含上述已验收运行修复。
- 当前替换内置后台会重启 Local Ops 控制面。私有制品安装验收时，Process Compose Worker 下的 SSH 进程也随之重启过一次。在升级流程能够保留 Worker 前，应避开正在进行的数据传输。
- 当前只提供 Apple Silicon 包，使用 ad-hoc 签名，尚未公证。
- 终态恢复期间每 30 秒会向配置的本地域名入口发送一次真实 HTTP 请求；频率已刻意降低，但并非零流量。

强制回归流程见[发布与热修回归手册](RELEASE_REGRESSION.md)。
