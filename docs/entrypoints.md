# Entrypoints

更新日期：2026-05-06

这份文档说明当前正式入口和主链边界。历史 `simple/minimal/fixed/original`
入口已经清理，不再作为当前产品路径维护。

---

## 1. 正式前端入口

```text
src/main.tsx
-> src/App.tsx
-> src/components/Unified/UnifiedView.tsx
```

职责：

- `src/main.tsx`：挂载 React 根、全局错误处理、Provider。
- `src/App.tsx`：初始化下载事件桥、配置 store、下载 store。
- `UnifiedView.tsx`：承载手动输入、文件导入、任务队列、批量控制、设置入口。

---

## 2. 正式后端入口

```text
src-tauri/src/main.rs
-> commands/*
-> TaskEngine
-> DownloadRuntimeHandle
-> DownloadManager
```

职责：

- `main.rs`：注册 Tauri 插件、commands、runtime loop、event bridge、queue
  scheduler。
- `commands/*`：IPC 命令入口。
- `TaskEngine`：控制命令去重和 ACK。
- `DownloadRuntimeHandle`：串行化进入下载核心。
- `DownloadManager`：任务状态、队列、并发、文件、事件的核心真相源。

---

## 3. 事件入口

当前唯一下载事件信道：

```text
download-events
```

后端常量：

```text
src-tauri/src/infra/event_bus.rs
```

前端监听：

```text
src/features/downloads/state/downloadEventBridge.ts
```

旧的 `download.events` 是历史名称，不再作为当前 Tauri v2 合法事件信道。

---

## 4. 不再维护的历史入口

这些历史入口已经从当前主表面移除：

- `src/main-simple.tsx`
- `src/main-minimal.tsx`
- `vite.config.simple.ts`
- `vite.config.minimal.ts`
- `index-simple.html`
- `index-minimal.html`
- `src-tauri/src/main-simple.rs`
- `src-tauri/src/main-minimal.rs`
- `src-tauri/src/main-fixed.rs`
- `src-tauri/src/main-original.rs`
- `src-tauri/tauri-minimal.conf.json`

后续新增功能应沿正式入口扩展，不要重新引入平行启动链。
