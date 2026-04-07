# Video Downloader Pro — AI Agent 技术导览与上手手册

> 目标读者：后续接手本仓库的 AI Agent（代码修复、排障、扩展功能）。
> 
> 文档目标：让 Agent **快速建立系统级心智模型**，明确哪些模块是关键路径、哪些区域高风险、如何安全改动并验证。

---

## 1. 项目定位与总体架构

这是一个基于 **Tauri v2 + Rust + React + Zustand** 的桌面视频下载工具，核心能力是：

- 批量任务导入（CSV / Excel / 手动 URL / YouTube 列表）
- 多协议下载（HTTP、M3U8、YouTube）
- 任务并发调度、暂停/恢复/取消、失败重试
- 前后端事件同步（Rust 事件 -> 前端任务状态）
- 配置持久化与系统能力检查

### 1.1 分层结构

- **前端层（`src/`）**
  - React UI + Zustand 状态管理
  - 通过 `invoke()` 调用 Tauri 命令
  - 通过事件监听同步下载进度与状态
- **Tauri 命令层（`src-tauri/src/commands/`）**
  - 对外 API 边界（下载、导入、配置、系统、YouTube）
  - 参数校验、错误映射、调用核心模块
- **核心领域层（`src-tauri/src/core/`）**
  - `manager.rs`：任务状态机 + 队列 + 并发控制 + 事件
  - `runtime.rs`：命令路由队列，避免命令线程锁竞争
  - `downloader.rs` / `resume_downloader.rs` / `m3u8_downloader.rs` / `youtube_downloader.rs`：具体下载实现
  - `config.rs`：配置加载、验证、持久化
- **解析层（`src-tauri/src/parsers/` + `core/file_parser.rs`）**
  - CSV/Excel 数据读取、字段映射、编码处理

---

## 2. 启动流程与关键运行链路

## 2.1 前端启动链路

1. `src/main.tsx` 初始化 i18n、React Query、全局错误日志桥接。
2. `App.tsx` 启动时顺序执行：
   - `initializeProgressListener()`（绑定事件监听）
   - `invoke('get_system_info')`（后端可用性探测）
   - 加载配置与下载 store 初始化
3. 初始化成功后渲染 `UnifiedView`。

### 2.2 后端启动链路

`src-tauri/src/main.rs` 关键逻辑：

1. 构建 `AppState`（`DownloadManager` + `HttpDownloader` + `AppConfig` + `DownloadRuntimeHandle`）。
2. Tauri `.setup()` 中执行：
   - `spawn_router_loop(...)`：启动 runtime 命令路由（非常关键）
   - 启动事件桥，将 `DownloadManager` 事件转发到前端事件（如 `download_progress`）
   - 异步调用 `manager.start_with_sender(sender)` 并启动队列调度器
3. 通过 `invoke_handler` 注册命令集。

**设计意图**：把耗时/高冲突下载控制调用统一串行进 runtime router，降低“命令线程直接拿写锁 + await”导致的潜在死锁和卡顿风险。

---

## 3. 核心数据模型（Agent 必须掌握）

核心定义在 `src-tauri/src/core/models.rs`。

## 3.1 任务模型 `VideoTask`

关键字段：

- `id/url/title/output_path/resolved_path`
- `status`（`Pending/Downloading/Paused/Completed/Failed/Cancelled`）
- `progress`（0~1 in Rust 进度结构；前端常按百分比展示）
- `file_size/downloaded_size/speed/eta`
- `error_message`
- `created_at/updated_at/paused_at/paused_from_active`
- `downloader_type`（Http/M3u8/Youtube）

## 3.2 配置模型 `DownloadConfig`

控制并发、重试、超时、UA、输出目录、完整性校验等。配置默认值与持久化逻辑在 `core/config.rs`。

## 3.3 事件模型 `DownloadEvent`

`manager.rs` 中定义了高密度事件：

- 任务生命周期：Created/Started/Progress/Paused/Resumed/Completed/Failed/Cancelled
- 统计与监控：StatsUpdated/SystemMetricsUpdated 等
- 完整性校验与重试事件
- YouTube 特化事件

这些事件会被 `main.rs` 的桥接任务转换并发射到前端。

---

## 4. 下载调度与状态机（最高优先级理解）

## 4.1 `DownloadManager` 的职责边界

`manager.rs` 同时管理：

- 任务存储（`tasks: HashMap<String, VideoTask>`）
- 活跃下载句柄（`active_downloads`）
- 并发限制（`download_semaphore`）
- 队列（`BinaryHeap<TaskPriority>`）
- 事件发送器、统计信息、速率限制
- 状态持久化（state file）

## 4.2 Runtime Router 模式

`runtime.rs` 提供 `RuntimeCommand` 队列（Start/Pause/Resume/Cancel/...），命令端通过 `DownloadRuntimeHandle` 发请求，router 单线程消费并调用 `DownloadManager::runtime_*`。

**这条约束非常重要**：

- 新增下载控制命令时，优先走 runtime router；
- 避免在 Tauri command 中长时间持有 manager 写锁并跨 `.await`。

## 4.3 生命周期核心语义

- **start**：任务进入下载执行，受并发信号量约束。
- **pause**：触发暂停标记并等待下载侧安全退出（含 part 文件落盘）。
- **resume**：恢复暂停任务，优先复用断点。
- **cancel**：取消并清理活跃句柄。
- **start_all/pause_all/resume_all/cancel_all**：批量状态机控制。

---

## 5. 下载器实现分工

## 5.1 `downloader.rs`（HTTP 主下载器）

- 基于 `reqwest` + async 流处理
- 集成 `ResumeDownloader`（断点续传）与 `M3U8Downloader`
- `BandwidthController` 提供全局限速窗口
- 管理 active download flags（cancel/pause）

## 5.2 `resume_downloader.rs`（断点续传）

- 检测服务器 Range 支持（含缓存）
- 分片并行下载与合并
- 续传信息缓存/持久化
- 取消/暂停通过特定错误语义上抛（`download_paused` / `download_cancelled`）

## 5.3 `m3u8_downloader.rs`

- 解析 m3u8 清单与片段
- 并发下载 ts 片段并合并
- 支持 AES-128 解密路径
- 支持临时目录清理策略

## 5.4 `youtube_downloader.rs`

- 基于 `yt-dlp` Rust 封装管理 YouTube 任务
- 管理 format selector、下载状态、二进制安装/更新
- 与通用任务系统存在适配层（事件与状态映射）

---

## 6. 命令接口地图（前后端契约）

`src-tauri/src/main.rs` 注册命令可分组如下：

- 下载控制：`add_download_tasks`、`start_download`、`pause_download`、`resume_download`、`cancel_download`、批量控制等
- 导入：`import_file`、`import_csv_file`、`import_excel_file`、`preview_import_data`、`import_tasks_and_enqueue`
- YouTube：`get_youtube_info`、`get_youtube_formats`、`download_youtube_playlist`
- 配置：`get_config`、`update_config`、`reset_config`、`export_config`、`import_config`
- 系统：`get_system_info`、`open_download_folder`、`show_in_folder`、`check_ffmpeg`、`check_yt_dlp`

### 6.1 前端 Store 的契约处理特征

`src/stores/downloadStore.ts` 特征：

- 状态枚举双向映射（前端小写 <-> 后端 PascalCase）
- 入参与回包都做数据验证/归一化（Zod + dataValidator）
- 任务合并使用“进度回退保护”逻辑，避免事件乱序导致进度倒退
- 通过监听后端事件维护 UI 真值，减少前端乐观写入

---

## 7. UI 结构速览

- 根视图：`UnifiedView`
  - 顶部工具条（设置/关于）
  - 导入面板（手动链接 + 文件导入，可折叠）
  - `DashboardToolbar`
  - `VirtualizedTaskList`（任务量大时优化渲染）
  - 状态栏 + 设置抽屉
- 侧重下载体验统一入口，不再多页面切换。

---

## 8. 配置与持久化

## 8.1 配置

- `AppConfig::load()`：若配置文件不存在，自动生成默认配置。
- `update_config` 命令会：
  1) 验证配置
  2) 写入内存状态
  3) 落盘
  4) 同步更新 `DownloadManager` 配置

## 8.2 下载状态持久化

`DownloadManager` 包含 state file 概念（任务、队列、全局暂停状态）。Agent 做状态逻辑修改时，必须考虑“冷启动恢复”一致性。

---

## 9. 测试资产与验证策略

项目包含前后端测试：

- 前端：Vitest 单测 + integration tests（`src/**/__tests__`）
- 后端：`cargo test`（`src-tauri/src/core/*_tests.rs`）

建议最小验证集：

1. `pnpm exec vitest run`
2. `pnpm exec vitest run --config vitest.config.integration.ts`
3. `cargo test --manifest-path src-tauri/Cargo.toml`

对 manager / resume 相关改动，优先补状态机与并发场景测试（暂停恢复、批量操作、启动时队列补位）。

---

## 10. 当前架构风险点与修复优先建议

以下是从代码现状出发，Agent 应优先关注的风险区。

## 10.1 高风险（并发/一致性）

1. **锁与 await 交织风险**
   - 虽已引入 runtime router，但仍有部分命令直接持 manager 写锁执行业务逻辑。
   - 改动原则：把控制类操作统一路由到 runtime；缩短锁持有时间。

2. **事件乱序与状态回退**
   - 前端已有 progress regression guard，但需持续防止“已完成任务被旧进度覆盖”。

3. **批量删除/取消时状态竞争**
   - 需要确保任务删除与 active handle 清理原子语义。

## 10.2 中风险（实现完整性）

1. `system.rs` 部分能力是占位实现（如 system monitor start/stop）。
2. YouTube 命令层与 `core/youtube_downloader.rs` 可能存在双路径能力，后续应统一入口。
3. 导入字段映射兼容逻辑较多，需特别关注旧字段与空值容错。

## 10.3 可快速修复的代码味道

- `commands/download.rs` 的 `remove_download` 中出现重复写锁获取语句（同一函数两次 `let mut manager = ...`），应清理并补回归测试。

---

## 11. AI Agent 接手开发的推荐流程（SOP）

1. **定位改动类型**：下载控制 / 导入解析 / 配置 / UI。
2. **先读契约**：先看对应 command 与前端 invoke payload（字段命名是否 snake_case / PascalCase）。
3. **识别并发边界**：任何 manager 写操作先判断是否该走 runtime。
4. **做最小改动**：保持单模块闭环，避免跨层顺手重构。
5. **补测试**：至少覆盖 1 条成功路径 + 1 条失败/边界路径。
6. **检查事件一致性**：确认前端最终状态由后端事件或 refresh 收敛。
7. **验证跨平台命令**：涉及外部命令（explorer/open/xdg-open、ffmpeg、yt-dlp）必须考虑 Windows/macOS/Linux。

---

## 12. 常见排障手册（给 Agent 的快速诊断）

## 12.1 “点击开始下载后无反应”

优先排查：

1. `download_manager_ready` 是否发出（后端 setup 初始化是否成功）。
2. runtime router 是否已 spawn（`take_router_rx` 是否被消费）。
3. task 是否真实存在、状态是否为 Pending/Paused。
4. 事件桥是否在转发 `TaskStarted/TaskProgress`。

## 12.2 “暂停后恢复进度清零/回退”

优先排查：

1. 后端 resume 是否正确读取 `.part` 与 resume info。
2. 前端 `mergeTaskWithProgressGuard` 是否被绕过。
3. 任务完成态是否被旧事件覆盖。

## 12.3 “导入成功但任务缺失”

优先排查：

1. `import_tasks_and_enqueue` 是否将导入记录转换为 `VideoTask` 成功。
2. `add_video_task` 是否命中去重复用逻辑。
3. 前端回包验证失败后是否 fallback 到本地数据。

---

## 13. 未来扩展建议（按收益排序）

1. **统一下载命令路径**：所有下载控制只走 runtime router。
2. **完善系统监控命令实现**：让 `start_system_monitor/stop_system_monitor` 真正可控。
3. **统一 YouTube 能力层**：命令层直接复用 `core/youtube_downloader.rs`，避免重复逻辑。
4. **状态机测试矩阵化**：覆盖 Downloading -> Paused -> Resumed -> Completed / Failed / Cancelled 全链路。
5. **事件协议版本化**：为前后端事件 payload 增加版本字段，便于未来演进。

---

## 14. 给 AI Agent 的执行守则（简版）

- **先契约后实现**：先看 `commands/*` 与 `stores/*` 再改代码。
- **先状态机后 UI**：下载问题通常根源在后端状态一致性。
- **避免长锁 await**：尤其是 manager 写锁。
- **不要前端强行改状态**：以后端事件为准。
- **任何下载核心改动必须补测试**。

如果你是接手这个仓库的新 Agent，建议你的第一个任务是：

1. 跑通测试命令；
2. 读 `manager.rs`、`runtime.rs`、`downloadStore.ts`；
3. 画出“命令 -> runtime -> manager -> event -> store”的本地序列图；
4. 再开始第一项功能或 bug 修复。

