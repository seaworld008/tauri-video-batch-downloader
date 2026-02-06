# 架构与模块（Architecture）

## 架构概览

- 前端（React）：负责 UI、状态管理、导入映射与用户交互
- 后端（Rust/Tauri）：负责任务队列、下载执行、文件解析与系统能力

## 关键模块

- `src-tauri/src/core/`：下载核心与运行时
  - `manager.rs`：任务队列与调度
  - `downloader.rs`：下载执行与重试
  - `resume_downloader.rs`：断点续传逻辑
  - `m3u8_downloader.rs`：M3U8 解析与分片
  - `youtube_downloader.rs`：YouTube 解析与下载
- `src-tauri/src/commands/`：Tauri 命令入口
- `src-tauri/src/parsers/`：CSV/Excel 解析

## 数据流（简化）

1. 前端触发导入/开始下载
2. Tauri command 写入任务队列
3. DownloadManager 负责调度并发
4. 进度与状态事件桥接回前端

## 任务状态与排序

- 状态优先级：Downloading > Paused > Pending > Failed > Completed
- UI 列表按状态优先 + 时间

## 本地日志（仅测试包）

- Rust：`tracing` 输出到 `./log/backend.log`
- Frontend：`invoke('log_frontend_event')` 写入 `./log/frontend.log`
