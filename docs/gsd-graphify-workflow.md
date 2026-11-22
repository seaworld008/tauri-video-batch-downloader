# GSD + Graphify Workflow

更新日期：2026-11-22

本仓库使用 GSD 管理阶段化执行节奏，使用 Graphify /
GitNexus 辅助大型代码库理解、影响分析和文档校准。

---

## 1. 本地位置

- GSD local runtime：`./.codex/`
- Graphify 输出：`./graphify-out/`
- Graphify 报告：`./graphify-out/GRAPH_REPORT.md`

`.planning/` 和 `graphify-out/` 默认是本地工作流产物（已在 `.gitignore`
中忽略），不随普通提交入库。

---

## 2. 推荐进入流程

```bash
git status -sb
npx gitnexus status
```

接手架构或大范围变更前，先读：

1. `docs/current-state.md`
2. `docs/architecture-functional-design.md`
3. `graphify-out/GRAPH_REPORT.md`（若本地已生成）

---

## 3. Graphify 使用

代码变更后可直接运行 Graphify CLI 更新本地 AST 图谱：

```bash
graphify update .
```

需要结合文档和代码做全量重建或图谱查询时，使用：

```bash
graphify query "<question>"
```

---

## 4. GitNexus 使用

提交前建议分析 staged 影响面：

```bash
npx gitnexus analyze
```

重点关注：

- 下载状态机
- runtime command router
- event bridge
- 导入任务创建和重复识别
- 持久化恢复

---

## 5. GSD 使用原则

- 大功能先规划，再分阶段执行。
- 已完成阶段结论合并回 `docs/current-state.md` 和
  `docs/roadmap.md`，不长期保留过期计划文档。
