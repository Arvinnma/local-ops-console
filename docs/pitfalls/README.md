# 踩坑记录

## SSH 与应用 readiness

- HTTP `401/403` 只证明受保护入口已应答，不能证明用户认证成功；它们在本项目的完整域名入口检查中属于可达结果。
- 回环 TCP listener 只能证明隧道存活，不能证明远端应用可用。
- 带 `ProxyJump` / `ProxyCommand` 的 SSH 别名应由 OpenSSH 管理完整链路，不能直接探测最终回环 HostName/Port 后伪造成功或失败。
- HTTP 超时或 `5xx` 只能降级应用 readiness，不能杀死仍健康的 SSH 进程。详细矩阵见 [RELEASE_REGRESSION.md](../RELEASE_REGRESSION.md)。

## 刷新与托盘动作

- 强制刷新不能直接复用正在运行的普通刷新；普通轮结束后必须再执行一次 fresh 轮，否则用户看到的“刷新成功”仍可能是缓存状态。
- 刷新失败不等于控制面或 SSH 已离线。主界面和菜单栏应保留最后一次成功快照、标记 stale，并禁用基于旧状态的写操作。
- `active` 只说明进程仍存在，不能单独决定托盘执行 stop。SSH 健康但域名入口终态失败时，正确动作是重检入口，不能停止或重启 SSH。

## 源码、安装与发布

- `scripts/build-app.zsh` 名称看似“构建”，实际会退出并覆盖 `/Applications/Local Ops.app`；普通打包应使用 `npm run build:dmg`。
- GitHub `main`、Forgejo `main`、Release 标签和安装 App 可能不同。只看 `package.json` 或一个远端会得出错误结论。
- 目标目录可能已经包含历史任务、依赖和 DMG。直接递归复制会把数 GB 可再生成内容带入新项目；先做冲突清单，再只迁移跟踪文件。
- m-wiki 入口可解析只代表浏览注册正确，不证明源码、安装版或运行态健康；这些基线必须分别核验。

## 生产边界

覆盖后台会重启控制面，并可能重启 Worker SSH 进程。源码迁移、文档维护和只读检查不得借机运行安装脚本；发布或安装前按 [PROJECT_STATUS.md](../PROJECT_STATUS.md) 与回归手册留出传输窗口。
