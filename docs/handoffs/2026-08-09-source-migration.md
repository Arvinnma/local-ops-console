# 2026-08-09 源码迁移交接

## 目标

将 Local Ops 源码从：

```text
/Users/arvin/Documents/Codex/projects/local-ops/local-ops-console
```

迁移到：

```text
/Users/arvin/Documents/AI/codex/local-ops-console
```

项目标识为 `local-ops-console`，按 Project Foundation `complex` 等级接管。迁移执行阶段不安装 App、不重启 Local Ops、Caddy 或 SSH 隧道，也不接入 OpenWiki / m-wiki。

## 迁移阶段已完成

- 迁移前核对旧仓库工作树、分支、HEAD、标签、GitHub 与 Forgejo 远端及公开 Release。
- 发现目标路径已有混合历史内容后，先整体保存在同级恢复目录，未覆盖或删除。
- 仅迁移旧仓库 `.git` 和 `git ls-files` 列出的跟踪路径；未复制 `node_modules`、`desktop/dist`、测试缓存、DMG 或其他可再生成制品。
- 先执行 Project Foundation dry-run，确认保留型冲突后再正式接管。
- 保留原目录布局以及两个远端、分支、标签和完整 Git 历史。
- 迁移阶段没有合并、变基、提交或推送远端，也没有触碰运行目录。

## 迁移时基线

迁移时本地 `main` 与 GitHub `origin/main` 均为：

```text
d3a9ddaa2a7ae9b3fffc922741a60e5a58f2d4ef
```

只读刷新后，私有 Forgejo `forgejo/main` 为：

```text
136dde7a0d33f1d683f4811cc6c8fcc0aa6d7439
```

Forgejo 当时比 GitHub 多两个 Foundation/OpenWiki 文档提交；迁移执行阶段没有擅自选边。公开 `v1.8.5` 标签为 `3c37d965f2857ec8ef5ad8c193ad5bcb8c0baaa5`。

## 后续收尾

- 统一验收阶段完成 m-wiki 正式注册和 OpenWiki 候选审阅/接受。
- 迁移收尾阶段先把本地 `main` 快进到既有 `forgejo/main`，保留私有历史，再在其上复核并提交 schema 3 与完整治理文档。
- 该收尾只推进私有 Forgejo；公开 GitHub 继续停留在公开 v1.8.5 文档基线。
- 迁移阶段的“未接入、未提交、未推送”是历史授权边界，不应误写成当前未完成事项。

## 恢复点

目标目录原有混合内容保存在：

```text
/Users/arvin/Documents/AI/codex/local-ops-console.pre-migration-20260809-190435
```

旁路提示文件：

```text
/Users/arvin/Documents/AI/codex/.local-ops-console-migration-backup-path
```

旧仓库仍原样保留，迁移完成后只读使用：

```text
/Users/arvin/Documents/Codex/projects/local-ops/local-ops-console
```

OpenWiki 恢复点：

```text
/Users/arvin/.local/state/project-foundation/backups/local-ops-console/openwiki-20260809T063200500964
/Users/arvin/.local/state/project-foundation/openwiki-candidates/local-ops-console/20260809T062514831109
```

## 明确未触碰

```text
/Applications/Local Ops.app
/Users/arvin/.local/share/local-ops
/Users/arvin/Library/Logs/Local Ops
```

迁移和文档收尾都没有执行安装脚本、App 构建覆盖、控制面 reload、服务或隧道启停。

## 接手结论

权威工作区固定为 `/Users/arvin/Documents/AI/codex/local-ops-console`。接手者先读 `AGENTS.md` 与 `docs/current-state.md`，再按当前 Git 和门禁结果工作；旧路径和恢复目录不能继续作为可写源码工作区。
