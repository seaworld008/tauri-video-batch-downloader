# 代码问题审查报告

## 发现的问题

### 🔴 严重问题 1: task_status_changed 事件监听器未使用状态映射

**位置**: `downloadStore.ts` 第 1623-1658 行

**问题描述**:

- 事件监听器直接使用后端返回的状态值，未通过 `fromBackendStatus()` 映射
- 后端返回 `"Downloading"`, `"Paused"` (首字母大写)
- 前端期望 `"downloading"`, `"paused"` (全小写)
- 导致 UI 无法正确识别任务状态

**当前错误代码**:

```typescript
const { task_id, status, error_message } = payload;
useDownloadStore.setState(state => ({
  tasks: state.tasks.map(task => {
    if (task.id === task_id) {
      return {
        ...task,
        status, // ❌ 直接使用，未映射！
        error_message,
        updated_at: new Date().toISOString(),
      };
    }
    return task;
  }),
}));
```

**应该改为**:

```typescript
const { task_id, status: rawStatus, error_message } = payload;
const status = fromBackendStatus(rawStatus); // ✅ 使用映射函数

useDownloadStore.setState(state => ({
  tasks: state.tasks.map(task => {
    if (task.id === task_id) {
      return {
        ...task,
        status, // ✅ 现在是映射后的小写状态
        error_message,
        updated_at: new Date().toISOString(),
      };
    }
    return task;
  }),
}));
```

---

### 🟡 中等问题 2: startAllDownloads 缺少任务优先级排序

**位置**: `downloadStore.ts` 第 753-779 行

**问题描述**:

- 没有对待下载任务进行优先级排序
- 应该优先下载有进度的任务（paused > failed > pending）
- fix3_task_priority.ts 中有正确实现，但未应用到主代码

**当前代码**:

```typescript
get().enqueueDownloads(pendingTasks.map(task => task.id));
```

**应该改为**:

```typescript
// 按进度排序,优先继续已有进度的任务
const sortedPendingTasks = [...pendingTasks].sort((a, b) => {
  // 1. 优先下载已有进度的任务
  const statusPriority: Record<TaskStatus, number> = {
    paused: 0,
    failed: 1,
    pending: 2,
    downloading: 3,
    completed: 4,
    cancelled: 5,
  };
  const statusDiff = statusPriority[a.status] - statusPriority[b.status];
  if (statusDiff !== 0) return statusDiff;

  // 2. 同状态下,进度高的优先
  return (b.progress || 0) - (a.progress || 0);
});

get().enqueueDownloads(sortedPendingTasks.map(task => task.id));
```

---

### 🟡 中等问题 3: processStartQueue 可能提前退出

**位置**: `downloadStore.ts` 第 824-869 行

**问题描述**:

- 当任务启动返回 `'queued'` 时，函数直接 return
- 导致队列中后续任务无法处理
- 应该继续尝试下一个任务

**当前代码**:

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
    return; // ❌ 提前退出，后续任务未处理
  }
}
```

**建议修改**:

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
      break; // ✅ 跳出循环，但不退出函数
    }
  } catch (error) {
    console.error(`启动任务 ${taskId} 失败:`, error);
    // 继续处理下一个任务
  }
}
```

---

## 修复优先级

1. **最高优先级**: 问题 1 (task_status_changed 状态映射)
   - 这是导致进度显示、下载控制等核心功能失效的根本原因
2. **高优先级**: 问题 2 (任务优先级排序)
   - 影响用户体验，暂停的任务应优先恢复
3. **中等优先级**: 问题 3 (队列处理逻辑)
   - 可能影响并发下载的正确性

## 修复步骤

1. 修复 task_status_changed 监听器，添加状态映射
2. 修复 startAllDownloads，添加任务排序
3. 优化 processStartQueue 的错误处理逻辑

这些修复都在 fixes 目录中有相应的修复文件，但似乎还没有正确应用到主代码中。
