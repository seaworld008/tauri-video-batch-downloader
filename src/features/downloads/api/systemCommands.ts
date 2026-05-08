import * as dialog from '@tauri-apps/plugin-dialog';
import { invokeTauri } from '../../../utils/tauriBridge';

export type ExternalToolStatusKind = 'available' | 'missing' | 'failed' | 'version_unsupported';
export type ExternalToolSource = 'user_override' | 'managed' | 'bundled_sidecar' | 'path_fallback';
export type ExternalToolId = 'yt-dlp' | 'ffmpeg';

export interface ExternalToolStatus {
  id: ExternalToolId;
  display_name: string;
  status: ExternalToolStatusKind;
  source?: ExternalToolSource;
  path?: string;
  current_version?: string;
  latest_version?: string;
  update_available: boolean;
  can_auto_update: boolean;
  can_rollback: boolean;
  last_error?: string;
}

export interface GetVideoInfoOptions {
  url: string;
}

export interface LogFrontendEventOptions {
  level?: 'info' | 'warn' | 'error';
  message: string;
}

export const getVideoInfoCommand = async <T>({ url }: GetVideoInfoOptions): Promise<T> =>
  invokeTauri<T>('get_video_info', { url });

export const openDownloadFolderCommand = async (): Promise<void> =>
  invokeTauri<void>('open_download_folder');

export const revealPathInFolderCommand = async (path: string): Promise<void> =>
  invokeTauri<void>('reveal_path_in_folder', { path });

export const readClipboardTextCommand = async (): Promise<string> =>
  invokeTauri<string>('read_clipboard_text');

export interface SelectOutputDirectoryOptions {
  defaultPath?: string;
  title?: string;
}

export const selectOutputDirectoryCommand = async (
  options: SelectOutputDirectoryOptions = {}
): Promise<string | null> => {
  const selected = await dialog.open({
    directory: true,
    multiple: false,
    title: options.title ?? '选择输出目录',
    defaultPath: options.defaultPath,
  });

  return typeof selected === 'string' ? selected : null;
};

export const logFrontendEventCommand = async ({
  level,
  message,
}: LogFrontendEventOptions): Promise<void> =>
  invokeTauri<void>('log_frontend_event', { level, message });

export const getExternalToolStatusCommand = async (): Promise<ExternalToolStatus[]> =>
  invokeTauri<ExternalToolStatus[]>('get_external_tool_status');

export const checkExternalToolUpdatesCommand = async (
  tool?: ExternalToolId
): Promise<ExternalToolStatus[]> =>
  invokeTauri<ExternalToolStatus[]>('check_external_tool_updates', { tool });

export const updateExternalToolCommand = async (
  tool: ExternalToolId
): Promise<ExternalToolStatus> => invokeTauri<ExternalToolStatus>('update_external_tool', { tool });

export const rollbackExternalToolCommand = async (
  tool: ExternalToolId
): Promise<ExternalToolStatus> =>
  invokeTauri<ExternalToolStatus>('rollback_external_tool', { tool });

export const setExternalToolOverrideCommand = async (
  tool: ExternalToolId,
  path: string
): Promise<ExternalToolStatus> =>
  invokeTauri<ExternalToolStatus>('set_external_tool_override', { tool, path });

export const clearExternalToolOverrideCommand = async (
  tool: ExternalToolId
): Promise<ExternalToolStatus> =>
  invokeTauri<ExternalToolStatus>('clear_external_tool_override', { tool });

export const selectExternalToolBinaryCommand = async (
  tool: ExternalToolId
): Promise<string | null> => {
  const selected = await dialog.open({
    directory: false,
    multiple: false,
    title: `选择 ${tool} 可执行文件`,
  });

  return typeof selected === 'string' ? selected : null;
};
