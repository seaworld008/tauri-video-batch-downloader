import type { DownloadConfig, ImportedData, VideoTask } from '../../../schemas';
import { reportFrontendDiagnosticIfEnabled } from '../../../utils/frontendLogging';

export type TaskDraft = Omit<VideoTask, 'id' | 'status' | 'created_at' | 'updated_at'>;

export const buildTasksFromUrls = (
  urls: string[],
  outputDirectory: DownloadConfig['output_directory']
): TaskDraft[] =>
  urls.map(url => ({
    url,
    title: url,
    output_path: outputDirectory,
    progress: 0,
    downloaded_size: 0,
    speed: 0,
    display_speed_bps: 0,
    eta: undefined,
    error_message: undefined,
  }));

export const buildTasksFromImportedData = (
  rows: ImportedData[],
  outputDirectory: DownloadConfig['output_directory']
): TaskDraft[] =>
  rows.flatMap((data, index) => {
    const url = data.record_url || data.url || '';

    if (!url) {
      reportFrontendDiagnosticIfEnabled('warn', 'import_orchestration:skip_row_missing_url', data);
      return [];
    }

    const title = data.kc_name || data.course_name || data.name || `任务_${index + 1}`;
    const outputPath = `${outputDirectory}/${data.zl_name || data.name || 'Unknown'}`;

    return [
      {
        url,
        title,
        output_path: outputPath,
        progress: 0,
        downloaded_size: 0,
        speed: 0,
        display_speed_bps: 0,
        eta: undefined,
        error_message: undefined,
        video_info: {
          zl_id: data.zl_id || data.id,
          zl_name: data.zl_name || data.name,
          record_url: data.record_url || data.url,
          kc_id: data.kc_id || data.course_id,
          kc_name: data.kc_name || data.course_name,
        },
      },
    ];
  });

export const filterExistingTaskIds = (taskIds: string[], tasks: VideoTask[]): string[] => {
  const existingIds = new Set(tasks.map(task => task.id));
  return taskIds.filter(id => id && existingIds.has(id));
};
