import { invokeTauri } from '../../../utils/tauriBridge';

export const addDownloadTasksCommand = async <T>(tasks: unknown[]): Promise<T> =>
  invokeTauri<T>('add_download_tasks', { tasks });
