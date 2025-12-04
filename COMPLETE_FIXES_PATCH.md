# 下载管理核心修复 - 完整补丁

本文档包含3个关键修复，用于解决下载进度显示、状态识别和队列处理问题。

## 修复 1: task_status_changed 状态映射 (最关键)

### 位置
第 1623-1658 行

### 问题
后端返回 `"Downloading"`, `"Paused"` (首字母大写)，前端期望 `"downloading"`, `"paused"` (全小写)

### 修复前
```typescript
const { task_id, status, error_message } = payload;
```

### 修复后
```typescript
const { task_id, status: rawStatus, error_message } = payload;

// ✅ 使用状态映射函数，确保前后端状态一致
const status = fromBackendStatus(rawStatus);

console.log(`🔄 任务 ${task_id} 状态变化: ${rawStatus} → ${status}`);
```

---

## 修复 2: startAllDownloads 任务优先级排序

### 位置
第 753-779 行

### 问题
没有对待下载任务进行优先级排序

### 添加代码 (在第 769 行 `return;` 后添加)
```typescript
// 按进度排序,优先继续已有进度的任务
const sortedPendingTasks = [...pendingTasks].sort((a, b) => {
  // 1. 优先下载已有进度的任务 (paused > failed > pending)
  const statusPriority: Record<TaskStatus, number> = {
    paused: 0,
    failed: 1,
    pending: 2,
    downloading: 3,
    completed: 4,
    cancelled: 5
  };
  const statusDiff = statusPriority[a.status] - statusPriority[b.status];
  if (statusDiff !== 0) return statusDiff;

  // 2. 同状态下,进度高的优先
  return (b.progress || 0) - (a.progress || 0);
});

console.log('📋 开始下载队列:', sortedPendingTasks.map(t => ({
  id: t.id.substring(0, 8),
  title: t.title,
  status: t.status,
  progress: Math.round(t.progress || 0) + '%'
})));
```

### 修改
将 `pendingTasks` 替换为 `sortedPendingTasks`：
- 第 771 行: `get().enqueueDownloads(sortedPendingTasks.map(task => task.id));`
- 第 775 行: `? \`已提交 ${sortedPendingTasks.length} 个选中任务到队列\``
- 第 776 行: `: \`已提交 ${sortedPendingTasks.length} 个任务到队列\`;`

---

## 修复 3: processStartQueue 错误处理

### 位置
第 851-862 行

### 问题
当任务启动返回 `'queued'` 时直接 `return`，导致后续任务无法处理

### 修复前
```typescript
for (const taskId of toStart) {
  const result = await get().startDownload(taskId, {
    enqueueOnLimit: false,
    suppressConcurrencyToast: true,
  });
  if (result === 'queued') {
    set(current => ({
      pendingStartQueue: current.pendingStartQueue.includes(taskId)
        ? current.pendingStartQueue
        : [taskId, ...current.pendingStartQueue],
    }));
    return;  // ❌ 提前退出
  }
}
```

### 修复后
```typescript
for (const taskId of toStart) {
  try {
    const result = await get().startDownload(taskId, {
      enqueueOnLimit: false,
      suppressConcurrencyToast: true,
    });
    if (result === 'queued') {
      // 重新入队但继续处理其他任务
      set(current => ({
        pendingStartQueue: current.pendingStartQueue.includes(taskId)
          ? current.pendingStartQueue
          : [taskId, ...current.pendingStartQueue],
      }));
      break;  // ✅ 跳出 for 循环，但继续 while 循环
    }
  } catch (error) {
    console.error(`❌ 启动任务 ${taskId} 失败:`, error);
    // 继续处理下一个任务
  }
}
```

---

## 如何应用

请按照以下步骤手动应用这些修复，或使用 IDE 的查找替换功能。

## 预期效果

✅ 任务状态正确识别  
✅ 进度、速度、ETA 正常显示  
✅ 暂停的任务优先恢复  
✅ 并发下载控制正确  
✅ 队列处理稳定可靠
