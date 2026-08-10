# 运行手册

## 日常只读诊断

```bash
proxy_on >/dev/null 2>&1
localops status
localops logs
curl --fail --silent --show-error http://127.0.0.1:19090/api/health
```

不要因界面显示“已连接”就断言链路正常；还要核对真实进程、回环监听、SSH/TCP 状态及相应 HTTP readiness。

## 源码验证

```bash
cd /Users/arvin/Documents/AI/codex/local-ops-console
proxy_on >/dev/null 2>&1
npm run check
npm test
git diff --check
```

原生钥匙串相关改动再按[测试入口](../testing/README.md)构建临时 Helper 并运行集成测试。

## 构建与发布入口

- 依赖、Electron、钥匙串和 DMG 构建：[开发与发布指南](../DEVELOPMENT.md)
- 冷启动、SSH/readiness、安装和 Release 强制门禁：[发布与热修回归手册](../RELEASE_REGRESSION.md)
- 安装、公开 Release、私有远端和源码基线：[PROJECT_STATUS](../PROJECT_STATUS.md) 与[当前状态](../current-state.md)
- 安全边界：[SECURITY.md](../../SECURITY.md)

只生成 DMG 时使用 `npm run build:dmg`。`scripts/build-app.zsh` 会替换已安装 App；`scripts/install.zsh` 会写入后台和 LaunchAgent。两者都必须获得单独授权，并在执行前记录运行 PID、监听和恢复点。

## 回滚原则

- 源码修改：保留用户改动，不使用 `git reset --hard`；从已记录提交和差异中做最小回滚。
- Release：标签和已发布制品不原位替换，发布修复版本。
- 安装版：先备份 catalog、会话和运行证据；具体恢复按回归手册执行。
- 源码迁移：恢复点见[迁移交接](../handoffs/2026-08-09-source-migration.md)。
