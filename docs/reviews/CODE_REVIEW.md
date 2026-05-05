# 代码审查报告 — Video Downloader Pro

> 评审日期：2026-05-05
> 评审方法：静态阅读 + 自动化工具（`pnpm type-check`、`pnpm lint`、`pnpm exec vitest run`、`pnpm audit`）
> 受限：Rust 工具链（`cargo`/`clippy`/`rustc`）在评审环境不可用 — Rust 部分仅做静态阅读，未执行 `cargo clippy --` 与 `cargo test`，建议用户在本地或 CI 上补跑。

## 一、自动化工具结果

| 工具 | 结果 |
|------|------|
| `pnpm type-check`（tsc --noEmit）| ✅ 0 错误 |
| `pnpm lint`（ESLint + `--max-warnings=0`）| ✅ 通过 |
| `pnpm exec vitest run` | ✅ 50 文件 / **257 / 257** 测试通过（2.31s）|
| `pnpm audit --prod` | ✅ No known vulnerabilities |
| `cargo fmt --check` | ⚠️ 未执行（环境无 cargo）|
| `cargo clippy -- -D warnings` | ⚠️ 未执行（环境无 cargo）|
| `cargo test` | ⚠️ 未执行（环境无 cargo）|

## 二、严重程度分级

| 标记 | 含义 |
|------|------|
| 🔴 Critical | 可能导致运行时 panic / 安全漏洞 / 数据丢失 |
| 🟠 High | 设计/可维护性硬伤，应尽快修 |
| 🟡 Medium | 正确但不够稳健，建议修 |
| 🔵 Low | 代码风格 / 文档 / 微优化 |

## 三、Rust 后端

### 🔴 R-01 `manager.rs:1098` — `event_sender.unwrap()` 可能 panic

```rust
let event_sender = self.event_sender.as_ref().unwrap().clone();
```

**问题**：`event_sender: Option<...>` 被无条件 `unwrap()`。同文件 L1083 `if let Some(sender) = &self.event_sender` 已显式承认这个字段可能为 `None` —— 一旦在 `event_sender` 未注入时进入下载分支，整个 manager 任务会 panic 终止。

**修复建议**：

```rust
let event_sender = self.event_sender.as_ref()
    .ok_or_else(|| AppError::Download(
        "event_sender not initialised — call set_event_sender before start_download".into()
    ))?
    .clone();
```

或在结构体设计上把 `event_sender` 收敛为构造时的强制依赖（`Arc<EventSender>` 而非 `Option`），从根源消除 None 分支。

### 🟠 R-02 单文件超大 — 违反项目自身规约

AGENTS.md 第 19 行明确写：

> Keep code files under ~300 lines. Proactively split UI components or complex Rust modules logic if they grow too large.

实际：

| 文件 | 行数 | 倍数 |
|------|------|------|
| `src-tauri/src/core/manager.rs` | 4 957 | **16.5x** |
| `src-tauri/src/core/downloader.rs` | 1 827 | 6.1x |
| `src-tauri/src/core/file_parser.rs` | 1 390 | 4.6x |
| `src-tauri/src/core/resume_downloader.rs` | 1 354 | 4.5x |
| `src-tauri/src/core/youtube_downloader.rs` | 1 341 | 4.5x |
| `src-tauri/src/core/integrity_checker.rs` | 1 031 | 3.4x |
| `src-tauri/src/core/error_handling.rs` | 970 | 3.2x |

**`manager.rs` 内 79 个 `pub fn`/`pub async fn`** —— 一个文件承担了任务调度、队列管理、并发控制、事件分发、暂停/恢复、配置、哈希校验、统计聚合等多职责。

**修复建议**（建议拆分为子模块，按 SRP 切分）：

```
src-tauri/src/core/manager/
  mod.rs                 // pub use re-exports
  state.rs               // Manager 结构体、字段定义
  queue.rs               // enqueue/dequeue/scheduling
  active.rs              // active_downloads 跟踪、reap
  pause_resume.rs        // pause/resume/cancel
  event_dispatch.rs      // event_sender 适配
  integrity.rs           // expected_hashes / verify
  stats.rs               // stats / aggregation
  tests.rs
```

不要求一次到位，但每个 PR 至少切出一个 **<500 行**的子模块。

### 🟡 R-03 `unwrap()` 用量集中在核心路径

| 文件 | `.unwrap()` 出现次数 |
|------|------|
| `core/downloader.rs` | 29 |
| `core/resume_downloader.rs` | 24 |
| `core/part_file.rs` | 19 |
| `core/integrity_checker.rs` | 19 |
| `core/manager.rs` | 18 |
| `core/m3u8_downloader.rs` | 12 |

虽然多数 `unwrap()` 用在已经检查过的不变量上（如 `unwrap_or_default()`），仍存在若干裸 `unwrap()`（`manager.rs:1098`、`manager.rs:759`、`manager.rs:831`、`manager.rs:2381` 等），建议：

1. 用 clippy lint 强制：`#![warn(clippy::unwrap_used, clippy::expect_used)]`（先 warn 再升级 deny）。
2. 对每处裸 `unwrap()`，追加 SAFETY 注释说明不变量，或改为 `?` / `ok_or_else()`。

### 🟡 R-04 `main.rs` 中四处 `unsafe` 块未文档化

```
src-tauri/src/main.rs:397, 510, 521, 532
```

`unsafe extern "system" fn GetVersionFn(...)` 等 Windows API 调用是合理的，但每个 `unsafe` 块都应附 `// SAFETY:` 注释解释不变量（Rust API guidelines C-UNSAFE）。当前缺失，会被 `clippy::missing_safety_doc` 命中。

### 🟡 R-05 `tokio::process::Command` 子进程参数透传需复核

`commands/system.rs:67/75/83/201/220` 调用 `explorer.exe` / `open` / `xdg-open` / `yt-dlp` / `youtube-dl`。`tokio::process::Command::new(...).arg(...)` 不经过 shell，理论上不存在 shell 注入；但仍需确认：

1. 路径参数全部来源于受信任源（`AppHandle::path()` 解析、用户对话框选择，而非 URL 解析后的路径片段）。
2. Windows 上 `explorer.exe /select,<path>` 形式必须分两个 `arg()` 调用，不能拼成单字符串。
3. yt-dlp/youtube-dl 接受用户 URL 时，是否限制 scheme 为 `http(s)://`？建议在调用前做 `url::Url::parse` + scheme 白名单校验。

### 🔵 R-06 依赖版本偏老

| crate | 当前 | 最新 | 备注 |
|-------|------|------|------|
| `reqwest` | 0.11 | 0.12.x | 0.12 修复多项 H2 / TLS 行为 |
| `env_logger` | 0.10 | 0.11.x | 主要是 API 变更 |
| `thiserror` | 1.0 | 2.0.x | 2.0 是 breaking but small |
| `cbc` | 0.1（cipher 0.4 系列）| 0.1.x（同系列） | 当前是该系列最新，OK |

非紧急，但下次依赖升级窗口可一次性处理。

## 四、前端 / TypeScript / React

### 🟢 总体健康

- TS 严格模式无错误 ✓
- ESLint 0 warning ✓
- 257 / 257 测试通过 ✓
- Zustand 用法抽样（`UnifiedView.tsx`、`ManualInputPanel.tsx`、`StatusBar.tsx`、`VirtualizedTaskList.tsx` 等）**全部使用 selector 形式**，符合 AGENTS.md L21 的禁止解构规约 ✓

### 🟡 F-01 大型组件 / store 文件接近上限

- `stores/downloadStore.ts` — 686 行
- `stores/__tests__/downloadStore.test.ts` — 884 行
- `schemas/index.ts` — 799 行
- `components/Downloads/DashboardToolbar.tsx` — 612 行
- `utils/dataValidator.ts` — 519 行
- `components/Settings/SettingsView.tsx` — 422 行

虽然不像 Rust 那样夸张，但相对 AGENTS.md 的 ~300 行预算仍偏大。建议：

- `downloadStore.ts` 按 slice 拆分（tasks-slice、queue-slice、filter-slice、recent-imports-slice），用 zustand 的 `combine`/`subscribeWithSelector` 组合；
- `schemas/index.ts` 按领域拆为 `schemas/task.ts`、`schemas/import.ts`、`schemas/config.ts` 等，再 re-export；
- `DashboardToolbar.tsx` 抽出 SearchBar、FilterChip、SortMenu 子组件。

### 🔵 F-02 `package.json` 未声明 engines

`package.json` 未声明 `"engines": { "node": ">=20", "pnpm": ">=9" }`。这会让新贡献者在错误版本上踩坑。结合 AGENTS.md 的 Prerequisites 缺失（见 NLPM_REPORT.md §3.2），应在两处一并补齐。

### 🔵 F-03 `prepare` 脚本使用已废弃的 husky 命令

```json
"prepare": "husky install"
```

执行时 husky 输出：

> husky - install command is DEPRECATED

husky v9 的正确命令是直接 `husky`（无子命令）。

## 五、构建脚本可移植性

### 🟠 B-01 `test:all` 硬编码了开发者本地路径

```
"test:all": "~/.hermes/node/bin/corepack pnpm lint && ~/.hermes/node/bin/corepack pnpm type-check && ... && ~/.cargo/bin/cargo fmt ..."
```

`~/.hermes/node/bin/corepack`、`~/.cargo/bin/cargo` 是当前作者机器的特定路径，**在 CI、其他贡献者机器、容器中都会失效**。建议改为：

```json
"test:all": "pnpm lint && pnpm type-check && pnpm exec vitest run && pnpm exec vitest run --config vitest.config.integration.ts && cargo fmt --manifest-path src-tauri/Cargo.toml --all --check && cargo test --manifest-path src-tauri/Cargo.toml && cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings"
```

并把 `cargo` 与 `corepack` 视为环境前置（在 CONTRIBUTING / AGENTS.md 的 Prerequisites 中列出）。

## 六、CI / `.github/workflows/`

未详细审查；存在 `ci.yml`、`release.yml`、`security.yml` 三个 workflow，建议下一轮专门做 CI 审查（matrix 矩阵覆盖、dependabot、CodeQL 是否启用）。

## 七、汇总（建议落地优先级）

| ID | 等级 | 建议 PR |
|----|------|---------|
| R-01 | 🔴 | PR-A：修复 manager.rs `event_sender.unwrap()` 潜在 panic |
| R-02 | 🟠 | PR-B：拆分 `core/manager.rs` 第一刀（先把 stats/integrity 抽出）|
| R-03 | 🟡 | PR-C：开启 `clippy::unwrap_used` warn，逐文件治理 |
| R-04 | 🟡 | PR-D：为 `main.rs` 四处 unsafe 补 SAFETY 注释 |
| R-05 | 🟡 | PR-E：yt-dlp 调用前增加 URL scheme 白名单 |
| F-01 | 🟡 | PR-F：拆 `downloadStore` / `schemas/index.ts` |
| F-02 | 🔵 | PR-G：补 `package.json#engines` 和 `AGENTS.md#Prerequisites`（与 NLPM 报告合并）|
| F-03 | 🔵 | PR-H：husky v9 prepare 脚本更新 |
| B-01 | 🟠 | PR-I：移除 `test:all` 中的硬编码绝对路径 |

详见 `docs/reviews/ACTION_PLAN.md`。
