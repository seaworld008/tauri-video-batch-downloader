import { normalizeImportedData } from '../../../utils/dataValidator';
import type { DownloaderType, TaskStatus, VideoTask } from '../../../schemas';

const STATUS_TO_BACKEND: Record<TaskStatus, string> = {
  pending: 'Pending',
  downloading: 'Downloading',
  committing: 'Committing',
  paused: 'Paused',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

const STATUS_FROM_BACKEND: Record<string, TaskStatus> = {
  pending: 'pending',
  Pending: 'pending',
  downloading: 'downloading',
  Downloading: 'downloading',
  committing: 'committing',
  Committing: 'committing',
  paused: 'paused',
  Paused: 'paused',
  completed: 'completed',
  Completed: 'completed',
  failed: 'failed',
  Failed: 'failed',
  cancelled: 'cancelled',
  Cancelled: 'cancelled',
};

const DOWNLOADER_TYPE_TO_BACKEND: Record<DownloaderType, string> = {
  http: 'Http',
  m3u8: 'M3u8',
  youtube: 'Youtube',
};

const DOWNLOADER_TYPE_FROM_BACKEND: Record<string, DownloaderType> = {
  http: 'http',
  Http: 'http',
  m3u8: 'm3u8',
  M3u8: 'm3u8',
  youtube: 'youtube',
  Youtube: 'youtube',
};

const toBackendStatus = (status: TaskStatus): string =>
  STATUS_TO_BACKEND[status] ?? STATUS_TO_BACKEND.pending;

const toBackendDownloaderType = (downloaderType?: DownloaderType): string | undefined =>
  downloaderType ? (DOWNLOADER_TYPE_TO_BACKEND[downloaderType] ?? undefined) : undefined;

const fromBackendDownloaderType = (downloaderType: unknown): DownloaderType | undefined => {
  if (typeof downloaderType !== 'string') {
    return undefined;
  }

  return (
    DOWNLOADER_TYPE_FROM_BACKEND[downloaderType] ??
    DOWNLOADER_TYPE_FROM_BACKEND[downloaderType.toLowerCase()]
  );
};

export const fromBackendStatus = (status: unknown): TaskStatus => {
  if (typeof status !== 'string') {
    return 'pending';
  }

  const mapped = STATUS_FROM_BACKEND[status] ?? STATUS_FROM_BACKEND[status.toLowerCase()];
  return mapped ?? 'pending';
};

export const convertTaskForBackend = (task: VideoTask) => ({
  ...task,
  status: toBackendStatus(task.status),
  downloader_type: toBackendDownloaderType(task.downloader_type),
});

export const normalizeBackendTask = (task: any): VideoTask => {
  const normalizedVideoInfo = task?.video_info ? normalizeImportedData(task.video_info) : undefined;
  const hasVideoInfo =
    normalizedVideoInfo && Object.values(normalizedVideoInfo).some(value => value !== undefined);

  const fileSize = typeof task?.file_size === 'number' ? task.file_size : undefined;
  const displaySpeed = typeof task?.display_speed_bps === 'number' ? task.display_speed_bps : undefined;

  return {
    ...task,
    file_size: fileSize,
    display_speed_bps: displaySpeed,
    status: fromBackendStatus(task?.status),
    downloader_type: fromBackendDownloaderType(task?.downloader_type),
    video_info: hasVideoInfo ? normalizedVideoInfo : undefined,
  };
};
