# 使用说明

这是其他项目或新任务调用 Local Ops 功能时读取的唯一正文。默认把本项目视为只读外部依赖；维护源码时改读根目录 [AGENTS.md](../../AGENTS.md)。

## 能力 1：查询和控制已安装的 Local Ops

### 适用范围

查看已登记服务与 SSH 隧道状态、读取日志、打开控制台，或在用户明确要求时启动、停止、重启单个资源。不要从源码目录再启动第二套控制面。

### 前置条件

- Apple Silicon macOS 上已经安装并启动 Local Ops。
- `command -v localops` 能找到安装器创建的命令。
- 控制面只允许从本机回环访问；不得转发到局域网或公网。

### 只读调用与输出

```bash
proxy_on >/dev/null 2>&1
command -v localops
localops status
localops logs
localops logs <process-id> 300
curl --fail --silent --show-error http://127.0.0.1:19090/api/health
```

- `status` 输出 Core 与 Worker 的 Process Compose 状态。
- `logs [process-id] [tail]` 输出控制面或指定进程日志尾部。
- 健康接口成功返回 `{"ok":true,"service":"local-ops-console"}`；连接拒绝、超时或非 2xx 表示控制面未就绪。
- 不要打印 `/api/bootstrap` 的完整响应，它包含仅供本机写请求使用的临时 CSRF Token。

### 有状态调用

只有目标和用户意图都明确时才执行：

```bash
localops process start <process-id>
localops process stop <process-id>
localops process restart <process-id>
```

输入必须是已登记的真实进程 ID。命令成功只代表控制 API 接受操作；仍需用 `localops status`、真实回环监听和相应 HTTP/SSH 检查验证。目标不存在、控制面未就绪、HTTP 非 2xx 或最终健康检查失败都不能报告为成功。

`localops stop` 与 `localops restart` 会影响整个控制面，不属于普通诊断命令；除非用户明确授权，不得调用。`localops open` 会打开浏览器，也不是纯只读终端检查。

## 能力 2：从源码构建和验证

### 前置条件

- 源码根目录：`/Users/arvin/Documents/AI/codex/local-ops-console`
- Node.js 22.12+、npm、Xcode Command Line Tools。
- 打包时还需要 arm64 Caddy 与 Process Compose；准确要求见[开发指南](../DEVELOPMENT.md)。

### 可复制命令

```bash
cd /Users/arvin/Documents/AI/codex/local-ops-console
proxy_on >/dev/null 2>&1
npm ci
npm run check
npm test
npm run build:keychain
npm run test:keychain
git diff --check
```

这些命令验证语法、单元行为和本机钥匙串集成。`test:smoke`、`test:browser`、Docker 变更测试和安装验收有额外运行副作用，必须先读[回归手册](../RELEASE_REGRESSION.md)，使用可丢弃测试资源，不能直接拿不可替代的运行配置做测试。

### 只构建、不安装

```bash
cd /Users/arvin/Documents/AI/codex/local-ops-console
proxy_on >/dev/null 2>&1
npm ci
npm --prefix desktop ci
npm run build:dmg
```

输出位于 `desktop/dist/Local-Ops-<version>-arm64.dmg`。这不会主动安装 App；`scripts/build-app.zsh` 会退出、覆盖并重新打开 `/Applications/Local Ops.app`，没有明确安装授权时不得运行。

## 能力 3：读取或发布 Git 仓库

### 远端与身份

| 名称 | 地址 / 规则 |
| --- | --- |
| GitHub 公开仓库 | `https://github.com/Arvinnma/local-ops-console.git` |
| Forgejo 私有仓库 | `forgejo-office:arvin/local-ops-console.git` |
| 私有 SSH Host | `forgejo-office`，由 `~/.ssh/config` 解析 |
| 专用身份 | `/Users/arvin/.ssh/forgejo_office_ed25519`（只记录路径，不读取或保存私钥正文） |
| 网络入口 | 当前 SSH 配置负责解析完整连接路径；新电脑必须恢复相同 Host 配置和身份文件 |

只读验证：

```bash
proxy_on >/dev/null 2>&1
git ls-remote https://github.com/Arvinnma/local-ops-console.git refs/heads/main
git ls-remote forgejo-office:arvin/local-ops-console.git refs/heads/main
ssh -G forgejo-office | awk '$1=="hostname" || $1=="port" || $1=="identityfile" || $1=="proxycommand" || $1=="proxyjump"'
```

克隆到用户已经确认的目标路径：

```bash
git clone https://github.com/Arvinnma/local-ops-console.git <confirmed-path>
git clone forgejo-office:arvin/local-ops-console.git <confirmed-path>
```

已有仓库添加远端：

```bash
git remote add origin https://github.com/Arvinnma/local-ops-console.git
git remote add forgejo forgejo-office:arvin/local-ops-console.git
```

发布前必须先读[当前状态](../current-state.md)、[PROJECT_STATUS](../PROJECT_STATUS.md) 与 [RELEASE_REGRESSION](../RELEASE_REGRESSION.md)，记录目标分支、标签、DMG SHA-256 和远端引用。默认分支是 `main`，Release 标签不可在原位替换。只有用户明确指定的远端可以 push；不能因为仓库有两个远端就自动同时推送。

新电脑若 `git ls-remote forgejo ...` 失败，先检查 `ssh -G forgejo-office` 是否能解析 Host、ProxyCommand/ProxyJump 和 IdentityFile，以及身份文件是否存在；文档、日志和工单中不得粘贴密码、Token、私钥正文、恢复密钥或完整 CSRF 响应。

## 验证

以下是不会修改已安装资源的无害验收：

```bash
command -v localops
localops status
curl --fail --silent --show-error http://127.0.0.1:19090/api/health
git status --short --branch
```

前三项只读检查安装副本，最后一项只读检查源码现场。任何非零退出都要保留为“未验证”或失败，不得仅凭界面外观宣称可用。
