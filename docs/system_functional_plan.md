# 系统功能增强执行计划（基于 context7 指南）

> 说明：以下计划依据 `docs/system_functional_review.md` 中的建议，并按 **context7 MCP 工具** 的要求拆分为可执行任务。每个任务包含目标、步骤、依赖与验收标准，方便逐项落实。

## 阶段 2：M3U8/HLS 功能加强

### 任务 2.1：实现 `#EXT-X-BYTERANGE` 支持
- **状态**：✅ 已完成（2025-11-14）
- **结果摘要**：播放列表解析记录 `byte_range` 偏移，下载阶段按 Range 头精确读取并输出片段范围日志。
- **目标**：在解析与下载流程中识别并应用字节范围，确保支持 HTTP 分片。
- **步骤**
  1. `parse_m3u8_playlist` 解析 `#EXT-X-BYTERANGE:<len>@<start>`（无 `@` 则继承上次结束偏移），填充 `M3U8Segment.byte_range`。
  2. `download_segment_static` 根据 byte range 设置 `Range` header，并确保写入的文件只包含期望字节。
  3. 更新日志，输出当前分片的 range 以便排查。
- **依赖**：现有 `M3U8Segment` 结构已包含 `byte_range` 字段，无需新增 crate。
- **验收**：本地构造带 `#EXT-X-BYTERANGE` 的 playlist，确认分片下载成功且无重复/缺失字节。

### 任务 2.2：实现 AES-128 解密
- **状态**：✅ 已完成（2025-11-14）
- **结果摘要**：增加密钥缓存、IV 推导与 AES-128-CBC 解密流程，下载后即时解密写盘并捕获密钥获取日志。
- **目标**：对 `#EXT-X-KEY` 指定的加密分片进行解密，支持常见 `METHOD=AES-128`。
- **步骤**
  1. 在 `Cargo.toml` 引入 `aes` + `cbc` + `cipher`（或 `openssl`）依赖。
  2. `M3U8Encryption` 增加解密所需的 `key_data`、`iv_bytes` 缓存。
  3. `fetch_encryption_key` 下载 KEY 后缓存，并支持本地/远程 URI。
  4. 每个分片下载后，根据 KEY/IV 在内存中执行 AES-CBC 解密，再写入文件。
  5. 对未提供 IV 的情况，根据规范使用 `segment_index`（或媒体序列号）生成 16 字节大端 IV。
- **依赖**：任务 2.1 完成后可直接使用；需要 `tokio` + 新增加密 crate。
- **验收**：准备一个需要 AES-128 解密的 .m3u8，确保合并结果可播放，并在日志中确认密钥获取/解密成功。

### 任务 2.3：真实下载速度与进度统计
- **状态**：✅ 已完成（2025-11-14）
- **结果摘要**：`DownloadStats` 以真实字节和 `Instant` 计算速度/ETA，确保 UI 展示与实际下载一致。
- **目标**：为 HLS 下载提供可靠的速度与进度数据，替换临时写死值。
- **步骤**
  1. 在 `download_segments` 中使用 `AtomicU64` 记录实际写入字节数，`Instant` 记录开始时间。
  2. 在每次分片完成后根据 `(下载字节 / elapsed)` 计算瞬时速度，并通过 `progress_tx` 发送。
  3. 将 `DownloadStats.downloaded_bytes/total_bytes` 设置为真实值（可根据 `segment_files` 累加）。
- **依赖**：建立在任务 2.1/2.2 完成的基础上，确保数据准确。
- **验收**：UI 或日志显示的速度与文件大小一致，且 ETA 合理。

### 任务 2.4：错误恢复与临时文件管理
- **状态**：✅ 已完成（2025-11-14）
- **结果摘要**：Range 失败与解密异常会输出包含 URL/偏移/状态码的日志，并按照 `keep_temp_files` 精准保留或清理分片目录。
- **目标**：提高 HLS 下载在异常场景下的可诊断性及可恢复性。
- **步骤**
  1. 对 Range 请求 404、解密失败等场景补充详细日志和错误码。
  2. 下载失败时提供选项保留临时分片，便于复现问题。
  3. 在成功合并后按 `keep_temp_files` 配置清理分片目录。
- **验收**：触发失败场景时日志包含 URL、HTTP 状态、分片索引等信息；配置 `keep_temp_files=true` 时分片被保留。

## 阶段 3：YouTube 下载真实化

### 任务 3.1：外部二进制管理（yt-dlp / ffmpeg）
- **状态**：✅ 已完成（2025-11-14）
- **结果摘要**：`YoutubeDownloaderConfig` 新增可选二进制路径，默认会在 `libs` 目录下自动安装/更新 yt-dlp 与 ffmpeg，并支持禁用自动安装时的显式提示。
- **目标**：在系统启动或首次使用时确保依赖的外部工具就绪。
- **步骤**
  1. `YoutubeDownloaderConfig` 增加 `yt_dlp_path`、`ffmpeg_path` 可选项。
  2. 在 `YoutubeDownloader::new` 中检测二进制是否存在；若 `auto_install_binaries = true` 则自动下载对应平台的 release。
  3. 下载后校验文件哈希/版本号，并放置在 `libraries_dir`。
- **验收**：清空 libs 目录后运行，确认可自动下载并记录日志；若禁用 auto install 则给出明确提示。

### 任务 3.2：真实的视频信息获取
- **状态**：✅ 已完成（2025-11-14）
- **结果摘要**：通过 yt-dlp crate 获取真实 JSON，映射所有格式/码率字段到 `YoutubeVideoInfo`/`YoutubeFormat`，并对非法 URL、网络异常返回结构化 `AppError`。
- **目标**：用 `yt-dlp -J <url>` 获得真实的格式/信息数据并映射到 `YoutubeVideoInfo`。
- **步骤**
  1. 使用 `tokio::process::Command` 执行 `yt-dlp`, 捕获 JSON 输出。
  2. 解析 JSON，填充 `YoutubeVideoInfo`、`YoutubeFormat`（格式列表等）。
  3. 对常见错误（网络、认证）进行分类并返回 `AppError::Download`。
- **验收**：对真实 YouTube 链接调用 API，能返回完整信息；错误场景日志可见。

### 任务 3.3：视频/音频下载执行
- **状态**：✅ 已完成（2025-11-14）
- **结果摘要**：`download_video` 依据 `YoutubeDownloadFormat` 选择实际格式，委托 yt-dlp 提供的 `DownloadManager` 下载，实时更新 `YoutubeDownloadStatus` 并回调 UI 进度。
- **目标**：将 `download_video`、`download_audio` 等接口连接真实的 yt-dlp 下载，并与 `DownloadManager` 事件联动。
- **步骤**
  1. 根据 `YoutubeDownloadFormat` 构造 yt-dlp 命令（`--format`, `--output`, `--audio-format` 等）。
  2. 从 yt-dlp 的 stdout/stderr 解析进度（例如匹配 `frame=`、`ETA`），并映射到 `DownloadEvent::TaskProgress`。
  3. 下载完成后将文件路径写入 `DownloadTask`，触发 `TaskCompleted`；失败时填充 `error_message` 并提供是否重试的信息。
- **验收**：能够下载至少一个完整视频/音频，UI 端能收到实时进度更新。

### 任务 3.4：取消/重试与并发控制
- **状态**：✅ 已完成（2025-11-14）
- **结果摘要**：为每个任务保存 `DownloadManager` 句柄，可在 `cancel_download` 中精准终止；并发数由 `ManagerConfig` 绑定 `max_concurrent_downloads`，状态清理同步释放句柄。
- **目标**：支持中途取消 YouTube 下载，并限制最大并发数。
- **步骤**
  1. 为每个 yt-dlp 进程保存 `Child` 句柄，在 `cancel_download` 时发送 kill 信号。
  2. 使用 `Semaphore` 控制并发，`max_concurrent_downloads` 通过配置调整。
  3. 对失败任务支持 `retry_failed`，复用 `DownloadManager` 现有逻辑。
- **验收**：同时发起多任务时总数不超过配置；取消操作后进程终止，任务状态转为 `Cancelled`。

### 任务 3.5：文档与测试
- **状态**：✅ 已完成（2025-11-14）
- **结果摘要**：新增 `docs/youtube_downloader_usage.md`、README 链接与系统评审更新，并补充 `youtube_downloader.rs` 的 JSON 模拟单元测试，覆盖映射与格式选择逻辑。
- **目标**：保障新功能的可维护性。
- **步骤**
  1. 在 `docs/` 中新增 `youtube_downloader_usage.md`，说明依赖、配置、常见错误。
  2. 添加集成测试（可通过 `yt-dlp --simulate` 或 mock 方式）验证命令拼装。
  3. 更新 `README` & `system_functional_review.md` 的进度表。
- **验收**：CI/本地可运行相关测试，文档覆盖安装与使用步骤。

---

执行顺序建议：先完成阶段 2（HLS），再进入阶段 3（YouTube）。每个任务完成后更新 `docs/system_functional_review.md` 与 `download_feature_audit.md`，同步进度并记录新的验证命令。*** End Patch
