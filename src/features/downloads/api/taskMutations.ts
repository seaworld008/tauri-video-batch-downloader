import type { VideoTask } from '../../../schemas';
import { invokeTauri } from '../../../utils/tauriBridge';
import { buildTaskIdsPayload } from '../../../utils/tauriPayloads';

export const removeTasksCommand = async (taskIds: string[]): Promise<void> =>
  invokeTauri('remove_download_tasks', buildTaskIdsPayload(taskIds));

export const clearCompletedTasksCommand = async (): Promise<void> =>
  invokeTauri('clear_completed_tasks');

export interface TaskOutputPathUpdate {
  task_id: string;
  output_path: string;
}

export const updateTaskOutputPathsCommand = async (
  taskUpdates: TaskOutputPathUpdate[]
): Promise<VideoTask[]> =>
  invokeTauri<VideoTask[]>('update_task_output_paths', {
    taskUpdates,
    task_updates: taskUpdates,
  });
