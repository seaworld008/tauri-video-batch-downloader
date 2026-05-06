# 项目介绍（Overview）

更新日期：2026-05-06

Video Downloader Pro 是一款基于 **Rust + Tauri v2 + React 19**
的桌面端批量视频下载工具。它面向课程、资料、媒体归档等真实批量场景，支持从 Excel/CSV 导入链接，统一进入可暂停、可恢复、可观察、可重试的下载队列。

## 适用场景

- 企业或团队批量下载课程、培训资料、视频归档
- 需要从业务系统导出的 CSV/Excel 中批量创建下载任务
- 需要断点续传、并发控制、失败重试和可解释恢复的桌面下载工具
- 需要 macOS、Windows、Linux 跨平台桌面发布基线

## 支持范围

- 协议：HTTP/HTTPS 直链、M3U8/HLS、YouTube 信息与格式相关能力
- 导入：CSV、Excel、字段映射、编码检测、重复导入识别
- 队列：并发控制、全部开始、全部暂停、失败重试、清理完成任务
- 恢复：`.part` 文件、resume 快照、完成 marker、App 重启后可恢复

## 项目结构

- `src/`：React 前端、Zustand 状态、feature-local API/state helpers
- `src-tauri/`：Rust/Tauri 后端、下载核心、IPC commands、事件桥
- `docs/`：当前项目文档
- `graphify-out/`：本地图谱输出，默认不入库

更多细节见：

- `features.md`
- `architecture-functional-design.md`
- `current-state.md`
- `integration.md`
