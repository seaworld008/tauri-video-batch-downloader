# 构建与发布（Build & Release）

更新日期：2026-05-06

## 生产包

```bash
pnpm build:prod
```

等价主路径：

```bash
pnpm build
```

输出目录：

```text
src-tauri/target/release/bundle/
```

生产包默认不写本地前端/后端日志文件。

## 本地测试包

```bash
pnpm build:local
```

本地测试包用于真实 App 回归，启用日志落地：

```text
./log/backend.log
./log/frontend.log
```

相关配置：

- `src-tauri/tauri.conf.local.json`
- `.env.localtest`

## 平台说明

| 平台    | 说明                                          |
| ------- | --------------------------------------------- |
| macOS   | Tauri 默认生成 `.app` / `.dmg`                |
| Windows | 需要 WebView2 runtime；安装包应包含检测与引导 |
| Linux   | 依赖 WebKitGTK/GTK，deb 依赖见 Tauri 配置     |

## 发布前检查

1. 跑通 `pnpm test:all`。
2. 用真实 App 导入少量测试数据并验证开始、暂停、恢复、重复导入。
3. 检查 `docs/current-state.md`、`docs/roadmap.md` 是否需要同步。
4. 发布说明写清新增能力、修复问题、已知风险和升级建议。
