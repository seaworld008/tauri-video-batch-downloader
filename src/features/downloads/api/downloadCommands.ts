import { invokeTauri } from '../../../utils/tauriBridge';
import { buildTaskIdPayload } from '../../../utils/tauriPayloads';

export interface StartDownloadOptions {
  taskId: string;
}

export const startDownloadCommand = async ({ taskId }: StartDownloadOptions): Promise<void> =>
  invokeTauri('start_download', buildTaskIdPayload(taskId));

export const pauseDownloadCommand = async ({ taskId }: StartDownloadOptions): Promise<void> =>
  invokeTauri('pause_download', buildTaskIdPayload(taskId));

export const resumeDownloadCommand = async ({ taskId }: StartDownloadOptions): Promise<void> =>
  invokeTauri('resume_download', buildTaskIdPayload(taskId));

export const cancelDownloadCommand = async ({ taskId }: StartDownloadOptions): Promise<void> =>
  invokeTauri('cancel_download', buildTaskIdPayload(taskId));

export const startAllDownloadsCommand = async (): Promise<number> =>
  invokeTauri<number>('start_all_downloads');

export const pauseAllDownloadsCommand = async (): Promise<number> =>
  invokeTauri<number>('pause_all_downloads');
