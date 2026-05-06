# Roadmap

更新日期：2026-05-06

这份路线图只保留当前仍有价值的后续优化方向。历史阶段计划已经清理；如果未来某个路线项完成，应把结果合并回
`current-state.md` 或对应功能文档，而不是长期保留已完成待办。

---

## P0：下载可靠性

- 补齐下载边界测试：断网、HTTP
  429、无 Range 支持、服务器中断、磁盘权限不足、`.part` 损坏、最终文件已存在。
- 继续强化状态机测试：`Downloading -> Paused -> Resumed -> Completed`、`Failed -> Pending -> Downloading`、`Queued -> Cancelled`。
- 启动恢复保持当前原则：恢复任务和文件状态，但等待用户明确点击开始/恢复。
- 完善重复导入后的任务归类提示，让已完成、可续传、等待、失败任务更容易被用户理解。

## P1：协议与工具链

- 强化 M3U8/HLS：加密 key、相对 segment、直播/超长 playlist、失败 segment 重试。
- 系统化接入 `yt-dlp` 和 `ffmpeg` sidecar，并补齐 macOS/Windows/Linux target
  triple 配置。
- 增加外部工具缺失、版本不兼容、执行失败的诊断提示。

## P2：产品体验

- 增加“上次会话恢复”提示面板，展示哪些任务可继续、哪些已完成、哪些需要重试。
- 增强并发数量修改反馈：调高后立即补位，调低后说明不会强杀已在下载的任务。
- 改进错误报告：一键复制任务诊断、URL、状态、错误码、日志位置。
- 增加任务分组、标签、搜索和批量筛选能力。

## P3：发布与社区

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
