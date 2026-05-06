# 对接与数据导入（Integration）

更新日期：2026-05-06

## 批量导入格式

支持 CSV / Excel。字段可以在导入预览中映射，只要能识别视频链接字段即可创建任务。

推荐字段：

- `zl_id` / `zl_name`
- `kc_id` / `kc_name`
- `record_url`

兼容字段：

- `id` / `name`
- `course_id` / `course_name`
- `url`

## 重复导入行为

导入同一份表格时，应用应识别：

- 新增任务
- 已存在任务
- 已完成任务
- 可续传任务
- 等待或失败任务

这样用户可以继续下载未完成内容，而不是重复创建一批无法区分的任务。

## 自动化对接建议

- 外部系统导出 CSV/Excel 后交给应用导入。
- 保持链接字段稳定，业务字段可以作为任务标题、课程、分组等元信息。
- 不建议直接改写应用内部状态文件；配置迁移请使用应用内导出/导入。

## 开发命令边界

前端通过 feature-local API wrappers 调用 Tauri commands，不建议组件直接散落
`invoke(...)`。

主要命令类别：

- 下载：`add_download_tasks`、`start_download`、`pause_download`、`resume_download`
- 批量：`start_all_downloads`、`pause_all_downloads`、`retry_failed_tasks`
- 导入：`import_file`、`preview_import_data`
- 配置：`get_config`、`update_config`、`export_config`、`import_config`
