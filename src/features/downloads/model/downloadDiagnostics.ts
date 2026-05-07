import type { VideoTask } from '../../../types';

export type DownloadDiagnosticCode =
  | 'max_concurrency_reached'
  | 'permission_denied'
  | 'rate_limited'
  | 'external_tool_missing'
  | 'external_tool_failed'
  | 'authentication_required'
  | 'geo_or_policy_restricted'
  | 'unsupported_extractor'
  | 'ffmpeg_missing'
  | 'ytdlp_update_recommended'
  | 'json_parse_failed'
  | 'part_file_corrupted'
  | 'network_error'
  | 'unknown';

export type DownloadDiagnosticSeverity = 'info' | 'warning' | 'error';

export type ExternalToolStatus =
  | 'available'
  | 'missing'
  | 'failed'
  | 'version_unsupported'
  | 'unknown';

export interface DownloadDiagnostic {
  code: DownloadDiagnosticCode;
  severity: DownloadDiagnosticSeverity;
  message: string;
  externalToolStatus?: ExternalToolStatus;
}

export interface TaskSupportBundleOptions {
  generatedAt?: Date;
  logPaths?: string[];
}

const DEFAULT_LOG_PATHS = ['./log/backend.log', './log/frontend.log'];

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message?: unknown }).message);
  }
  return String(error ?? '');
};

const getErrorCode = (error: unknown): string | undefined => {
  if (error && typeof error === 'object' && 'code' in error) {
    return String((error as { code?: unknown }).code);
  }

  return undefined;
};

export const classifyDownloadDiagnosticCode = (error: unknown): DownloadDiagnosticCode => {
  const code = getErrorCode(error);
  const message = getErrorMessage(error);
  const normalized = message.toLowerCase();

  if (code === 'MAX_CONCURRENCY_REACHED' || normalized.includes('maximum concurrent downloads')) {
    return 'max_concurrency_reached';
  }

  if (
    normalized.includes('permission denied') ||
    normalized.includes('access denied') ||
    normalized.includes('权限')
  ) {
    return 'permission_denied';
  }

  if (normalized.includes('429') || normalized.includes('rate limit')) {
    return 'rate_limited';
  }

  if (
    normalized.includes('authentication_required') ||
    normalized.includes('sign in') ||
    normalized.includes('login') ||
    normalized.includes('private') ||
    normalized.includes('age-restricted')
  ) {
    return 'authentication_required';
  }

  if (
    normalized.includes('geo_or_policy_restricted') ||
    normalized.includes('not available in your country') ||
    normalized.includes('geo') ||
    normalized.includes('policy')
  ) {
    return 'geo_or_policy_restricted';
  }

  if (
    normalized.includes('unsupported_extractor') ||
    normalized.includes('unsupported url') ||
    normalized.includes('no suitable extractor')
  ) {
    return 'unsupported_extractor';
  }

  if (normalized.includes('ffmpeg_missing') || normalized.includes('ffmpeg not found')) {
    return 'ffmpeg_missing';
  }

  if (normalized.includes('ytdlp_update_recommended')) {
    return 'ytdlp_update_recommended';
  }

  if (normalized.includes('yt-dlp') || normalized.includes('youtube-dl')) {
    if (normalized.includes('not found') || normalized.includes('not installed')) {
      return 'external_tool_missing';
    }
    return 'external_tool_failed';
  }

  if (normalized.includes('json') && normalized.includes('parse')) {
    return 'json_parse_failed';
  }

  if (normalized.includes('.part') || normalized.includes('part file')) {
    return 'part_file_corrupted';
  }

  if (
    normalized.includes('network') ||
    normalized.includes('timeout') ||
    normalized.includes('connection')
  ) {
    return 'network_error';
  }

  return 'unknown';
};

export const toDownloadDiagnostic = (error: unknown): DownloadDiagnostic => {
  const code = classifyDownloadDiagnosticCode(error);
  const originalMessage = getErrorMessage(error);

  switch (code) {
    case 'max_concurrency_reached':
      return {
        code,
        severity: 'info',
        message: '当前下载达到最大并发，任务已进入等待队列，下载槽空出后会自动继续。',
      };
    case 'permission_denied':
      return {
        code,
        severity: 'error',
        message: '下载目录没有写入权限，请更换保存位置或检查系统权限。',
      };
    case 'rate_limited':
      return {
        code,
        severity: 'warning',
        message: '下载源正在限流，请稍后重试或降低并发数。',
      };
    case 'external_tool_missing':
      return {
        code,
        severity: 'warning',
        message: '未检测到 yt-dlp/youtube-dl，部分视频信息探测能力不可用。',
        externalToolStatus: 'missing',
      };
    case 'external_tool_failed':
      return {
        code,
        severity: 'warning',
        message: '外部视频工具执行失败，请检查工具安装、站点可访问性或链接有效性。',
        externalToolStatus: 'failed',
      };
    case 'authentication_required':
      return {
        code,
        severity: 'warning',
        message: '该内容需要登录、年龄确认或私有权限；当前仅支持公开内容下载。',
      };
    case 'geo_or_policy_restricted':
      return {
        code,
        severity: 'warning',
        message: '该内容受地区、版权或平台策略限制，当前不会绕过这些限制。',
      };
    case 'unsupported_extractor':
      return {
        code,
        severity: 'warning',
        message: 'yt-dlp 暂不支持该链接或站点结构已变化，请确认链接是否为公开视频页。',
      };
    case 'ffmpeg_missing':
      return {
        code,
        severity: 'warning',
        message: '未检测到 ffmpeg sidecar 或 PATH fallback，无法合并音视频流。',
        externalToolStatus: 'missing',
      };
    case 'ytdlp_update_recommended':
      return {
        code,
        severity: 'warning',
        message: '当前 yt-dlp 版本可能过旧，建议更新随包版本后重试。',
        externalToolStatus: 'version_unsupported',
      };
    case 'json_parse_failed':
      return {
        code,
        severity: 'error',
        message: '后端返回的数据无法解析，请保留日志用于排查。',
      };
    case 'part_file_corrupted':
      return {
        code,
        severity: 'error',
        message: '检测到未完成下载文件异常，请重试或删除对应 .part 文件后再下载。',
      };
    case 'network_error':
      return {
        code,
        severity: 'warning',
        message: '网络连接异常，请检查网络后重试。',
      };
    case 'unknown':
    default:
      return {
        code: 'unknown',
        severity: 'error',
        message: originalMessage || '下载操作失败，请查看日志获取更多信息。',
      };
  }
};

const formatSupportValue = (value: unknown): string => {
  if (value === null || value === undefined || value === '') {
    return '-';
  }
  return String(value);
};

export const buildTaskSupportBundle = (
  task: VideoTask,
  options: TaskSupportBundleOptions = {}
): string => {
  const generatedAt = options.generatedAt ?? new Date();
  const diagnostic = toDownloadDiagnostic(task.error_message ?? '');
  const externalInfo = task.external_info;
  const logPaths = options.logPaths ?? DEFAULT_LOG_PATHS;

  return [
    'Video Downloader Pro Task Diagnostic',
    `generated_at: ${generatedAt.toISOString()}`,
    `task_id: ${task.id}`,
    `title: ${formatSupportValue(task.title)}`,
    `url: ${formatSupportValue(task.url)}`,
    `status: ${task.status}`,
    `downloader_type: ${formatSupportValue(task.downloader_type)}`,
    `source_platform: ${formatSupportValue(externalInfo?.source_platform)}`,
    `extractor: ${formatSupportValue(externalInfo?.extractor)}`,
    `webpage_url: ${formatSupportValue(externalInfo?.webpage_url)}`,
    `format_id: ${formatSupportValue(externalInfo?.format_id)}`,
    `format_note: ${formatSupportValue(externalInfo?.format_note)}`,
    `requires_auth: ${formatSupportValue(externalInfo?.requires_auth)}`,
    `progress: ${task.progress}%`,
    `downloaded_size: ${task.downloaded_size}`,
    `file_size: ${formatSupportValue(task.file_size)}`,
    `output_path: ${formatSupportValue(task.output_path)}`,
    `resolved_path: ${formatSupportValue(task.resolved_path)}`,
    `created_at: ${formatSupportValue(task.created_at)}`,
    `updated_at: ${formatSupportValue(task.updated_at)}`,
    `diagnostic_code: ${diagnostic.code}`,
    `diagnostic_severity: ${diagnostic.severity}`,
    `diagnostic_message: ${diagnostic.message}`,
    `raw_error: ${formatSupportValue(task.error_message)}`,
    `logs: ${logPaths.join(', ')}`,
  ].join('\n');
};
