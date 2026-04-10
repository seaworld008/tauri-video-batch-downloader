export interface DownloadEventEnvelopeV1<T = unknown> {
  schema_version: number;
  event_id: string;
  event_type: string;
  ts: string;
  payload: T;
}

export type DownloadEventTypeV1 = 'task.progressed' | 'task.status_changed' | 'task.stats_updated';

export interface TaskProgressedPayload {
  task_id: string;
  downloaded_size: number;
  total_size?: number;
  speed?: number;
  eta?: number;
  progress?: number;
}

export interface TaskStatusChangedPayload {
  task_id: string;
  status: string;
  error_message?: string | null;
}

export interface TaskStatsUpdatedPayload {
  total_tasks?: number;
  completed_tasks?: number;
  failed_tasks?: number;
  total_downloaded?: number;
  average_speed?: number;
  active_downloads?: number;
  queue_paused?: boolean;
}

export const SUPPORTED_DOWNLOAD_EVENT_SCHEMA = 1;

export const isSupportedDownloadEventType = (value: unknown): value is DownloadEventTypeV1 =>
  value === 'task.progressed' || value === 'task.status_changed' || value === 'task.stats_updated';

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const asFiniteNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

export const parseDownloadEventEnvelopeV1 = (
  raw: unknown
): { success: true; data: DownloadEventEnvelopeV1 } | { success: false; error: string } => {
  if (!raw || typeof raw !== 'object') {
    return { success: false, error: 'Event payload must be an object' };
  }

  const candidate = raw as Record<string, unknown>;
  const schemaVersion = candidate.schema_version;

  if (schemaVersion !== SUPPORTED_DOWNLOAD_EVENT_SCHEMA) {
    return {
      success: false,
      error: `Unsupported schema version: ${String(schemaVersion)}`,
    };
  }

  if (!isNonEmptyString(candidate.event_id)) {
    return { success: false, error: 'Invalid event_id' };
  }

  if (!isSupportedDownloadEventType(candidate.event_type)) {
    return { success: false, error: `Unsupported event_type: ${String(candidate.event_type)}` };
  }

  if (!isNonEmptyString(candidate.ts)) {
    return { success: false, error: 'Invalid ts' };
  }

  if (!('payload' in candidate)) {
    return { success: false, error: 'Missing payload' };
  }

  return {
    success: true,
    data: {
      schema_version: schemaVersion,
      event_id: candidate.event_id,
      event_type: candidate.event_type,
      ts: candidate.ts,
      payload: candidate.payload,
    },
  };
};

export const parseTaskProgressedPayload = (
  payload: unknown
): { success: true; data: TaskProgressedPayload } | { success: false; error: string } => {
  if (!payload || typeof payload !== 'object') {
    return { success: false, error: 'task.progressed payload must be an object' };
  }

  const candidate = payload as Record<string, unknown>;
  if (!isNonEmptyString(candidate.task_id)) {
    return { success: false, error: 'task.progressed missing task_id' };
  }

  const downloadedSize = asFiniteNumber(candidate.downloaded_size);
  if (downloadedSize === undefined) {
    return { success: false, error: 'task.progressed missing downloaded_size' };
  }

  return {
    success: true,
    data: {
      task_id: candidate.task_id,
      downloaded_size: downloadedSize,
      total_size: asFiniteNumber(candidate.total_size),
      speed: asFiniteNumber(candidate.speed),
      eta: asFiniteNumber(candidate.eta),
      progress: asFiniteNumber(candidate.progress),
    },
  };
};

export const parseTaskStatusChangedPayload = (
  payload: unknown
): { success: true; data: TaskStatusChangedPayload } | { success: false; error: string } => {
  if (!payload || typeof payload !== 'object') {
    return { success: false, error: 'task.status_changed payload must be an object' };
  }

  const candidate = payload as Record<string, unknown>;
  if (!isNonEmptyString(candidate.task_id)) {
    return { success: false, error: 'task.status_changed missing task_id' };
  }
  if (!isNonEmptyString(candidate.status)) {
    return { success: false, error: 'task.status_changed missing status' };
  }

  return {
    success: true,
    data: {
      task_id: candidate.task_id,
      status: candidate.status,
      error_message:
        candidate.error_message === null || typeof candidate.error_message === 'string'
          ? candidate.error_message
          : undefined,
    },
  };
};

export const parseTaskStatsUpdatedPayload = (
  payload: unknown
): { success: true; data: TaskStatsUpdatedPayload } | { success: false; error: string } => {
  if (!payload || typeof payload !== 'object') {
    return { success: false, error: 'task.stats_updated payload must be an object' };
  }

  const candidate = payload as Record<string, unknown>;
  const queuePaused =
    typeof candidate.queue_paused === 'boolean' ? candidate.queue_paused : undefined;

  return {
    success: true,
    data: {
      total_tasks: asFiniteNumber(candidate.total_tasks),
      completed_tasks: asFiniteNumber(candidate.completed_tasks),
      failed_tasks: asFiniteNumber(candidate.failed_tasks),
      total_downloaded: asFiniteNumber(candidate.total_downloaded),
      average_speed: asFiniteNumber(candidate.average_speed),
      active_downloads: asFiniteNumber(candidate.active_downloads),
      queue_paused: queuePaused,
    },
  };
};
