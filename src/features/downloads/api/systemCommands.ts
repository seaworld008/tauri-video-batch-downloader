import * as dialog from '@tauri-apps/plugin-dialog';
import { invokeTauri } from '../../../utils/tauriBridge';

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
}: LogFrontendEventOptions): Promise<void> => invokeTauri<void>('log_frontend_event', { level, message });
