# 测试

## 基础门禁

```bash
npm run check
npm test
git diff --check
```

## 扩展门禁

```bash
npm run build:keychain
npm run test:keychain
npm run test:smoke
npm run test:browser
```

Smoke 和浏览器测试可能创建临时 Local Ops 资源；运行前必须确认其临时 ID 与清理逻辑，不能拿不可替代的用户资源做测试。Docker 变更测试保持显式 opt-in。

完整发布矩阵、输入、判定和回滚见 [[../RELEASE_REGRESSION]]；当前发布基线见 [[../PROJECT_STATUS]]。
