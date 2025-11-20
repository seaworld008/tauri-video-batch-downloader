# 视频批量下载全量实现计划

本文档列出了将当前占位/未完成功能落地为真实可用下载能力的完整路线图，以阶段划分任务，便于逐步交付。

## 阶段 0 · 基线与依赖
- [ ] **梳理现状**：整理 HTTP/M3U8/YouTube/命令/测试中所有 TODO、占位实现与现存缺陷，对应输出对照表。
- [ ] **确定外部依赖策略**：明确 `yt-dlp`、`ffmpeg` 等二进制在开发/打包环境中的提供方式（随包带入或运行时下载），并更新脚本。

## 阶段 1 · HTTP 下载器与调度补强
- [ ] **ResumeDownloader 进度桥接**：让分片/断点续传的实时进度通过回调同步到 `DownloadTask`，确保 UI 能看到大文件状态。
- [ ] **速率/并发控制与失败重试**：落实 `DownloadManager` 中关于暂停、速率限制、`retry_failed_tasks` 等 TODO，使命令层 API 完整可用。
- [ ] **清理旧 downloader stub**：移除 `src-tauri/src/downloaders` 目录下的 `Simple*` 占位实现，统一走 `core` 下的新 downloader，减少混淆。

## 阶段 2 · M3U8 / HLS 完整方案
- [ ] **分片增强**：在 `M3U8Downloader` 中补全分片字节范围、AES-128 解密、速度统计与错误重试策略。
- [ ] **临时文件管理**：统一 M3U8 下载过程中的临时目录/文件，确保异常情况下可恢复或自动清理。
- [ ] **HttpDownloader 集成**：让 `smart_download` 的 M3U8 分支具备生产可用的错误处理与进度反馈。

## 阶段 3 · YouTube 下载真实落地
- [ ] **yt-dlp 集成**：封装 `yt-dlp` 或等效库，负责下载器初始化、版本检查以及二进制安装/更新。
- [ ] **真实下载实现**：在 `youtube_downloader.rs` 中完成 `download_video / download_audio / download_thumbnail` 的实际下载流程，解析进度输出并写入统一目录。
- [ ] **任务调度融合**：将 YouTube 任务纳入 `DownloadManager` 队列与事件体系，前端可统一显示/控制。
- [ ] **命令能力补齐**：让 `commands/youtube.rs` 的 info/format/playlist 调用都能返回真实数据，并在缺省时给出明确的降级提示。

## 阶段 4 · 命令层与前端交互
- [ ] **下载命令完善**：补齐 `commands/download.rs` 中的批量暂停/恢复、失败重试、清理逻辑，确保前端 `useDownloadStore` 的动作都有真实响应。
- [ ] **任务类型支持**：为任务模型新增下载类型（HTTP/M3U8/YouTube），前端基于类型展示差异化控制项。
- [ ] **通知与错误反馈**：统一错误码与提示，提供“失败原因 + 操作建议”，提高可观测性。

## 阶段 5 · 测试与工具链
- [ ] **Rust 测试修复**：重写/删除依赖旧接口的 integration tests，新增针对 HTTP/M3U8/YouTube 的单元或 mock 集成测试，保证 `cargo test` 可通过。
- [ ] **Vitest 修复**：更新 store hooks 的 mock 写法，恢复 `ImportView` 等前端用例，并补充导入→下载的关键路径测试。
- [ ] **CI/脚本支持**：在 CI 或本地脚本中检查 `yt-dlp`/`ffmpeg` 的可用性，必要时提供 mock，确保自动化环境稳定。

## 阶段 6 · 文档与发布
- [ ] **文档更新**：同步 `README / SETUP_GUIDE / DEV_GUIDE` 等，说明新增依赖、配置项与命令。
- [ ] **依赖安装脚本**：提供 Windows/macOS/Linux 的安装或打包脚本，确保 `yt-dlp` 等工具随应用可用。
- [ ] **回归验证**：完成手动 + 自动回归，覆盖 CSV/Excel 导入、HTTP/M3U8/YouTube 下载、暂停/恢复/失败重试等全链路。

完成上述阶段后，将获得一套从导入到多协议下载完整闭环、具备真实执行能力的桌面应用。每个阶段结束时应输出：代码实现、测试结果以及必要的文档/脚本更新，以便下一阶段顺利衔接。
