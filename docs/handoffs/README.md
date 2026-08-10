# 交接

保存特定时点的薄交接记录；稳定规则和长期知识必须回写到正式文档。

新任务接手顺序：

1. 阅读仓库根目录的 `AGENTS.md`、`README.md` 或 `README.zh-CN.md`。
2. 阅读 `docs/index.md`、`docs/current-state.md` 和 `docs/PROJECT_STATUS.md`。
3. 按任务类型继续阅读开发、发布、回归、安全或用户手册。
4. 运行 `git status --short --branch`，确认用户未提交改动和当前远端基线。
5. 涉及安装或运行态前，先区分源码、安装 App、后台运行目录和日志目录。

当前迁移现场：[2026-08-09 源码迁移](2026-08-09-source-migration.md)。不得依赖旧聊天补充说明。
