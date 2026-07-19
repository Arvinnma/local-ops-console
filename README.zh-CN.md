# Local Ops

[English](README.md) · [下载最新版](https://github.com/Arvinnma/local-ops-console/releases/latest) · [完整使用手册](docs/USER_GUIDE.zh-CN.md) · [安全说明](SECURITY.md)

Local Ops 是一套仅在本机运行的 macOS 服务控制台，用一个 App 统一管理服务、SSH 隧道、Docker 容器、终端操作和 `*.localhost` 反向代理。安装包已经包含 Caddy 与 Process Compose，普通用户不需要单独安装 Node.js。

> Local Ops 可以执行当前 macOS 用户配置的命令。控制 API、SSH 监听和反向代理目标均限制在本机回环地址，请勿把控制台暴露到局域网或公网。

## 主要功能

- 启动、停止、重启、编辑、拖拽排序并查看 Node / 命令服务日志。
- 维护带保活和自动重连的 SSH 本地端口转发。
- 使用 `http://openclaw.localhost` 这类易记域名访问本机服务。
- 查看并控制 Docker 容器，Docker Engine 未运行时可自动打开 Docker Desktop。
- 保存 Terminal.app / iTerm2 命令、SSH 登录和 SSH 转发操作。
- 只监控已经由其他工具管理的现有服务，不重复接管进程。
- 点击“需要关注”查看停止、健康检查异常和离线资源的具体清单。
- 导出 / 导入可迁移配置，同时排除 Docker 状态、密钥和管理员授权。
- 支持简体中文和英文界面并即时切换。
- 提供包含 Caddy、Process Compose 的 Apple Silicon DMG 安装包。

## 架构

```text
Local Ops.app / 浏览器
          │
          ▼
本机控制 API（127.0.0.1:19090）
          │
          ├── Process Compose Core（控制台、Caddy、服务调度器）
          ├── Process Compose Worker（用户服务、SSH 隧道）
          └── Caddy（127.0.0.1:19080，可选回环 80 端口入口）
```

用户服务使用独立 Worker，因此添加、删除或修改资源时不会重启 Electron 窗口、网页控制台或 Caddy。

## 安装最新版

系统要求：Apple Silicon（`arm64`）Mac。

1. 从 [Releases](https://github.com/Arvinnma/local-ops-console/releases/latest) 下载 `Local-Ops-1.7.0-arm64.dmg`。
2. 打开 DMG，把 **Local Ops** 拖到“应用程序”。
3. 从“应用程序”启动 **Local Ops**。

第一次启动会把内置后台安装到 `~/.local/share/local-ops`。更新 App 时会保留原来的服务、SSH 隧道、域名、终端操作和本机随机密钥。

设置页可以启用“无端口访问”。首次启用时 macOS 会要求输入一次管理员密码，把本机回环 80 端口转发到 Caddy；之后可直接访问 `http://openclaw.localhost`，无需再写 `:19080`。该规则只作用于 `127.0.0.1` 和 `::1`，也可以随时关闭并清理。

当前安装包使用本地临时签名，尚未经过 Apple 公证。如果首次打开被 Gatekeeper 阻止，可按住 Control 点击 App 后选择“打开”。对外大规模分发时应配置 Developer ID 签名与公证。

## 快速使用

- **总览**：查看控制面、托管进程、快捷入口、现有服务以及“需要关注”详情。
- **服务**：配置工作目录、启动命令、重启策略、健康检查和可选本地域名。
- **SSH 隧道**：填写 SSH 跳板机、本地监听端口和转发目标。
- **反向代理**：把 `*.localhost` 域名映射到本机回环端口。
- **Docker**：打开 Docker Desktop，集中启动、停止或重启容器。
- **终端**：保存 Terminal.app / iTerm2 命令、SSH 登录或 SSH 本地转发。
- **设置**：管理启动自动化、无端口访问、语言以及配置迁移。

每个字段的填写示例、开机行为、配置导入导出范围和排错方法见[完整使用手册](docs/USER_GUIDE.zh-CN.md)。

## 常用命令

安装器可写入 Homebrew bin 目录时，会创建 `localops` 命令：

```bash
localops status
localops open
localops start
localops stop
localops restart
localops logs <进程ID> 300
localops process start <进程ID>
localops process stop <进程ID>
localops process restart <进程ID>
localops tui
localops tui-core
```

项目自带的终端脚本会加载用户 shell 环境，并在可用时先执行 `proxy_on`。

## 从源码构建

构建环境需要 Apple Silicon Mac、Node.js 22.12+、npm、Caddy 与 Process Compose：

```bash
brew install node caddy
brew install f1bonacc1/tap/process-compose
npm install
npm test
npm run check
cd desktop
npm install
npm run dmg
```

安装包输出到 `desktop/dist/Local-Ops-1.7.0-arm64.dmg`。`desktop/scripts/prepare-bundle.zsh` 会把当前 Caddy 与 Process Compose 二进制复制进 App，所以最终用户不需要再安装它们。

开发模式、本地安装、目录结构和发布流程见[开发文档](docs/DEVELOPMENT.md)。

## 本机数据与安全

以下内容不会进入 Git：

- `config/catalog.json`：当前机器的真实服务、隧道、域名、终端操作和设置。
- `config/process-compose.token`：本机随机生成的控制 API 密钥。
- `runtime/`、`generated/`：日志和运行时生成配置。
- Electron 依赖、App、DMG 以及生成图标。

仓库只保存 `config/catalog.example.json` 和安全模板。SSH 私钥只保存路径，不会被复制进安装包或导出配置。修改监听地址或 Electron 安全设置前，请先阅读 [SECURITY.md](SECURITY.md)。

## 参与开发

欢迎提交 Issue 和 Pull Request。请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)，并在提交前运行 `npm test` 与 `npm run check`。所有控制接口必须继续只监听回环地址。

## 许可证

项目使用 [MIT License](LICENSE)。第三方图标和组件说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
