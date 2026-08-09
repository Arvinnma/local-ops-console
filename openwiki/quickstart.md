---
type: 快速开始
title: Local Ops 代码百科导航
description: 面向安全修改的 Local Ops 代码地图：从意图定位到控制面、配置、生命周期、SSH 隧道、桌面壳和验证。
tags: [navigation, architecture, testing]
---

# Local Ops 代码百科导航

这是 Local Ops 的代码快照百科。项目是 macOS 本机服务、SSH 隧道、反向代理、Docker 和终端任务的控制台；网页控制面、Process Compose worker、Caddy 与 Electron 壳的关系在[项目总览与控制面边界](overview.md)中建立。这里不替代人工叙事：使用说明见 [../docs/USER_GUIDE.md](../docs/USER_GUIDE.md)，开发与打包说明见 [../docs/DEVELOPMENT.md](../docs/DEVELOPMENT.md)，发布状态见 [../docs/PROJECT_STATUS.md](../docs/PROJECT_STATUS.md)。

## 代码地图

| 页面 | 正典问题 | 主要源码 |
| --- | --- | --- |
| [项目总览与控制面边界](overview.md) | 网页如何调用 API，哪些 Host/Origin/token/CSP 规则保护本机控制面 | `src/server.mjs`、`public/app.js`、`public/index.html`、`desktop/main.cjs` |
| [Catalog 配置模型与运行时渲染](configuration.md) | 资源如何验证、导入导出、生成 core/worker Compose 和 Caddy | `src/config.mjs`、`config/catalog.example.json` |
| [进程、服务与会话生命周期](lifecycle.md) | 如何审计动作、监督带健康 URL 的服务、停止进程树和恢复会话 | `src/process-lifecycle.mjs`、`src/managed-service.mjs`、`scripts/run-managed-service.mjs` |
| [SSH 隧道、网络门控与健康状态](tunnels.md) | SSH、Keychain 引用、网络 gate、健康分层和 retry 语义 | `src/tunnel-network.mjs`、`src/tunnel-health.mjs`、`scripts/run-managed-tunnel.mjs` |
| [Electron 桌面壳、本机安装与受限端口访问](desktop.md) | 窗口/托盘、LaunchAgent、本机 `opsctl` 和受限 PF 能力 | `desktop/`、`scripts/install.zsh`、`scripts/start-stack.zsh`、`scripts/opsctl.zsh` |

## 按修改意图定位

| 意图 | 先读 | 实现切入点 | 聚焦测试 | 最小验证 |
| --- | --- | --- | --- | --- |
| 新增/修改 HTTP API | [总览](overview.md) | `src/server.mjs` 的 request handler、`assertMutationRequest`、`publicCatalog` | `tests/smoke.mjs`、`tests/process-lifecycle.test.mjs` | `npm test` |
| 新增资源字段或调整 route/配置 | [配置](configuration.md) | `normalize*`、`validateCatalog`、`renderAll`、`enqueueMutation` | `tests/config.test.mjs` | `node --test tests/config.test.mjs` |
| 修改服务启动、健康或停止 | [生命周期](lifecycle.md) | `processAction`、`run-managed-service.mjs`、`managed-service.mjs`、`service-health.mjs` | `tests/managed-service.test.mjs`、`tests/service-health.test.mjs` | `node --test tests/managed-service.test.mjs tests/service-health.test.mjs` |
| 修改会话恢复或动作审计 | [生命周期](lifecycle.md) | `process-lifecycle.mjs`、`captureLastSessionState`、`applyAppStartupActions` | `tests/process-lifecycle.test.mjs` | `node --test tests/process-lifecycle.test.mjs` |
| 修改 SSH 或隧道健康/retry | [SSH 隧道](tunnels.md) | `renderSshCommand`、`run-managed-tunnel.mjs`、`tunnel-network.mjs`、`tunnel-health.mjs` | `tests/tunnel-network.test.mjs`、`tests/tunnel-health.test.mjs`、`tests/tunnel-ui.test.mjs` | 对应 `node --test`，再 `npm test` |
| 修改 Electron/托盘/启动呈现 | [桌面壳](desktop.md) | `desktop/main.cjs`、`desktop/preload.cjs`、`desktop/tray.js`、`desktop/startup-mode.cjs` | `tests/tray-action.test.mjs`、`tests/window-lifecycle.test.mjs`、`tests/startup-mode.test.mjs` | 对应 `node --test` |
| 修改无端口访问或代理端口验证 | [桌面壳](desktop.md) 与[配置](configuration.md) | `desktop/portless-config.cjs`、`setPortlessAccess`、`setProxyPort` | `tests/portless-config.test.mjs` | `node --test tests/portless-config.test.mjs` |

## 基线命令

`package.json` 要求 Node `>=22.12.0`。`npm run check` 对列出的 Node/Electron/前端文件做语法检查；`npm test` 运行 `tests/*.test.mjs`；`npm run test:smoke` 是需要本机运行控制栈的实例检查；`npm run test:all` 组合更广的检查。选择最窄的行为测试起步，只有改动跨越多个系统时才扩大范围。

## 不变量速查

- 控制 API 和反向代理目标保持 loopback；新增变更 API 必须复用 Host、token 和 Origin 边界。
- catalog 改动经验证、串行 mutation、重新渲染和运行时应用；失败要维持既有回滚语义。
- 生命周期的 desired state 不能被短暂 observed stop 覆盖；托盘停止必须具有确认和审计上下文。
- 隧道的 SSH liveness、转发应用 readiness、域名入口 readiness 是不同信号；后两者失败不应直接终止健康 SSH。
- Electron renderer 保持 sandbox/context isolation；preload 只增加明确的窄 IPC 面。

本次没有源码证据受阻而需要列入 Backlog 的模块。