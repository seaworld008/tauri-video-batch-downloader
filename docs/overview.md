# 项目介绍（Overview）

Video Downloader Pro 是一款基于 Rust + Tauri +
React 的桌面端视频批量下载器，目标是提供稳定、高效、可扩展的多协议下载体验，并支持批量导入与断点续传。

## 适用场景

- 企业/团队批量下载课程、资料、视频归档
- 需要导入 CSV/Excel 数据进行批量任务处理
- 对下载性能、稳定性、可观测性有要求的场景

## 支持范围

- 协议：HTTP/HTTPS 直链、M3U8、YouTube
- 平台：Windows / macOS / Linux（Tauri）
- 导入：CSV、Excel（字段可映射）

## 项目结构概览

- 前端：`src/`（React + Zustand + React Query）
- 后端：`src-tauri/`（Rust + Tokio + Tauri Commands）
- 文档：`docs/`

更多细节请见：

- 功能：`features.md`
- 架构：`architecture.md`
- 对接：`integration.md`
