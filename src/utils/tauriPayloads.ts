export const buildTaskIdPayload = (taskId: string) => ({
  task_id: taskId,
  taskId,
});

export const buildTaskIdsPayload = (taskIds: string[]) => ({
  task_ids: taskIds,
  taskIds,
});
