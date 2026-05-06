# Code Quality

更新日期：2026-05-06

这份文档取代旧的详细评审目录，记录当前仍有效的质量门禁、安全状态和提交前检查。旧评审中已经修复或过期的条目不再单独保留，避免新维护者误以为它们仍是当前缺陷。

---

## 1. 当前状态摘要

| 维度            | 当前状态                                                                        |
| --------------- | ------------------------------------------------------------------------------- |
| Node/pnpm 版本  | `package.json#engines` 已声明 Node.js >= 20、pnpm >= 9                          |
| Tauri CSP       | 生产配置已移除 `'unsafe-eval'`，本地测试配置可单独保留开发放行                  |
| 下载事件信道    | 当前唯一信道为 `download-events`                                                |
| `event_sender`  | 已避免无条件 `unwrap()`，缺失时返回显式错误                                     |
| 前端命令边界    | 下载、导入、配置、runtime query、系统能力已收敛到 feature-local API wrappers    |
| 后端主链        | Tauri commands 经 `TaskEngine` / `DownloadRuntimeHandle` 进入 `DownloadManager` |
| GitHub 社区配置 | Issues、Discussions、Wiki、labels、issue templates、PR template 已配置          |

---

## 2. 推荐质量门禁

```bash
pnpm install --frozen-lockfile
pnpm type-check
pnpm lint
pnpm exec vitest run
pnpm exec vitest run --config vitest.config.integration.ts
cargo fmt --manifest-path src-tauri/Cargo.toml --all --check
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

文档-only 变更至少运行：

```bash
pnpm exec prettier --check README.md docs/**/*.md
```

---

## 3. 风险分级

| 改动区域                                           | 风险 | 推荐验证                                            |
| -------------------------------------------------- | ---- | --------------------------------------------------- |
| `src-tauri/src/core/manager.rs`                    | 高   | Rust focused tests + `cargo test` + GitNexus impact |
| `src-tauri/src/core/runtime.rs` / `task_engine.rs` | 高   | command ACK、去重、状态转换测试                     |
| `src-tauri/src/infra/download_event_bridge.rs`     | 高   | Rust event tests + 前端 event contract tests        |
| `src/features/downloads/state/*`                   | 中高 | Vitest focused tests + `pnpm type-check`            |
| `src/features/downloads/api/*`                     | 中   | API wrapper tests + consumer tests                  |
| `docs/*`                                           | 低   | Prettier + broken link 检查 + Graphify 语义刷新     |

---

## 4. GitNexus / Graphify 使用约定

- 提交前用 GitNexus `detect_changes` 查看 staged 影响面。
- 架构或大范围文档变化后，运行 Graphify 全量或强制刷新，而不是只依赖 smart
  sync。
- `graphify-out/` 是本地图谱产物，默认不提交。
- 分析结论写入文档时必须标注日期和当前基线。

---

## 5. 仍需关注

- 下载边界测试仍应继续扩展，特别是网络异常、限流、权限、Range、`.part` 损坏。
- M3U8/YouTube/ffmpeg/yt-dlp 的跨平台 sidecar 体验仍有提升空间。
- 真机 App 回归仍不可完全由普通浏览器测试替代；涉及 Tauri
  IPC 时应运行真实桌面应用或 Tauri E2E。
