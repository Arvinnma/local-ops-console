# 维护

## 三个独立对象

1. 本源码仓库：用于开发、测试和打包。
2. `/Applications/Local Ops.app`：用户启动的桌面 App。
3. `~/.local/share/local-ops`：安装后台、配置和运行数据。

升级源码不会自动更新后两者。覆盖安装后台可能重启控制面和 Worker 进程，必须按 [[../RELEASE_REGRESSION]] 记录 PID、监听、配置备份和恢复结果。

运行数据的范围、导出排除项和卸载方式见[中文使用手册](../USER_GUIDE.zh-CN.md)；版本、制品和安装状态见 [[../PROJECT_STATUS]]。
