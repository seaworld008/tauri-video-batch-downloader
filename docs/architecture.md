# 架构与模块（Architecture）

> 这是一份基础架构摘要。完整的架构、功能设计、技术决策、状态机和后续路线请阅读
> [`architecture-functional-design.md`](architecture-functional-design.md)。

## 架构概览

- 前端（React）：负责 UI、状态管理、导入映射、完整 `zh-CN`/`en-US`
  国际化、全局键盘快捷键与桌面提示音/原生通知
- 后端（Rust/Tauri + CLI）：负责任务队列、下载执行、文件解析、系统托盘与无头
  `vdpro-cli` 二进制

## 关键模块（Cargo Workspace）

- `src-tauri/crates/vdpro-core`：基础领域模型（`models` / `TaskPriority` /
  `PersistedManagerState`）、`AppConfig`、重试熔断器（`error_handling`）、URL/路径/进程安全辅助、进度统计与哈希完整性校验
- `src-tauri/crates/vdpro-storage`：SQLite
  WAL 持久化状态库（`SqliteStateStore`，支持单任务/批量增量提交及旧
  `download_state.json` 无损迁移）与 `.part` 原子 staging（`PartFileWriter`）
- `src-tauri/crates/vdpro-providers`：多站点平台识别（`platform`）、优先级
  `ProviderRegistry` 路由（`registry`）、MPEG-DASH
  MPD 解析器（`dash_parser`）与共享 `ffmpeg_muxer` 无损混流层
- `src-tauri/src/`（`video-downloader-pro` & `vdpro-cli`）：
  - `infra/tray.rs`：系统托盘菜单、`minimize_to_tray` 与优雅关闭控制
  - `cli/mod.rs` &
    `bin/vdpro_cli.rs`：复用 Rust 核心的无头命令行模式（`download` / `probe` /
    `doctor`）
  - `core/`：DownloadManager 调度器（接入
    `SqliteStateStore`）、传输实现（`downloader` / `resume_downloader` /
    `m3u8_downloader` / `dash_downloader` / `ytdlp_downloader`）与重导出兼容层
  - `commands/` & `parsers/`：Tauri IPC 命令入口与 CSV/Excel 解析

## 数据流（简化）

1. 前端触发导入/添加任务（可附带 `TaskRequestOptions`）与开始下载
2. Tauri command 写入任务队列
3. DownloadManager 负责调度并发与合并配置默认值
4. ProviderRegistry 路由至 HTTP / Resume / M3U8 / DASH / YtDlp Provider 执行下载
5. DownloadEvent 经事件桥接回前端
6. 前端 listener/reducer/store 以事件或 refresh 结果同步 UI

## 下载生命周期

常规任务从 `Pending` 进入队列，队列未暂停且 semaphore 有余量时转为
`Downloading`。暂停请求只发往后端，前端不直接破坏性改为
`paused`；真实状态由后端事件或 `refreshTasks` 同步（终态事件经
`downloadEventBridge` 250ms 防抖刷新，避免并发完成时 IPC 风暴）。完成前会进入
`Committing`，通过单流 `.part` / `.ts.tmp` 分片与
`sync_all()` + 原子重命名写入，生成完成 marker 后再转
`Completed`，这样启动恢复时可以根据 marker 与文件大小 hydrate 已完成文件。

失败任务保留 `error_message`
并在任务行内联显示，同时支持工具栏批量重试 (`retryFailedTasks`) 与行级单个重试/继续/暂停/删除操作；取消或暂停活跃任务会移除 active
handle 并保留暂停上下文以便续传，同时触发队列补位。

## 任务状态与排序

- 状态优先级：Downloading > Paused > Pending > Failed > Completed
- UI 列表按状态优先 + 时间

## 本地日志（仅测试包）

- Rust：`tracing` 输出到 `./log/backend.log`
- Frontend：`invoke('log_frontend_event')` 写入 `./log/frontend.log`
