import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { invoke } from '@tauri-apps/api/tauri';
import { listen } from '@tauri-apps/api/event';
import toast from 'react-hot-toast';
import { AppErrorHandler, handleError, withRetry, withTimeout } from '../utils/errorHandler';
import { StateValidator, validateState, syncStates, shouldValidate } from '../utils/stateValidator';
import { buildTaskIdPayload, buildTaskIdsPayload } from '../utils/tauriPayloads';
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
  AppConfig,
} from '../schemas';
import {
  TaskListSchema,
  DownloadConfigSchema,
  DownloadStatsSchema,
  validateRelatedData,
} from '../schemas';
import {
  createDefaultDownloadStats,
  ensureDownloadStats,
  calculateStatsFromTasks,
} from '../utils/downloadStats';

let listenersInitialized = false;
let listenerSetupPromise: Promise<void> | null = null;
let activeSyncTimer: number | null = null;
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

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as any).message);
  }
  return String(error ?? '');
};

const isConcurrencyError = (error: unknown) =>
  getErrorMessage(error).toLowerCase().includes('maximum concurrent downloads');

const CONCURRENCY_NOTICE_INTERVAL = 4000;
let lastConcurrencyNotice = 0;

interface StartDownloadOptions {
  enqueueOnLimit?: boolean;
  suppressConcurrencyToast?: boolean;
}

const DEFAULT_DOWNLOAD_CONFIG: DownloadConfig = {
  concurrent_downloads: 3,
  retry_attempts: 3,
  timeout_seconds: 30,
  user_agent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  proxy: undefined,
  headers: {},
  output_directory: './downloads',
  auto_verify_integrity: false,
  integrity_algorithm: 'sha256',
  expected_hashes: {},
};

const mergeDownloadConfig = (config?: Partial<DownloadConfig>): DownloadConfig => ({
  ...DEFAULT_DOWNLOAD_CONFIG,
  ...config,
  headers: {
    ...DEFAULT_DOWNLOAD_CONFIG.headers,
    ...(config?.headers ?? {}),
  },
  expected_hashes: {
    ...DEFAULT_DOWNLOAD_CONFIG.expected_hashes,
    ...(config?.expected_hashes ?? {}),
  },
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

  startDownload: (taskId: string, options?: StartDownloadOptions) => Promise<'started' | 'queued'>;

  pauseDownload: (taskId: string) => Promise<void>;

  resumeDownload: (taskId: string) => Promise<void>;

  cancelDownload: (taskId: string) => Promise<void>;

  startAllDownloads: () => Promise<void>;

  pauseAllDownloads: () => Promise<void>;

  retryFailedTasks: () => Promise<void>;

  // Actions - 文件导入
  importFromFile: (filePath: string) => Promise<void>;
  importFromUrls: (urls: string[]) => Promise<void>;

  // Actions - 配置管理
  updateConfig: (newConfig: Partial<DownloadConfig>) => Promise<void>;
  setDownloadConfig: (newConfig: Partial<DownloadConfig>) => void;
  resetConfig: () => Promise<void>;

  // Actions - UI 状态
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

  pendingStartQueue: string[];
  isProcessingQueue: boolean;
  recentImportTaskIds: string[];
  recentImportSnapshot: VideoTask[];
  resumePriority: string[];
  queueFrozen: boolean;
  enqueueDownloads: (taskIds: string[]) => void;
  processStartQueue: () => Promise<void>;
  recordRecentImport: (taskIds: string[], snapshot: VideoTask[]) => void;
  clearRecentImport: () => void;
}

export const useDownloadStore = create<DownloadState>()(
  subscribeWithSelector((set, get) => ({
    // \u521d\u59cb\u72b6\u6001

    tasks: [],

    config: mergeDownloadConfig(),

    stats: createDefaultDownloadStats(),

    // \u6570\u636e\u9a8c\u8bc1\u72b6\u6001\u521d\u59cb\u5316

    validationStats: createValidationStats(),

    lastValidationTime: 0,

    validationErrors: [],

    isImporting: false,

    isLoading: false,

    selectedTasks: [],
    pendingStartQueue: [],
    isProcessingQueue: false,
    recentImportTaskIds: [],
    recentImportSnapshot: [],
    resumePriority: [],
    queueFrozen: false,

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
        let validatedBackendTasks: VideoTask[];

        if (!backendTasksSource) {
          console.warn(
            '[addTasks] Backend did not return a task list, falling back to locally validated tasks'
          );
          validatedBackendTasks = processedTasks;
        } else {
          const backendValidation = validateVideoTaskList(backendTasksSource, {
            stopOnFirstError: false,
          });

          if (!backendValidation.success || backendValidation.validItems.length === 0) {
            console.warn(
              '\u26a0\ufe0f \u540e\u7aef\u4efb\u52a1\u6570\u636e\u4e0d\u517c\u5bb9\uff0c\u4f7f\u7528\u672c\u5730\u6570\u636e\u63d0\u4ea4',
              {
                \u539f\u59cb\u54cd\u5e94: backendTasksSource,
                \u9a8c\u8bc1\u9519\u8bef: backendValidation.invalidItems,
              }
            );
            validatedBackendTasks = processedTasks;
          } else {
            validatedBackendTasks = backendValidation.validItems;
          }
        }

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
          const updatedTasks = [...state.tasks];
          const indexById = new Map(updatedTasks.map((task, index) => [task.id, index]));

          for (const task of validatedBackendTasks) {
            const existingIndex = indexById.get(task.id);
            if (existingIndex !== undefined) {
              updatedTasks[existingIndex] = task;
            } else {
              indexById.set(task.id, updatedTasks.length);
              updatedTasks.push(task);
            }
          }

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

        get().recordRecentImport(
          validatedBackendTasks.map(task => task.id),
          validatedBackendTasks
        );

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

        handleError('\u6dfb\u52a0\u4e0b\u8f7d\u4efb\u52a1', error);
        return;
      }
    },

    addTask: async newTask => {
      await get().addTasks([newTask]);
    },

    removeTasks: async taskIds => {
      try {
        await invoke('remove_download_tasks', buildTaskIdsPayload(taskIds));

        set(state => ({
          tasks: state.tasks.filter(task => !taskIds.includes(task.id)),

          selectedTasks: state.selectedTasks.filter(id => !taskIds.includes(id)),
          resumePriority: state.resumePriority.filter(id => !taskIds.includes(id)),
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
          resumePriority: state.resumePriority.filter(id => {
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

    startDownload: async (taskId, options = {}) => {
      const { enqueueOnLimit = true, suppressConcurrencyToast = false } = options;
      console.log('[START_DOWNLOAD] Initiating download for task:', taskId);
      try {
        // 只要用户主动点开始，解冻队列
        set({ queueFrozen: false });
        console.log('[START_DOWNLOAD] Calling invoke start_download...');
        await invoke('start_download', buildTaskIdPayload(taskId));
        console.log('[START_DOWNLOAD] invoke returned successfully for task:', taskId);

        set(state => ({
          tasks: state.tasks.map(task =>
            task.id === taskId ? { ...task, status: 'downloading' as TaskStatus } : task
          ),
          resumePriority: state.resumePriority.filter(id => id !== taskId),
        }));

        void get().refreshTasks().catch(err => console.warn('[startDownload] sync failed', err));
        void get().refreshStats().catch(err => console.warn('[startDownload] stats sync failed', err));

        console.log('[START_DOWNLOAD] Task started successfully:', taskId);
        return 'started';
      } catch (error) {
        if (isConcurrencyError(error)) {
          set(state => {
            if (state.pendingStartQueue.includes(taskId)) {
              return {};
            }
            const nextQueue = enqueueOnLimit
              ? [...state.pendingStartQueue, taskId]
              : [taskId, ...state.pendingStartQueue];
            return { pendingStartQueue: nextQueue };
          });

          if (!suppressConcurrencyToast) {
            const now = Date.now();
            if (now - lastConcurrencyNotice > CONCURRENCY_NOTICE_INTERVAL) {
              toast('当前下载达到最大并发，其余任务已自动排队等待。');
              lastConcurrencyNotice = now;
            }
          }

          void get().processStartQueue();

          return 'queued';
        }

        handleError('启动下载', error);
        throw error;
      }
    },

    pauseDownload: async taskId => {
      console.log('[PAUSE_DOWNLOAD] Starting pause for task:', taskId);
      try {
        console.log('[PAUSE_DOWNLOAD] Calling invoke pause_download...');
        await invoke('pause_download', buildTaskIdPayload(taskId));
        console.log('[PAUSE_DOWNLOAD] invoke returned successfully for task:', taskId);

        set(state => {
          const updatedTasks = state.tasks.map(task =>
            task.id === taskId ? { ...task, status: 'paused' as TaskStatus } : task
          );
          const filteredPriority = state.resumePriority.filter(id => id !== taskId);
          console.log('[PAUSE_DOWNLOAD] Updated task state to paused:', taskId);
          return {
            tasks: updatedTasks,
            resumePriority: [taskId, ...filteredPriority],
            // 暂停后不要进入自动启动队列，避免立刻被重新启动
            pendingStartQueue: state.pendingStartQueue.filter(id => id !== taskId),
            queueFrozen: true, // 暂停单个任务时也冻结队列，避免立即启动其他任务
          };
        });

        void get().refreshTasks().catch(err => console.warn('[pauseDownload] sync failed', err));
        void get().refreshStats().catch(err => console.warn('[pauseDownload] stats sync failed', err));
      } catch (error) {
        console.error('[PAUSE_DOWNLOAD] Failed to pause task:', taskId, error);
        handleError('暂停下载', error);

        throw error;
      }
    },

    resumeDownload: async taskId => {
      try {
        set({ queueFrozen: false });
        await invoke('resume_download', buildTaskIdPayload(taskId));

        set(state => ({
          tasks: state.tasks.map(task =>
            task.id === taskId ? { ...task, status: 'downloading' as TaskStatus } : task
          ),
          resumePriority: state.resumePriority.filter(id => id !== taskId),
        }));

        void get().refreshTasks().catch(err => console.warn('[resumeDownload] sync failed', err));
        void get().refreshStats().catch(err => console.warn('[resumeDownload] stats sync failed', err));
      } catch (error) {
        if (isConcurrencyError(error)) {
           set(state => {
            if (state.pendingStartQueue.includes(taskId)) {
              return {};
            }
            // 恢复的任务优先级通常较高，放到队列前面
            return { pendingStartQueue: [taskId, ...state.pendingStartQueue] };
          });
          
          toast('当前下载达到最大并发，任务已加入队列等待恢复。');
          void get().processStartQueue();
          return;
        }

        handleError('\u6062\u590d\u4e0b\u8f7d', error);

        throw error;
      }
    },

    cancelDownload: async taskId => {
      try {
        await invoke('cancel_download', buildTaskIdPayload(taskId));

        set(state => ({
          tasks: state.tasks.map(task =>
            task.id === taskId ? { ...task, status: 'cancelled' as TaskStatus } : task
          ),
          resumePriority: state.resumePriority.filter(id => id !== taskId),
        }));

        void get().refreshTasks().catch(err => console.warn('[cancelDownload] sync failed', err));
        void get().refreshStats().catch(err => console.warn('[cancelDownload] stats sync failed', err));
      } catch (error) {
        handleError('取消下载', error);

        throw error;
      }
    },

    startAllDownloads: async () => {
      const { tasks, selectedTasks } = get();
      const targetTasks =
        selectedTasks.length > 0
          ? tasks.filter(task => selectedTasks.includes(task.id))
          : tasks;

      const startableTasks = targetTasks.filter(task =>
        ['pending', 'paused', 'failed'].includes(task.status)
      );

      if (startableTasks.length === 0) {
        toast('没有可开始的下载任务');
        return;
      }

      // 如果用户有选中项，逐个处理以保持顺序
      if (selectedTasks.length > 0) {
        for (const task of startableTasks) {
          await get().startDownload(task.id, { enqueueOnLimit: true });
        }
        return;
      }

      const orderedTaskIds = startableTasks.map(task => task.id);
      set({ queueFrozen: false });
      get().enqueueDownloads(orderedTaskIds);
      toast.success(`已提交 ${orderedTaskIds.length} 个任务到下载队列`);
    },

    pauseAllDownloads: async () => {
      const { tasks } = get();

      const downloadingTasks = tasks.filter(task => task.status === 'downloading');

      try {
        // 逐个暂停，避免因某个异常阻塞全部
        for (const task of downloadingTasks) {
          try {
            // 一次仅暂停非 completed/cancelled 的任务
            const safeTask = get().tasks.find(t => t.id === task.id);
            if (safeTask && safeTask.status === 'downloading') {
              // 调用单条暂停
              await get().pauseDownload(task.id);
            }
          } catch (err) {
            console.warn('Pause task failed', task.id, err);
          }
        }
        set(state => {
        const pausedOrder = downloadingTasks.map(task => task.id);
        const remaining = state.resumePriority.filter(id => !pausedOrder.includes(id));
        const queuedWithoutPaused = state.pendingStartQueue.filter(id => !pausedOrder.includes(id));
        return {
          resumePriority: [...pausedOrder, ...remaining],
          // 暂停时不把任务重新塞进启动队列，避免自动重启
          pendingStartQueue: queuedWithoutPaused,
          isProcessingQueue: false,
          queueFrozen: true, // 全局暂停时冻结队列，直到用户再次点击开始
        };
      });

        toast.success(`\u5df2\u6682\u505c ${downloadingTasks.length} \u4e2a\u4e0b\u8f7d\u4efb\u52a1`);
      } catch (error) {
        handleError('\u6279\u91cf\u6682\u505c\u4e0b\u8f7d', error);

        throw error;
      }
    },

    retryFailedTasks: async () => {
      const { tasks } = get();

      const failedTasks = tasks.filter(task => task.status === 'failed');

      get().enqueueDownloads(failedTasks.map(task => task.id));
      toast.success(`\u5df2\u5c06 ${failedTasks.length} \u4e2a\u5931\u8d25\u4efb\u52a1\u91cd\u65b0\u63d0\u4ea4\u5230\u961f\u5217`);
    },

    enqueueDownloads: taskIds => {
      const uniqueIds = taskIds.filter(Boolean);
      if (uniqueIds.length === 0) {
        return;
      }

      set(state => {
        const resumeOrder = state.resumePriority;
        const existing = new Set(state.pendingStartQueue);
        // additions 按 resumePriority 优先级排序
        const additions = uniqueIds
          .filter(id => !existing.has(id))
          .sort((a, b) => {
            const ia = resumeOrder.indexOf(a);
            const ib = resumeOrder.indexOf(b);
            if (ia === -1 && ib === -1) return 0;
            if (ia === -1) return 1;
            if (ib === -1) return -1;
            return ia - ib;
          });
        if (additions.length === 0) {
          return {};
        }
        return { pendingStartQueue: [...state.pendingStartQueue, ...additions] };
      });

      void get().processStartQueue();
    },

    processStartQueue: async () => {
      if (get().queueFrozen) {
        return;
      }
      if (get().isProcessingQueue) {
        return;
      }

      set({ isProcessingQueue: true });
      try {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const state = get();
          // 过滤掉不应再次启动的任务
          let queue = state.pendingStartQueue.filter(id => {
            const task = state.tasks.find(t => t.id === id);
            return (
              task &&
              task.status !== 'completed' &&
              task.status !== 'cancelled' &&
              task.status !== 'downloading'
            );
          });

          // 按 resumePriority 优先恢复暂停过的任务
          if (queue.length > 1 && state.resumePriority.length > 0) {
            const idxMap = new Map<string, number>();
            state.resumePriority.forEach((id, idx) => idxMap.set(id, idx));
            queue = [...queue].sort((a, b) => {
              const ia = idxMap.get(a);
              const ib = idxMap.get(b);
              if (ia === undefined && ib === undefined) return 0;
              if (ia === undefined) return 1;
              if (ib === undefined) return -1;
              return ia - ib;
            });
          }

          if (queue.length === 0) {
            break;
          }

          const maxConcurrent =
            state.config.concurrent_downloads ?? DEFAULT_DOWNLOAD_CONFIG.concurrent_downloads;
          const activeCount = state.tasks.filter(task => task.status === 'downloading').length;
          const available = Math.max(maxConcurrent - activeCount, 0);

          if (available <= 0) {
            break;
          }

          const toStart = queue.slice(0, available);

          // Remove tasks to be started from the queue
          set(current => ({
            pendingStartQueue: current.pendingStartQueue.filter(id => !toStart.includes(id))
          }));

          for (const taskId of toStart) {
            const result = await get().startDownload(taskId, {
              enqueueOnLimit: false,
              suppressConcurrencyToast: true,
            });

            if (result === 'queued') {
              // If rejected, put back in queue and stop processing
              set(current => ({
                pendingStartQueue: current.pendingStartQueue.includes(taskId)
                  ? current.pendingStartQueue
                  : [taskId, ...current.pendingStartQueue],
              }));
              return;
            }
          }
        }
      } finally {
        set({ isProcessingQueue: false });
      }
    },

    recordRecentImport: (taskIds, snapshot) => {
      set({
        recentImportTaskIds: taskIds,
        recentImportSnapshot: snapshot,
      });
    },

    clearRecentImport: () => {
      set({
        recentImportTaskIds: [],
        recentImportSnapshot: [],
      });
    },

    // \u6587\u4ef6\u5bfc\u5165 - \u589e\u5f3a\u7248\u672c\u5e26Zod\u9a8c\u8bc1

    importFromFile: async filePath => {
      const validationStartTime = performance.now();

      console.log('\u1f50d \u5f00\u59cb\u6587\u4ef6\u5bfc\u5165:', filePath);

      set({ isImporting: true, validationErrors: [] });

      try {
        // \u6b65\u9aa41: \u83b7\u53d6\u539f\u59cb\u5bfc\u5165\u6570\u636e

        const rawImportedData = await invoke<any[]>('import_csv_file', { filePath });

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
        const currentAppConfig = await invoke<AppConfig>('get_config').catch(() => null);
        if (!currentAppConfig) {
          throw new Error('获取现有配置失败，未能同步到后端');
        }

        const mergedDownloadConfig = mergeDownloadConfig({
          ...(currentAppConfig.download ?? DEFAULT_DOWNLOAD_CONFIG),
          ...newConfig,
        });

        const mergedAppConfig: AppConfig = {
          ...currentAppConfig,
          download: mergedDownloadConfig,
        };

        await invoke('update_config', {
          newConfig: mergedAppConfig,
          new_config: mergedAppConfig,
        });

        set({ config: mergedDownloadConfig });

        toast.success('\u914d\u7f6e\u5df2\u66f4\u65b0');
      } catch (error) {
        handleError('\u66f4\u65b0\u914d\u7f6e', error);
        throw error;
      }
    },

    setDownloadConfig: (newConfig: Partial<DownloadConfig>) => {
      const baseDownloadConfig = get().config ?? DEFAULT_DOWNLOAD_CONFIG;
      const mergedDownloadConfig = mergeDownloadConfig({
        ...baseDownloadConfig,
        ...newConfig,
      });
      set({ config: mergedDownloadConfig });
    },

    resetConfig: async () => {
      try {
        const resetConfig = await invoke<AppConfig>('reset_config');

        const normalizedConfig = mergeDownloadConfig(resetConfig.download);

        set({ config: normalizedConfig });

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

        const currentTasks = get().tasks;
        if (normalizedRawTasks.length === 0 && currentTasks.length > 0) {
          console.warn('[refreshTasks] Backend returned empty list - preserving local tasks');
          set(state => ({
            validationErrors: [
              ...state.validationErrors,
              '后端返回空任务列表，已保留本地任务',
            ],
            lastValidationTime: Date.now(),
          }));
          return;
        }

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

        const ensuredStats = ensureDownloadStats(statsResult.data);
        const localTasks = get().tasks;
        const derivedStats = localTasks.length > 0 ? calculateStatsFromTasks(localTasks) : null;

        const mergedStats = derivedStats
          ? {
            ...ensuredStats,
            total_tasks: derivedStats.total_tasks,
            completed_tasks: derivedStats.completed_tasks,
            failed_tasks: derivedStats.failed_tasks,
            active_downloads: derivedStats.active_downloads,
            total_downloaded: derivedStats.total_downloaded,
            average_speed: derivedStats.average_speed,
          }
          : ensuredStats;

        set({ stats: mergedStats });
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

        const [rawTasks, rawAppConfig, rawStats] = await Promise.all([

          invoke<any[]>('get_download_tasks'),

          invoke<AppConfig>('get_config'),

          invoke<any>('get_download_stats'),
        ]);

        const normalizedConfig = mergeDownloadConfig(rawAppConfig?.download);
        const normalizedInitialTasks = Array.isArray(rawTasks)
          ? rawTasks.map(normalizeBackendTask)
          : [];


        console.log('\u1f50d \u5f00\u59cb\u6279\u91cf\u9a8c\u8bc1\u521d\u59cb\u5316\u6570\u636e...');

        // \u6279\u91cf\u9a8c\u8bc1\u6240\u6709\u6570\u636e

        const validations = validateRelatedData([
          { name: 'tasks', schema: TaskListSchema, data: normalizedInitialTasks },

          { name: 'config', schema: DownloadConfigSchema, data: normalizedConfig },

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

export const initializeProgressListener = async () => {
  if (listenersInitialized) {
    return;
  }

  if (listenerSetupPromise) {
    return listenerSetupPromise;
  }

  const setupListeners = async () => {
    try {
      let progressEventCount = 0;
      const lastProgressUpdate = new Map<string, number>();
      const unlistenProgress = await listen<any>('download_progress', event => {
        progressEventCount++;
        
        // 只在首次和每10次记录详细日志，避免刷屏
        const shouldLogDetail = progressEventCount <= 3 || progressEventCount % 10 === 0;
        
        if (shouldLogDetail) {
          console.log(`[FRONTEND_PROGRESS] Event #${progressEventCount}:`, {
            task_id: event.payload?.task_id,
            progress: event.payload?.progress,
            speed: event.payload?.speed,
            downloaded: event.payload?.downloaded_size,
          });
        }

        const validationResult = validateProgressUpdate(event.payload);

        if (!validationResult.success) {
          // 验证失败时尝试使用原始数据（降级处理）
          console.warn('⚠️ 进度验证失败，尝试降级处理:', {
            payload: event.payload,
            errors: validationResult.errors,
          });
          
          // 如果有基本必要字段，仍然尝试更新
          const rawPayload = event.payload;
          if (rawPayload?.task_id && typeof rawPayload.downloaded_size === 'number') {
            const fallbackUpdate = {
              task_id: String(rawPayload.task_id),
              downloaded_size: rawPayload.downloaded_size ?? 0,
              total_size: rawPayload.total_size,
              speed: rawPayload.speed ?? 0,
              eta: rawPayload.eta,
              progress: rawPayload.progress ?? 0,
            };
            updateTaskProgress(fallbackUpdate);
            return;
          }
          return;
        }

        const update = validationResult.data!;
        if (update.task_id && typeof update.downloaded_size === 'number') {
          const now = Date.now();
          const last = lastProgressUpdate.get(update.task_id) ?? 0;
          const pct = typeof update.progress === 'number' ? update.progress * 100 : undefined;
          const forceEmit = (pct ?? 0) >= 99 || progressEventCount <= 3;
          if (!forceEmit && now - last < 1000) {
            return; // 节流：默认1秒一次
          }
          lastProgressUpdate.set(update.task_id, now);
          updateTaskProgress({
            task_id: update.task_id,
            downloaded_size: update.downloaded_size,
            total_size: update.total_size,
            speed: update.speed,
            eta: update.eta,
            progress: update.progress,
          });
        }
      });

      // 抽取进度更新逻辑为独立函数
      function updateTaskProgress(update: {
        task_id: string;
        downloaded_size: number;
        total_size?: number | null;
        speed?: number;
        eta?: number | null;
        progress?: number;
      }) {
        const totalSize =
          typeof update.total_size === 'number' && Number.isFinite(update.total_size)
            ? update.total_size
            : undefined;
        const etaValue =
          typeof update.eta === 'number' && Number.isFinite(update.eta) ? update.eta : undefined;
        const normalizedSpeed = Math.max(0, 
          typeof update.speed === 'number' && Number.isFinite(update.speed) ? update.speed : 0
        );
        const normalizedProgress =
          typeof update.progress === 'number' && Number.isFinite(update.progress)
            ? Math.min(Math.max(update.progress * 100, 0), 100)
            : undefined;

        useDownloadStore.setState(state => ({
          tasks: state.tasks.map(task => {
            if (task.id === update.task_id) {
              let progress = normalizedProgress ?? task.progress;

              // 如果进度为0但有下载数据，从下载量计算进度
              if (progress === 0 && totalSize && totalSize > 0 && update.downloaded_size > 0) {
                progress = Math.min((update.downloaded_size / totalSize) * 100, 100);
              }

              return {
                ...task,
                downloaded_size: update.downloaded_size,
                file_size: totalSize ?? task.file_size,
                speed: normalizedSpeed,
                eta: etaValue,
                progress,
                updated_at: new Date().toISOString(),
              };
            }

            return task;
          }),
        }));
      }

      const unlistenStatus = await listen<any>('task_status_changed', event => {
        const payload = event.payload;

        if (!payload || typeof payload.task_id !== 'string' || !payload.status) {
          console.error('❌ 任务状态变更数据无效:', payload);
          return;
        }

        const { task_id, status: rawStatus, error_message } = payload;
        const status = fromBackendStatus(rawStatus);

        console.log(`🔄 任务 ${task_id} 状态变化: ${rawStatus} → ${status}`);

        useDownloadStore.setState(state => {
          const updatedTasks = state.tasks.map(task => {
            if (task.id === task_id) {
              return {
                ...task,
                status,
                error_message,
                updated_at: new Date().toISOString(),
              };
            }

            return task;
          });

          const filteredPriority = state.resumePriority.filter(id => id !== task_id);
          const nextPriority =
            status === 'paused' ? [task_id, ...filteredPriority] : filteredPriority;
          const nextQueueFrozen = status === 'paused' ? true : state.queueFrozen;
          const nextPendingStartQueue = state.pendingStartQueue.filter(id => id !== task_id);

          return {
            tasks: updatedTasks,
            resumePriority: nextPriority,
            queueFrozen: nextQueueFrozen,
            pendingStartQueue: nextPendingStartQueue,
          };
        });

        useDownloadStore.getState().refreshStats();
        void useDownloadStore.getState().processStartQueue();
      });

      const cleanup = () => {
        if (!listenersInitialized) {
          return;
        }
        try {
          unlistenProgress();
        } catch (error) {
          console.warn('Failed to remove progress listener', error);
        }
        try {
          unlistenStatus();
        } catch (error) {
          console.warn('Failed to remove status listener', error);
        }
        listenersInitialized = false;
        listenerSetupPromise = null;
      };

      if (typeof window !== 'undefined') {
        window.addEventListener('beforeunload', cleanup, { once: true });
      }

      listenersInitialized = true;
    } catch (error) {
      listenerSetupPromise = null;
      console.error('Failed to initialize download listeners', error);
      throw error;
    }
  };

  listenerSetupPromise = setupListeners();

  try {
    await listenerSetupPromise;
  } catch {
    if (typeof window !== 'undefined') {
      window.setTimeout(() => {
        void initializeProgressListener();
      }, 1000);
    }
  }

  if (typeof window !== 'undefined' && activeSyncTimer === null) {
    activeSyncTimer = window.setInterval(() => {
      const state = useDownloadStore.getState();
      const hasActiveDownloads = state.tasks.some(task => task.status === 'downloading');
      const hasQueuedStarts = state.pendingStartQueue.length > 0;

      if (!hasActiveDownloads && !hasQueuedStarts) {
        return;
      }

      state.refreshTasks().catch(err => console.warn('[sync] refreshTasks failed', err));
      state.refreshStats().catch(err => console.warn('[sync] refreshStats failed', err));
    }, 1500);
  }
};
