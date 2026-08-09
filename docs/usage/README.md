# 使用说明

这是其他项目或新任务调用 Local Ops 功能时读取的唯一正文。默认把本项目视为只读外部依赖；维护源码时应改读根目录 `AGENTS.md`。

## 能力与适用范围

Local Ops 是 Apple Silicon macOS 上的本机控制面，可查看和管理已登记的服务、SSH 隧道、Docker 容器、反向代理和终端动作。普通调用优先使用已安装的 `localops` 命令，不从本源码目录直接启动第二套控制面。

## 前置条件

- 已安装并启动 Local Ops；命令行可找到 `localops`。
- 运行副本位于 `~/.local/share/local-ops`，配置和秘密不在本仓库中。
- 控制面只能从本机回环地址访问，禁止发布到局域网或公网。
- 只读查询无需修改本仓库；启动、停止、重启或配置资源属于有状态操作，必须与用户意图一致。

## 可复制命令

只读或低风险入口：

```bash
command -v localops
localops status
localops logs
localops logs <进程ID> 300
localops open
```

明确需要改变状态时才使用：

```bash
localops process start <进程ID>
localops process stop <进程ID>
localops process restart <进程ID>
```

不要把 `<进程ID>` 原样执行；先从状态或控制台确认真实目标。`localops stop` 和 `localops restart` 会影响整个控制面，不能作为普通诊断命令。

## 输入、输出和失败判断

- `status` 返回 Core 与 Worker 的当前状态。
- `logs [进程ID] [行数]` 返回控制面或指定进程的日志尾部。
- `open` 打开本机网页控制台。
- `process start|stop|restart` 的输入是已登记进程 ID，成功后仍要用 `status`、真实监听端口和相应 HTTP/SSH 健康结果复核。
- 非零退出、目标不存在、真实监听缺失或健康检查失败都不能报告为成功。

## 验证

```bash
command -v localops
localops status
```

这两条不会修改资源。完整字段、配置、备份与故障排查见[中文使用手册](../USER_GUIDE.zh-CN.md)；维护或发布见[开发指南](../DEVELOPMENT.md)和[回归手册](../RELEASE_REGRESSION.md)。
