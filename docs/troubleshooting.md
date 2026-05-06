# 排查与日志（Troubleshooting）

更新日期：2026-05-06

## 日志位置

本地测试包：

- 后端：`./log/backend.log`
- 前端：`./log/frontend.log`

生产包默认不落地本地日志。

## 常见问题

### Windows WebView2 缺失

Windows 启动失败时，先确认 WebView2
runtime 已安装。发布包应保留 WebView2 检测与引导路径。

### E2E 驱动不匹配

如果 `msedgedriver` 与 WebView2 版本不一致：

- `E2E_FORCE=true`：临时跳过版本校验
- `E2E_WEBVIEW2_VERSION=144.x.x`：手动指定版本
- `TAURI_DRIVER_PATH`：指定 tauri-driver

### 暂停后无法恢复

优先检查：

- 任务是否仍处于 `Paused` 或可恢复状态
- `.part` 文件是否存在且大小合理
- 日志中是否有权限、Range、网络或写入错误
- 是否使用了“全部开始”恢复队列

### 重复导入后任务数量不符合预期

重复导入会把已存在/已完成/可续传任务归类，而不是盲目重复创建。请查看导入完成摘要。

### 事件桥报错

当前下载事件信道必须是 `download-events`。如果日志中出现旧的 `download.events`
emit/listen 错误，说明代码或文档引用了历史信道，需要更新。

## 反馈问题时请提供

- 操作系统与版本
- 应用版本或 commit
- 复现步骤
- 测试数据字段示例
- 日志片段
- 是否存在 `.part` 文件或最终文件
