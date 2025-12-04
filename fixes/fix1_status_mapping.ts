// 修复后的 task_status_changed 监听器代码片段
// 需要替换 downloadStore.ts 中第 1623-1658 行

listen<any>('task_status_changed', event => {
    const payload = event.payload;

    console.log('📡 收到状态变化事件:', payload);

    if (!payload || typeof payload.task_id !== 'string' || !payload.status) {
        console.error('❌ 任务状态变化数据无效:', payload);
        return;
    }

    const { task_id, status: rawStatus, error_message } = payload;

    // 使用状态映射函数
    const status = fromBackendStatus(rawStatus);

    console.log(`🔄 任务 ${task_id} 状态变化: ${rawStatus} → ${status}`);

    useDownloadStore.setState(state => ({
        tasks: state.tasks.map(task => {
            if (task.id === task_id) {
                return {
                    ...task,
                    status,
                    error_message,
                    updated_at: new Date().toISOString(),
                };
            }
            return task;
        }),
    }));

    useDownloadStore.getState().refreshStats();
    void useDownloadStore.getState().processStartQueue();
});
