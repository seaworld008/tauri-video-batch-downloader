# 贡献指南

感谢你愿意改进 Video Downloader Pro。这个项目是 Tauri
v2 桌面应用，改动时请优先保护下载状态机、队列调度和前后端事件一致性。

## 环境要求

- Node.js >= 20.x
- pnpm >= 9.x，推荐通过 `corepack enable` 使用 `packageManager` 中声明的版本
- Rust stable >= 1.78
- macOS 需要 Xcode Command Line Tools；Windows 需要 WebView2
  Runtime；Linux 需要 GTK/WebKit 依赖
- 可选：`cargo-audit`，用于 Rust 依赖漏洞扫描

## 安装

```bash
corepack enable
corepack prepare pnpm@9.15.0 --activate
pnpm install --frozen-lockfile
```

## 常用验证

```bash
pnpm type-check
pnpm lint
pnpm exec vitest run
pnpm exec vitest run --config vitest.config.integration.ts
pnpm vite build
cargo fmt --manifest-path src-tauri/Cargo.toml --all --check
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
pnpm audit --prod
cargo audit --manifest-path src-tauri/Cargo.toml
```

如果 `cargo test` 或 `cargo clippy` 因 Tauri `frontendDist` 缺失失败，先运行
`pnpm vite build` 再重试。

## Tauri 开发注意事项

普通前端预览可以用
`pnpm vite`，但 IPC、窗口事件、文件选择和系统命令必须通过 Tauri 桌面上下文验证。只有在明确需要长运行桌面调试时才启动：

```bash
pnpm tauri dev
```

Tauri E2E 请使用项目配置的 Tauri MCP 工具，不要用 Chrome DevTools
MCP 代替桌面应用链路。

## 代码约定

- React 组件使用 Zustand selector：`useDownloadStore(state => state.tasks)`。
- 异步回调和事件监听优先用 `useDownloadStore.getState()` 获取当前状态。
- Rust 不要在持有 `std::sync::Mutex/RwLock` guard 时 `await`。
- 下载核心行为先写测试，尤其是 `manager.rs`、`resume_downloader.rs` 的状态流转。
- 保持文件规模克制，复杂 UI 和 Rust manager 职责应拆到邻近模块。
- 不要提交 `.planning/`、`graphify-out/`、`.gitnexus/`、`dist/`、`target/`。

## Graphify 与 GitNexus

GitNexus 可用于查询下载生命周期、队列调度和事件桥影响面：

```bash
npx gitnexus status
npx gitnexus context DownloadManager
```

Graphify 产物位于 `graphify-out/`。当前脚本会检测 CLI 是否支持图谱重建；如果当前
`graphify` 只有 query 能力，会给出清晰 fallback：

```bash
./scripts/graphify-sync.sh smart
```

架构或计划类问题请先阅读
`graphify-out/GRAPH_REPORT.md`；如果该文件不存在，参考脚本输出使用具备 build/update 能力的 Graphify
CLI 重建。
