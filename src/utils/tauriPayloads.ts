const buildRequestId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export const buildTaskIdPayload = (taskId: string, requestId: string = buildRequestId()) => ({
  task_id: taskId,
  taskId,
  request_id: requestId,
  requestId,
});

export const buildTaskIdsPayload = (taskIds: string[]) => ({
  task_ids: taskIds,
  taskIds,
});
