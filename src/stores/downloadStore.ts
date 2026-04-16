import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import toast from 'react-hot-toast';
import { handleError } from '../utils/errorHandler';
import { validateState, syncStates, shouldValidate } from '../utils/stateValidator';
import {
  normalizeTaskData,
  createValidationStats,
} from '../utils/dataValidator';
import type {
  VideoTask,
  TaskStatus,
  DownloadConfig,
  DownloadStats,
} from '../schemas';
import {
  createDefaultDownloadStats,
  ensureDownloadStats,
  calculateStatsFromTasks,
} from '../utils/downloadStats';
import {
  convertTaskForBackend,
  normalizeBackendTask,
} from '../features/downloads/model/runtimeTaskMapping';
import {
  startDownloadCommand,
  pauseDownloadCommand,
  resumeDownloadCommand,
  cancelDownloadCommand,
  startAllDownloadsCommand,
  pauseAllDownloadsCommand,
} from '../features/downloads/api/downloadCommands';
import {
  removeTasksCommand,
  clearCompletedTasksCommand,
  updateTaskOutputPathsCommand,
} from '../features/downloads/api/taskMutations';
import { addDownloadTasksCommand } from '../features/downloads/api/taskCreation';
import { importRawFileCommand } from '../features/downloads/api/importCommands';
import {
  DEFAULT_DOWNLOAD_VIEW_STATE,
  createDownloadViewStateActions,
} from '../features/downloads/state/downloadViewState';
import {
  DEFAULT_IMPORT_SESSION_STATE,
  createImportSessionStateActions,
} from '../features/downloads/state/importSessionState';
import {
  buildTasksFromUrls,
  filterExistingTaskIds,
} from '../features/downloads/state/importOrchestration';
import { executeImportFromFileStoreAction } from '../features/downloads/state/importFileStoreAction';
import { executeTaskCreationStoreAction } from '../features/downloads/state/taskCreationStoreAction';
import {
  executeClearCompletedTasksMutation,
  executeRemoveTasksMutation,
} from '../features/downloads/state/taskMutationEffects';
import { executeOutputPathOverrideStoreAction } from '../features/downloads/state/taskOutputPathStoreAction';
import {
  executePauseAllDownloads,
  executeStartAllDownloads,
} from '../features/downloads/state/batchControlEffects';
import { executeRetryFailedTasks } from '../features/downloads/state/retryFailedEffects';
import {
  runControlCommandWithRuntimeSync,
  runQueuedControlCommand,
} from '../features/downloads/state/commandControlEffects';
import { executeInitializeStoreStoreAction } from '../features/downloads/state/initializeStoreStoreAction';
import {
  fetchRuntimeTasks,
  fetchRuntimeStats,
  syncRuntimeStateWith,
} from '../features/downloads/state/runtimeSync';
import {
  getDownloadStatsCommand,
  getDownloadTasksCommand,
} from '../features/downloads/api/runtimeQueries';
import { runDataIntegrityCheckFor } from '../features/downloads/state/validationHelpers';
import {
  executeForceSyncStoreAction,
  executeValidateAndSyncStoreAction,
} from '../features/downloads/state/validationStoreAction';
import { reportFrontendDiagnosticIfEnabled } from '../utils/frontendLogging';

interface StartDownloadOptions {
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
  ) => Promise<VideoTask[]>;

  addTask: (
    task: VideoTask | Omit<VideoTask, 'id' | 'status' | 'created_at' | 'updated_at'>
  ) => Promise<VideoTask | undefined>;

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
  applyOutputDirectoryOverride: (taskIds: string[], overrideOutputDirectory: string) => Promise<void>;

  // Actions - 文件导入
  importFromFile: (filePath: string) => Promise<void>;
  importFromUrls: (urls: string[]) => Promise<void>;

  // Actions - 配置镜像同步
  setDownloadConfig: (newConfig: Partial<DownloadConfig>) => void;

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

  syncRuntimeState: (reason?: string) => Promise<void>;

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

  recentImportTaskIds: string[];
  recentImportSnapshot: VideoTask[];
  enqueueDownloads: (taskIds: string[]) => void;
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

    ...DEFAULT_DOWNLOAD_VIEW_STATE,
    ...DEFAULT_IMPORT_SESSION_STATE,

    ...createDownloadViewStateActions(set),
    ...createImportSessionStateActions(set),

    refreshTasks: async () => {
      const rawTasks = await fetchRuntimeTasks(getDownloadTasksCommand);
      const normalizedTasks = rawTasks.map(normalizeBackendTask);

      set({ tasks: normalizedTasks });
    },

    refreshStats: async () => {
      const stats = await fetchRuntimeStats(getDownloadStatsCommand);

      set({ stats: ensureDownloadStats(stats) });
    },

    syncRuntimeState: async reason => {
      try {
        if (reason) {
          reportFrontendDiagnosticIfEnabled('info', '[syncRuntimeState] syncing runtime state', reason);
        }

        await syncRuntimeStateWith(get().refreshTasks, get().refreshStats);
      } catch (error) {
        handleError(`同步运行时状态${reason ? ` (${reason})` : ''}`, error, false);
        throw error;
      }
    },

    // 任务管理 - 增强版本带Zod验证

    addTasks: async newTasks => {
      const validationStartTime = performance.now();

      try {
        reportFrontendDiagnosticIfEnabled('info', 'download_store:add_tasks:start', {
          count: newTasks.length,
          sample: newTasks[0],
        });

        set({ isLoading: true, validationErrors: [] });

        reportFrontendDiagnosticIfEnabled('info', 'download_store:add_tasks:validation:start');

        return await executeTaskCreationStoreAction({
          newTasks,
          validationStartTime,
          convertTaskForBackend,
          addDownloadTasksCommand,
          normalizeBackendTask,
          currentTasks: get().tasks,
          recordValidation: get().validationStats.recordValidation,
          getValidationStats: () => get().validationStats.getStats(),
          getValidationErrors: () => get().validationErrors,
          applyValidationPatch: patch => set(patch),
          applyStateUpdate: (patch, summary) => {
            set(() => patch);
          },
          applyFailurePatch: patch => set(patch),
          recordRecentImport: get().recordRecentImport,
          refreshStats: get().refreshStats,
          validateAndSync: get().validateAndSync,
          toastApi: toast,
        });
      } catch (error) {
        handleError('添加下载任务', error);
        return [];
      }
    },

    addTask: async newTask => {
      const [added] = await get().addTasks([newTask]);
      return added;
    },

    removeTasks: async taskIds => {
      try {
        const { tasks, selectedTasks, refreshStats } = get();

        await executeRemoveTasksMutation({
          taskIds,
          currentTasks: tasks,
          selectedTaskIds: selectedTasks,
          removeTasks: removeTasksCommand,
          refreshStats,
          applyPatch: patch => set(patch),
          toastApi: toast,
        });
      } catch (error) {
        handleError('删除任务', error);

        throw error;
      }
    },

    clearCompletedTasks: async () => {
      try {
        const { tasks, selectedTasks, refreshStats } = get();

        await executeClearCompletedTasksMutation({
          currentTasks: tasks,
          selectedTaskIds: selectedTasks,
          clearCompletedTasks: clearCompletedTasksCommand,
          refreshStats,
          applyPatch: patch => set(patch),
          toastApi: toast,
        });
      } catch (error) {
        handleError('清除完成任务', error);

        throw error;
      }
    },

    // \u4e0b\u8f7d\u63a7\u5236

    startDownload: async (taskId, options = {}) => {
      const { suppressConcurrencyToast = false } = options;

      try {
        return await runQueuedControlCommand({
          runCommand: () => startDownloadCommand({ taskId }).then(() => 'started' as const),
          source: 'startDownload',
          syncRuntimeState: get().syncRuntimeState,
          concurrencyError: {
            suppressToast: suppressConcurrencyToast,
            queueMessage: '当前下载达到最大并发，其余任务已自动排队等待。',
            queuedResult: 'queued' as const,
            toastFn: toast,
          },
        });
      } catch (error) {
        handleError('启动下载', error);
        throw error;
      }
    },

    pauseDownload: async taskId => {
      try {
        await runControlCommandWithRuntimeSync({
          runCommand: () => pauseDownloadCommand({ taskId }),
          source: 'pauseDownload',
          syncRuntimeState: get().syncRuntimeState,
        });
      } catch (error) {
        handleError('暂停下载', error);

        throw error;
      }
    },

    resumeDownload: async taskId => {
      try {
        await runQueuedControlCommand({
          runCommand: () => resumeDownloadCommand({ taskId }),
          source: 'resumeDownload',
          syncRuntimeState: get().syncRuntimeState,
          concurrencyError: {
            queueMessage: '当前下载达到最大并发，任务已加入队列等待恢复。',
            queuedResult: undefined,
            toastFn: toast,
          },
        });
      } catch (error) {
        handleError('\u6062\u590d\u4e0b\u8f7d', error);

        throw error;
      }
    },

    cancelDownload: async taskId => {
      try {
        await runControlCommandWithRuntimeSync({
          runCommand: () => cancelDownloadCommand({ taskId }),
          source: 'cancelDownload',
          syncRuntimeState: get().syncRuntimeState,
        });
      } catch (error) {
        handleError('取消下载', error);

        throw error;
      }
    },

    startAllDownloads: async () => {
      try {
        const { tasks, selectedTasks, startDownload, syncRuntimeState } = get();
        await executeStartAllDownloads({
          tasks,
          selectedTaskIds: selectedTasks,
          startDownload,
          runStartAll: startAllDownloadsCommand,
          syncRuntimeState,
          toastApi: toast,
        });
      } catch (error) {
        handleError('批量开始下载', error);
        throw error;
      }
    },

    pauseAllDownloads: async () => {
      try {
        const { tasks, syncRuntimeState } = get();
        await executePauseAllDownloads({
          tasks,
          runPauseAll: pauseAllDownloadsCommand,
          syncRuntimeState,
          toastApi: toast,
        });
      } catch (error) {
        handleError('批量暂停下载', error);

        throw error;
      }
    },

    retryFailedTasks: async () => {
      await executeRetryFailedTasks({
        tasks: get().tasks,
        startDownload: get().startDownload,
        toastApi: toast,
      });
    },

    applyOutputDirectoryOverride: async (taskIds, overrideOutputDirectory) => {
      try {
        const { tasks, config } = get();
        await executeOutputPathOverrideStoreAction({
          taskIds,
          currentTasks: tasks,
          defaultOutputDirectory: config.output_directory,
          overrideOutputDirectory,
          updateTaskOutputPaths: updateTaskOutputPathsCommand,
          normalizeTask: normalizeTaskData as any,
          applyPatch: patch => set(patch),
        });
      } catch (error) {
        handleError('更新本次保存位置', error);
        throw error;
      }
    },

    enqueueDownloads: taskIds => {
      const uniqueIds = filterExistingTaskIds(taskIds, get().tasks);
      if (uniqueIds.length === 0) {
        return;
      }

      void (async () => {
        for (const taskId of uniqueIds) {
          await get().startDownload(taskId, { suppressConcurrencyToast: true });
        }
      })();
    },

    // 文件导入 - 增强版本带Zod验证

    importFromFile: async filePath => {
      reportFrontendDiagnosticIfEnabled('info', 'download_store:import_file:start', filePath);

      set({ isImporting: true, validationErrors: [] });

      try {
        const { successSummary, completionSummary, taskPreviewSummary } =
          await executeImportFromFileStoreAction({
            filePath,
            outputDirectory: get().config.output_directory,
            importFile: filePathArg => importRawFileCommand({ filePath: filePathArg }),
            addTasks: get().addTasks,
            recordValidation: get().validationStats.recordValidation,
            getValidationStats: () => get().validationStats.getStats(),
            getValidationErrors: () => get().validationErrors,
            applyValidationPatch: patch => set(patch),
            applyFailurePatch: patch => set(patch),
            toastApi: toast,
          });

        reportFrontendDiagnosticIfEnabled(
          'info',
          'download_store:import_file:validation_completed',
          completionSummary
        );
        reportFrontendDiagnosticIfEnabled(
          'info',
          'download_store:import_file:task_preview',
          taskPreviewSummary
        );
        reportFrontendDiagnosticIfEnabled(
          'info',
          'download_store:import_file:completed',
          successSummary
        );
      } catch (error) {
        const appError = handleError('导入文件', error);
        throw appError;
      } finally {
        set({ isImporting: false });
      }
    },

    importFromUrls: async urls => {
      const tasks = buildTasksFromUrls(urls, get().config.output_directory);
      await get().addTasks(tasks);
    },

    // 配置镜像同步

    setDownloadConfig: (newConfig: Partial<DownloadConfig>) => {
      const baseDownloadConfig = get().config ?? DEFAULT_DOWNLOAD_CONFIG;
      const mergedDownloadConfig = mergeDownloadConfig({
        ...baseDownloadConfig,
        ...newConfig,
      });
      set({ config: mergedDownloadConfig });
    },

    // \u72b6\u6001\u9a8c\u8bc1\u548c\u540c\u6b65

    validateAndSync: async () => {
      try {
        const { tasks, stats } = get();

        return await executeValidateAndSyncStoreAction({
          tasks,
          stats,
          shouldValidateFn: shouldValidate,
          validateStateFn: validateState,
          set,
          normalizeTask: normalizeBackendTask,
          ensureStatsFn: ensureDownloadStats,
          syncStatesFn: (validationResult, storeUpdater) =>
            syncStates(validationResult.issues, validationResult.syncSuggestion, storeUpdater),
        });
      } catch (error) {
        handleError('Validate state and sync', error, false);

        return false;
      }
    },

    forceSync: async () => {
      try {
        await executeForceSyncStoreAction({
          fetchTasks: getDownloadTasksCommand,
          fetchStats: getDownloadStatsCommand,
          normalizeTask: normalizeBackendTask,
          applyPatch: patch => set(patch),
        });

        return true;
      } catch (error) {
        handleError('Force sync state', error);

        return false;
      }
    },

    // \u521d\u59cb\u5316 - \u589e\u5f3a\u7248\u672c\u5e26Zod\u9a8c\u8bc1

    initializeStore: async () => {
      set({ isLoading: true, validationErrors: [] });

      reportFrontendDiagnosticIfEnabled('info', 'download_store:initialize:start');
      reportFrontendDiagnosticIfEnabled('info', 'download_store:initialize:validation:start');

      try {
        await executeInitializeStoreStoreAction({
          validationStartTime: performance.now(),
          queryTasks: getDownloadTasksCommand,
          queryStats: getDownloadStatsCommand,
          currentConfig: get().config,
          currentStats: get().stats,
          normalizeTask: normalizeBackendTask,
          mergeConfig: mergeDownloadConfig,
          ensureStats: ensureDownloadStats,
          recordValidation: get().validationStats.recordValidation,
          getValidationErrors: () => get().validationErrors,
          applySuccessPatch: patch => set(patch),
          applyFailurePatch: patch => set(patch),
        });
      } catch (error) {
        handleError('初始化下载管理器', error);
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

      return runDataIntegrityCheckFor(tasks);
    },
  }))
);
