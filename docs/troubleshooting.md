# 排查与日志（Troubleshooting）

## 日志位置（本地测试包）

- 后端：`./log/backend.log`
- 前端：`./log/frontend.log`

> 生产包默认不落地日志。

## 常见问题

### 1) WebView2 缺失

Windows 启动失败时先确认 WebView2 已安装。

### 2) e2e 驱动不匹配

若 `msedgedriver` 与 WebView2 版本不一致：

- 临时跳过校验：`E2E_FORCE=true`
- 或指定版本：`E2E_WEBVIEW2_VERSION=144.x.x`

### 3) 下载暂停后无法恢复

确保使用“全部开始”优先恢复暂停任务；必要时查看日志中任务状态是否正确流转。

### 4) 导入失败

检查 CSV/Excel 字段映射是否包含视频链接字段（`record_url` 或 `url`）。

## 反馈问题时请提供

- 操作系统与版本
- 应用版本
- 复现步骤
- 日志（本地测试包）
