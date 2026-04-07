# 开发与测试（Development）

## 环境要求

- Node.js >= 18
- pnpm >= 8
- Rust >= 1.70
- Windows 需要 WebView2

## 常用命令

```bash
pnpm install
pnpm dev
pnpm lint
pnpm type-check
pnpm exec vitest run
```

## E2E 测试

E2E 使用 tauri-driver + msedgedriver。

常用环境变量：

- `E2E_FORCE=true`：忽略 WebView2 与驱动版本校验
- `E2E_WEBVIEW2_VERSION=144.x.x`：手动指定 WebView2 版本
- `E2E_APP_PATH`：指定被测 app 路径
- `TAURI_DRIVER_PATH`：指定 tauri-driver 路径

运行：

```bash
pnpm exec vitest run --config vitest.config.integration.ts
```

## Rust 测试

```bash
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
```
