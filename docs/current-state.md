# 当前状态

> 状态：V3 真实项目迁移已完成；未切换或修改正在运行的 Local Ops

状态日期：2026-08-09

## 项目身份

- 项目版本：`1.8.5`
- 迁移前仓库：`/Users/arvin/Documents/Codex/projects/local-ops/local-ops-console`
- 标准化副本：`/Users/arvin/Documents/AI/codex/local-ops-console`
- 迁移前提交：`d3a9ddaa2a7ae9b3fffc922741a60e5a58f2d4ef`
- 当前分支：`main`
- 私有远端：`forgejo-office:arvin/local-ops-console.git`
- 公开远端：`https://github.com/Arvinnma/local-ops-console.git`

## 已完成

- 迁移前源仓库为干净 Git 工作树，语法检查和 90 项单元测试通过。
- 已使用 APFS 克隆复制到标准路径；文件数、符号链接数和 Git 提交与旧目录一致。
- 已建立标准项目入口、对外使用入口和分层文档目录。
- 已注册到 m-wiki；项目入口只链接回本仓库，不复制项目文档。
- OpenWiki 代码百科候选已经人工审阅并接受，当前代码哈希检查为 `no-op`。
- 运行时仍使用 `/Applications/Local Ops.app` 与 `~/.local/share/local-ops`，本次没有重启 App、控制面、服务或 SSH 隧道。

## 验证结果

- `project-foundation check`：通过。
- OpenWiki 代码哈希：`a52071269e8404ee12e028ac3237c4614f95a0e5fa65f462ce3720b087203134`，状态 `no-op`。
- `npm run check`：通过。
- `npm test`：90/90 通过。
- `git diff --check`：通过。

## 唯一下一步

在一个全新 Codex 任务中打开本目录，只提供项目路径，验证它能按 `AGENTS.md` 接手。真实使用确认稳定前，不删除旧目录。

## 已知问题

- 当前安装 App 仍为 `1.8.4`；公开发布与运行基线的完整区别以 [[PROJECT_STATUS]] 为准。
- 替换安装后台会重启控制面，并可能重启 Worker 下的 SSH 进程；迁移源码目录不等于授权安装或升级。
- 当前发布仍只支持 Apple Silicon，使用 ad-hoc 签名，尚未公证。

## 恢复点

- 旧目录保持原样，不删除、不重命名。
- 如果新副本验证失败，停止使用新路径并回到迁移前目录与提交 `d3a9ddaa2a7ae9b3fffc922741a60e5a58f2d4ef`。
- OpenWiki 接受前备份：`/Users/arvin/.local/state/project-foundation/backups/local-ops-console/openwiki-20260809T061537609155`。
- 已接受候选：`/Users/arvin/.local/state/project-foundation/openwiki-candidates/local-ops-console/20260809T055433524456`。
