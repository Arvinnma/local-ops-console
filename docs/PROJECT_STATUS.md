# Authoritative Project Status

[简体中文](#简体中文)

This file is the project-owned source of truth for the currently installed build, public distribution baseline, private verified baseline, and release-readiness behavior. Update it after every release or verified post-release hotfix. Roadmap ideas and external knowledge bases are not authoritative for shipped state.

Status date: **2026-07-29**

## English

### Version and repository baselines

| Scope | Version / commit | Meaning |
| --- | --- | --- |
| Installed application | `1.8.2` | `/Applications/Local Ops.app`; bundled backend built at `2026-07-25T06:54:19.982Z`, source-equivalent to runtime commit `3d402a9` |
| Public GitHub `main` runtime baseline | `3d402a99c2e8cfeb6e6b7f86acd9b01af894e91c` | Contains the accepted lifecycle/readiness fix after the 2026-07-25 source publication |
| Public `v1.8.2` DMG | SHA-256 `89d525ea0a132679373c9ce41fa9bf7fca941788f01b30154a28b8a4dbcd5e30` | Published GitHub Release artifact |
| Public `v1.8.2` tag | `81a7d9b402733a97f10140c47108177508618f5a` | Immutable released source baseline; older than current `main` |
| Private Forgejo runtime baseline | `f9c2dfb94a7115263f6619d7f3b2261de1ffb9a7` | Verified post-release hotfix for SSH aliases managed by `ProxyJump` / `ProxyCommand` |
| Verified internal DMG | SHA-256 `93c880b17ae4abad58635734a2580b91077d9774e8e692bfd02bfc953c2a63eb` | Internal `Local-Ops-1.8.2-arm64.dmg`; installed and runtime-accepted locally |

Documentation-only commits may advance either `main`; `3d402a9` remains the latest public runtime-affecting baseline, while `f9c2dfb` is the latest privately verified and installed runtime hotfix.

There is no uncommitted ProxyJump patch and no pending “move the patch into source” step. The hotfix is committed in the canonical source, installed as a minimal runtime overlay, and runtime-verified. It is private-only: GitHub `main`, the published `v1.8.2` tag, the Release DMG, and the previously verified internal DMG must not be described as containing it.

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

The installed build was verified with private Git HTTP and `git ls-remote`, authentication-protected routes, and degraded-upstream recovery. The 2026-07-29 proxy hotfix was additionally verified with `office-server-01` (`HostName 127.0.0.1`, port `10022`, `ProxyJump frp-relay-01`): Open WebUI and Grafana tunnels both reached **Connected**, TCP/HTTP/domain checks passed, and `fullyAvailable` became true. Every pre-existing tunnel retained the same PID and restart count.

### Current limitations and follow-up

- The accepted post-release source still reports application version `1.8.2`. The next public distribution must bump the version and publish a new tag/DMG instead of silently replacing the existing `v1.8.2` artifact.
- The ProxyJump hotfix is installed as a backend overlay; the current App bundle and DMGs do not contain it. A full reinstall from an older bundle can revert the runtime until a new package is built.
- Replacing the bundled backend currently restarts the Local Ops control plane. During the verified private installation this also restarted Process Compose worker SSH processes once. Schedule upgrades after active transfers complete until backend upgrades can preserve worker processes.
- Distribution remains Apple Silicon only, ad-hoc signed, and not notarized.
- A terminal domain-entry probe runs every 30 seconds until recovery. This is intentionally low frequency, but it still sends a real HTTP request to the configured local entry.

Use [Release and Hotfix Regression Manual](RELEASE_REGRESSION.md) for the mandatory verification sequence.

## 简体中文

### 版本与仓库双基线

| 范围 | 版本 / 提交 | 含义 |
| --- | --- | --- |
| 当前安装 App | `1.8.2` | `/Applications/Local Ops.app`；内置后台构建时间为 `2026-07-25T06:54:19.982Z`，源码内容等价于运行代码提交 `3d402a9` |
| 公开 GitHub `main` 运行代码基线 | `3d402a99c2e8cfeb6e6b7f86acd9b01af894e91c` | 2026-07-25 源码发布后包含已验收的生命周期/readiness 修复 |
| 公开 `v1.8.2` DMG | SHA-256 `89d525ea0a132679373c9ce41fa9bf7fca941788f01b30154a28b8a4dbcd5e30` | GitHub Release 已发布制品 |
| 公开 `v1.8.2` 标签 | `81a7d9b402733a97f10140c47108177508618f5a` | 不可变的已发布源码基线，早于当前 `main` |
| 私有 Forgejo 运行代码基线 | `f9c2dfb94a7115263f6619d7f3b2261de1ffb9a7` | 已验收的发布后热修，支持由 `ProxyJump` / `ProxyCommand` 管理的 SSH 别名 |
| 已验证内部 DMG | SHA-256 `93c880b17ae4abad58635734a2580b91077d9774e8e692bfd02bfc953c2a63eb` | 内部 `Local-Ops-1.8.2-arm64.dmg`，已在本机安装并通过运行验收 |

后续纯文档提交可能继续推进任一 `main`；`3d402a9` 仍是最新公开运行代码基线，`f9c2dfb` 是最新经过私有验收并安装的运行热修。

目前不存在“ProxyJump 补丁尚未提交”或“还要把热修搬回正式源码”的步骤。热修已经进入正式源码，以最小运行覆盖方式安装并通过运行验收；它目前仅属于私有基线。公开 GitHub `main`、`v1.8.2` 标签、Release DMG 和此前验证的内部 DMG 都不能描述成已经包含该热修。

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

当前安装副本已完成私有 Git HTTP 与 `git ls-remote`、认证型入口和降级恢复验收。2026-07-29 又以 `office-server-01`（`HostName 127.0.0.1`、端口 `10022`、`ProxyJump frp-relay-01`）验证了代理热修：Open WebUI 与 Grafana 隧道均进入“已连接”，TCP、HTTP、域名检查通过，`fullyAvailable=true`；全部既有隧道的 PID 与重启次数保持不变。

### 尚未解决与后续事项

- 已验收的发布后源码仍显示 App 版本 `1.8.2`。下一次公开发布必须升级版本号、创建新标签和 DMG；不得静默替换既有公开 `v1.8.2` 制品。
- ProxyJump 热修目前以后台覆盖方式安装，当前 App Bundle 和 DMG 都不包含它；在新制品产生前，从旧 Bundle 完整重装可能回退该运行代码。
- 当前替换内置后台会重启 Local Ops 控制面。私有制品安装验收时，Process Compose Worker 下的 SSH 进程也随之重启过一次。在升级流程能够保留 Worker 前，应避开正在进行的数据传输。
- 当前只提供 Apple Silicon 包，使用 ad-hoc 签名，尚未公证。
- 终态恢复期间每 30 秒会向配置的本地域名入口发送一次真实 HTTP 请求；频率已刻意降低，但并非零流量。

强制回归流程见[发布与热修回归手册](RELEASE_REGRESSION.md)。
