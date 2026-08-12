# 需求

记录已确认的目标、范围、验收标准和明确不做的内容。

## 产品边界

- 管理本机 Node / 命令服务、SSH 隧道、Docker 容器、本地域名反向代理和终端操作。
- 控制 API、隧道监听和反向代理目标默认限制在本机回环地址。
- SSH 私钥口令等敏感值由 macOS Keychain 保存，不写入 catalog、日志、文档或导出包。
- UI 状态必须区分进程存在、SSH/TCP 存活、应用 readiness 和域名入口 readiness，不能用单一“运行中”掩盖降级状态。

## 源码迁移验收

- 新目录保留完整 Git 历史、分支、标签和 `origin` / `forgejo` 两个远端。
- 原生 `assets`、`desktop`、`native`、`public`、`runtime`、`src`、`tests` 结构不重排。
- 不迁移依赖、缓存、DMG、挂载目录和其他可再生成制品。
- 不覆盖原有 README、中文 README 或项目文档正文；Project Foundation 只维护各文档的唯一受控区和新增治理文档。
- 旧仓库保留且迁移后不继续修改。
- 源码迁移不触碰安装版、运行数据、日志或现有进程。
- 迁移、Git 提交、远端推送、Release 发布和安装分别遵循当前任务授权；Git 推送成功后按 Project Foundation 契约自动登记或校验 m-wiki。

## 证据要求

每次发布或安装都分别记录源码 HEAD、公开 Release 标签与校验值、本机 App 版本、后台源码版本、测试结果、运行 PID/监听变化以及已知差异。当前证据见 [current-state.md](../current-state.md)。
