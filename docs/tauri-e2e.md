# Tauri E2E Smoke

更新日期：2026-05-07

真实桌面 App 回归不能由普通浏览器或 jsdom 替代。涉及 Tauri
IPC、sidecar 进程、窗口状态或原生截图时，应使用 Tauri dev App + MCP Bridge。

## 运行方式

先在一个终端启动真实 App：

```bash
pnpm tauri dev
```

等日志出现 MCP Bridge 监听端口后，在另一个终端运行：

```bash
pnpm test:tauri-smoke
```

默认连接：

```text
ws://127.0.0.1:9223
```

如果端口不同：

```bash
pnpm test:tauri-smoke -- --url ws://127.0.0.1:9224
```

## 覆盖内容

`scripts/tauri-mcp-smoke.mjs` 会通过 MCP Bridge 验证：

- 后端状态可读取。
- App identifier 是 `com.videodownloader.pro`。
- App name 是 `Video Downloader Pro`。
- 至少有一个 Tauri window。
- `main` window 已注册且可见。
- 原生截图能返回 PNG data URL，并写入本地文件。

默认截图输出：

```text
/tmp/video-downloader-pro-tauri-smoke.png
```

只检查后端和窗口状态、不截图：

```bash
pnpm test:tauri-smoke -- --skip-screenshot
```

## 当前限制

- 该 smoke 不依赖 Chrome DevTools，不打开普通浏览器。
- `execute_js` 暂不作为默认断言，因为当前 App 设置 `withGlobalTauri=false`，MCP
  Bridge 的 JS result bridge 会超时。
- 公开视频下载、取消和合并仍需要真实 `yt-dlp` / `ffmpeg`
  sidecar 或可信本地工具。
