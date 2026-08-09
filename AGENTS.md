# 项目智能体入口

## 项目身份

- project_id：`local-ops-console`
- 等级：`complex`
- 工作区：`/Users/arvin/Documents/AI/codex/local-ops-console`

## 开始工作

1. 先读本文件、`README.md`、`docs/index.md` 和 `docs/current-state.md`。
2. 以磁盘、代码和测试结果为准，不依赖旧聊天上下文。
3. 修改前检查 Git 状态；保留用户已有变更。
4. 完成功能后运行相关测试，并同步代码无法表达的使用、决策或踩坑文档。
5. 不把秘密、缓存、大文件或临时运行产物提交进仓库。

## 项目边界

- 本目录是源码仓库，不是正在运行的安装副本。
- 当前安装 App 位于 `/Applications/Local Ops.app`，后台位于 `~/.local/share/local-ops`。
- 未得到用户明确授权时，不安装 App、不覆盖后台、不停止或重启 Local Ops，也不操作现有服务和 SSH 隧道。
- 控制 API、SSH 监听和反向代理目标必须保持在回环地址；真实配置、Token、私钥、口令和运行日志不得进入仓库。
- 发布状态以 `docs/PROJECT_STATUS.md` 为准，不能把文档提交误称为已经发布的运行变更。

## 验证基线

- 普通代码或文档修改至少运行 `npm run check`、`npm test` 和 `git diff --check`。
- 打包、原生钥匙串、安装副本或运行时变更必须进一步遵守 `docs/DEVELOPMENT.md` 与 `docs/RELEASE_REGRESSION.md`。
- 只调用功能的其他项目不得直接修改本仓库；调用入口见 `USAGE.md`。

## 两种阅读模式

- 接手或维护本项目：按“开始工作”的顺序读取；默认不需要读取 `USAGE.md`。
- 只调用本项目功能：只读根目录 `USAGE.md` 及其指向的 `docs/usage/README.md`，把本项目视为只读外部依赖。

## 当前状态

当前状态和下一步记录在 `docs/current-state.md`（如该文件存在）；小脚本则直接维护在 `README.md`。
