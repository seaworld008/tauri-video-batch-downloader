# 行动计划 — 修复路线图

> 生成日期：2026-05-05
> 来源：`NLPM_REPORT.md` + `CODE_REVIEW.md` + `SECURITY_REVIEW.md`
> 原则：每个 PR 单一关注点、可独立 review、可独立回滚。

## 一、PR 序列（按建议合并顺序）

### PR-A 🔴 修复 manager.rs `event_sender` 潜在 panic
- 改动文件：`src-tauri/src/core/manager.rs`
- 改动量：≤30 行
- 风险：低
- 验证：`cargo test --manifest-path src-tauri/Cargo.toml`
- 详情：见 `CODE_REVIEW.md` R-01。

### PR-B 🟠 拆分 `core/manager.rs` 第一刀
- 目标：把 stats 聚合 + integrity（`expected_hashes`、`set_expected_hash`/`remove_expected_hash`/`get_expected_hashes`）抽出为子模块 `core/manager/integrity.rs`，主文件减约 200~400 行
- 风险：中（涉及可见性调整）
- 验证：`cargo test`、`cargo clippy -- -D warnings`、应用回归（启动 + 启动一次下载）
- 后续 PR：继续拆 queue / pause-resume / event-dispatch

### PR-C 🟡 启用 `clippy::unwrap_used` (warn)
- 改动文件：`src-tauri/src/lib.rs` / 各模块顶部 `#![warn(clippy::unwrap_used, clippy::expect_used)]`
- 改动量：≤10 行（先打开开关，警告先入流水线，不阻塞）
- 后续：分文件治理（`downloader.rs`、`resume_downloader.rs`...）

### PR-D 🟡 为 main.rs 四处 `unsafe` 块补 SAFETY 注释
- 改动文件：`src-tauri/src/main.rs:397/510/521/532`
- 改动量：~40 行注释
- 风险：极低（纯文档）

### PR-E 🟡 yt-dlp / youtube-dl 调用前增加 URL scheme 白名单
- 改动文件：`src-tauri/src/commands/system.rs`、可能新增 `src-tauri/src/utils/url_validator.rs`
- 风险：低
- 验证：新增单测覆盖 `http://`、`https://`、`file://`、`ftp://`、`javascript:` 五种 scheme

### PR-F 🟡 拆 `downloadStore.ts` / `schemas/index.ts`
- 改动文件：`src/stores/downloadStore.ts`（→ slice 模式）、`src/schemas/index.ts`（→ 按领域分文件 + re-export）
- 风险：中（需保持对外导出接口不变）
- 验证：`pnpm type-check && pnpm lint && pnpm exec vitest run`

### PR-G 🔵 文档完善：`AGENTS.md` Prerequisites + `package.json#engines`
- 改动文件：`AGENTS.md`（顶部新增 Prerequisites 段；修正 `capabilities/default.json` → `migrated.json`；替换 5 处模糊量词）、`package.json`（`engines: { node: ">=20", pnpm: ">=9" }`）
- 风险：极低（纯文档/元数据）
- **此 PR 同时关闭 NLPM 报告中 -25 的所有扣分点**

### PR-H 🔵 husky v9 prepare 脚本更新
- 改动文件：`package.json`、可能 `.husky/_/`
- 改动：`"prepare": "husky install"` → `"prepare": "husky"`，并按 v9 文档调整 hook 执行入口
- 风险：低

### PR-I 🟠 `test:all` 移除硬编码绝对路径
- 改动文件：`package.json`
- 改动：详见 `CODE_REVIEW.md` B-01
- 风险：低；但要求执行环境已有 `cargo`、`pnpm` 在 PATH（在 README/AGENTS.md 的 Prerequisites 中明示）

### PR-CSP 🔴 收紧 CSP（移除 `unsafe-eval` + 去重）
- 改动文件：`src-tauri/tauri.conf.json`、可能 `src-tauri/tauri.conf.local.json`
- 改动：见 `SECURITY_REVIEW.md` S-01 / S-02
- 风险：中（可能破坏 dev HMR），**必须在 dev + prod 双场景下手动验证**
- 建议：先开新 issue 让用户决策（dev 是否需要保留 unsafe-eval 在 local 配置中）

### PR-CI（可选）🟢 CI 增强
- 在 `.github/workflows/security.yml` 加：
  - `cargo install cargo-audit && cargo audit --manifest-path src-tauri/Cargo.toml`
  - `pnpm audit --prod --audit-level=high`
- 在 `.github/workflows/ci.yml` 启 matrix：`{ os: [ubuntu-latest, macos-latest, windows-latest], node: [20] }`
- 风险：低（仅 CI 改动）

## 二、本次 PR 仅落地"评审报告"

为避免一次性大量代码改动，本仓库当前 PR（`chore/project-review-nlpm`）**只新增 4 份评审文档**：

```
docs/reviews/
├── NLPM_REPORT.md
├── CODE_REVIEW.md
├── SECURITY_REVIEW.md
└── ACTION_PLAN.md
```

后续 PR-A ~ PR-CSP 应在这一 PR 合并后，**逐个独立 PR** 提交。

## 三、建议的 issue 模板

合并本 PR 后建议批量开 9 个 issue，标题如下：

```
[Review/PR-A] Fix potential panic on event_sender unwrap in manager.rs
[Review/PR-B] Split core/manager.rs (Step 1: extract integrity submodule)
[Review/PR-C] Enable clippy::unwrap_used as warn
[Review/PR-D] Document SAFETY invariants on unsafe blocks in main.rs
[Review/PR-E] Validate URL scheme before passing to yt-dlp / youtube-dl
[Review/PR-F] Split downloadStore.ts and schemas/index.ts into focused modules
[Review/PR-G] Add Prerequisites section to AGENTS.md + package.json engines
[Review/PR-H] Migrate husky to v9 prepare script
[Review/PR-I] Remove hardcoded absolute paths from test:all script
[Review/PR-CSP] Tighten CSP — remove unsafe-eval, dedupe connect-src
[Review/PR-CI] Add cargo-audit and OS matrix to CI
```

## 四、跑通命令清单（建议在 CONTRIBUTING.md 或 AGENTS.md 加入）

```bash
# Frontend
pnpm install
pnpm type-check
pnpm lint
pnpm exec vitest run
pnpm exec vitest run --config vitest.config.integration.ts

# Backend
cargo fmt --manifest-path src-tauri/Cargo.toml --all --check
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml

# Security
pnpm audit --prod
cargo audit --manifest-path src-tauri/Cargo.toml   # 需先 cargo install cargo-audit

# Tauri 整体
pnpm tauri dev    # IPC 测试需要图形会话
pnpm tauri build  # 生产打包验证
```

## 五、报告复读建议

- 本次报告基于静态阅读 + 自动化工具，未运行 `cargo` 系列；**强烈建议**用户在本地补跑 clippy / cargo-audit，并把结果增量并入本次 PR。
- NLPM 命令 `/nlpm:score`、`/nlpm:check`、`/nlpm:security-scan` 在新 Claude Code 会话中可直接调用，**用户可自行复跑确认与本报告打分一致**。
