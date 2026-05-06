import type { ImportedData, VideoTask } from '../schemas';

const TASK_STATUS_FROM_BACKEND = {
  pending: 'pending',
  downloading: 'downloading',
  committing: 'committing',
  paused: 'paused',
  completed: 'completed',
  failed: 'failed',
  cancelled: 'cancelled',
} as const;

const normalizeTaskStatus = (status: unknown): VideoTask['status'] => {
  if (typeof status !== 'string') {
    return 'pending';
  }

  return (
    TASK_STATUS_FROM_BACKEND[status.toLowerCase() as keyof typeof TASK_STATUS_FROM_BACKEND] ??
    'pending'
  );
};

export const normalizeImportedData = (data: any): ImportedData => {
  const normalizeString = (value: unknown): string | undefined => {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  };
  const normalized: ImportedData = {};

  normalized.zl_id = normalizeString(data.zl_id) || normalizeString(data.id);
  normalized.zl_name = normalizeString(data.zl_name) || normalizeString(data.name);
  normalized.record_url = normalizeString(data.record_url) || normalizeString(data.url);
  normalized.kc_id = normalizeString(data.kc_id) || normalizeString(data.course_id);
  normalized.kc_name = normalizeString(data.kc_name) || normalizeString(data.course_name);

  if (normalizeString(data.id) && !normalized.zl_id) normalized.id = normalizeString(data.id);
  if (normalizeString(data.name) && !normalized.zl_name)
    normalized.name = normalizeString(data.name);
  if (normalizeString(data.url) && !normalized.record_url)
    normalized.url = normalizeString(data.url);
  if (normalizeString(data.course_id) && !normalized.kc_id) {
    normalized.course_id = normalizeString(data.course_id);
  }
  if (normalizeString(data.course_name) && !normalized.kc_name) {
    normalized.course_name = normalizeString(data.course_name);
  }

  return normalized;
};

export const normalizeTaskData = (data: any): Partial<VideoTask> => {
  const normalizedVideoInfo = data.video_info ? normalizeImportedData(data.video_info) : undefined;
  const hasVideoInfo =
    normalizedVideoInfo && Object.values(normalizedVideoInfo).some(value => value !== undefined);
  return {
    id: data.id || generateTaskId(),
    url: data.url?.trim(),
    title: data.title?.trim() || extractTitleFromUrl(data.url),
    output_path: data.output_path?.trim(),
    resolved_path: data.resolved_path?.trim(),
    status: normalizeTaskStatus(data.status),
    progress: Number(data.progress) || 0,
    downloaded_size: Number(data.downloaded_size) || 0,
    speed: Number(data.speed) || 0,
    display_speed_bps: Number(data.display_speed_bps ?? data.speed) || 0,
    created_at: data.created_at || new Date().toISOString(),
    updated_at: data.updated_at || new Date().toISOString(),
    video_info: hasVideoInfo ? normalizedVideoInfo : undefined,
  };
};

const generateTaskId = (): string => {
  return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

const extractTitleFromUrl = (url: string): string => {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const segments = pathname.split('/');
    const lastSegment = segments[segments.length - 1];
    return lastSegment || `video_${Date.now()}`;
  } catch {
    return `video_${Date.now()}`;
  }
};
