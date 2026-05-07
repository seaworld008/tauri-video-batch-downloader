# Roadmap

更新日期：2026-05-07

这份路线图只保留当前仍有价值的后续优化方向。历史阶段计划已经清理；如果未来某个路线项完成，应把结果合并回
`current-state.md` 或对应功能文档，而不是长期保留已完成待办。

---

## P0：下载可靠性

- 已补齐第一批下载边界测试：HTTP 429、服务器截断响应、输出路径冲突、Range
  416、Range ignored。
- 已补强：`.part` 过大时隔离为 `.corrupt-*` 并重下，`.part`
  截断时按实际长度回收分片进度。
- 继续补齐：断网中途重试、最终文件已存在和更接近真实磁盘权限不足的跨平台场景。
- 已补强：服务端忽略 Range 时安全重下，不追加污染本地 `.part`。
- 继续强化状态机测试：`Downloading -> Paused -> Resumed -> Completed`、`Failed -> Pending -> Downloading`、`Queued -> Cancelled`。
- 启动恢复保持当前原则：恢复任务和文件状态，但等待用户明确点击开始/恢复。
- 完善重复导入后的任务归类提示，让已完成、可续传、等待、失败任务更容易被用户理解。

## P1：协议与工具链

- 已抽离：`DownloadProviderRouter`
  统一负责 M3U8、直链媒体、社媒网页和 HEAD 后 HTML 页面的 provider 选择，避免新增平台规则牵动 HTTP
  Range/M3U8 主路径。
- 继续强化 M3U8/HLS：直播/超长 playlist、失败 segment 重试。
- 已补强：M3U8 相对 segment、相对 key URI、byte-range
  Range 响应校验、同一 playlist 多 AES key 下载与缓存。
- 已接入：通用 `YtDlp`
  provider，覆盖 YouTube、TikTok、Instagram、Facebook 和未知复杂网页。
- 已预留：`yt-dlp` 平台 host registry，新增平台时集中扩展 host 规则和 schema。
- 已接入：`yt-dlp` / `ffmpeg` sidecar 配置、工具状态探测、`yt-dlp`
  手动更新、兼容性契约检查和回退。
- 已拆分：external tools service 按 registry/resolver/status/update/config
  store 分层，后续更新/回滚策略变化不再集中修改单个大模块。
- 已接入：严格 sidecar 发布预检，覆盖 macOS/Windows/Linux target
  triple、capability、可执行权限和占位文件拦截。
- 已接入：`sidecars:prepare` 发布准备链路，release runner 会在打包前准备真实
  `yt-dlp` / `ffmpeg` sidecar 并严格校验。
- 待完成：替换或确认项目最终采用的 `ffmpeg`
  可信分发来源后补跑真实公开视频下载回归。
- 已补强：`yt-dlp`
  App 管理更新最终替换失败时自动恢复旧版本；设置页解释自动更新、兼容性探测、回退和
  `ffmpeg` 可信本地文件手动更新流程。
- 继续增加外部工具缺失、版本不兼容、执行失败、checksum 失败、回退失败的诊断提示。

## P2：产品体验

- 已增加“上次会话恢复”状态条，展示可继续、等待、失败、已完成任务，并提供继续、重试失败、清理完成入口。
- 增强并发数量修改反馈：调高后立即补位，调低后说明不会强杀已在下载的任务。
- 已改进错误报告：任务列表可一键复制任务诊断，包含 URL、状态、错误分类、平台信息、输出路径和日志位置。
- 增加任务分组、标签、搜索和批量筛选能力。

## P3：发布与社区

- 已新增：`pnpm risk:gitnexus` 本地风险门禁，普通 PR 默认不允许 `critical`
  影响面；核心迁移需显式放行并说明验证范围。
- 已建立真实 Tauri MCP Bridge
  smoke，避免只靠普通浏览器或 jsdom；后续补下载链路 E2E。
- 补充真实截图、短视频或 demo GIF。
- 添加明确 License。
- 完善 Windows/Linux release 验证说明。
- 定期刷新 Graphify/GitNexus 摘要，避免架构文档再次漂移。
- 持续维护 issue labels、issue templates、PR template 和贡献说明。

---

## 执行原则

1. 下载核心行为必须 test-first。
2. 涉及事件契约时，Rust/TypeScript schema 和前端 reducer 测试必须同步更新。
3. 涉及持久化或断点续传时，必须覆盖关闭重开和本地文件不一致场景。
4. 涉及 UI 状态时，前端不抢写后端真相状态。
5. 每轮完成后同步更新 README、`docs/index.md`、`docs/current-state.md`
   和本路线图。
