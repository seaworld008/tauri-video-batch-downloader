# NLPM 报告 — Video Downloader Pro

> 工具：[`nlpm@xiaolai`](https://github.com/xiaolai/nlpm-for-claude) v0.7.24（已通过 `claude plugin install nlpm@xiaolai --scope user` 全局安装）
> 评分日期：2026-05-05
> 评分依据：NLPM 官方 50-Rules 与 100-Point Rubric（来源：插件内置 `skills/nlpm/scoring/SKILL.md`）

## 一、扫描范围（NLPM `discover`）

| 类别 | 命中模式 | 文件 |
|------|----------|------|
| Category B | `.claude/settings.local.json` | `.claude/settings.local.json` |
| 非 NLPM 模式（项目自定义） | — | `AGENTS.md`（按 CLAUDE.md 规则推断评分） |

> NLPM 的官方发现模式不包含 `AGENTS.md`，但本项目使用 `AGENTS.md` 作为多 AI 助手共享指令的等价物，因此按 CLAUDE.md 评分表执行。
> 项目当前**没有** `CLAUDE.md`、`.claude/commands/`、`.claude/rules/`、`skills/`、`agents/`、`hooks/`、`.mcp.json`、`.lsp.json` 等 NLPM 主要目标，因此扫描覆盖面有限。

## 二、评分汇总

| 文件 | 得分 | 等级 | 通过阈值（70）|
|------|------|------|----------------|
| `.claude/settings.local.json` | **100 / 100** | Excellent | ✅ |
| `AGENTS.md` | **75 / 100** | Adequate | ✅ |
| **整体平均** | **87.5** | — | — |

## 三、详评

### 3.1 `.claude/settings.local.json`（100/100）

```json
{
  "permissions": {
    "allow": [
      "WebFetch(domain:github.com)",
      "Bash(claude plugin *)"
    ]
  }
}
```

| 检查项 | 结果 |
|--------|------|
| 有效 JSON | ✅ |
| 无硬编码密钥 | ✅ |
| 无 `bypassPermissions` 滥用 | ✅ |
| 仅含识别字段（`permissions.allow`）| ✅ |
| 无非法 hook 定义 | ✅ |

**结论**：完全合规，无需改动。

### 3.2 `AGENTS.md`（75/100）

**扣分明细：**

| 规则 | 扣分点 | 扣分 |
|------|--------|------|
| — | 无 "Prerequisites / 工具版本" 小节（未列出 Node、pnpm、Rust 工具链版本要求）| -5 |
| R01 | 模糊量词命中 5 处（"relevant" L13、"appropriate" L35、"as needed" L41、"appropriate" L68、"properly" L83）| -10 |
| R37 | 过期文件引用：L89 `src-tauri/capabilities/default.json` —— 实际文件名为 `migrated.json` | -10 |
| **合计** | | **-25** |

**未扣分但建议关注：**

- AGENTS.md 提到 `.codex/`、`graphify-out/`、`.planning/` 为本地工件并已在 `.gitignore` 中（验证通过 `.gitignore:169-171`），不算 stale 引用。
- 长度 90 行，远低于 200 行预算 ✓
- Build/test 命令分散在多处提示（`pnpm tauri dev`、`cargo test`、`vitest`），但缺一个统一的 "How to build / test" 段落。

**修复建议（一并整合到一个 PR 内）：**

1. 把 L89 的 `default.json` 改为 `migrated.json`，或在 `src-tauri/capabilities/` 下重新建立 `default.json` 并迁移内容。
2. 将 `relevant`、`appropriate` 等量词替换为可衡量描述（例如 "files that the current task references" 替代 "relevant files"）。
3. 顶部新增 "Prerequisites" 小节，明确：
   - Node ≥ 20.x（package.json 未 pin engines）
   - pnpm（推荐通过 corepack）
   - Rust stable + `cargo-tauri` v2
   - 平台前置：Windows 需 WebView2，macOS 需 Xcode CLT

## 四、跨制品一致性（`/nlpm:check` 结论）

由于本项目 NL 制品数量 < 2，无 hooks/agents/commands 互相引用，**不存在跨制品冲突**。

## 五、Security Scan（`/nlpm:security-scan` 结论）

`.claude/settings.local.json` 的 `permissions.allow` 仅放行：
- `WebFetch(domain:github.com)` — 限定域名，安全等级良好；
- `Bash(claude plugin *)` — 仅允许 `claude plugin` 子命令，未放行任意 shell。

**无可执行脚本制品，无 hook，无 MCP 配置 → 无可疑风险面。**

## 六、与 NLPM 命令的对应关系

| 等价命令 | 本报告对应章节 |
|----------|----------------|
| `/nlpm:ls` | §一 |
| `/nlpm:score` | §二、§三 |
| `/nlpm:check` | §四 |
| `/nlpm:security-scan` | §五 |

> 实际命令需在新会话 / 重启 Claude Code 后通过 slash 形式 `/nlpm:score` 触发；本报告由人工按相同评分表（`scoring/SKILL.md`）执行。

## 七、结论

整体 NL 工件健康度高（87.5/100），唯一明显问题是 `AGENTS.md` 中一处过期路径与少量模糊量词。建议见 `docs/reviews/ACTION_PLAN.md`。
