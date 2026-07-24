# Authoritative Project Status

[简体中文](#简体中文)

This file is the project-owned source of truth for the currently installed build, public distribution baseline, private verified baseline, and release-readiness behavior. Update it after every release or verified post-release hotfix. Roadmap ideas and external knowledge bases are not authoritative for shipped state.

Status date: **2026-07-24**

## English

### Version and repository baselines

| Scope | Version / commit | Meaning |
| --- | --- | --- |
| Installed application | `1.8.2` | `/Applications/Local Ops.app`; bundled backend built at `2026-07-23T09:54:04.500Z` |
| Public GitHub `main` | `81a7d9b402733a97f10140c47108177508618f5a` | Same commit as public tag `v1.8.2` |
| Public `v1.8.2` DMG | SHA-256 `89d525ea0a132679373c9ce41fa9bf7fca941788f01b30154a28b8a4dbcd5e30` | Published GitHub Release artifact |
| Private Forgejo runtime baseline | `5d6d7ea67f2e1b650c5f6287da6ad8ee7b624e4a` | Verified post-release tunnel-readiness fix; not present on public GitHub |
| Verified private DMG | SHA-256 `d5794ac42c13464ae413ef0994ce35ef6e2909af3d882b57ca7d4fa464b6314e` | Internal `Local-Ops-1.8.2-5d6d7ea-arm64.dmg`; installed and verified locally |

Documentation-only commits may advance private Forgejo `main`; `5d6d7ea` remains the latest runtime-affecting private baseline until another code change is accepted.

There is no uncommitted tunnel patch and no pending “move the patch into source” step. The fix is committed, privately pushed, packaged, installed, and runtime-verified. It has not been published to GitHub and must not be described as part of the public `v1.8.2` artifact.

### Verified cold-start and SSH-readiness behavior

- Effective SSH aliases are resolved with `ssh -G`, then the real `HostName/Port` is probed before starting SSH.
- An unavailable boot-time network remains **Connecting / Waiting for Network**. It does not report a false connection and does not use a fixed long sleep.
- SSH uses `ConnectTimeout=5` and `ConnectionAttempts=1`; Process Compose retries at an approximately three-second cadence.
- User-triggered starts have a three-retry budget. Previous-session restoration has a 40-retry budget.
- A configured tunnel HTTP health URL has a ten-second timeout and treats HTTP `100` through `499` as proof that the forwarded application responded.
- A matching complete `.localhost` domain entry accepts `2xx`, `3xx`, `401`, and `403`. `401/403` prove that routing reached an authentication-protected application; they do **not** prove that user authentication succeeded.
- `404`, `5xx`, connection failures, and timeouts keep the domain entry unready.
- Exhausting the domain-entry retry budget no longer locks the card permanently. Terminal failures receive one low-frequency recovery probe every 30 seconds and automatically return to **Connected** when the entry recovers.
- Domain-entry recovery probes are throttled and do not restart an otherwise healthy SSH process.

The installed build was verified with one private Git route returning `200` and two authentication-protected backup routes returning `401`; all three were reported as `connected`, `healthy`, and domain-ready. Private Git HTTP and `git ls-remote` reads both succeeded.

### Current limitations and follow-up

- The private hotfix still reports application version `1.8.2`. The next public distribution must bump the version, publish a new tag/DMG, and move GitHub to a commit that contains the fix instead of silently replacing the existing `v1.8.2` artifact.
- Replacing the bundled backend currently restarts the Local Ops control plane. During the verified private installation this also restarted Process Compose worker SSH processes once. Schedule upgrades after active transfers complete until backend upgrades can preserve worker processes.
- Distribution remains Apple Silicon only, ad-hoc signed, and not notarized.
- A terminal domain-entry probe runs every 30 seconds until recovery. This is intentionally low frequency, but it still sends a real HTTP request to the configured local entry.

Use [Release and Hotfix Regression Manual](RELEASE_REGRESSION.md) for the mandatory verification sequence.

## 简体中文

### 版本与仓库双基线

| 范围 | 版本 / 提交 | 含义 |
| --- | --- | --- |
| 当前安装 App | `1.8.2` | `/Applications/Local Ops.app`；内置后台构建时间为 `2026-07-23T09:54:04.500Z` |
| 公开 GitHub `main` | `81a7d9b402733a97f10140c47108177508618f5a` | 与公开标签 `v1.8.2` 指向同一提交 |
| 公开 `v1.8.2` DMG | SHA-256 `89d525ea0a132679373c9ce41fa9bf7fca941788f01b30154a28b8a4dbcd5e30` | GitHub Release 已发布制品 |
| 私有 Forgejo 运行代码基线 | `5d6d7ea67f2e1b650c5f6287da6ad8ee7b624e4a` | 已验证的发布后隧道 readiness 修复；公开 GitHub 尚未包含 |
| 已验证私有 DMG | SHA-256 `d5794ac42c13464ae413ef0994ce35ef6e2909af3d882b57ca7d4fa464b6314e` | 内部制品 `Local-Ops-1.8.2-5d6d7ea-arm64.dmg`，已在本机安装验收 |

后续纯文档提交可能继续推进私有 Forgejo `main`；在下一次代码改动被接受前，`5d6d7ea` 仍是最新的私有运行代码基线。

目前不存在“补丁尚未提交”或“还要把热修搬回正式源码”的步骤。修复已经提交、推送到私有 Forgejo、打包、安装并通过运行验收，但尚未发布到 GitHub，也不能把它描述成公开 `v1.8.2` 安装包已经包含的能力。

### 已验证的冷启动与 SSH readiness 行为

- Local Ops 先用 `ssh -G` 解析别名对应的真实 `HostName/Port`，确认该端点可连接后才启动 SSH。
- 开机网络尚未就绪时保持“连接中 / 等待网络”，不误报已连接，也不使用固定长时间 `sleep`。
- SSH 使用 `ConnectTimeout=5`、`ConnectionAttempts=1`，Process Compose 约每 3 秒发起下一轮。
- 人工触发最多重试 3 次；恢复上次会话最多重试 40 次。
- 隧道 HTTP 健康地址的超时为 10 秒；收到 HTTP `100–499` 说明转发后的应用已经响应。
- 匹配到的完整 `.localhost` 域名入口接受 `2xx`、`3xx`、`401` 和 `403`。`401/403` 只证明请求到达了受认证保护的应用，不代表用户认证已经成功。
- `404`、`5xx`、连接失败和超时仍表示域名入口未就绪。
- 域名入口耗尽重试额度后不会永久锁死。终态每 30 秒进行一次低频恢复探测，入口恢复后自动回到“已连接”。
- 域名入口恢复探测有节流，不会重启本身仍然健康的 SSH 进程。

当前安装副本已使用一条返回 `200` 的私有 Git 入口和两条返回 `401` 的认证型备份入口完成验收；三条均显示 `connected`、`healthy` 和域名入口已就绪，私有 Git 的 HTTP 与 `git ls-remote` 读取都成功。

### 尚未解决与后续事项

- 私有热修制品的 App 版本仍显示 `1.8.2`。下一次公开发布必须升级版本号、创建新标签和 DMG，并把 GitHub 更新到包含该修复的提交；不得静默替换既有公开 `v1.8.2` 制品。
- 当前替换内置后台会重启 Local Ops 控制面。私有制品安装验收时，Process Compose Worker 下的 SSH 进程也随之重启过一次。在升级流程能够保留 Worker 前，应避开正在进行的数据传输。
- 当前只提供 Apple Silicon 包，使用 ad-hoc 签名，尚未公证。
- 终态恢复期间每 30 秒会向配置的本地域名入口发送一次真实 HTTP 请求；频率已刻意降低，但并非零流量。

强制回归流程见[发布与热修回归手册](RELEASE_REGRESSION.md)。
