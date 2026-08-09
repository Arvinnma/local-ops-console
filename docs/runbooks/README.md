# 运行手册

## 日常只读诊断

```bash
localops status
localops logs
```

不要因界面显示“已连接”就断言链路正常；同时核对真实进程、回环监听和相应 HTTP/SSH 结果。

## 源码验证

```bash
npm run check
npm test
git diff --check
```

## 深度维护入口

- 构建、安装、原生钥匙串和浏览器检查：[[../DEVELOPMENT]]
- 发布、热修、冷启动、SSH/readiness 和恢复：[[../RELEASE_REGRESSION]]
- 已安装、公开与私有三类基线：[[../PROJECT_STATUS]]
- 安全边界：[[../../SECURITY]]

任何覆盖 `~/.local/share/local-ops` 或 `/Applications/Local Ops.app` 的操作都可能重启控制面。操作前必须记录运行资源和恢复点，完成后按回归手册验证；仅迁移源码目录时不得触碰安装副本。
