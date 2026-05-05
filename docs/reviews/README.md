# 项目评审报告（2026-05-05）

由 [`nlpm-for-claude`](https://github.com/xiaolai/nlpm-for-claude) v0.7.24 + 静态代码审查 + 自动化工具流水线生成。

## 文档索引

| 文档 | 内容 |
|------|------|
| [NLPM_REPORT.md](./NLPM_REPORT.md) | NLPM 100 分制评分（仅 NL 工件：`AGENTS.md`、`.claude/settings.local.json`）|
| [CODE_REVIEW.md](./CODE_REVIEW.md) | Rust 后端 + 前端 TS/React 代码审查 |
| [SECURITY_REVIEW.md](./SECURITY_REVIEW.md) | Tauri 配置 / CSP / capabilities / 子进程 / 依赖漏洞 |
| [ACTION_PLAN.md](./ACTION_PLAN.md) | 逐 PR 修复路线图 |

## TL;DR

| 维度 | 结果 |
|------|------|
| NLPM 平均分 | **87.5 / 100** |
| TypeScript 类型 | ✅ 通过 |
| ESLint | ✅ 通过 |
| 前端单测 | ✅ 257 / 257 |
| `pnpm audit --prod` | ✅ 0 known vuln |
| Rust 工具链审查 | ⚠️ 评审环境无 `cargo`，建议本地补跑 |
| 高优先级问题 | 🔴 manager.rs `event_sender.unwrap()`、🔴 CSP `'unsafe-eval'` |
| 高架构债 | 🟠 `manager.rs` 4 957 行（违反项目自身 ≤300 行规约 16.5x）|

## 复跑评审

新会话中：

```bash
/nlpm:ls
/nlpm:score
/nlpm:check
/nlpm:security-scan
```

或：

```bash
pnpm install
pnpm type-check && pnpm lint && pnpm exec vitest run
pnpm audit --prod
cargo fmt --manifest-path src-tauri/Cargo.toml --all --check
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```
