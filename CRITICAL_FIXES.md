# 🔧 关键问题修复说明

## 问题总结
基于用户测试反馈,发现以下三个严重问题:

1. **进度不显示**: 3个任务显示正在下载,但没有进度条和速度
2. **并发数配置不生效**: 修改并发数从3改到6,实际还是3个并发
3. **暂停/重启逻辑错误**: 暂停后重启,不是继续下载之前的任务,而是随机选择其他任务

## 根本原因分析

### 问题 1: 进度不显示

**原因**: `task_status_changed` 事件监听器没有正确映射后端状态到前端状态

**位置**: `src/stores/downloadStore.ts` 第 1623-1658 行

**当前代码问题**:
```typescript
const { task_id, status, error_message } = payload;  // ❌ 直接使用后端状态

useDownloadStore.setState(state => ({
  tasks: state.tasks.map(task => {
    if (task.id === task_id) {
      return {
        ...task,
        status,  // ❌ 后端发送 "Downloading",前端需要 "downloading"
        error_message,
        updated_at: new Date().toISOString(),
      };
    }
    return task;
  }),
}));
```

**修复方案**:
```typescript
const { task_id, status: rawStatus, error_message } = payload;

// 使用状态映射函数
const status = fromBackendStatus(rawStatus);

console.log(`🔄 任务 ${task_id} 状态变化: ${rawStatus} → ${status}`);

useDownloadStore.setState(state => ({
  tasks: state.tasks.map(task => {
    if (task.id === task_id) {
      return {
        ...task,
        status,  // ✅ 正确映射的状态
        error_message,
        updated_at: new Date().toISOString(),
      };
    }
    return task;
  }),
}));
```

### 问题 2: 并发数配置不生效

**原因**: `set DownloadConfig` 只更新前端状态,没有同步到后端,且没有触发队列重新处理

**位置**: `src/stores/downloadStore.ts` 第 1123-1130 行

**当前代码问题**:
```typescript
setDownloadConfig: (newConfig: Partial<DownloadConfig>) => {
  const baseDownloadConfig = get().config ?? DEFAULT_DOWNLOAD_CONFIG;
  const mergedDownloadConfig = mergeDownloadConfig({
    ...baseDownloadConfig,
    ...newConfig,
  });
  set({ config: mergedDownloadConfig });  // ❌ 只更新前端,不同步后端
},
```

**修复方案 1 - 在 configStore 中修复**:
`src/stores/configStore.ts` 的 `updateDownloadConfig` 需要在更新后触发队列处理:

```typescript
updateDownloadConfig: async (newDownloadConfig) => {
  try {
    set({ isLoading: true });
    
    const currentConfig = get().config;
    const mergedConfig = {
      ...currentConfig,
      download: {
        ...currentConfig.download,
        ...newDownloadConfig,
      },
    };

    const result = await invoke<{ success: boolean }>('update_config', {
      newConfig: mergedConfig,
    });

    if (result.success) {
      set({ config: mergedConfig, isLoading: false });
      useDownloadStore.getState().setDownloadConfig(newDownloadConfig);
      
      // ✅ 关键: 触发队列重新处理以应用新的并发数
      void useDownloadStore.getState().processStartQueue();
      
      toast.success('配置已更新');
    }
  } catch (error) {
    set({ isLoading: false });
    handleError('更新下载配置', error);
  }
},
```

### 问题 3: 暂停/重启逻辑错误

**原因**: `startAllDownloads` 没有根据任务进度排序,应该优先继续已有进度的任务

**位置**: `src/stores/downloadStore.ts` 第 753-779 行

**当前代码问题**:
```typescript
startAllDownloads: async () => {
  const { tasks, selectedTasks } = get();

  const targetTasks =
    selectedTasks.length > 0 ? tasks.filter(task => selectedTasks.includes(task.id)) : tasks;

  const pendingTasks = targetTasks.filter(
    task => task.status === 'pending' || task.status === 'paused' || task.status === 'failed'
  );  // ❌ 没有排序,每次都是随机顺序

  if (pendingTasks.length === 0) {
    toast('没有可启动的下载任务');
    return;
  }

  get().enqueueDownloads(pendingTasks.map(task => task.id));
},
```

**修复方案**:
```typescript
startAllDownloads: async () => {
  const { tasks, selectedTasks } = get();

  const targetTasks =
    selectedTasks.length > 0 ? tasks.filter(task => selectedTasks.includes(task.id)) : tasks;

  const pendingTasks = targetTasks.filter(
    task => task.status === 'pending' || task.status === 'paused' || task.status === 'failed'
  );

  if (pendingTasks.length === 0) {
    toast('没有可启动的下载任务');
    return;
  }

  // ✅ 关键: 按进度排序,优先继续已有进度的任务
  const sortedPendingTasks = [...pendingTasks].sort((a, b) => {
    // 1. 优先下载已有进度的任务 (paused > failed > pending)
    const statusPriority = { paused: 0, failed: 1, pending: 2 };
    const statusDiff = statusPriority[a.status] - statusPriority[b.status];
    if (statusDiff !== 0) return statusDiff;

    // 2. 同状态下,进度高的优先
    return (b.progress || 0) - (a.progress || 0);
  });

  console.log('📋 开始下载队列:', sortedPendingTasks.map(t => ({
    id: t.id,
    title: t.title,
    status: t.status,
    progress: t.progress
  })));

  get().enqueueDownloads(sortedPendingTasks.map(task => task.id));

  const message =
    selectedTasks.length > 0
      ? `已提交 ${sortedPendingTasks.length} 个选中任务到队列`
      : `已提交 ${sortedPendingTasks.length} 个任务到队列`;

  toast.success(message);
},
```

## 修复步骤总结

1. **修复状态映射** (问题1)
   - 文件: `src/stores/downloadStore.ts`
   - 位置: 第 1634 行
   - 修改: 使用 `fromBackendStatus(rawStatus)` 而不是直接使用 `status`

2. **触发队列重新处理** (问题2)
   - 文件: `src/stores/configStore.ts`
   - 位置: `updateDownloadConfig` 函数
   - 修改: 在配置更新成功后调用 `processStartQueue()`

3. **任务优先级排序** (问题3)
   - 文件: `src/stores/downloadStore.ts`
   - 位置: `startAllDownloads` 函数
   - 修改: 在enqueue之前对任务排序

## 验证清单

修复后请验证:
- [ ] 下载任务能看到进度条和速度
- [ ] 修改并发数后立即生效
- [ ] 暂停后重启,继续下载之前的任务
- [ ] 控制台能看到调试日志 (状态变化、队列信息)
