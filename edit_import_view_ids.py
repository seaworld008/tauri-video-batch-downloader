from pathlib import Path
path = Path("src/components/Import/ImportView.tsx")
text = path.read_text(encoding="utf-8")
old = "      const createdCount = createdTasks.length;\r\n      const totalRows = importPreview.total_rows;\r\n\r\n      if (createdCount === 0) {\r\n"
if old not in text:
    raise SystemExit("anchor not found")
new = "      const createdCount = createdTasks.length;\r\n      const totalRows = importPreview.total_rows;\r\n\r\n      const newTaskIds = createdTasks.map(task => task.id);\r\n      setLatestImportTaskIds(newTaskIds);\r\n      useDownloadStore.setState({ selectedTasks: newTaskIds });\r\n\r\n      if (createdCount === 0) {\r\n"
text = text.replace(old, new, 1)
path.write_text(text, encoding="utf-8")
