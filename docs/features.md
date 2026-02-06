# 功能说明（Features）

## 下载能力

- 多协议支持：HTTP/HTTPS、M3U8、YouTube
- 高并发下载：可配置并发任务数
- 断点续传：支持暂停/恢复与失败重试
- 速率与统计：速度、ETA、完成统计

## 批量导入

- CSV / Excel 导入
- 导入预览 + 字段映射
- 支持兼容旧字段（见对接文档）

## 任务管理

- 状态管理：pending / downloading / paused / completed / failed / cancelled
- 批量操作：全部开始、全部暂停、全部取消
- 失败重试与清理

## YouTube 支持

- 获取视频信息与格式
- 可配置默认清晰度与字幕选项

## 配置管理

- UI/下载/系统/高级配置
- 支持导出与导入配置

## 可观测性（本地测试包）

- 前端日志：`./log/frontend.log`
- 后端日志：`./log/backend.log`
- 生产包默认关闭日志落地
