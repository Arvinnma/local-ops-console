---
type: 桌面运行时
title: Electron 桌面壳与受限端口访问
description: Electron 窗口和托盘可信动作、受隔离的窄 IPC 面，以及可选 PF loopback 端口重定向边界。
tags: [electron, macos, tray, portless]
---

# Electron 桌面壳与受限端口访问

`desktop/main.cjs` 是 Electron 主进程入口。它不是业务控制 API 的第二套实现：启动时创建窗口/托盘并连接固定控制面 URL，网页业务请求仍由 `src/server.mjs` 处理，见[项目总览](overview.md)。本页聚焦桌面主进程的安全、托盘意图审计和可选本机端口访问。

## 窗口、连接与最小桥接

`app.whenReady()` 依次判定启动呈现、设置 renderer 安全、IPC、菜单、托盘、主窗口，调用 `connectControlPlane()` 并启动健康监控。`createMainWindow()` 先加载 splash，控制面可达后加载网页；主窗口 close 时通常 hide 而非退出，`before-quit` 最多等待 5 秒捕获会话。

| 面 | 符号 | 边界 |
| --- | --- | --- |
| renderer 安全 | `createMainWindow`、`configureSecurity` | 无 Node integration，隔离上下文和 sandbox；所有权限请求拒绝；禁止 webview。外部窗口/导航只有安全 URL 可交给系统 shell。 |
| 控制面连接 | `connectControlPlane`、`ensureControlPlane` | 先 health check；不可达时显示离线页并安排重连。控制面安装与运维步骤不在本页展开。 |
| preload | `desktop/preload.cjs` | `window.localOpsDesktop` 仅暴露 portless、登录项、导入导出文件与 tray panel 固定方法；没有任意命令执行接口。 |
| 启动呈现 | `desktop/startup-mode.cjs` | 仅 packaged macOS 的登录项或 `--local-ops-silent-start` 可静默；静默呈现会在 `createMainWindow()` 的 `ready-to-show` 时保持窗口隐藏，直到 `showMainWindow()` 调用 `startupPresentation.reveal()`；其他场景显示正常窗口。 |

## 托盘：可信点击到控制面审计

托盘由 `createTray()`、`createTrayPanelWindow()`、`buildTrayMenu()` 和 `buildTrayPanelState()` 构成。`configureIpc()` 的每个 tray/桌面 handler 都先执行 `assertTrustedRenderer()`，后者只接受 `isAllowedAppUrl()` 或 `isAllowedBundledFile()` 认可的 sender URL。panel renderer `desktop/tray.js` 只响应 `event.isTrusted` 的资源行点击，并上送事件名、手势类型和时间。`runTrayMutation()` 每次先取 `/api/bootstrap` token，再向同一控制 API 发送 `X-Local-Ops-Requested-By: tray`、event name、action ID、call path 与明确意图 header。

停止资源比其他托盘操作多一道约束：`confirmTrayProcessStop()` 先显示原生确认；控制面仍在 `src/server.mjs` 拒绝缺少 `userIntentConfirmed` 的 tunnel stop。生命周期模块对未确认 stop 的会话保存规则见[生命周期页](lifecycle.md)。这两层限制避免 renderer 构造一次非用户手势的 stop 即改变 remembered tunnel 状态。

## 本机安装与运维资料

安装、打包与运维步骤属于人工叙事层；需要这些资料时阅读 [../docs/DEVELOPMENT.md](../docs/DEVELOPMENT.md)，不要在此代码快照页复制或推导操作流程。与桌面变更直接相关的实现边界仍在本页其余章节：桌面壳只能连接 loopback 控制面，且不会把 renderer 变成通用系统权限通道。

## 可选无端口访问：特权范围与冲突规则

`setPortlessAccess()`、`setProxyPort()` 和 `runElevatedShell()` 是 Electron 主进程中的受限特权面。启用时，主进程在管理员授权下渲染并应用本地 PF anchor，随后将 `publicProxyPort` 更新为 80；禁用时清除该 PF anchor 并将 public port 恢复为 Caddy proxy port。`getPortlessStatus()` 只有在 anchor 与当前 proxy port 同步且健康检查通过时才报告 active；授权取消或规则安装后 80 不连通都作为失败处理。规则仅将 loopback IPv4/IPv6 的端口 80 重定向到配置的 Caddy proxy port；控制面、Caddy admin 和 worker API 仍是独立 loopback 端口。

`normalizeProxyPort()` 只接受 1024–65535 的整数；`conflictingRuntimePort()` 拒绝与 `consolePort`、`processComposePort`、`workerComposePort`、`caddyAdminPort` 重合；`renderPortlessAnchor()` 要求模板存在 `{{PROXY_PORT}}`。因此改端口时必须先验证这些约束，再更新运行时设置；不可用或不健康的特权资源不能被当作网页控制面已经对外开放。

## 测试与验证

- `tests/window-lifecycle.test.mjs`：隐藏/最小化窗口的恢复顺序与 destroyed window 无操作。
- `tests/startup-mode.test.mjs`：仅 packaged macOS 登录场景静默，登录项固定使用 `openAsHidden`。
- `tests/tray-action.test.mjs`：非可信 click 不执行；可信事件携带审计信息；停止路径要求确认；panel 动作可重复。
- `tests/portless-config.test.mjs`：IPv4/IPv6 PF anchor、端口范围、模板占位符与运行时端口冲突。
- `tests/browser-qa.mjs`：在桌面承载的网页控制台满足 CSP 与交互基本质量。

改窗口/托盘时运行 `node --test tests/window-lifecycle.test.mjs tests/startup-mode.test.mjs tests/tray-action.test.mjs`；改 portless 规则时额外运行 `node --test tests/portless-config.test.mjs`，最后运行 `npm run check`。