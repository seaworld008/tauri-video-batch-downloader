# Video Downloader Pro

一个基于 **Tauri v2 + Rust + React**
的跨平台桌面批量视频下载工具，面向“高并发任务管理 + 断点续传 + 多来源导入 + 可观测性”场景设计。

> 当前仓库已包含前后端主代码、导入解析链路、下载调度核心、系统命令桥接、测试与文档体系，可直接用于二次开发与企业内网定制。

---

## 目录

- [1. 项目简介](#1-项目简介)
- [2. 核心能力](#2-核心能力)
- [3. 技术架构](#3-技术架构)
- [4. 项目结构](#4-项目结构)
- [5. 快速开始（本地开发）](#5-快速开始本地开发)
- [6. 简单使用指南](#6-简单使用指南)
- [7. 配置说明](#7-配置说明)
- [8. 常用开发命令](#8-常用开发命令)
- [9. 测试与质量保障](#9-测试与质量保障)
- [10. 故障排查](#10-故障排查)
- [11. 构建与发布](#11-构建与发布)
- [12. 研发约定（重要）](#12-研发约定重要)
- [13. 文档导航](#13-文档导航)
- [14. 许可证](#14-许可证)

---

## 1. 项目简介

**Video Downloader Pro**
是一个桌面端批量视频下载器，核心关注点不是“单次下载”，而是：

1. **任务编排能力**：可同时管理多个下载任务及状态流转（Pending / Downloading /
   Paused / Failed / Completed / Cancelled）。
2. **复杂下载链路可靠性**：支持断点续传、M3U8 分片、失败重试、批量操作。
3. **可维护可扩展**：前后端通过 Tauri 命令与事件桥接，便于拆分模块和逐步升级。

该项目适合：

- 批量课程视频/媒体资源下载；
- 需要导入 CSV/Excel 的内容运营团队；
- 对“下载状态可控、可暂停恢复、可监控”有明确要求的场景。

---

## 2. 核心能力

### 2.1 下载能力

- HTTP/HTTPS 常规资源下载
- M3U8/HLS 分片下载与合并
- YouTube 信息获取、格式查询、播放列表解析
- 断点续传（Resume）与失败重试
- 速率限制与下载统计

### 2.2 任务管理能力

- 新增/删除任务
- 单任务：开始、暂停、恢复、取消
- 批量：全部开始、全部暂停、全部恢复、全部取消、失败重试
- 已完成任务清理

### 2.3 导入能力

- CSV / Excel 导入
- 导入预览、字段映射、编码检测
- 导入后可直接入队下载

### 2.4 配置与系统能力

- 应用配置读取/更新/重置/导入/导出
- 选择下载目录
- 检查 `ffmpeg` / `yt-dlp` 可用性
- 打开下载目录、在文件管理器中定位文件

---

## 3. 技术架构

## 3.1 架构分层

- **前端（React 19 + Zustand + Vite）**
  - 负责 UI、用户交互、状态管理、命令调用、事件消费
- **Tauri 命令层（Rust）**
  - 提供 `invoke` 命令入口（下载、导入、系统、配置、YouTube）
- **核心领域层（Rust Core）**
  - `DownloadManager`：任务状态机、队列、并发控制、统计
  - `DownloadRuntime`：命令路由队列，统一状态迁移入口
  - `HttpDownloader` / `ResumeDownloader` / `M3U8Downloader` /
    `YoutubeDownloader`
- **解析层**
  - CSV / Excel / 编码检测 / 字段映射

## 3.2 关键数据流

1. 前端触发命令（`invoke`）
2. 命令层调用核心模块执行业务
3. 核心模块产出事件（进度/状态）
4. Tauri 事件桥发回前端
5. Zustand Store 合并任务并刷新 UI

---

## 4. 项目结构

```text
.
├── src/                          # 前端 React
│   ├── components/               # 页面与业务组件
│   ├── stores/                   # Zustand 状态管理
│   ├── hooks/                    # 自定义 hooks
│   ├── schemas/                  # 前端数据结构与校验
│   └── utils/                    # 工具函数（错误处理/桥接/格式化）
├── src-tauri/                    # 后端 Rust + Tauri
│   ├── src/commands/             # Tauri 命令入口
│   ├── src/core/                 # 下载核心逻辑
│   ├── src/parsers/              # 文件解析器
│   ├── src/utils/                # 后端工具模块
│   └── tauri.conf.json           # Tauri 配置
├── docs/                         # 项目文档
└── scripts/                      # 开发与构建辅助脚本
```

---

## 5. 快速开始（本地开发）

## 5.1 环境要求

- Node.js >= 18
- pnpm >= 8
- Rust（建议 stable 最新）
- Windows 需安装 WebView2 Runtime

## 5.2 安装依赖

```bash
pnpm install
```

## 5.3 启动开发模式（Tauri 桌面）

```bash
pnpm dev
```

## 5.4 构建应用

```bash
pnpm build
```

---

## 6. 简单使用指南

这是一个“3 分钟上手”的基础流程。

## 6.1 添加任务

你有两种方式：

1. **手动添加链接**：在输入面板中粘贴一个或多个 URL。
2. **批量导入**：导入 CSV/Excel，预览后映射字段并入队。

## 6.2 开始下载

- 点击单任务“开始”，或使用“全部开始”。
- 下载中可随时暂停；暂停后可恢复。

## 6.3 查看状态

每个任务会展示：

- 当前状态（下载中/已暂停/已完成/失败等）
- 进度、速度、已下载大小、预计剩余时间
- 错误信息（若失败）

## 6.4 常见操作

- **失败重试**：批量重试失败任务
- **清理完成**：清除已完成任务，保持列表整洁
- **打开目录**：直接打开下载输出目录

---

## 7. 配置说明

应用配置支持读取、更新、重置、导出、导入。重点项：

- `concurrent_downloads`：并发下载数
- `retry_attempts`：失败重试次数
- `timeout_seconds`：网络请求超时
- `output_directory`：下载输出目录
- `user_agent`：下载请求 UA
- `proxy`：代理配置（可选）

建议：

- 普通网络环境并发 `3~5` 较稳；
- 弱网或限流场景适当降低并发并增加重试间隔；
- 输出目录使用本地可写路径，避免权限问题。

---

## 8. 常用开发命令

```bash
# 启动
pnpm dev

# 仅前端开发预览
pnpm vite

# 代码检查
pnpm lint
pnpm type-check

# 前端测试
pnpm test
pnpm test:integration
pnpm test:coverage

# 后端测试
cargo test --manifest-path src-tauri/Cargo.toml

# 全量质量门禁
pnpm test:all
```

---

## 9. 测试与质量保障

项目采用“前后端双测试栈”：

- 前端：Vitest（组件/集成）
- 后端：cargo test（核心模块、状态机、集成测试）

建议提交流程：

1. `pnpm lint`
2. `pnpm type-check`
3. `pnpm exec vitest run`
4. `cargo test --manifest-path src-tauri/Cargo.toml`

对下载核心改动（`manager.rs`、`resume_downloader.rs`）建议强制补测试：

- 状态流转：Downloading -> Paused -> Resumed -> Completed
- 异常流转：Downloading -> Failed -> Retry -> Completed
- 批量操作与并发限制一致性

---

## 10. 故障排查

## 10.1 启动失败

- Windows 检查 WebView2 是否安装
- 检查 Rust/Node/pnpm 版本
- 查看终端日志定位初始化失败点

## 10.2 下载没有进度

- 检查 URL 是否可访问
- 检查是否被目标站点限流（429）
- 检查输出目录权限
- 检查任务是否实际进入 `Downloading`

## 10.3 M3U8 下载异常

- 检查 m3u8 地址是否过期
- 检查分片是否可访问
- 检查是否涉及加密密钥拉取失败

## 10.4 YouTube 相关异常

- 确认 `yt-dlp` 可用
- 确认 `ffmpeg` 可用
- 某些区域/网络环境可能需要代理

---

## 11. 构建与发布

常用命令：

```bash
# 标准构建
pnpm build

# 本地日志版本构建
pnpm build:local

# 生产构建
pnpm build:prod
```

发布前建议：

- 先执行测试与静态检查
- 验证核心下载流程（手动 URL / 文件导入 / 暂停恢复 / 失败重试）
- 验证 Windows/macOS 下外部依赖可用性（ffmpeg / yt-dlp）

---

## 12. 研发约定（重要）

1. 下载状态以**后端为单一真值**，前端避免激进乐观更新。
2. 新增下载控制逻辑，优先走 runtime router。
3. 避免在持有 manager 锁时执行长链路 await。
4. 任何核心下载逻辑改动必须补测试。
5. 保持跨平台兼容（Windows 与 macOS 同优先级）。

---

## 13. 文档导航

完整文档位于 `docs/`：

- `docs/index.md`：文档入口
- `docs/overview.md`：项目概览
- `docs/features.md`：功能清单
- `docs/architecture.md`：架构说明
- `docs/development.md`：开发与测试
- `docs/build-release.md`：构建发布
- `docs/troubleshooting.md`：排障

面向 AI Agent 的专项文档：

- `docs/ai-agent-technical-guide.md`
- `docs/code-review-2026-04-07.md`

---

## 14. 许可证

本项目当前仓库标注为 MIT（以 `src-tauri/Cargo.toml`
为准）。如需用于商业分发，请在发布前确认所有第三方依赖许可证与二进制分发合规性。
