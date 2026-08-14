# 当前状态

> 状态：权威源码、Foundation 文档和 m-wiki 注册已收敛；v1.8.6 已完成源码、制品与本机覆盖安装验收

状态日期：2026-08-14

## 项目与版本基线

| 项目 | 当前事实 |
| --- | --- |
| project_id | `local-ops-console` |
| 软件源码版本 | `1.8.6` |
| 权威源码仓库 | `/Users/arvin/Documents/AI/codex/local-ops-console` |
| 旧源码仓库 | `/Users/arvin/Documents/Codex/projects/local-ops/local-ops-console`，只读保留 |
| 当前分支 | `main` |
| 公开 GitHub `origin/main` | 发布后与本地 `main` 一致；精确 SHA 以 `git ls-remote origin refs/heads/main` 为准 |
| 私有 Forgejo `forgejo/main` | 发布后与本地 `main` 一致；精确 SHA 以 `git ls-remote forgejo refs/heads/main` 为准 |
| 公开 / 私有发布标签 | `v1.8.6`，两个远端必须解析到同一发布提交 |
| GitHub Release | `v1.8.6`，Apple Silicon DMG SHA-256 `726e1f52c1ff8da1ac334d187b69ffc335396e8240404ed6136190c08979fe40` |
| 当前安装 App | `/Applications/Local Ops.app`，App 与内置后台均已核验为 `1.8.6` |
| m-wiki | `/Users/arvin/Documents/AI/m-wiki/项目/local-ops-console/` 已注册并解析到权威源码路径 |
| 项目文档 | README、`docs/`、源码和测试共同构成当前事实；m-wiki 仅链接这些项目文件 |

公开 Release、两个远端、源码工作区和本机安装版不是同一基线。运行代码与制品的详细权威说明见 [PROJECT_STATUS.md](PROJECT_STATUS.md)；本文件额外记录源码迁移和 Foundation 现场。

## 源码、安装和运行目录

- 源码开发与测试：`/Users/arvin/Documents/AI/codex/local-ops-console`
- 桌面 App：`/Applications/Local Ops.app`
- 安装后台、配置与运行状态：`/Users/arvin/.local/share/local-ops`
- App 日志：`/Users/arvin/Library/Logs/Local Ops`

源码提交不会自动更新后三项。`npm run build:dmg` 只生成制品；`scripts/build-app.zsh` 会退出并覆盖安装 App；`scripts/install.zsh` 会写后台和 LaunchAgent。安装或运行态验收必须另行授权。

## 迁移与治理结果

- 迁移前旧仓库工作树干净，分支为 `main`，HEAD 为 `d3a9dda`，保留 `origin`、`forgejo`、完整历史和标签。
- 目标路径原有混合内容先保存为同级恢复点；迁移只复制 Git 历史和跟踪文件，没有迁移 `node_modules`、`desktop/dist`、缓存、DMG 或其他可再生成制品。
- 原有 `assets`、`desktop`、`native`、`public`、`runtime`、`src`、`tests` 结构未重排。
- 迁移执行阶段按当时授权没有接入 m-wiki；后续统一验收阶段完成了 m-wiki 注册。
- 私有 Forgejo 已存在的 Foundation 与历史文档提交先以快进方式纳入本地，再在其上完成 schema 3、受控文档区和迁移收尾；没有改写私有历史。
- 迁移收尾只提交并推送迁移文档、Foundation 配置和当时经审阅的文档快照到私有 Forgejo，不推 GitHub，不修改业务源码、安装副本、运行目录或生产配置。

## 验证结果

- `project-foundation check`：通过。
- `project-foundation doctor`：通过；项目与 m-wiki 注册可解析。
- `project-foundation review-docs`：Project Foundation V6 Lite 已移除此命令；当前返回 `deprecated`，不再作为发布门禁。
- `npm run check`：通过。
- `npm test`：135 项单元/回归测试通过。
- `git diff --check`：通过。
- `npm run test:keychain`、`npm run test:refresh-isolated`、`npm run test:smoke` 和 `npm run test:browser`：通过。
- v1.8.6 DMG 已通过 SHA-256、`hdiutil verify`、ad-hoc 签名、arm64 架构和挂载布局验证。
- 覆盖安装前没有活动 `restic`、`rclone`、`rsync`、`scp` 或 `sftp` 数据任务；安装后 App 与后台关键源码 SHA 一致，所有本地 SSH listener 保持唯一。
- 强模式秘密扫描：迁移文档与配置未发现私钥正文、长 Bearer Token、GitHub Token、AWS Access Key、OpenAI Key 或明文密码赋值。

## 已知限制

- 当前仅提供 Apple Silicon、ad-hoc 签名且未公证的安装包。
- 覆盖安装内置后台仍会重启控制面和 Process Compose Worker；本次安装中的 SSH PID 因此全部更新，但没有出现重复 listener。
- 两条语音服务隧道在安装后仍等待其上游 HTTP readiness；TCP 转发已建立。该状态不会提前清零连续失败计数，也不会被误报为完全可用。

## 恢复点

- 旧仓库：`/Users/arvin/Documents/Codex/projects/local-ops/local-ops-console`
- 新目标路径原有内容：`/Users/arvin/Documents/AI/codex/local-ops-console.pre-migration-20260809-190435`

任何恢复都应保留当前现场，不使用 `git reset --hard`，也不得把源码回滚等同于运行副本回滚。

## 唯一下一步

日常开发继续使用权威源码、测试和人工文档；旧仓库和迁移恢复目录保持只读。每次 Git 发布后按 Project Foundation 契约校验 m-wiki 链接；未来安装升级仍应避开活动数据传输并先记录 PID/listener。
