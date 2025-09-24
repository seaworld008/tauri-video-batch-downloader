import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { invoke } from '@tauri-apps/api/tauri';
import { listen } from '@tauri-apps/api/event';
import toast from 'react-hot-toast';
import { AppErrorHandler, handleError, withRetry, withTimeout } from '../utils/errorHandler';
import { StateValidator, validateState, syncStates, shouldValidate } from '../utils/stateValidator';
import {
  validateVideoTask,
  validateImportedData,
  validateProgressUpdate,
  validateDownloadConfig,
  validateVideoTaskList,
  validateImportDataList,
  validateApiResponse,
  normalizeTaskData,
  normalizeImportedData,
  checkDataIntegrity,
  createValidationStats,
} from '../utils/dataValidator';
import type {
  VideoTask,
  TaskStatus,
  DownloaderType,
  DownloadConfig,
  ImportedData,
  ProgressUpdate,
  DownloadStats,
} from '../schemas';
import {
  TaskListSchema,
  DownloadConfigSchema,
  DownloadStatsSchema,
  validateRelatedData,
} from '../schemas';
import { createDefaultDownloadStats, ensureDownloadStats } from '../utils/downloadStats';
const STATUS_TO_BACKEND: Record<TaskStatus, string> = {
  pending: 'Pending',
  downloading: 'Downloading',
  paused: 'Paused',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

const STATUS_FROM_BACKEND: Record<string, TaskStatus> = {
  pending: 'pending',
  Pending: 'pending',
  downloading: 'downloading',
  Downloading: 'downloading',
  paused: 'paused',
  Paused: 'paused',
  completed: 'completed',
  Completed: 'completed',
  failed: 'failed',
  Failed: 'failed',
  cancelled: 'cancelled',
  Cancelled: 'cancelled',
};

const DOWNLOADER_TYPE_TO_BACKEND: Record<DownloaderType, string> = {
  http: 'Http',
  m3u8: 'M3u8',
  youtube: 'Youtube',
};

const DOWNLOADER_TYPE_FROM_BACKEND: Record<string, DownloaderType> = {
  http: 'http',
  Http: 'http',
  m3u8: 'm3u8',
  M3u8: 'm3u8',
  youtube: 'youtube',
  Youtube: 'youtube',
};

const toBackendStatus = (status: TaskStatus): string =>
  STATUS_TO_BACKEND[status] ?? STATUS_TO_BACKEND.pending;

const fromBackendStatus = (status: unknown): TaskStatus => {
  if (typeof status === 'string') {
    const mapped =
      STATUS_FROM_BACKEND[status] ??
      STATUS_FROM_BACKEND[status.toLowerCase()];

    return mapped ?? 'pending';
  }

  return 'pending';
};

const toBackendDownloaderType = (
  downloaderType?: DownloaderType
): string | undefined =>
  downloaderType ? DOWNLOADER_TYPE_TO_BACKEND[downloaderType] ?? undefined : undefined;

const fromBackendDownloaderType = (
  downloaderType: unknown
): DownloaderType | undefined => {
  if (typeof downloaderType === 'string') {
    return (
      DOWNLOADER_TYPE_FROM_BACKEND[downloaderType] ??
      DOWNLOADER_TYPE_FROM_BACKEND[downloaderType.toLowerCase()]
    );
  }

  return undefined;
};

const convertTaskForBackend = (task: VideoTask) => ({
  ...task,
  status: toBackendStatus(task.status),
  downloader_type: toBackendDownloaderType(task.downloader_type),
});

const normalizeBackendTask = (task: any) => ({
  ...task,
  status: fromBackendStatus(task?.status),
  downloader_type: fromBackendDownloaderType(task?.downloader_type),
});

interface DownloadState {
  // \u6570\u636e\u72b6\u6001

  tasks: VideoTask[];

  config: DownloadConfig;

  stats: DownloadStats;

  // UI \u72b6\u6001

  isImporting: boolean;

  isLoading: boolean;

  selectedTasks: string[];

  // \u6570\u636e\u9a8c\u8bc1\u72b6\u6001

  validationStats: ReturnType<typeof createValidationStats>;

  lastValidationTime: number;

  validationErrors: string[];

  // \u8fc7\u6ee4\u548c\u6392\u5e8f

  filterStatus: TaskStatus | 'all';

  searchQuery: string;

  sortBy: keyof VideoTask;

  sortDirection: 'asc' | 'desc';

  // Actions - \u4efb\u52a1\u7ba1\u7406

  addTasks: (
    tasks: VideoTask[] | Omit<VideoTask, 'id' | 'status' | 'created_at' | 'updated_at'>[]
  ) => Promise<void>;

  addTask: (
    task: VideoTask | Omit<VideoTask, 'id' | 'status' | 'created_at' | 'updated_at'>
  ) => Promise<void>;

  removeTasks: (taskIds: string[]) => Promise<void>;

  clearCompletedTasks: () => Promise<void>;

  // Actions - \u4e0b\u8f7d\u63a7\u5236

  startDownload: (taskId: string) => Promise<void>;

  pauseDownload: (taskId: string) => Promise<void>;

  resumeDownload: (taskId: string) => Promise<void>;

  cancelDownload: (taskId: string) => Promise<void>;

  startAllDownloads: () => Promise<void>;

  pauseAllDownloads: () => Promise<void>;

  retryFailedTasks: () => Promise<void>;

  // Actions - \u6587\u4ef6\u5bfc\u5165

  importFromFile: (filePath: string) => Promise<void>;

  importFromUrls: (urls: string[]) => Promise<void>;

  // Actions - \u914d\u7f6e\u7ba1\u7406

  updateConfig: (config: Partial<DownloadConfig>) => Promise<void>;

  resetConfig: () => Promise<void>;

  // Actions - UI \u72b6\u6001

  setSelectedTasks: (taskIds: string[]) => void;

  toggleTaskSelection: (taskId: string) => void;

  selectAllTasks: () => void;

  clearSelection: () => void;

  // Actions - \u8fc7\u6ee4\u548c\u641c\u7d22

  setFilterStatus: (status: TaskStatus | 'all') => void;

  setSearchQuery: (query: string) => void;

  setSortBy: (field: keyof VideoTask, direction?: 'asc' | 'desc') => void;

  // Actions - \u6570\u636e\u5237\u65b0

  refreshTasks: () => Promise<void>;

  refreshStats: () => Promise<void>;

  // Actions - \u72b6\u6001\u9a8c\u8bc1\u548c\u540c\u6b65

  validateAndSync: () => Promise<boolean>;

  forceSync: () => Promise<boolean>;

  // Actions - \u521d\u59cb\u5316

  initializeStore: () => Promise<void>;

  // Actions - \u6570\u636e\u9a8c\u8bc1

  getValidationStats: () => {
    total: number;

    successful: number;

    failed: number;

    successRate: number;

    averageDuration: number;
  };

  resetValidationStats: () => void;

  clearValidationErrors: () => void;

  runDataIntegrityCheck: () => {
    duplicates: string[];

    orphaned: string[];

    corrupted: string[];
  };
}

export const useDownloadStore = create<DownloadState>()(
  subscribeWithSelector((set, get) => ({
    // \u521d\u59cb\u72b6\u6001

    tasks: [],

    config: {
      concurrent_downloads: 3,

      retry_attempts: 3,

      timeout_seconds: 30,

      user_agent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',

      proxy: undefined,

      headers: {},

      output_directory: '',
    },

    stats: createDefaultDownloadStats(),

    // \u6570\u636e\u9a8c\u8bc1\u72b6\u6001\u521d\u59cb\u5316

    validationStats: createValidationStats(),

    lastValidationTime: 0,

    validationErrors: [],

    isImporting: false,

    isLoading: false,

    selectedTasks: [],

    filterStatus: 'all',

    searchQuery: '',

    sortBy: 'created_at',

    sortDirection: 'desc',

    // \u4efb\u52a1\u7ba1\u7406 - \u589e\u5f3a\u7248\u672c\u5e26Zod\u9a8c\u8bc1

    addTasks: async newTasks => {
      const validationStartTime = performance.now();

      try {
        console.log('\u1f680 \u5f00\u59cb\u6dfb\u52a0\u4efb\u52a1:', { count: newTasks.length, sample: newTasks[0] });

        set({ isLoading: true, validationErrors: [] });

        // \u6b65\u9aa41: \u8f93\u5165\u6570\u636e\u9a8c\u8bc1\u548c\u6807\u51c6\u5316

        console.log('\u1f50d \u6b65\u9aa41: \u9a8c\u8bc1\u8f93\u5165\u6570\u636e...');

        const normalizedTasks = newTasks.map(task => normalizeTaskData(task));

        // \u6279\u91cf\u9a8c\u8bc1\u8f93\u5165\u6570\u636e

        const inputValidation = validateVideoTaskList(normalizedTasks, { stopOnFirstError: false });

        const validationDuration = performance.now() - validationStartTime;

        // \u8bb0\u5f55\u9a8c\u8bc1\u7edf\u8ba1

        get().validationStats.recordValidation(inputValidation.success, validationDuration);

        if (!inputValidation.success) {
          console.warn('\u26a0\ufe0f \u8f93\u5165\u9a8c\u8bc1\u53d1\u73b0\u95ee\u9898:', {
            \u603b\u6570: inputValidation.totalItems,

            \u6709\u6548: inputValidation.validItems.length,

            \u65e0\u6548: inputValidation.invalidItems.length,

            \u6210\u529f\u7387: `${(inputValidation.successRate * 100).toFixed(1)}%`,
          });

          // \u8bb0\u5f55\u9a8c\u8bc1\u9519\u8bef

          const errorMessages = inputValidation.invalidItems.map(
            item => `\u4efb\u52a1[${item.index}]: ${item.errors.map(e => e.message).join(', ')}`
          );

          set(state => ({
            validationErrors: errorMessages,

            lastValidationTime: Date.now(),
          }));
        }

        // \u5982\u679c\u6709\u6709\u6548\u4efb\u52a1\uff0c\u7ee7\u7eed\u5904\u7406\uff1b\u5982\u679c\u5168\u90e8\u65e0\u6548\uff0c\u629b\u51fa\u9519\u8bef

        if (inputValidation.validItems.length === 0) {
          throw new Error(
            `\u6240\u6709\u8f93\u5165\u4efb\u52a1\u5747\u65e0\u6548\u3002\u9519\u8bef\u8be6\u60c5: ${inputValidation.invalidItems
              .map(item => item.errors.map(e => e.message).join(', '))
              .join('; ')}`
          );
        }

        const processedTasks = inputValidation.validItems;
        const backendTasksPayload = processedTasks.map(convertTaskForBackend);

        console.log('\u2705 \u8f93\u5165\u9a8c\u8bc1\u5b8c\u6210:', {
          \u539f\u59cb\u6570\u91cf: newTasks.length,

          \u6709\u6548\u6570\u91cf: processedTasks.length,

          \u6210\u529f\u7387: `${(inputValidation.successRate * 100).toFixed(1)}%`,
        });

        console.log('\u1f4e4 \u53d1\u9001\u5230\u540e\u7aef\u7684\u4efb\u52a1:', {
          count: processedTasks.length,
          sample: processedTasks[0],
        });

        // \u6b65\u9aa42: \u540e\u7aef\u8c03\u7528

        const backendResponse = await invoke<any>('add_download_tasks', { tasks: backendTasksPayload });

        // \u6b65\u9aa43: \u540e\u7aef\u54cd\u5e94\u9a8c\u8bc1

        console.log('\u1f50d \u6b65\u9aa43: \u9a8c\u8bc1\u540e\u7aef\u54cd\u5e94...');

        const responseValidation = validateApiResponse(backendResponse, TaskListSchema);

        let backendTasksSource: unknown[] | undefined;

        if (responseValidation.success) {
          const payload = responseValidation.data?.data ?? backendResponse;

          if (Array.isArray(payload)) {
            backendTasksSource = payload.map(normalizeBackendTask);
          } else {
            console.warn('Backend payload is not an array', { payload });
          }
        } else if (Array.isArray(backendResponse)) {
          console.warn('Backend response shape mismatched spec', {
            validationErrors: responseValidation.errors,
          });

          backendTasksSource = backendResponse.map(normalizeBackendTask);
        } else {
          console.error('Backend response format invalid:', responseValidation.errors);

          const errorDetails =
            responseValidation.errors?.map(e => e.message).join(', ') ?? 'unknown error';

          throw new Error('Backend response format invalid: ' + errorDetails);
        }
        if (!backendTasksSource) {
          throw new Error('Could not extract task list from backend response');
        }
        const backendValidation = validateVideoTaskList(backendTasksSource, {
          stopOnFirstError: false,
        });

        if (!backendValidation.success || backendValidation.validItems.length === 0) {
          console.error('\u274c \u540e\u7aef\u8fd4\u56de\u7684\u4efb\u52a1\u6570\u636e\u65e0\u6548:', {
            \u539f\u59cb\u54cd\u5e94: backendTasksSource,

            \u9a8c\u8bc1\u9519\u8bef: backendValidation.invalidItems,
          });

          throw new Error('\u540e\u7aef\u8fd4\u56de\u7684\u4efb\u52a1\u6570\u636e\u683c\u5f0f\u65e0\u6548');
        }

        const validatedBackendTasks = backendValidation.validItems;

        console.log('\u1f4e5 \u4ece\u540e\u7aef\u63a5\u6536\u7684\u4efb\u52a1:', {
          count: validatedBackendTasks.length,

          sample: validatedBackendTasks[0],

          allTaskIds: validatedBackendTasks.map(t => t.id),
        });

        // \u6b65\u9aa45: \u6570\u636e\u5b8c\u6574\u6027\u68c0\u67e5

        const integrityCheck = checkDataIntegrity(validatedBackendTasks);

        if (integrityCheck.duplicates.length > 0 || integrityCheck.corrupted.length > 0) {
          console.warn('\u26a0\ufe0f \u53d1\u73b0\u6570\u636e\u5b8c\u6574\u6027\u95ee\u9898:', integrityCheck);
        }

        // \u6b65\u9aa46: \u539f\u5b50\u6027\u72b6\u6001\u66f4\u65b0 - \u4f7f\u7528\u9a8c\u8bc1\u8fc7\u7684\u540e\u7aef\u6570\u636e

        set(state => {
          const updatedTasks = [...state.tasks, ...validatedBackendTasks];

          console.log('\u1f4ca \u66f4\u65b0\u540e\u7684\u72b6\u6001:', {
            \u539f\u6709\u4efb\u52a1\u6570: state.tasks.length,

            \u65b0\u589e\u4efb\u52a1\u6570: validatedBackendTasks.length,

            \u6700\u7ec8\u4efb\u52a1\u6570: updatedTasks.length,
          });

          return {
            tasks: updatedTasks,

            isLoading: false,

            lastValidationTime: Date.now(),

            validationErrors:
              inputValidation.invalidItems.length > 0
                ? [
                    `\u90e8\u5206\u4efb\u52a1\u9a8c\u8bc1\u5931\u8d25 (${inputValidation.invalidItems.length}/${inputValidation.totalItems})`,
                  ]
                : [],
          };
        });

        // \u786e\u4fdd\u7edf\u8ba1\u4fe1\u606f\u540c\u6b65\u66f4\u65b0

        try {
          await get().refreshStats();

          console.log('\u2705 \u7edf\u8ba1\u4fe1\u606f\u5df2\u5237\u65b0');
        } catch (statsError) {
          console.warn('\u26a0\ufe0f \u7edf\u8ba1\u4fe1\u606f\u5237\u65b0\u5931\u8d25:', statsError);
        }

        // \u6b65\u9aa47: \u5b8c\u6210\u5904\u7406\u548c\u7528\u6237\u53cd\u9988

        const finalValidationDuration = performance.now() - validationStartTime;

        console.log('\u2705 \u4efb\u52a1\u6dfb\u52a0\u5b8c\u6210:', {
          \u6210\u529f\u6dfb\u52a0: validatedBackendTasks.length,

          \u539f\u59cb\u8f93\u5165: newTasks.length,

          \u9a8c\u8bc1\u8017\u65f6: `${finalValidationDuration.toFixed(2)}ms`,

          \u5f53\u524d\u603b\u6570: get().tasks.length,
        });

        // \u667a\u80fd\u7528\u6237\u53cd\u9988

        if (inputValidation.successRate === 1) {
          toast.success(`\u5df2\u6dfb\u52a0 ${validatedBackendTasks.length} \u4e2a\u4e0b\u8f7d\u4efb\u52a1`);
        } else {
          toast.success(
            `\u5df2\u6dfb\u52a0 ${validatedBackendTasks.length}/${newTasks.length} \u4e2a\u4efb\u52a1 - \u5df2\u8df3\u8fc7 ${inputValidation.invalidItems.length} \u4e2a\u65e0\u6548\u4efb\u52a1`
          );
        }

        // \u89e6\u53d1\u72b6\u6001\u9a8c\u8bc1\uff08\u975e\u963b\u585e\uff09

        setTimeout(() => get().validateAndSync(), 1000);
      } catch (error) {
        const validationDuration = performance.now() - validationStartTime;

        // \u8bb0\u5f55\u5931\u8d25\u7684\u9a8c\u8bc1\u7edf\u8ba1

        get().validationStats.recordValidation(false, validationDuration);

        set(state => ({
          isLoading: false,

          validationErrors: [
            ...state.validationErrors,
            `\u4efb\u52a1\u6dfb\u52a0\u5931\u8d25: ${error instanceof Error ? error.message : String(error)}`,
          ],

          lastValidationTime: Date.now(),
        }));

        // \u4f7f\u7528\u7edf\u4e00\u9519\u8bef\u5904\u7406\u673a\u5236

        console.error('\u6dfb\u52a0\u4e0b\u8f7d\u4efb\u52a1\u5931\u8d25\u4e0a\u4e0b\u6587', {
          \u8f93\u5165\u4efb\u52a1\u6570\u91cf: newTasks.length,

          \u9a8c\u8bc1\u8017\u65f6: `${validationDuration.toFixed(2)}ms`,

          \u9a8c\u8bc1\u7edf\u8ba1: get().validationStats.getStats(),
        });

        const appError = handleError('\u6dfb\u52a0\u4e0b\u8f7d\u4efb\u52a1', error);

        // \u91cd\u65b0\u629b\u51fa\u683c\u5f0f\u5316\u540e\u7684\u9519\u8bef

        throw appError;
      }
    },

    addTask: async newTask => {
      await get().addTasks([newTask]);
    },

    removeTasks: async taskIds => {
      try {
        await invoke('remove_download_tasks', { taskIds });

        set(state => ({
          tasks: state.tasks.filter(task => !taskIds.includes(task.id)),

          selectedTasks: state.selectedTasks.filter(id => !taskIds.includes(id)),
        }));

        await get().refreshStats();

        toast.success(`\u5df2\u5220\u9664 ${taskIds.length} \u4e2a\u4efb\u52a1`);
      } catch (error) {
        handleError('\u5220\u9664\u4efb\u52a1', error);

        throw error;
      }
    },

    clearCompletedTasks: async () => {
      try {
        await invoke('clear_completed_tasks');

        set(state => ({
          tasks: state.tasks.filter(task => task.status !== 'completed'),

          selectedTasks: state.selectedTasks.filter(id => {
            const task = state.tasks.find(t => t.id === id);

            return task && task.status !== 'completed';
          }),
        }));

        await get().refreshStats();

        toast.success('\u5df2\u6e05\u9664\u5b8c\u6210\u7684\u4efb\u52a1');
      } catch (error) {
        handleError('\u6e05\u9664\u5b8c\u6210\u4efb\u52a1', error);

        throw error;
      }
    },

    // \u4e0b\u8f7d\u63a7\u5236

    startDownload: async taskId => {
      try {
        await invoke('start_download', { taskId });

        set(state => ({
          tasks: state.tasks.map(task =>
            task.id === taskId ? { ...task, status: 'downloading' as TaskStatus } : task
          ),
        }));
      } catch (error) {
        handleError('\u542f\u52a8\u4e0b\u8f7d', error);

        throw error;
      }
    },

    pauseDownload: async taskId => {
      try {
        await invoke('pause_download', { taskId });

        set(state => ({
          tasks: state.tasks.map(task =>
            task.id === taskId ? { ...task, status: 'paused' as TaskStatus } : task
          ),
        }));
      } catch (error) {
        handleError('\u6682\u505c\u4e0b\u8f7d', error);

        throw error;
      }
    },

    resumeDownload: async taskId => {
      try {
        await invoke('resume_download', { taskId });

        set(state => ({
          tasks: state.tasks.map(task =>
            task.id === taskId ? { ...task, status: 'downloading' as TaskStatus } : task
          ),
        }));
      } catch (error) {
        handleError('\u6062\u590d\u4e0b\u8f7d', error);

        throw error;
      }
    },

    cancelDownload: async taskId => {
      try {
        await invoke('cancel_download', { taskId });

        set(state => ({
          tasks: state.tasks.map(task =>
            task.id === taskId ? { ...task, status: 'cancelled' as TaskStatus } : task
          ),
        }));
      } catch (error) {
        handleError('\u53d6\u6d88\u4e0b\u8f7d', error);

        throw error;
      }
    },

    startAllDownloads: async () => {
      const { tasks, selectedTasks } = get();

      // \u5982\u679c\u6709\u9009\u4e2d\u7684\u4efb\u52a1\uff0c\u53ea\u542f\u52a8\u9009\u4e2d\u7684\uff1b\u5426\u5219\u542f\u52a8\u6240\u6709\u53ef\u542f\u52a8\u7684\u4efb\u52a1

      const targetTasks =
        selectedTasks.length > 0 ? tasks.filter(task => selectedTasks.includes(task.id)) : tasks;

      const pendingTasks = targetTasks.filter(
        task => task.status === 'pending' || task.status === 'paused' || task.status === 'failed'
      );

      if (pendingTasks.length === 0) {
        toast('\u6ca1\u6709\u53ef\u542f\u52a8\u7684\u4e0b\u8f7d\u4efb\u52a1');

        return;
      }

      try {
        await Promise.all(pendingTasks.map(task => get().startDownload(task.id)));

        const message =
          selectedTasks.length > 0
            ? `\u5df2\u542f\u52a8 ${pendingTasks.length} \u4e2a\u9009\u4e2d\u7684\u4e0b\u8f7d\u4efb\u52a1`
            : `\u5df2\u542f\u52a8 ${pendingTasks.length} \u4e2a\u4e0b\u8f7d\u4efb\u52a1`;

        toast.success(message);
      } catch (error) {
        handleError('\u6279\u91cf\u542f\u52a8\u4e0b\u8f7d', error);

        throw error;
      }
    },

    pauseAllDownloads: async () => {
      const { tasks } = get();

      const downloadingTasks = tasks.filter(task => task.status === 'downloading');

      try {
        await Promise.all(downloadingTasks.map(task => get().pauseDownload(task.id)));

        toast.success(`\u5df2\u6682\u505c ${downloadingTasks.length} \u4e2a\u4e0b\u8f7d\u4efb\u52a1`);
      } catch (error) {
        handleError('\u6279\u91cf\u6682\u505c\u4e0b\u8f7d', error);

        throw error;
      }
    },

    retryFailedTasks: async () => {
      const { tasks } = get();

      const failedTasks = tasks.filter(task => task.status === 'failed');

      try {
        await Promise.all(failedTasks.map(task => get().startDownload(task.id)));

        toast.success(`\u5df2\u91cd\u8bd5 ${failedTasks.length} \u4e2a\u5931\u8d25\u4efb\u52a1`);
      } catch (error) {
        console.error('Failed to retry failed tasks:', error);

        toast.error('\u91cd\u8bd5\u5931\u8d25\u4efb\u52a1\u5931\u8d25');
      }
    },

    // \u6587\u4ef6\u5bfc\u5165 - \u589e\u5f3a\u7248\u672c\u5e26Zod\u9a8c\u8bc1

    importFromFile: async filePath => {
      const validationStartTime = performance.now();

      console.log('\u1f50d \u5f00\u59cb\u6587\u4ef6\u5bfc\u5165:', filePath);

      set({ isImporting: true, validationErrors: [] });

      try {
        // \u6b65\u9aa41: \u83b7\u53d6\u539f\u59cb\u5bfc\u5165\u6570\u636e

        const rawImportedData = await invoke<any[]>('import_csv_file', { file_path: filePath });

        console.log('\u1f4c4 \u5bfc\u5165\u7684\u539f\u59cb\u6570\u636e:', {
          count: rawImportedData.length,
          sample: rawImportedData[0],
        });

        if (!rawImportedData || rawImportedData.length === 0) {
          throw new Error('\u5bfc\u5165\u7684\u6587\u4ef6\u4e3a\u7a7a\u6216\u65e0\u6709\u6548\u6570\u636e');
        }

        // \u6b65\u9aa42: \u6279\u91cf\u9a8c\u8bc1\u5bfc\u5165\u6570\u636e

        console.log('\u1f50d \u6b65\u9aa42: \u9a8c\u8bc1\u5bfc\u5165\u6570\u636e...');

        const normalizedImportData = rawImportedData.map(data => normalizeImportedData(data));

        const importValidation = validateImportDataList(normalizedImportData, {
          stopOnFirstError: false,
        });

        const validationDuration = performance.now() - validationStartTime;

        get().validationStats.recordValidation(importValidation.success, validationDuration);

        if (importValidation.validItems.length === 0) {
          const errorDetails = importValidation.invalidItems

            .slice(0, 5) // \u53ea\u663e\u793a\u524d5\u4e2a\u9519\u8bef

            .map(item => `\u7b2c${item.index + 1}\u884c: ${item.errors.map(e => e.message).join(', ')}`)

            .join('; ');

          throw new Error(`\u6240\u6709\u5bfc\u5165\u6570\u636e\u5747\u65e0\u6548\u3002\u9519\u8bef\u8be6\u60c5: ${errorDetails}`);
        }

        const validImportedData = importValidation.validItems;

        // \u8bb0\u5f55\u9a8c\u8bc1\u7ed3\u679c

        if (importValidation.invalidItems.length > 0) {
          console.warn('\u26a0\ufe0f \u5bfc\u5165\u6570\u636e\u9a8c\u8bc1\u53d1\u73b0\u95ee\u9898:', {
            \u603b\u6570: importValidation.totalItems,

            \u6709\u6548: importValidation.validItems.length,

            \u65e0\u6548: importValidation.invalidItems.length,

            \u6210\u529f\u7387: `${(importValidation.successRate * 100).toFixed(1)}%`,
          });

          const errorMessages = importValidation.invalidItems
            .slice(0, 10)
            .map(item => `\u7b2c${item.index + 1}\u884c: ${item.errors.map(e => e.message).join(', ')}`);

          set(state => ({
            validationErrors: errorMessages,
          }));
        }

        console.log('\u2705 \u5bfc\u5165\u6570\u636e\u9a8c\u8bc1\u5b8c\u6210:', {
          \u539f\u59cb\u6570\u91cf: rawImportedData.length,

          \u6709\u6548\u6570\u91cf: validImportedData.length,

          \u6210\u529f\u7387: `${(importValidation.successRate * 100).toFixed(1)}%`,
        });

        // \u6b65\u9aa43: \u8f6c\u6362\u4e3a\u4efb\u52a1\u683c\u5f0f\uff0c\u786e\u4fdd\u6570\u636e\u5b8c\u6574\u6027

        const tasks = validImportedData
          .map((data, index) => {
            // \u4f7f\u7528\u65b0\u7684\u5b57\u6bb5\u540d\u4f18\u5148\uff0c\u5411\u540e\u517c\u5bb9\u65e7\u5b57\u6bb5\u540d

            const url = data.record_url || data.url || '';

            const title = data.kc_name || data.course_name || data.name || `\u4efb\u52a1_${index + 1}`;

            const outputPath = `${get().config.output_directory}/${data.zl_name || data.name || 'Unknown'}`;

            if (!url) {
              console.warn('\u26a0\ufe0f \u8df3\u8fc7\u65e0\u6548\u4efb\u52a1 - \u7f3a\u5c11URL:', data);

              return null;
            }

            return {
              url,

              title,

              output_path: outputPath,

              progress: 0,

              downloaded_size: 0,

              speed: 0,

              eta: undefined,

              error_message: undefined,

              // \u4fdd\u5b58\u5b8c\u6574\u7684\u89c6\u9891\u4fe1\u606f

              video_info: {
                zl_id: data.zl_id || data.id,

                zl_name: data.zl_name || data.name,

                record_url: data.record_url || data.url,

                kc_id: data.kc_id || data.course_id,

                kc_name: data.kc_name || data.course_name,
              },
            };
          })
          .filter(task => task !== null) as Omit<
          VideoTask,
          'id' | 'status' | 'created_at' | 'updated_at'
        >[];

        console.log('\u1f504 \u5904\u7406\u540e\u7684\u4efb\u52a1:', { count: tasks.length, sample: tasks[0] });

        // \u8c03\u7528addTasks\u6dfb\u52a0\u4efb\u52a1

        await get().addTasks(tasks);

        // \u6b65\u9aa45: \u5b8c\u6210\u5904\u7406\u548c\u7528\u6237\u53cd\u9988

        const finalValidationDuration = performance.now() - validationStartTime;

        console.log('\u2705 \u6587\u4ef6\u5bfc\u5165\u5b8c\u6210:', {
          \u5bfc\u5165\u6587\u4ef6: filePath,

          \u539f\u59cb\u6570\u636e: rawImportedData.length,

          \u6709\u6548\u6570\u636e: validImportedData.length,

          \u6700\u7ec8\u4efb\u52a1: tasks.length,

          \u9a8c\u8bc1\u8017\u65f6: `${finalValidationDuration.toFixed(2)}ms`,

          \u6570\u636e\u8d28\u91cf: `${(importValidation.successRate * 100).toFixed(1)}%`,
        });

        // \u667a\u80fd\u7528\u6237\u53cd\u9988

        if (importValidation.successRate === 1) {
          toast.success(`\u5df2\u5bfc\u5165 ${tasks.length} \u4e2a\u4efb\u52a1`);
        } else {
          toast.success(
            `\u5df2\u5bfc\u5165 ${tasks.length}/${rawImportedData.length} \u4e2a\u4efb\u52a1 - \u5df2\u8df3\u8fc7 ${importValidation.invalidItems.length} \u6761\u65e0\u6548\u6570\u636e`
          );
        }
      } catch (error) {
        const validationDuration = performance.now() - validationStartTime;

        // \u8bb0\u5f55\u5931\u8d25\u7684\u9a8c\u8bc1\u7edf\u8ba1

        get().validationStats.recordValidation(false, validationDuration);

        set(state => ({
          isImporting: false,

          validationErrors: [
            ...state.validationErrors,
            `\u6587\u4ef6\u5bfc\u5165\u5931\u8d25: ${error instanceof Error ? error.message : String(error)}`,
          ],

          lastValidationTime: Date.now(),
        }));

        // \u4f7f\u7528\u7edf\u4e00\u9519\u8bef\u5904\u7406\u673a\u5236

        console.error('\u5bfc\u5165\u6587\u4ef6\u5931\u8d25\u4e0a\u4e0b\u6587', {
          \u6587\u4ef6\u8def\u5f84: filePath,

          \u9a8c\u8bc1\u8017\u65f6: `${validationDuration.toFixed(2)}ms`,

          \u9a8c\u8bc1\u7edf\u8ba1: get().validationStats.getStats(),
        });

        const appError = handleError('\u5bfc\u5165\u6587\u4ef6', error);

        // \u91cd\u65b0\u629b\u51fa\u683c\u5f0f\u5316\u540e\u7684\u9519\u8bef

        throw appError;
      } finally {
        set({ isImporting: false });
      }
    },

    importFromUrls: async urls => {
      const tasks = urls.map(url => ({
        url,

        title: url,

        output_path: get().config.output_directory,

        progress: 0,

        downloaded_size: 0,

        speed: 0,

        eta: undefined,

        error_message: undefined,
      }));

      await get().addTasks(tasks);
    },

    // \u914d\u7f6e\u7ba1\u7406

    updateConfig: async newConfig => {
      try {
        const updatedConfig = { ...get().config, ...newConfig };

        await invoke('update_config', { config: updatedConfig });

        set({ config: updatedConfig });

        toast.success('\u914d\u7f6e\u5df2\u66f4\u65b0');
      } catch (error) {
        console.error('Failed to update config:', error);

        toast.error(`\u66f4\u65b0\u914d\u7f6e\u5931\u8d25: ${error}`);
      }
    },

    resetConfig: async () => {
      try {
        await invoke('reset_config');

        const defaultConfig = await invoke<DownloadConfig>('get_config');

        set({ config: defaultConfig });

        toast.success('\u914d\u7f6e\u5df2\u91cd\u7f6e');
      } catch (error) {
        console.error('Failed to reset config:', error);

        toast.error(`\u91cd\u7f6e\u914d\u7f6e\u5931\u8d25: ${error}`);
      }
    },

    // UI \u72b6\u6001

    setSelectedTasks: taskIds => {
      set({ selectedTasks: taskIds });
    },

    toggleTaskSelection: taskId => {
      set(state => ({
        selectedTasks: state.selectedTasks.includes(taskId)
          ? state.selectedTasks.filter(id => id !== taskId)
          : [...state.selectedTasks, taskId],
      }));
    },

    selectAllTasks: () => {
      const { tasks } = get();

      set({ selectedTasks: tasks.map(task => task.id) });
    },

    clearSelection: () => {
      set({ selectedTasks: [] });
    },

    // \u8fc7\u6ee4\u548c\u641c\u7d22

    setFilterStatus: status => {
      set({ filterStatus: status });
    },

    setSearchQuery: query => {
      set({ searchQuery: query });
    },

    setSortBy: (field, direction) => {
      set(state => ({
        sortBy: field,

        sortDirection:
          direction || (state.sortBy === field && state.sortDirection === 'asc' ? 'desc' : 'asc'),
      }));
    },

    // \u6570\u636e\u5237\u65b0 - \u589e\u5f3a\u7248\u672c\u5e26Zod\u9a8c\u8bc1

    refreshTasks: async () => {
      const validationStartTime = performance.now();

      try {
        const rawTasks = await invoke<any[]>('get_download_tasks');
        const normalizedRawTasks = Array.isArray(rawTasks)
          ? rawTasks.map(task => normalizeBackendTask(task))
          : [];

        // \ufffd\ufffd\u05a4\ufffd\ufffd\u02f7\ufffd\ufffd\u0635\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd

        const validation = validateVideoTaskList(normalizedRawTasks, { stopOnFirstError: false });

        const validationDuration = performance.now() - validationStartTime;

        get().validationStats.recordValidation(validation.success, validationDuration);

        if (validation.validItems.length === 0 && normalizedRawTasks.length > 0) {
          console.error('\u274c \u4ece\u540e\u7aef\u83b7\u53d6\u7684\u4efb\u52a1\u6570\u636e\u5168\u90e8\u65e0\u6548:', {
            \u539f\u59cb\u6570\u636e: rawTasks,

            \u9a8c\u8bc1\u9519\u8bef: validation.invalidItems.slice(0, 3),
          });

          set(state => ({
            validationErrors: [...state.validationErrors, '\u4ece\u540e\u7aef\u83b7\u53d6\u7684\u4efb\u52a1\u6570\u636e\u683c\u5f0f\u65e0\u6548'],

            lastValidationTime: Date.now(),
          }));

          return; // \u4e0d\u66f4\u65b0\u65e0\u6548\u6570\u636e
        }

        // \u66f4\u65b0\u6709\u6548\u4efb\u52a1

        set({ tasks: validation.validItems });

        // \u8bb0\u5f55\u90e8\u5206\u65e0\u6548\u6570\u636e

        if (validation.invalidItems.length > 0) {
          console.warn('\u26a0\ufe0f \u5237\u65b0\u4efb\u52a1\u65f6\u53d1\u73b0\u90e8\u5206\u65e0\u6548\u6570\u636e:', {
            \u6709\u6548: validation.validItems.length,

            \u65e0\u6548: validation.invalidItems.length,

            \u6210\u529f\u7387: `${(validation.successRate * 100).toFixed(1)}%`,
          });

          const errorMessages = validation.invalidItems
            .slice(0, 5)
            .map(item => `\u4efb\u52a1[${item.index}]: \u6570\u636e\u683c\u5f0f\u95ee\u9898`);

          set(state => ({
            validationErrors: [...state.validationErrors, ...errorMessages],

            lastValidationTime: Date.now(),
          }));
        }
      } catch (error) {
        const validationDuration = performance.now() - validationStartTime;

        get().validationStats.recordValidation(false, validationDuration);

        handleError('\u5237\u65b0\u4efb\u52a1\u5217\u8868', error, false); // \u4e0d\u663e\u793aToast\uff0c\u907f\u514d\u9891\u7e41\u5f39\u7a97
      }
    },

    refreshStats: async () => {
      const validationStartTime = performance.now();

      try {
        const rawStats = await invoke<unknown>('get_download_stats');

        const statsResult = DownloadStatsSchema.safeParse(rawStats);

        const validationDuration = performance.now() - validationStartTime;

        get().validationStats.recordValidation(statsResult.success, validationDuration);

        if (!statsResult.success) {
          console.error('\u26a0\ufe0f \u5b9e\u65f6\u7edf\u8ba1\u6570\u636e\u683c\u5f0f\u65e0\u6548:', {
            \u539f\u59cb\u6570\u636e: rawStats,

            \u9a8c\u8bc1\u9519\u8bef: statsResult.error.issues,
          });

          set(state => ({
            validationErrors: [...state.validationErrors, '\u5b9e\u65f6\u7edf\u8ba1\u6570\u636e\u683c\u5f0f\u65e0\u6548'],

            lastValidationTime: Date.now(),
          }));

          return;
        }

        set({ stats: ensureDownloadStats(statsResult.data) });
      } catch (error) {
        const validationDuration = performance.now() - validationStartTime;

        get().validationStats.recordValidation(false, validationDuration);

        handleError('\u5237\u65b0\u7edf\u8ba1\u4fe1\u606f', error, false);
      }
    },

    // \u72b6\u6001\u9a8c\u8bc1\u548c\u540c\u6b65

    validateAndSync: async () => {
      try {
        const { tasks, stats } = get();

        // \u68c0\u67e5\u662f\u5426\u9700\u8981\u9a8c\u8bc1

        if (!shouldValidate()) {
          return true;
        }

        console.log('\u1f50d \u6267\u884c\u72b6\u6001\u4e00\u81f4\u6027\u9a8c\u8bc1...');

        const validationResult = await validateState(tasks, stats);

        if (validationResult.isConsistent) {
          console.log('\u2705 \u72b6\u6001\u4e00\u81f4\uff0c\u65e0\u9700\u540c\u6b65');

          return true;
        }

        console.warn('\u26a0\ufe0f \u53d1\u73b0\u72b6\u6001\u4e0d\u4e00\u81f4:', validationResult.issues);

        // \u6267\u884c\u540c\u6b65

        const syncResult = await syncStates(
          validationResult.issues,

          validationResult.syncSuggestion,

          {
            updateTasks: newTasks => set({ tasks: newTasks.map(normalizeBackendTask) }),

            updateStats: newStats => set({ stats: ensureDownloadStats(newStats) }),
          }
        );

        if (syncResult) {
          console.log('\u2705 \u72b6\u6001\u540c\u6b65\u6210\u529f');
        } else {
          console.error('\u274c \u72b6\u6001\u540c\u6b65\u5931\u8d25');
        }

        return syncResult;
      } catch (error) {
        handleError('Validate state and sync', error, false);

        return false;
      }
    },

    forceSync: async () => {
      try {
        console.log('[forceSync] Start forced backend sync...');

        const [rawTasks, stats] = await Promise.all([
          invoke<any[]>('get_download_tasks'),

          invoke<DownloadStats>('get_download_stats'),
        ]);

        const normalizedTasks = Array.isArray(rawTasks)
          ? rawTasks.map(normalizeBackendTask)
          : [];

        set({ tasks: normalizedTasks, stats: ensureDownloadStats(stats) });

        console.log('[forceSync] Sync result:', {
          totalTasks: normalizedTasks.length,

          stats,
        });

        return true;
      } catch (error) {
        handleError('Force sync state', error);

        return false;
      }
    },

    // \u521d\u59cb\u5316 - \u589e\u5f3a\u7248\u672c\u5e26Zod\u9a8c\u8bc1

    initializeStore: async () => {
      const validationStartTime = performance.now();

      try {
        set({ isLoading: true, validationErrors: [] });

        // \u5e76\u884c\u83b7\u53d6\u6570\u636e

        console.log('\u1f680 \u5f00\u59cb\u521d\u59cb\u5316\u5e97\u4f53...');

        const [rawTasks, rawConfig, rawStats] = await Promise.all([

          invoke<any[]>('get_download_tasks'),

          invoke<any>('get_config'),

          invoke<any>('get_download_stats'),
        ]);
        const normalizedInitialTasks = Array.isArray(rawTasks)
          ? rawTasks.map(normalizeBackendTask)
          : [];


        console.log('\u1f50d \u5f00\u59cb\u6279\u91cf\u9a8c\u8bc1\u521d\u59cb\u5316\u6570\u636e...');

        // \u6279\u91cf\u9a8c\u8bc1\u6240\u6709\u6570\u636e

        const validations = validateRelatedData([
          { name: 'tasks', schema: TaskListSchema, data: normalizedInitialTasks },

          { name: 'config', schema: DownloadConfigSchema, data: rawConfig },

          { name: 'stats', schema: DownloadStatsSchema, data: rawStats },
        ]);

        const validationDuration = performance.now() - validationStartTime;

        get().validationStats.recordValidation(validations.success, validationDuration);

        // \u5206\u522b\u5904\u7406\u9a8c\u8bc1\u7ed3\u679c

        const validatedTasks = validations.results.tasks.success
          ? validations.results.tasks.data
          : [];

        const validatedConfig = validations.results.config.success
          ? validations.results.config.data
          : get().config; // \u4f7f\u7528\u9ed8\u8ba4\u914d\u7f6e

        const validatedStats = validations.results.stats.success
          ? validations.results.stats.data
          : get().stats; // \u4f7f\u7528\u9ed8\u8ba4\u7edf\u8ba1

        // \u8bb0\u5f55\u9a8c\u8bc1\u95ee\u9898

        const validationErrors: string[] = [];

        if (!validations.results.tasks.success) {
          validationErrors.push('\u540e\u7aef\u4efb\u52a1\u6570\u636e\u683c\u5f0f\u65e0\u6548');

          console.error('\u274c \u4efb\u52a1\u6570\u636e\u9a8c\u8bc1\u5931\u8d25:', validations.results.tasks.errors);
        }

        if (!validations.results.config.success) {
          validationErrors.push('\u540e\u7aef\u914d\u7f6e\u6570\u636e\u683c\u5f0f\u65e0\u6548');

          console.error('\u274c \u914d\u7f6e\u6570\u636e\u9a8c\u8bc1\u5931\u8d25:', validations.results.config.errors);
        }

        if (!validations.results.stats.success) {
          validationErrors.push('\u540e\u7aef\u7edf\u8ba1\u6570\u636e\u683c\u5f0f\u65e0\u6548');

          console.error('\u274c \u7edf\u8ba1\u6570\u636e\u9a8c\u8bc1\u5931\u8d25:', validations.results.stats.errors);
        }

        set({
          tasks: validatedTasks,

          config: validatedConfig,

          stats: ensureDownloadStats(validatedStats),

          isLoading: false,

          validationErrors,

          lastValidationTime: Date.now(),
        });

        const finalValidationDuration = performance.now() - validationStartTime;

        console.log('\u2705 Download store \u521d\u59cb\u5316\u5b8c\u6210:', {
          \u4efb\u52a1\u6570: validatedTasks.length,

          \u914d\u7f6e\u72b6\u6001: validations.results.config.success ? '\u6709\u6548' : '\u4f7f\u7528\u9ed8\u8ba4',

          \u7edf\u8ba1\u72b6\u6001: validations.results.stats.success ? '\u6709\u6548' : '\u4f7f\u7528\u9ed8\u8ba4',

          \u9a8c\u8bc1\u8017\u65f6: `${finalValidationDuration.toFixed(2)}ms`,

          \u6570\u636e\u8d28\u91cf: validations.success ? '100%' : '\u90e8\u5206\u65e0\u6548',
        });
      } catch (error) {
        const validationDuration = performance.now() - validationStartTime;

        get().validationStats.recordValidation(false, validationDuration);

        set(state => ({
          isLoading: false,

          validationErrors: [
            ...state.validationErrors,
            `\u521d\u59cb\u5316\u5931\u8d25: ${error instanceof Error ? error.message : String(error)}`,
          ],

          lastValidationTime: Date.now(),
        }));

        console.error('\u274c Download store \u521d\u59cb\u5316\u5931\u8d25:', error);

        handleError('\u521d\u59cb\u5316\u4e0b\u8f7d\u7ba1\u7406\u5668', error);

        throw error;
      }
    },

    // \u6570\u636e\u9a8c\u8bc1\u7ba1\u7406\u529f\u80fd

    getValidationStats: () => {
      return get().validationStats.getStats();
    },

    resetValidationStats: () => {
      get().validationStats.reset();

      set({ lastValidationTime: 0 });
    },

    clearValidationErrors: () => {
      set({ validationErrors: [] });
    },

    runDataIntegrityCheck: () => {
      const { tasks } = get();

      return checkDataIntegrity(tasks);
    },
  }))
);

// \u8fdb\u5ea6\u66f4\u65b0\u76d1\u542c\u5668 - \u589e\u5f3a\u7248\u672c\u5e26Zod\u9a8c\u8bc1

export const initializeProgressListener = () => {
  listen<any>('download_progress', event => {
    // \u9a8c\u8bc1\u8fdb\u5ea6\u66f4\u65b0\u6570\u636e

    const validationResult = validateProgressUpdate(event.payload);

    if (!validationResult.success) {
      console.error('\u274c \u8fdb\u5ea6\u66f4\u65b0\u6570\u636e\u65e0\u6548:', {
        payload: event.payload,

        errors: validationResult.errors,
      });

      return; // \u5ffd\u7565\u65e0\u6548\u6570\u636e
    }

    const update = validationResult.data!;

    useDownloadStore.setState(state => ({
      tasks: state.tasks.map(task => {
        if (task.id === update.task_id) {
          return {
            ...task,

            downloaded_size: update.downloaded_size,

            speed: update.speed,

            eta: update.eta,

            progress: update.total_size
              ? (update.downloaded_size / update.total_size) * 100
              : task.progress,

            updated_at: new Date().toISOString(),
          };
        }

        return task;
      }),
    }));
  });

  // \u4efb\u52a1\u72b6\u6001\u53d8\u5316\u76d1\u542c - \u589e\u5f3a\u7248\u672c\u5e26Zod\u9a8c\u8bc1

  listen<any>('task_status_changed', event => {
    // \u9a8c\u8bc1\u72b6\u6001\u53d8\u5316\u6570\u636e

    const payload = event.payload;

    if (!payload || typeof payload.task_id !== 'string' || !payload.status) {
      console.error('\u274c \u4efb\u52a1\u72b6\u6001\u53d8\u5316\u6570\u636e\u65e0\u6548:', payload);

      return; // \u5ffd\u7565\u65e0\u6548\u6570\u636e
    }

    const { task_id, status, error_message } = payload;

    useDownloadStore.setState(state => ({
      tasks: state.tasks.map(task => {
        if (task.id === task_id) {
          return {
            ...task,

            status,

            error_message,

            updated_at: new Date().toISOString(),
          };
        }

        return task;
      }),
    }));

    // \u5237\u65b0\u7edf\u8ba1\u4fe1\u606f

    useDownloadStore.getState().refreshStats();
  });
};

