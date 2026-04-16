# Video Downloader Pro

一个基于 **Tauri v2 + Rust + React** 的跨平台桌面批量视频下载器，当前重点不是“从零搭建”，而是让既有下载主链在 **批量导入、任务编排、断点续传、状态同步、架构收敛** 上持续稳定演进。

> 当前仓库已经具备前后端主代码、导入与下载链路、测试资产、graphify 图谱分析以及 GSD 规划上下文。现在最重要的工作不是推倒重写，而是把现有能力收敛成更稳定的一套正式架构与开发流程。

---

## 目录

- [1. 项目简介](#1-项目简介)
- [2. 当前状态概览](#2-当前状态概览)
- [3. 核心能力](#3-核心能力)
- [4. 当前架构主链](#4-当前架构主链)
- [5. 项目结构（真实现状）](#5-项目结构真实现状)
- [6. 快速开始（本地开发）](#6-快速开始本地开发)
- [7. 持续迭代工作流（GSD + graphify）](#7-持续迭代工作流gsd--graphify)
- [8. 常用开发命令](#8-常用开发命令)
- [9. 测试与质量保障](#9-测试与质量保障)
- [10. 文档导航](#10-文档导航)
- [11. 当前优先事项](#11-当前优先事项)

---

## 1. 项目简介

**Video Downloader Pro** 是一个桌面端批量视频下载器，核心关注点不是“单次下载”，而是：

1. **任务编排能力**：同时管理多个下载任务及其状态流转
2. **复杂下载链路可靠性**：支持断点续传、M3U8 分片、失败重试、批量操作
3. **前后端状态一致性**：通过 Tauri 命令与事件桥接，维持后端 truth 与前端 UI 同步
4. **可持续演进**：在不推倒重来的前提下，持续收敛架构边界与工作流

适用场景包括：

- 批量课程视频/媒体资源下载
- 需要 CSV / Excel 导入的内容运营场景
- 对下载状态可控、可暂停恢复、可观察有要求的桌面应用场景

---

## 2. 当前状态概览

这个仓库当前属于 **brownfield 持续收敛阶段**：

### 已经具备
- 后端下载主链已存在
- 前端主 UI 路径已存在
- 导入、下载、基础配置、测试资产已存在
- graphify 图谱与 GSD 规划上下文已接入

### 仍需收敛
- 多入口/历史入口尚未完全清理
- 后端写路径尚未完全统一
- 前端同步仍存在 event + refresh + polling 三轨并存
- `DownloadManager` 与 `downloadStore.ts` 仍偏大
- 文档与实现还需要进一步对齐

如果要看更详细的“当前真实状态”，请先读：
- `docs/current-state.md`

---

## 3. 核心能力

### 3.1 下载能力
- HTTP/HTTPS 常规资源下载
- M3U8/HLS 分片下载与合并
- YouTube 信息获取、格式查询、播放列表解析相关能力
- 断点续传（Resume）与失败重试
- 速率限制与下载统计

### 3.2 任务管理能力
- 新增/删除任务
- 单任务：开始、暂停、恢复、取消
- 批量：全部开始、全部暂停、全部恢复、全部取消、失败重试
- 已完成任务清理

### 3.3 导入能力
- CSV / Excel 导入
- 导入预览、字段映射、编码检测
- 导入后直接转为下载任务

### 3.4 规划与分析能力
- graphify 图谱分析
- GSD 规划上下文与 phase 路线图
- 可持续的架构分析与阶段推进工作流

---

## 4. 当前架构主链

### Frontend 主链
```text
App.tsx
  -> UnifiedView
  -> ManualInputPanel / FileImportPanel / DashboardToolbar
  -> downloadStore / configStore
  -> invoke / listen
  -> contracts + reducers
  -> Zustand state
  -> UI render
```

### Backend 主链
```text
commands/download.rs
  -> TaskEngine
  -> DownloadRuntime
  -> DownloadManager(runtime_*)
  -> downloader / resume / m3u8 / youtube
  -> DownloadEvent
  -> main.rs event bridge
  -> frontend
```

### 当前主要问题
当前不是“没有架构”，而是“架构迁移进行中，但还没完全收尾”。

如果你要深入理解当前链路，建议阅读：
- `docs/plans/2026-04-15-download-core-call-chain-analysis.md`
- `docs/plans/2026-04-15-backend-write-path-boundary-map.md`
- `graphify-out/GRAPH_REPORT.md`

---

## 5. 项目结构（真实现状）

```text
.
├── src/                            # 前端 React / Zustand / feature modules
│   ├── components/                 # 页面与业务组件
│   ├── features/                   # 逐步收敛中的 feature 层（如 downloads contracts/reducers）
│   ├── stores/                     # 当前状态管理中心
│   ├── hooks/                      # 自定义 hooks
│   ├── schemas/                    # 结构与校验
│   ├── types/                      # 类型定义（部分仍与 schemas 并存）
│   └── utils/                      # 前端工具函数
├── src-tauri/                      # 后端 Rust + Tauri
│   ├── src/commands/               # Tauri 命令入口
│   ├── src/core/                   # 下载核心逻辑（manager/runtime/downloader 等）
│   ├── src/engine/                 # TaskEngine 等控制层
│   ├── src/infra/                  # 事件总线/能力提供者等基础设施层
│   ├── src/parsers/                # 文件解析器
│   └── src/utils/                  # 后端工具模块
├── docs/                           # 项目文档
├── scripts/                        # 开发辅助脚本（含 graphify sync）
├── graphify-out/                   # 本地图谱分析产物（git ignored）
├── .planning/                      # GSD 项目规划上下文（git ignored）
├── .codex/                         # 本地 GSD Codex runtime 文件
```

### 注意
仓库里曾存在多套历史入口/调试入口文件；simple / minimal 以及旧的 backend main 变体现在已从当前仓库主表面移除，不应再被视为当前正式主链。

---

## 6. 快速开始（本地开发）

### 6.1 环境要求
- Node.js >= 18（当前环境已可运行更高版本）
- pnpm >= 8
- Rust stable
- Windows 需安装 WebView2 Runtime

### 6.2 安装依赖
```bash
pnpm install
```

### 6.3 启动开发模式（Tauri 桌面）
```bash
pnpm dev
```

### 6.4 构建应用
```bash
pnpm build
```

---

## 7. 持续迭代工作流（GSD + graphify）

这个项目现在使用：

- **Hermes**：作为总控编排器，负责技能加载、长期记忆、执行与环境级工作流
- **GSD**：管理规划、phase、执行与评审
- **graphify**：维护代码图谱上下文与架构理解

当前推荐的技能分层是：
- `hermes-graphify-gsd-nonintrusive-workflow`：全局非侵入集成与升级策略
- `hermes-graphify-gsd-project-integration`：仓库级接线与工作流落地
- `gsd-graphify-brownfield-bootstrap`：当 `.planning/` 需要真实建立/重建时的 brownfield bootstrap

### 推荐入口命令
```bash
./scripts/ai-workflow.sh doctor
./scripts/ai-workflow.sh context
./scripts/ai-workflow.sh sync
./scripts/graphify-sync.sh force
./scripts/graphify-sync.sh serve
```

### GSD 相关上下文
- 本地 Codex runtime：`./.codex/`
- 规划上下文：`./.planning/`（注意：它是独立的 brownfield planning 基线，不由普通 repo 接入步骤隐式生成）

### 推荐迭代节奏
1. `./scripts/ai-workflow.sh doctor`
2. `./scripts/ai-workflow.sh context`
3. 阅读 `graphify-out/GRAPH_REPORT.md`
4. 如果 `.planning/` 已存在，阅读 `.planning/ROADMAP.md` 和 `.planning/STATE.md`
5. 在 GSD 中推进 phase / plan / execute
6. 改完代码后再次 `./scripts/ai-workflow.sh sync`

详细说明见：
- `docs/gsd-graphify-workflow.md`
- `docs/non-invasive-ai-workflow.md`
- `docs/plans/2026-04-15-hermes-graphify-gsd-skills-finalization-summary.md`
- `.planning/research/ITERATION-LOOP.md`（如果 `.planning/` 已存在）

---

## 8. 常用开发命令

```bash
# 启动
pnpm dev

# 仅前端开发预览
pnpm vite

# 代码检查
pnpm lint
pnpm type-check

# 前端测试
pnpm test
pnpm test:integration
pnpm test:coverage

# 后端测试
cargo test --manifest-path src-tauri/Cargo.toml

# 全量质量门禁
pnpm test:all
```

---

## 9. 测试与质量保障

项目采用“前后端双测试栈”：

- 前端：Vitest（组件 / 集成）
- 后端：cargo test（核心模块、状态机、集成测试）

当前更关键的不是“有没有测试”，而是：
- 测试边界要与真实架构边界对齐
- 后续重构要优先补：
  - 下载生命周期状态流转
  - 统一写路径
  - 前端事件驱动状态同步

对下载核心改动（尤其 `manager.rs`、`resume_downloader.rs`）建议优先补：
- Downloading -> Paused -> Resumed -> Completed
- Downloading -> Failed -> Retry -> Completed
- 批量操作与并发限制一致性

---

## 10. 文档导航

优先阅读：

- `docs/current-state.md`
- `docs/index.md`
- `docs/entrypoints.md`
- `docs/gsd-graphify-workflow.md`
- `docs/plans/2026-04-15-system-architecture-optimization-plan.md`
- `docs/plans/2026-04-15-download-core-call-chain-analysis.md`

如果是做架构收敛或 brownfield 迭代，建议同时阅读：
- `.planning/PROJECT.md`
- `.planning/REQUIREMENTS.md`
- `.planning/ROADMAP.md`
- `graphify-out/GRAPH_REPORT.md`

---

## 11. 当前优先事项

当前阶段最重要的不是加新功能，而是进入 **Phase 3 / Frontend State and Event Convergence**：

- 抽离前端 download event bridge 与 reducer 接线层
- 继续收敛 `downloadStore.ts` 的职责
- 推进 `configStore` 成为唯一配置真源
- 把前端同步模型从 event + refresh + polling 三轨并存继续压缩成更单一的主链

当前系统优化路线见：
- `docs/plans/2026-04-15-system-architecture-optimization-plan.md`
- `docs/plans/2026-04-15-backend-write-path-boundary-map.md`
