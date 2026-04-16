# Entrypoints and Legacy Paths

**Updated:** 2026-04-15

这份文档专门回答一个问题：

> 当前这个仓库里，哪些入口是正式主链，哪些只是历史残留、调试路径或过渡产物？

---

## 1. 正式主入口（Authoritative Entrypoints）

这些文件应被视为**当前正式主链**。

### Frontend
- `src/main.tsx`
  - 当前正式前端入口
  - 负责挂载 React 根、ThemeProvider、QueryClient、ErrorBoundary，并初始化下载进度监听

- `src/App.tsx`
  - 当前正式应用壳层
  - 负责初始化配置、store、后端连接检查，并渲染主应用

- `src/components/Unified/UnifiedView.tsx`
  - 当前正式主视图
  - 组织手动输入、文件导入、批量控制和任务列表的主界面

### Backend
- `src-tauri/src/main.rs`
  - 当前正式 Tauri / Rust 入口
  - 负责启动应用状态、注册 commands、接好 runtime router 和 event bridge

---

## 2. 当前正式主链

### 前端主链
```text
src/main.tsx
  -> src/App.tsx
  -> src/components/Unified/UnifiedView.tsx
  -> stores / invoke / listen
```

### 后端主链
```text
src-tauri/src/main.rs
  -> commands/*
  -> TaskEngine
  -> DownloadRuntime
  -> DownloadManager(runtime_*)
  -> downloader implementations
  -> DownloadEvent
  -> main.rs event bridge
```

---

## 3. 历史 / 调试 / 过渡入口（Not Authoritative）

这些文件说明仓库曾经历多轮排障、简化启动或实验性路径，但它们**不应继续被默认视为当前产品主链**。

### 已移除的 Frontend 历史入口
- `src/main-simple.tsx`
- `src/main-minimal.tsx`
- `vite.config.simple.ts`
- `vite.config.minimal.ts`
- `index-simple.html`
- `index-minimal.html`

### 已移除的 Backend / Tauri 历史入口
- `src-tauri/src/main-simple.rs`
- `src-tauri/src/main-minimal.rs`
- `src-tauri/src/main-fixed.rs`
- `src-tauri/src/main-original.rs`
- `src-tauri/tauri-minimal.conf.json`

---

## 4. 为什么这些文件现在是问题

这些历史入口本身不一定“错误”，但它们会持续造成几个问题：

1. **误导认知**
   - 新人或 AI agent 会误以为这些文件仍是可选正式入口
2. **放大 graphify 图谱碎片化**
   - 多个 main / simple / minimal 社区会污染主架构理解
3. **阻碍 Phase 1 清理**
   - 如果不先明确权威入口，后续难以安全归档或删除旧路径
4. **文档更容易再次漂移**
   - README 和 docs 容易一边写主入口，一边仓库里仍躺着多套“看似主入口”的文件

---

## 5. 目前对这些历史入口的处理策略

当前阶段已经完成：
- 明确标记它们不是权威主链
- 清理主文档中的默认引用
- 将这些历史入口从当前仓库主表面移除

---

## 6. 给后续开发者 / AI agent 的规则

### 你应该默认使用
- `src/main.tsx`
- `src/App.tsx`
- `src/components/Unified/UnifiedView.tsx`
- `src-tauri/src/main.rs`

### 你不应该默认基于它们继续开发主功能
- `src/main-simple.tsx`
- `src/main-minimal.tsx`
- `src-tauri/src/main-simple.rs`
- `src-tauri/src/main-minimal.rs`
- `src-tauri/src/main-fixed.rs`
- `src-tauri/src/main-original.rs`
- `vite.config.simple.ts`
- `vite.config.minimal.ts`
- `index-simple.html`
- `index-minimal.html`

如果后续需要追溯这些历史入口，只应把它们视为历史背景，而不是当前正式主链。
