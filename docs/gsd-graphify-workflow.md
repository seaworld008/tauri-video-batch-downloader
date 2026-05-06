# GSD + Graphify Workflow

更新日期：2026-05-06

本仓库使用 GSD 管理阶段化执行节奏，使用 Graphify/GitNexus 辅助大型代码库理解、影响分析和文档校准。

---

## 1. 本地位置

- GSD local runtime：`./.codex/`
- Graphify 输出：`./graphify-out/`
- Graphify 报告：`./graphify-out/GRAPH_REPORT.md`
- Graphify 同步脚本：`./scripts/graphify-sync.sh`
- 统一工作流入口：`./scripts/ai-workflow.sh`

`.planning/` 和 `graphify-out/` 默认是本地工作流产物，不随普通提交入库。

---

## 2. 推荐进入流程

```bash
git status -sb
./scripts/ai-workflow.sh doctor
./scripts/ai-workflow.sh context
```

接手架构或大范围变更前，先读：

1. `graphify-out/GRAPH_REPORT.md`
2. `docs/current-state.md`
3. `docs/architecture-functional-design.md`
4. `docs/large-codebase-ai-handoff-analysis-2026-05-06.md`

---

## 3. Graphify 使用

代码变更后可用：

```bash
./scripts/graphify-sync.sh smart
```

文档或语义理解发生明显变化时，使用强制刷新：

```bash
./scripts/graphify-sync.sh force
```

服务本地图谱：

```bash
./scripts/graphify-sync.sh serve
```

---

## 4. GitNexus 使用

提交前建议分析 staged 影响面：

```text
detect_changes(scope="staged")
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
- 新下载核心行为必须 test-first。
- 每个阶段完成后，同步 README、`docs/index.md`、`docs/current-state.md` 和
  `docs/roadmap.md`。
- 历史计划执行完后不长期保留，结论合并进当前事实源。
