<!-- PROJECT-FOUNDATION:START v1 -->
# 项目智能体入口

## 项目身份

- project_id：`local-ops-console`
- 等级：`complex`
- 权威源码工作区：`/Users/arvin/Documents/AI/codex/local-ops-console`

## 两种阅读模式

- 接手或维护本项目：先读本文件、`README.md`、`docs/index.md` 和 `docs/current-state.md`。
- 只调用本项目功能：只读根目录 `USAGE.md` 及其指向的 `docs/usage/README.md`，把本项目视为只读外部依赖。

## 当前状态

当前源码、公开 Release、私有 Forgejo、安装版和唯一下一步记录在 `docs/current-state.md`；发布与运行代码基线另见 `docs/PROJECT_STATUS.md`。
<!-- PROJECT-FOUNDATION:END v1 -->

## 开始工作

1. 以当前磁盘、Git、代码和测试结果为准，不依赖旧聊天解释。
2. 修改前运行 `git status --short --branch`，保留用户已有变更。
3. 网络命令先执行 `proxy_on`；不得把代理值、Token 或其他秘密写进输出、日志和文档。
4. 只做需求范围内的最小修改，不顺带重排业务目录或格式化无关文件。
5. 完成功能后运行风险相称测试，并同步代码无法表达的使用、决策或踩坑文档。
6. 不提交秘密、真实运行配置、缓存、大文件、DMG、依赖目录或临时运行产物。

## 项目边界

- 本目录是源码仓库，不是正在运行的安装副本。
- 桌面 App 位于 `/Applications/Local Ops.app`；后台、配置和运行数据位于 `/Users/arvin/.local/share/local-ops`；日志位于 `/Users/arvin/Library/Logs/Local Ops`。
- 未得到当前任务的明确授权时，不安装或替换 App、不覆盖后台、不停止或重启 Local Ops、Caddy、服务或 SSH 隧道。
- `scripts/build-app.zsh` 会退出、覆盖并重新打开 `/Applications/Local Ops.app`，不是普通构建命令；只生成 DMG 时使用 `npm run build:dmg`。
- 控制 API、SSH 监听和反向代理目标必须保持在回环地址。真实 catalog、Token、私钥、口令、钥匙串内容和运行日志不得进入仓库。
- GitHub、Forgejo、Release 标签和当前安装版是独立基线；对外表述前必须分别核验。
- m-wiki 是可重建浏览层，项目文件仍是事实源。OpenWiki 更新、接受、外部注册、Git 提交、推送、发布和安装分别需要相应授权。

## 验证基线

- 普通源码或文档修改至少运行 `npm run check`、`npm test` 和 `git diff --check`。
- 原生钥匙串相关修改增加 `npm run build:keychain` 与 `npm run test:keychain`。
- Smoke、浏览器、安装、打包和发布按 `docs/DEVELOPMENT.md` 与 `docs/RELEASE_REGRESSION.md` 执行，并先确认不会触碰不可替代的运行数据。
- 推送前分别确认两个远端的目标引用；只推进用户明确指定的远端。
