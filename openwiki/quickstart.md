---
type: 快速开始
title: Local Ops 代码百科导航
description: 面向安全修改的 Local Ops 代码地图：从变更意图定位到控制面、配置、生命周期、SSH 隧道、桌面壳和聚焦验证。
tags: [navigation, architecture, testing]
openwiki:
  roles: [repository, workflow, testing]
  source_paths: [package.json, src/server.mjs, src/config.mjs, src/process-lifecycle.mjs, src/tunnel-health.mjs, desktop/main.cjs]
  test_paths: [tests/config.test.mjs, tests/process-lifecycle.test.mjs, tests/tunnel-health.test.mjs]
  validation_commands: [npm run check, npm test]
---

# Local Ops 代码百科导航

这是 Local Ops 的代码快照百科。项目以浏览器控制面和 Electron 宿主协调本机服务、SSH 隧道、反向代理、Docker 与终端任务；组件关系和 HTTP 边界见[项目总览与控制面边界](overview.md)。本百科只记录代码与测试可证明的内容；使用、开发和项目状态等人工叙事分别见 [../docs/USER_GUIDE.md](../docs/USER_GUIDE.md)、[../docs/DEVELOPMENT.md](../docs/DEVELOPMENT.md) 与 [../docs/PROJECT_STATUS.md](../docs/PROJECT_STATUS.md)。

## 阅读地图

| 页面 | 正典问题 | 主要源码 |
| --- | --- | --- |
| [项目总览与控制面边界](overview.md) | 网页如何调用 API，以及 Host、Origin、token、CSP、Electron 隔离和受限端口访问如何保护控制面 | `src/server.mjs`、`public/app.js`、`public/index.html`、`desktop/main.cjs`、`desktop/preload.cjs`、`desktop/portless-config.cjs` |
| [Catalog 配置模型与运行时渲染](configuration.md) | 资源如何验证、导入导出，并生成 core/worker Process Compose 与 Caddy 配置 | `src/config.mjs`、`config/catalog.example.json` |
| [进程、服务与会话生命周期](lifecycle.md) | 如何审计动作、监督带健康 URL 的服务、停止进程树和恢复会话 | `src/process-lifecycle.mjs`、`src/managed-service.mjs`、`scripts/run-managed-service.mjs` |
| [SSH 隧道、网络门控与健康状态](tunnels.md) | SSH、Keychain 引用、网络 gate、分层健康与 retry 语义 | `src/tunnel-network.mjs`、`src/tunnel-health.mjs`、`scripts/run-managed-tunnel.mjs` |
| [Electron 桌面壳与受限端口访问](desktop.md) | 窗口/托盘可信动作、窄 IPC 面与可选 loopback 端口重定向 | `desktop/main.cjs`、`desktop/preload.cjs`、`desktop/tray.js`、`desktop/portless-config.cjs` |

## 按修改意图定位

| 变更区域或意图 | 相关页面 | 精确源码入口 | 重要符号或类型 | 聚焦测试 | 最小验证命令 |
| --- | --- | --- | --- | --- | --- |
| 新增或修改 HTTP API | [总览](overview.md) | `src/server.mjs`、`public/app.js` | `assertMutationRequest`、`isAllowedHost`、`publicCatalog`、`request` | `tests/smoke.mjs`、`tests/process-lifecycle.test.mjs` | `npm test` |
| 新增资源字段、route 或配置 | [配置](configuration.md) | `src/config.mjs` | `normalizeService`、`normalizeTunnel`、`validateCatalog`、`renderAll`、`enqueueMutation` | `tests/config.test.mjs` | `node --test tests/config.test.mjs` |
| 修改服务启动、健康或停止 | [生命周期](lifecycle.md) | `src/managed-service.mjs`、`src/service-health.mjs`、`scripts/run-managed-service.mjs` | `reconcileManagedServiceProcess`、`stopManagedServiceRuntime`、`enrichServiceProcess` | `tests/managed-service.test.mjs`、`tests/service-health.test.mjs` | `node --test tests/managed-service.test.mjs tests/service-health.test.mjs` |
| 修改会话恢复或动作审计 | [生命周期](lifecycle.md) | `src/process-lifecycle.mjs`、`src/server.mjs` | `recordProcessActionRequest`、`reconcileRememberedProcessIds`、`captureLastSessionState` | `tests/process-lifecycle.test.mjs` | `node --test tests/process-lifecycle.test.mjs` |
| 修改 SSH、网络检查或隧道健康 | [SSH 隧道](tunnels.md) | `src/tunnel-network.mjs`、`src/tunnel-health.mjs`、`scripts/run-managed-tunnel.mjs` | `resolveSshEndpoint`、`enrichTunnelProcess`、`probeTunnelReadiness` | `tests/tunnel-network.test.mjs`、`tests/tunnel-health.test.mjs`、`tests/tunnel-ui.test.mjs` | `node --test tests/tunnel-network.test.mjs tests/tunnel-health.test.mjs tests/tunnel-ui.test.mjs` |
| 修改窗口、托盘或受限端口访问 | [总览](overview.md) | `desktop/main.cjs`、`desktop/preload.cjs`、`desktop/tray.js`、`desktop/portless-config.cjs` | `configureIpc`、`assertTrustedRenderer`、`setPortlessAccess`、`normalizeProxyPort` | `tests/tray-action.test.mjs`、`tests/window-lifecycle.test.mjs`、`tests/portless-config.test.mjs` | `node --test tests/window-lifecycle.test.mjs tests/tray-action.test.mjs tests/portless-config.test.mjs` |

## 验证层级

`package.json` 要求 Node `>=22.12.0`。先用表中的 `node --test` 命令验证受影响行为；`npm run check` 覆盖列出的 Node、前端和 Electron 文件语法，`npm test` 运行 `tests/*.test.mjs`。`npm run test:smoke` 需要运行中的本机控制栈且会创建与清理临时资源，仅当变更跨越真实 API、编排或反代边界时才运行；`npm run test:all` 还包含 Keychain 与 smoke 检查，不是普通代码变更的默认验证。

## 不变量速查

- 控制 API、反向代理目标与 SSH 监听保持 loopback；新增变更 API 必须复用 Host、token 和 Origin 边界。
- catalog 变更必须经过验证、串行 mutation、重新渲染和运行时应用；失败维持既有回滚语义。
- 生命周期的 desired state 不能被短暂 observed stop 覆盖；托盘停止必须具有确认和审计上下文。
- 隧道的 SSH liveness、转发应用 readiness 与域名入口 readiness 是不同信号；后两者失败不应直接终止健康 SSH。
- Electron renderer 保持 sandbox/context isolation；preload 只能增加明确且窄的 IPC 面。

## Backlog

当前源码与测试覆盖的主要系统均已有正典页面；没有可由现有证据准确展开的待办项。
