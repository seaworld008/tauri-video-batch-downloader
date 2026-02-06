# 构建与发布（Build & Release）

## 生产包

```bash
pnpm build:prod
```

- 默认不写本地日志文件
- 输出目录：`src-tauri/target/release/bundle/`

## 本地测试包（带日志）

```bash
pnpm build:local
```

- 启用本地日志落地
- 日志输出：`./log/backend.log`、`./log/frontend.log`

## 版本与安装包

- Windows：MSI / NSIS
- macOS / Linux：Tauri 默认打包

## WebView2

Windows 需要 WebView2。安装包内置检测与引导。

## 本地测试配置

- `src-tauri/tauri.conf.local.json`
- `.env.localtest`（前端日志开关）
