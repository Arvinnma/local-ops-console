# Authoritative Project Status

[简体中文](#简体中文)

This file is the project-owned source of truth for the currently installed build, public distribution baseline, private verified baseline, and release-readiness behavior. Update it after every release or verified post-release hotfix. Roadmap ideas and external knowledge bases are not authoritative for shipped state.

Status date: **2026-07-25**

## English

### Version and repository baselines

| Scope | Version / commit | Meaning |
| --- | --- | --- |
| Installed application | `1.8.2` | `/Applications/Local Ops.app`; bundled backend built at `2026-07-25T06:54:19.982Z`, source-equivalent to runtime commit `3d402a9` |
| Public GitHub `main` runtime baseline | `3d402a99c2e8cfeb6e6b7f86acd9b01af894e91c` | Contains the accepted lifecycle/readiness fix after the 2026-07-25 source publication |
| Public `v1.8.2` DMG | SHA-256 `89d525ea0a132679373c9ce41fa9bf7fca941788f01b30154a28b8a4dbcd5e30` | Published GitHub Release artifact |
| Public `v1.8.2` tag | `81a7d9b402733a97f10140c47108177508618f5a` | Immutable released source baseline; older than current `main` |
| Private Forgejo runtime baseline | `3d402a99c2e8cfeb6e6b7f86acd9b01af894e91c` | Same accepted lifecycle/readiness source baseline as GitHub `main` |
| Verified internal DMG | SHA-256 `93c880b17ae4abad58635734a2580b91077d9774e8e692bfd02bfc953c2a63eb` | Internal `Local-Ops-1.8.2-arm64.dmg`; installed and runtime-accepted locally |

Documentation-only commits may advance either `main`; `3d402a9` remains the latest runtime-affecting baseline until another code change is accepted.

There is no uncommitted lifecycle patch and no pending “move the patch into source” step. The source is committed for publication to both repositories, packaged, installed, and runtime-verified. The published GitHub `v1.8.2` tag and Release DMG remain older and must not be described as containing the post-release fixes.

### Verified cold-start and SSH-readiness behavior

- Effective SSH aliases are resolved with `ssh -G`, then the real `HostName/Port` is probed before starting SSH.
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

The installed build was verified with private Git HTTP and `git ls-remote`, two authentication-protected routes returning the expected `401`, and one monitored dashboard returning `503` while its original PID remained stable with zero restarts. Representative tunnels kept one wrapper/listener each and recovered readiness without a duplicate SSH process.

### Current limitations and follow-up

- The accepted post-release source still reports application version `1.8.2`. The next public distribution must bump the version and publish a new tag/DMG instead of silently replacing the existing `v1.8.2` artifact.
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
| 私有 Forgejo 运行代码基线 | `3d402a99c2e8cfeb6e6b7f86acd9b01af894e91c` | 与 GitHub `main` 相同的已验收生命周期/readiness 源码基线 |
| 已验证内部 DMG | SHA-256 `93c880b17ae4abad58635734a2580b91077d9774e8e692bfd02bfc953c2a63eb` | 内部 `Local-Ops-1.8.2-arm64.dmg`，已在本机安装并通过运行验收 |

后续纯文档提交可能继续推进任一 `main`；在下一次代码改动被接受前，`3d402a9` 仍是最新运行代码基线。

目前不存在“生命周期补丁尚未提交”或“还要把热修搬回正式源码”的步骤。源码已经提交并准备同步两个仓库，也已打包、安装和通过运行验收。公开 GitHub 的 `v1.8.2` 标签与 Release DMG 仍是旧基线，不能描述成已经包含这些发布后修复。

### 已验证的冷启动与 SSH readiness 行为

- Local Ops 先用 `ssh -G` 解析别名对应的真实 `HostName/Port`，确认该端点可连接后才启动 SSH。
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

当前安装副本已完成私有 Git HTTP 与 `git ls-remote` 读取、两个认证型入口预期 `401`、以及一个上游返回 `503` 但原 PID 保持不变且重启数为 0 的监控服务验收。代表性隧道均保持单一 wrapper/listener，readiness 恢复时没有产生重复 SSH 进程。

### 尚未解决与后续事项

- 已验收的发布后源码仍显示 App 版本 `1.8.2`。下一次公开发布必须升级版本号、创建新标签和 DMG；不得静默替换既有公开 `v1.8.2` 制品。
- 当前替换内置后台会重启 Local Ops 控制面。私有制品安装验收时，Process Compose Worker 下的 SSH 进程也随之重启过一次。在升级流程能够保留 Worker 前，应避开正在进行的数据传输。
- 当前只提供 Apple Silicon 包，使用 ad-hoc 签名，尚未公证。
- 终态恢复期间每 30 秒会向配置的本地域名入口发送一次真实 HTTP 请求；频率已刻意降低，但并非零流量。

强制回归流程见[发布与热修回归手册](RELEASE_REGRESSION.md)。
