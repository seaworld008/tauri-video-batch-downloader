// 修复后的 startAllDownloads 函数代码片段
// 需要替换 downloadStore.ts 中第 753-779 行

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

    get().enqueueDownloads(sortedPendingTasks.map(task => task.id));

    const message =
        selectedTasks.length > 0
            ? `已提交 ${sortedPendingTasks.length} 个选中任务到队列`
            : `已提交 ${sortedPendingTasks.length} 个任务到队列`;

    toast.success(message);
},
