# 开发与测试（Development）

更新日期：2026-05-06

## 环境要求

| 工具      | 版本                                           |
| --------- | ---------------------------------------------- |
| Node.js   | >= 20                                          |
| pnpm      | >= 9                                           |
| Rust      | stable，建议 >= 1.78                           |
| Tauri CLI | v2，通过 `@tauri-apps/cli` dev dependency 调用 |

Windows 需要 WebView2 runtime；macOS 需要 Xcode Command Line
Tools；Linux 需要 WebKitGTK/GTK 相关依赖。

## 安装依赖

```bash
pnpm install --frozen-lockfile
```

## 常用命令

```bash
pnpm dev
pnpm type-check
pnpm lint
pnpm exec vitest run
pnpm exec vitest run --config vitest.config.integration.ts
cargo test --manifest-path src-tauri/Cargo.toml
```

## 全量质量门禁

```bash
pnpm test:all
```

该命令会串联前端 lint/type/test、集成测试、Rust fmt/test/clippy。

## Tauri / E2E 测试

E2E 使用 Tauri 应用环境，不用普通浏览器替代 IPC 行为。

常用环境变量：

- `E2E_FORCE=true`：忽略 WebView2 与驱动版本校验
- `E2E_WEBVIEW2_VERSION=144.x.x`：手动指定 WebView2 版本
- `E2E_APP_PATH`：指定被测 app 路径
- `TAURI_DRIVER_PATH`：指定 tauri-driver 路径

运行：

```bash
pnpm exec vitest run --config vitest.config.integration.ts
```

## 文档变更

```bash
pnpm exec prettier --check README.md docs/**/*.md
```

如果文档变化会影响架构语义，应刷新 Graphify，见 `gsd-graphify-workflow.md`。
