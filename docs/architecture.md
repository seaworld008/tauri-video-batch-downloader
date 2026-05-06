# 架构与模块（Architecture）

> 这是一份基础架构摘要。完整的架构、功能设计、技术决策、状态机和后续路线请阅读
> [`architecture-functional-design.md`](architecture-functional-design.md)。

## 架构概览

- 前端（React）：负责 UI、状态管理、导入映射与用户交互
- 后端（Rust/Tauri）：负责任务队列、下载执行、文件解析与系统能力

## 关键模块

- `src-tauri/src/core/`：下载核心与运行时
  - `manager.rs`：DownloadManager 主类型、任务生命周期入口与兼容 API
  - `manager/queue.rs`：入队、出队、队列调度与 semaphore 收敛
  - `manager/stats.rs`：统计聚合、progress/lifecycle duration 指标
  - `manager/integrity.rs`：expected hash 与完整性校验配置/执行
  - `manager/events.rs`：DownloadEvent 发送辅助
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
4. downloader/resume/m3u8/youtube provider 执行下载
5. DownloadEvent 经事件桥接回前端
6. 前端 listener/reducer/store 以事件或 refresh 结果同步 UI

## 下载生命周期

常规任务从 `Pending` 进入队列，队列未暂停且 semaphore 有余量时转为
`Downloading`。暂停请求只发往后端，前端不直接破坏性改为
`paused`；真实状态由后端事件或 `refreshTasks` 同步。完成前会进入
`Committing`，写入完成 marker 后再转
`Completed`，这样启动恢复时可以根据 marker 与文件大小 hydrate 已完成文件。

失败任务必须保留 `error_message`，`retryFailedTasks`
会把失败任务重新提交到下载队列。取消或暂停活跃任务会移除 active
handle，并触发队列补位，避免 active download 清理时丢失等待队列状态。

## 任务状态与排序

- 状态优先级：Downloading > Paused > Pending > Failed > Completed
- UI 列表按状态优先 + 时间

## 本地日志（仅测试包）

- Rust：`tracing` 输出到 `./log/backend.log`
- Frontend：`invoke('log_frontend_event')` 写入 `./log/frontend.log`
