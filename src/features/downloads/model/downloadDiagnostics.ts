export type DownloadDiagnosticCode =
  | 'max_concurrency_reached'
  | 'permission_denied'
  | 'rate_limited'
  | 'external_tool_missing'
  | 'external_tool_failed'
  | 'json_parse_failed'
  | 'part_file_corrupted'
  | 'network_error'
  | 'unknown';

export type DownloadDiagnosticSeverity = 'info' | 'warning' | 'error';

export type ExternalToolStatus = 'available' | 'missing' | 'failed' | 'unknown';

export interface DownloadDiagnostic {
  code: DownloadDiagnosticCode;
  severity: DownloadDiagnosticSeverity;
  message: string;
  externalToolStatus?: ExternalToolStatus;
}

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
