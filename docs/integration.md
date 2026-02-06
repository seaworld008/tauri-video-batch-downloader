# 对接与数据导入（Integration）

## 批量导入格式

支持 CSV / Excel。字段可在导入预览中映射。

推荐字段（新）：

- `zl_id` / `zl_name`
- `kc_id` / `kc_name`
- `record_url`（视频链接）

兼容字段（旧）：

- `id` / `name`
- `course_id` / `course_name`
- `url`

> 只要包含视频链接字段即可导入，其他字段为可选。

## 自动化对接建议

- 外部系统生成 CSV/Excel 后导入
- 可通过配置导出/导入机制进行批量配置迁移

## 配置文件

配置文件为
`config.json`，位于系统配置目录。不同平台路径略有差异，但均可通过应用内导出/导入完成迁移。

## Tauri 命令（开发对接）

前端/插件可通过 Tauri `invoke` 调用命令：

- 下载：`add_download_tasks` / `start_download` / `pause_download` /
  `resume_download`
- 批量：`pause_all_downloads` / `resume_all_downloads` /
  `start_all_pending_downloads`
- 导入：`import_file` / `preview_import_data` / `import_tasks_and_enqueue`
- 配置：`get_config` / `update_config` / `export_config` / `import_config`
