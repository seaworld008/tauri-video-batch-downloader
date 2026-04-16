import { describe, expect, it, beforeEach, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import {
  startDownloadCommand,
  pauseDownloadCommand,
  resumeDownloadCommand,
  cancelDownloadCommand,
  startAllDownloadsCommand,
  pauseAllDownloadsCommand,
} from '../downloadCommands';
import {
  removeTasksCommand,
  clearCompletedTasksCommand,
  updateTaskOutputPathsCommand,
} from '../taskMutations';
import { addDownloadTasksCommand } from '../taskCreation';
import {
  importRawFileCommand,
  importStructuredFileCommand,
  previewImportDataCommand,
  resolveImportFileCommand,
  selectImportFileCommand,
} from '../importCommands';
import {
  getVideoInfoCommand,
  logFrontendEventCommand,
  openDownloadFolderCommand,
  selectOutputDirectoryCommand,
} from '../systemCommands';
import {
  exportConfigCommand,
  getConfigCommand,
  importConfigCommand,
  resetConfigCommand,
  updateConfigCommand,
} from '../configCommands';
import { getDownloadStatsCommand, getDownloadTasksCommand } from '../runtimeQueries';

describe('downloads api command seams', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(invoke).mockResolvedValue(undefined as never);
  });

  it('wraps task-level download control commands', async () => {
    await startDownloadCommand({ taskId: 'task-1' });
    await pauseDownloadCommand({ taskId: 'task-1' });
    await resumeDownloadCommand({ taskId: 'task-1' });
    await cancelDownloadCommand({ taskId: 'task-1' });

    expect(invoke).toHaveBeenNthCalledWith(
      1,
      'start_download',
      expect.objectContaining({ task_id: 'task-1', taskId: 'task-1' })
    );
    expect(invoke).toHaveBeenNthCalledWith(
      2,
      'pause_download',
      expect.objectContaining({ task_id: 'task-1', taskId: 'task-1' })
    );
    expect(invoke).toHaveBeenNthCalledWith(
      3,
      'resume_download',
      expect.objectContaining({ task_id: 'task-1', taskId: 'task-1' })
    );
    expect(invoke).toHaveBeenNthCalledWith(
      4,
      'cancel_download',
      expect.objectContaining({ task_id: 'task-1', taskId: 'task-1' })
    );
  });

  it('wraps batch download control commands', async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce(2 as never)
      .mockResolvedValueOnce(3 as never);

    await expect(startAllDownloadsCommand()).resolves.toBe(2);
    await expect(pauseAllDownloadsCommand()).resolves.toBe(3);

    expect(invoke).toHaveBeenNthCalledWith(1, 'start_all_downloads');
    expect(invoke).toHaveBeenNthCalledWith(2, 'pause_all_downloads');
  });

  it('wraps task mutation commands', async () => {
    const updates = [{ task_id: 'task-1', output_path: 'D:/Video/video.mp4' }];

    await removeTasksCommand(['task-1', 'task-2']);
    await clearCompletedTasksCommand();
    await updateTaskOutputPathsCommand(updates);

    expect(invoke).toHaveBeenNthCalledWith(1, 'remove_download_tasks', {
      task_ids: ['task-1', 'task-2'],
      taskIds: ['task-1', 'task-2'],
    });
    expect(invoke).toHaveBeenNthCalledWith(2, 'clear_completed_tasks');
    expect(invoke).toHaveBeenNthCalledWith(3, 'update_task_output_paths', {
      taskUpdates: updates,
      task_updates: updates,
    });
  });

  it('wraps task creation command', async () => {
    const tasks = [{ url: 'https://example.com/video.mp4', title: 'Example' }];

    await addDownloadTasksCommand(tasks);

    expect(invoke).toHaveBeenNthCalledWith(1, 'add_download_tasks', { tasks });
  });

  it('wraps import preview and structured-file command seams used by import surfaces', async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce({ headers: ['url'], rows: [], total_rows: 0, encoding: 'utf-8' } as never)
      .mockResolvedValueOnce([{ record_url: 'https://example.com/video.mp4' }] as never)
      .mockResolvedValueOnce([{ record_url: 'https://example.com/video.mp4' }] as never)
      .mockResolvedValueOnce([{ record_url: 'https://example.com/video.mp4' }] as never);

    await expect(
      previewImportDataCommand({ filePath: '/tmp/tasks.csv', maxRows: 10, encoding: 'utf-8' })
    ).resolves.toEqual({
      headers: ['url'],
      rows: [],
      total_rows: 0,
      encoding: 'utf-8',
    });
    await expect(
      importStructuredFileCommand({
        filePath: '/tmp/tasks.csv',
        fieldMapping: { url: 'video_url' },
        encoding: 'utf-8',
      })
    ).resolves.toEqual([{ record_url: 'https://example.com/video.mp4' }]);
    await expect(importRawFileCommand({ filePath: '/tmp/tasks.csv' })).resolves.toEqual([
      { record_url: 'https://example.com/video.mp4' },
    ]);
    await expect(
      importStructuredFileCommand({
        filePath: '/tmp/tasks.xlsx',
        fieldMapping: { url: 'video_url' },
      })
    ).resolves.toEqual([{ record_url: 'https://example.com/video.mp4' }]);

    expect(resolveImportFileCommand('/tmp/tasks.csv')).toBe('import_csv_file');
    expect(resolveImportFileCommand('/tmp/tasks.xlsx')).toBe('import_excel_file');

    expect(invoke).toHaveBeenNthCalledWith(1, 'preview_import_data', {
      filePath: '/tmp/tasks.csv',
      maxRows: 10,
      encoding: 'utf-8',
    });
    expect(invoke).toHaveBeenNthCalledWith(2, 'import_csv_file', {
      filePath: '/tmp/tasks.csv',
      fieldMapping: { url: 'video_url' },
      encoding: 'utf-8',
    });
    expect(invoke).toHaveBeenNthCalledWith(3, 'import_csv_file', {
      filePath: '/tmp/tasks.csv',
    });
    expect(invoke).toHaveBeenNthCalledWith(4, 'import_excel_file', {
      filePath: '/tmp/tasks.xlsx',
      fieldMapping: { url: 'video_url' },
      sheetName: null,
    });

    vi.mocked(open).mockResolvedValueOnce('/tmp/tasks.csv' as never);
    await expect(selectImportFileCommand()).resolves.toBe('/tmp/tasks.csv');
    expect(open).toHaveBeenLastCalledWith({
      title: '选择导入文件',
      defaultPath: undefined,
      filters: [
        {
          name: '支持的文件',
          extensions: ['csv', 'xlsx', 'xls'],
        },
      ],
    });
  });

  it('wraps system-related command seams used by the current frontend', async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce({ title: 'Example Video' } as never)
      .mockResolvedValueOnce(undefined as never)
      .mockResolvedValueOnce(undefined as never);
    vi.mocked(open).mockResolvedValueOnce('/downloads' as never);

    await expect(getVideoInfoCommand<{ title: string }>({ url: 'https://example.com/video' })).resolves.toEqual({
      title: 'Example Video',
    });
    await expect(openDownloadFolderCommand()).resolves.toBeUndefined();
    await expect(
      selectOutputDirectoryCommand({ title: '选择下载目录', defaultPath: '/existing-downloads' })
    ).resolves.toBe('/downloads');
    await expect(logFrontendEventCommand({ level: 'error', message: 'frontend_bootstrap' })).resolves.toBeUndefined();

    expect(invoke).toHaveBeenNthCalledWith(1, 'get_video_info', {
      url: 'https://example.com/video',
    });
    expect(invoke).toHaveBeenNthCalledWith(2, 'open_download_folder');
    expect(invoke).toHaveBeenNthCalledWith(3, 'log_frontend_event', {
      level: 'error',
      message: 'frontend_bootstrap',
    });
    expect(open).toHaveBeenCalledWith({
      directory: true,
      multiple: false,
      title: '选择下载目录',
      defaultPath: '/existing-downloads',
    });
  });

  it('wraps config command seams used by configStore', async () => {
    const config = {
      download: { output_directory: '/downloads' },
      ui: { theme: 'dark' },
      system: { log_level: 'info' },
      youtube: { default_quality: '1080p' },
      advanced: { enable_logging: true },
    };

    vi.mocked(invoke)
      .mockResolvedValueOnce(config as never)
      .mockResolvedValueOnce(undefined as never)
      .mockResolvedValueOnce(config as never)
      .mockResolvedValueOnce(undefined as never)
      .mockResolvedValueOnce(config as never);

    await expect(getConfigCommand()).resolves.toEqual(config);
    await expect(updateConfigCommand(config as never)).resolves.toBeUndefined();
    await expect(resetConfigCommand()).resolves.toEqual(config);
    await expect(exportConfigCommand('/tmp/config.json')).resolves.toBeUndefined();
    await expect(importConfigCommand('/tmp/config.json')).resolves.toEqual(config);

    expect(invoke).toHaveBeenNthCalledWith(1, 'get_config');
    expect(invoke).toHaveBeenNthCalledWith(2, 'update_config', {
      newConfig: config,
      new_config: config,
    });
    expect(invoke).toHaveBeenNthCalledWith(3, 'reset_config');
    expect(invoke).toHaveBeenNthCalledWith(4, 'export_config', {
      filePath: '/tmp/config.json',
      file_path: '/tmp/config.json',
    });
    expect(invoke).toHaveBeenNthCalledWith(5, 'import_config', {
      filePath: '/tmp/config.json',
      file_path: '/tmp/config.json',
    });
  });

  it('wraps runtime query command seams used by downloadStore/runtime sync', async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce([{ id: 'task-1' }] as never)
      .mockResolvedValueOnce({ total_tasks: 1 } as never);

    await expect(getDownloadTasksCommand<{ id: string }>()).resolves.toEqual([{ id: 'task-1' }]);
    await expect(getDownloadStatsCommand()).resolves.toEqual({ total_tasks: 1 });

    expect(invoke).toHaveBeenNthCalledWith(1, 'get_download_tasks');
    expect(invoke).toHaveBeenNthCalledWith(2, 'get_download_stats');
  });
});
