# 维护

## 三个独立对象

1. `/Users/arvin/Documents/AI/codex/local-ops-console`：源码、测试和打包输入。
2. `/Applications/Local Ops.app`：用户启动的桌面 App。
3. `/Users/arvin/.local/share/local-ops` 与 `/Users/arvin/Library/Logs/Local Ops`：后台、配置、运行状态和日志。

修改或拉取源码不会自动更新安装 App 与后台。覆盖 App 或后台可能重启控制面、Caddy、Worker 及 SSH 进程，必须避开活动传输并按[回归手册](../RELEASE_REGRESSION.md)记录前后 PID、监听、健康状态和回滚点。

## 依赖与制品

- 根与 `desktop/` 依赖只从各自 lockfile 通过 `npm ci` 生成，不迁移 `node_modules`。
- `desktop/dist`、`.tmp-tests`、构建缓存、DMG 和挂载内容都是可再生成制品，不进入源码迁移或普通提交。
- `bin/local-ops-keychain` 是原生 Helper；相关改动需重新构建并运行 Keychain 集成测试。

## 配置与秘密

真实 catalog、last-session、Process Compose Token、私钥、口令和钥匙串内容只留在本机运行范围，不复制进源码、文档、Release 或可迁移导出。可导出范围、卸载和恢复见[用户手册](../USER_GUIDE.zh-CN.md)。

## Git 维护

GitHub 与 Forgejo 可能处于不同文档提交。每次 pull、push 或发布前分别运行 `git ls-remote`，只推进用户指定的远端，并在 [current-state.md](../current-state.md) 记录真实基线。
