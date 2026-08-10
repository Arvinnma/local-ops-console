# 当前状态

> 状态：权威源码迁移、Foundation 文档复核、m-wiki 注册和 OpenWiki 快照复核已收敛；本轮未安装、未重启、未改生产配置

状态日期：2026-08-10

## 项目与版本基线

| 项目 | 当前事实 |
| --- | --- |
| project_id | `local-ops-console` |
| 软件源码版本 | `1.8.5` |
| 权威源码仓库 | `/Users/arvin/Documents/AI/codex/local-ops-console` |
| 旧源码仓库 | `/Users/arvin/Documents/Codex/projects/local-ops/local-ops-console`，只读保留 |
| 当前分支 | `main` |
| 公开 GitHub `origin/main` | `d3a9ddaa2a7ae9b3fffc922741a60e5a58f2d4ef` |
| 私有 Forgejo `forgejo/main` | 包含公开基线、Foundation/OpenWiki 历史及本次迁移收尾提交；精确 SHA 以 `git ls-remote forgejo refs/heads/main` 为准 |
| 公开 / 私有 `v1.8.5` 标签 | `3c37d965f2857ec8ef5ad8c193ad5bcb8c0baaa5` |
| GitHub Release | `v1.8.5`，Apple Silicon DMG SHA-256 `968e389d1a188b7bc8d24465215b49ba37714d2465ec6573749016308a2a6fd9` |
| 当前安装 App | `/Applications/Local Ops.app`，只读核验版本 `1.8.4` |
| m-wiki | `/Users/arvin/Documents/AI/m-wiki/项目/local-ops-console/` 已注册并解析到权威源码路径 |
| OpenWiki | 项目内快照已按当前源码与权威文档重新生成、逐页复核并接受；实时完整性与新鲜度以 `project-foundation wiki status/check` 为准，避免在被哈希文档中硬编码自引用哈希 |

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
- 迁移执行阶段按当时授权没有启动 OpenWiki、没有接入 m-wiki；后续统一验收阶段才完成 m-wiki 注册和 OpenWiki 候选审阅/接受。两项历史按阶段分别保留。
- 私有 Forgejo 已存在的 Foundation 与 OpenWiki 两笔文档提交先以快进方式纳入本地，再在其上完成 schema 3、受控文档区和迁移收尾；没有改写私有历史。
- 本轮只提交并推送迁移文档、Foundation 配置和经审阅的 OpenWiki 快照到私有 Forgejo，不推 GitHub，不修改业务源码、安装副本、运行目录或生产配置。

## 验证结果

- `project-foundation check`：通过。
- `project-foundation doctor`：通过；项目与 m-wiki 注册可解析。
- `project-foundation wiki status/check`：已接受快照完整性通过，当前输入与快照一致；精确状态以命令实时输出为准。
- `project-foundation review-docs`：提交前因文档差异按设计返回 `review-needed`；提交后应以重新执行的真实结果为准。
- `npm run check`：通过。
- `npm test`：全量单元/回归测试通过。
- `git diff --check`：通过。
- 强模式秘密扫描：迁移文档与配置未发现私钥正文、长 Bearer Token、GitHub Token、AWS Access Key、OpenAI Key 或明文密码赋值。

本轮未运行 `test:smoke`、`test:browser`、App 安装、DMG 构建或实机发布回归，因为这些步骤会创建运行资源、打开浏览器或影响安装版，不属于迁移收尾授权。

## 已知限制

- 当前安装 App 仍是 `1.8.4`，公开 Release 是 `1.8.5`；源码迁移不代表安装已升级。
- GitHub `origin/main` 与私有 Forgejo `main` 有意保持不同文档基线；本轮只授权推进私有 Forgejo。
- 当前仅提供 Apple Silicon、ad-hoc 签名且未公证的安装包。
- OpenWiki 是可重建的代码百科视图，不替代 `AGENTS.md`、`README.md`、`docs/` 和源码；源码或权威文档变化后应重新生成候选并复核，不得把旧快照描述为当前事实。

## 恢复点

- 旧仓库：`/Users/arvin/Documents/Codex/projects/local-ops/local-ops-console`
- 新目标路径原有内容：`/Users/arvin/Documents/AI/codex/local-ops-console.pre-migration-20260809-190435`
- 历史 OpenWiki 接受前备份：`/Users/arvin/.local/state/project-foundation/backups/local-ops-console/openwiki-20260809T063200500964`
- 最新 OpenWiki 接受产生的恢复点与候选路径以 `project-foundation wiki accept` 输出及本机状态目录为准，避免本文件再次制造输入哈希漂移。

任何恢复都应保留当前现场，不使用 `git reset --hard`，也不得把源码回滚等同于运行副本回滚。

## 唯一下一步

后续仅在源码或权威文档发生实际变化时重新生成 OpenWiki 候选并人工复核；日常开发继续使用权威新路径，旧仓库和恢复目录保持只读。
