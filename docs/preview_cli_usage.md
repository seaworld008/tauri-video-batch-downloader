# `preview_cli` 使用指南

该 CLI 工具打包在 `src-tauri/bin/preview_cli.rs`，用于在不启动 UI 的情况下快速预览 CSV/Excel 导入文件的表头、编码和样例数据。

## 命令语法

```bash
preview_cli <file-path> [max-rows]
```

- `file-path`（必填）：要预览的 CSV/Excel 文件绝对路径或相对路径。
- `max-rows`（可选）：预览的最大行数，默认为 10 行。

## 输出示例

```text
Headers: ["zl_id", "zl_name", "record_url", "kc_id", "kc_name"]
Total rows: 250
Encoding: UTF-8
Field mapping: {"column_id": 0, "column_name": 1, "video_url": 2, "course_id": 3, "course_name": 4}
Preview rows:
  ["1", "编程基础", "https://example.com/video1.mp4", "101", "Hello World"]
  ["2", "数据结构", "https://example.com/video2.mp4", "102", "算法入门"]
```

如果解析失败，将在 `stderr` 输出错误原因，并返回非零退出码。

## 日志与错误码

- 成功：退出码 `0`。
- 参数不足或解析失败：退出码 `1`，同时打印 `Usage` 或错误信息。

建议在 CI 或手动质检环节调用该工具，以便快速验证导入文件的结构与编码。*** End Patch
