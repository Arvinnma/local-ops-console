# 测试

记录测试分层、测试数据边界、运行命令、覆盖范围和已知缺口。

## 基础静态检查

```bash
proxy_on >/dev/null 2>&1
npm run check
git diff --check
```

`npm run check` 对前端、服务端、脚本、生命周期、隧道和 Electron 入口执行 JavaScript/CommonJS 语法检查。

## 单元与回归测试

```bash
npm test
```

覆盖控制面、隧道状态机、生命周期、会话记忆、托盘映射、配置校验和历史回归。测试使用临时目录，不得读取或覆盖用户真实 catalog。

## Keychain 集成测试

干净 checkout 不包含可再生成的 `bin/local-ops-keychain`。为避免把验证制品写回工作树，先把 Helper 构建到临时路径，再显式传给测试：

```bash
zsh scripts/build-keychain-helper.zsh /tmp/local-ops-keychain-test
LOCAL_OPS_KEYCHAIN_HELPER=/tmp/local-ops-keychain-test npm run test:keychain
```

测试只使用专用临时 service/account，结束后必须清理，不得查询或输出用户已有钥匙串秘密。`npm run build:keychain` 会在仓库内生成 `bin/local-ops-keychain`，只在确实需要准备打包输入时使用。

## 会触碰运行态的扩展验证

- `npm run test:smoke` 会通过本机控制 API 创建、启动、停止和删除临时资源。
- `npm run test:browser` 会连接运行中的控制台并启动浏览器。
- `npm run build:app` 会退出并覆盖 `/Applications/Local Ops.app`。
- `npm run install:local` 会写入安装目录和后台运行环境。

这些命令不是只读测试。只有任务明确授权运行态变更、安装或浏览器操作时才执行，并应先记录 PID、监听、catalog 与回滚点。

## 发布门禁

完整发布回归、冷启动、SSH readiness、Keychain、DMG 和实机安装要求见 [RELEASE_REGRESSION.md](../RELEASE_REGRESSION.md)。迁移或纯文档任务不以“完整测试”为由越权执行安装或重启。

## 2026-08-10 迁移收尾复验

- `project-foundation check`、`doctor`：通过，m-wiki 注册和项目入口可解析。
- 2026-08-10 曾记录代码百科输入为 `stale`；该能力现已退役，不再是测试或发布门禁。
- `project-foundation review-docs`：提交前因受审文档差异按设计返回 `review-needed`；提交后重新运行并记录真实结果。
- `npm run check`：通过。
- `npm test`：全量单元/回归测试通过。
- `git diff --check`：通过。

这是一条文档现场复验记录，不表示业务代码、安装 App 或生产运行态发生变化。
