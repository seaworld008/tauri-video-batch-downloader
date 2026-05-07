# Tauri Smoke Report - 2026-05-07

本报告记录多平台下载兼容优化工作树上的真实 Tauri App 冒烟结果。

## 环境

- macOS 26.4.1 arm64
- Tauri 2.11.1
- Rust 1.95.0 stable-aarch64-apple-darwin
- Node.js 24.15.0
- pnpm 9.15.0
- Xcode Command Line Tools 已安装；完整 Xcode 未安装

## 已执行

```bash
pnpm tauri info
pnpm tauri dev
pnpm test:tauri-smoke
```

`pnpm tauri dev` 执行了两轮：

1. 冷启动编译成功，真实桌面进程启动，MCP Bridge 监听 `0.0.0.0:9223`。
2. 停止后再次启动成功，增量编译正常，窗口重新出现。

通过 MCP Bridge WebSocket 验证到 dev App 后端状态：

- app identifier：`com.videodownloader.pro`
- app name：`Video Downloader Pro`
- app version：`1.0.0`
- Tauri version：`2.11.1`
- environment：`debug=true`、`os=macos`、`arch=aarch64`
- window_count：`1`
- main window：`visible=true`

通过 MCP Bridge 原生截图确认 dev App UI：

- 截图文件：`/tmp/video-downloader-pro-dev-smoke.png`
- 主界面正常渲染
- 任务数为 0
- 队列处于暂停状态
- 启动后没有自动开始下载

Task 8 已将 MCP Bridge smoke 固化为脚本，并在真实 `pnpm tauri dev`
进程上验证通过：

- 命令：`pnpm test:tauri-smoke`
- app identifier：`com.videodownloader.pro`
- window_count：`1`
- 截图文件：
  `/var/folders/8j/cx515_kn06b837bjfmyv7k9r0000gn/T/video-downloader-pro-tauri-smoke.png`
- 截图大小：`142487` bytes

## 发现

- 当前系统 PATH 中没有 `yt-dlp` 和 `ffmpeg`。
- `src-tauri/binaries/` 当前是 target triple 占位文件，不是正式二进制。
- 因此本轮不能在真实 App 中执行公开视频下载、合并和取消链路；该项转入 Task
  6 的真实 sidecar 发布链完成后复测。
- 机器上同时存在一个此前打开的 Release App 进程。Task 2 的 dev App 验证以 MCP
  Bridge `9223` 后端状态和截图为准，避免混淆窗口。
- MCP Bridge 的 `execute_js` 返回结果依赖 `window.__TAURI__.event.emit`；当前
  `withGlobalTauri=false`，所以默认 smoke 不依赖 JS 注入结果。

## 结论

真实 Tauri dev App 启动、重启、窗口注册、MCP Bridge 后端状态和原生截图冒烟通过。
`pnpm test:tauri-smoke` 已提供可重复脚本化入口。公开视频下载链路因缺少真实
`yt-dlp` / `ffmpeg`
二进制暂未验证，应在 sidecar 发布链完成后作为阻塞验收项补跑。
