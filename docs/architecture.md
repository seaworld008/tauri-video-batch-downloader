# 架构与模块（Architecture）

> 这是一份基础架构摘要。完整的架构、功能设计、技术决策、状态机和后续路线请阅读
> [`architecture-functional-design.md`](architecture-functional-design.md)。

## 架构概览

- 前端（React）：负责 UI、状态管理、导入映射、完整 `zh-CN`/`en-US`
  国际化、全局键盘快捷键与桌面提示音/原生通知
- 后端（Rust/Tauri + CLI）：负责任务队列、下载执行、文件解析、系统托盘与无头
  `vdpro-cli` 二进制

## 关键模块

- `src-tauri/src/infra/tray.rs`：系统托盘菜单、`minimize_to_tray` 与优雅关闭控制
- `src-tauri/src/cli/mod.rs` &
  `src-tauri/src/bin/vdpro_cli.rs`：复用 Rust 核心的无头命令行模式（`download` /
  `probe` / `doctor`）
- `src-tauri/src/core/`：下载核心与运行时
  - `manager.rs`：DownloadManager 主类型、任务生命周期入口与兼容 API
  - `manager/queue.rs`：入队、出队、队列调度与 semaphore 收敛
  - `manager/stats.rs`：统计聚合、progress/lifecycle duration 指标
  - `manager/integrity.rs`：expected hash 与完整性校验配置/执行
  - `manager/events.rs`：DownloadEvent 发送辅助
  - `download_provider.rs`：`DownloadProviderSpec` Trait 与优先级
    `ProviderRegistry`
  - `downloader.rs`：统一下载调度、作用域请求构造与单流下载
  - `resume_downloader.rs`：HTTP Range 分片断点续传（支持作用域 `Client` 覆盖）
  - `m3u8_downloader.rs`：HLS/M3U8 解析、Master Playlist 选流、fMP4
    INIT 与 AES-128 解密
  - `dash_parser.rs` & `dash_downloader.rs`：MPEG-DASH
    MPD 解析、分片断点与双轨下载
  - `ffmpeg_muxer.rs`：单轨重封装与音视频无损混流公共层
  - `ytdlp_downloader.rs` & `ytdlp_support.rs`：统一多站点 `yt-dlp`
    适配与安全参数构造
- `src-tauri/src/commands/`：Tauri 命令入口
- `src-tauri/src/parsers/`：CSV/Excel 解析

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
