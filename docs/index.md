# 文档导航

更新日期：2026-05-07

这份目录只保留当前仍应维护的文档。2 月、4 月的一次性计划、过期评审和旧交接记录已经清理；其中仍有价值的结论已合并到
`current-state.md`、`architecture-functional-design.md`、`roadmap.md`、`code-quality.md`
和 AI handoff 文档。

---

## 1. 第一次接手推荐阅读

1. `../README.md` — 项目总览、亮点、快速开始和社区入口
2. `architecture-functional-design.md`
   — 当前完整架构、功能设计、状态机和技术决策
3. `current-state.md` — 当前真实主链、已完成收敛、仍需优化项
4. `large-codebase-ai-handoff-analysis-2026-05-06.md`
   — 面向 AI/新维护者的大型代码库接手报告
5. `app-regression-test-plan-2026-05-06.md` — 真实 App 回归测试方案
6. `roadmap.md` — 当前后续优化路线
7. `code-quality.md` — 当前质量门禁、安全状态和提交前检查

---

## 2. 用户与贡献者文档

| 文档                 | 说明                                         |
| -------------------- | -------------------------------------------- |
| `overview.md`        | 项目介绍与适用场景                           |
| `features.md`        | 功能清单和当前支持范围                       |
| `integration.md`     | CSV/Excel 导入字段、对接建议、Tauri 命令边界 |
| `development.md`     | 本地开发、测试、E2E 和工具版本               |
| `tauri-e2e.md`       | Tauri MCP Bridge 真实桌面 App smoke          |
| `build-release.md`   | 本地测试包、生产包、平台发布说明             |
| `troubleshooting.md` | 日志、WebView2、导入、续传、事件排查         |

---

## 3. 架构与当前事实

| 文档                                               | 说明                           |
| -------------------------------------------------- | ------------------------------ |
| `architecture.md`                                  | 轻量架构摘要                   |
| `architecture-functional-design.md`                | 当前权威架构与功能设计         |
| `current-state.md`                                 | 当前事实源摘要                 |
| `entrypoints.md`                                   | 正式入口、主链和已移除历史入口 |
| `large-codebase-ai-handoff-analysis-2026-05-06.md` | AI/新人接手分析报告            |

---

## 4. 测试、质量与路线

| 文档                                     | 说明                                                       |
| ---------------------------------------- | ---------------------------------------------------------- |
| `app-regression-test-plan-2026-05-06.md` | App 真实导入、并发、暂停、恢复、重复导入、关闭重开回归用例 |
| `code-quality.md`                        | 当前质量门禁、安全状态、GitNexus/Graphify 使用约定         |
| `roadmap.md`                             | P0/P1/P2/P3 后续优化路线                                   |
| `tauri-e2e.md`                           | 真实 Tauri MCP Bridge smoke 运行方式和限制                 |

---

## 5. AI 工作流

| 文档                              | 说明                           |
| --------------------------------- | ------------------------------ |
| `gsd-graphify-workflow.md`        | 本仓库 GSD + Graphify 使用方式 |
| `../AGENTS.md`                    | 所有 AI agent 的项目级工作协议 |
| `../graphify-out/GRAPH_REPORT.md` | 本地图谱报告，默认不入库       |

---

## 6. 维护规则

1. `README.md` 负责对外第一印象和最短路径。
2. `architecture-functional-design.md` 负责系统设计，不写过期计划。
3. `current-state.md` 负责当前事实，不承载历史流水账。
4. `roadmap.md` 负责未来优化，不把已完成旧任务长期保留为待办。
5. `code-quality.md` 负责质量门禁和安全状态。
6. 任何新计划如果已经执行完，应合并回上述事实源后删除计划文件。
7. 文档中出现旧事件名、旧入口、旧版本要求时，必须同步修正或删除。
