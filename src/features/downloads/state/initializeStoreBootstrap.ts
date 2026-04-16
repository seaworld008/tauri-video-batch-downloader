import {
  DownloadConfigSchema,
  DownloadStatsSchema,
  TaskListSchema,
  validateRelatedData,
  type DownloadConfig,
  type DownloadStats,
  type VideoTask,
} from '../../../schemas';
import { reportFrontendDiagnostic } from '../../../utils/frontendLogging';

export const fetchInitialRuntimeSnapshot = async (
  queryTasks: <TTask>() => Promise<TTask[]>,
  queryStats: () => Promise<unknown>
): Promise<{ rawTasks: unknown[]; rawStats: unknown }> => {
  const [rawTasks, rawStats] = await Promise.all([
    queryTasks<unknown>(),
    queryStats(),
  ]);

  return {
    rawTasks: Array.isArray(rawTasks) ? rawTasks : [],
    rawStats,
  };
};

export const validateInitialRuntimeSnapshot = ({
  normalizedTasks,
  normalizedConfig,
  rawStats,
  fallbackConfig,
  fallbackStats,
}: {
  normalizedTasks: VideoTask[];
  normalizedConfig: DownloadConfig;
  rawStats: unknown;
  fallbackConfig: DownloadConfig;
  fallbackStats: DownloadStats;
}) => {
  const validations = validateRelatedData([
    { name: 'tasks', schema: TaskListSchema, data: normalizedTasks },
    { name: 'config', schema: DownloadConfigSchema, data: normalizedConfig },
    { name: 'stats', schema: DownloadStatsSchema, data: rawStats },
  ]);

  const validationErrors: string[] = [];

  if (!validations.results.tasks.success) {
    validationErrors.push('后端任务数据格式无效');
    reportFrontendDiagnostic('error', 'initialize_store_bootstrap:tasks_invalid', validations.results.tasks.errors);
  }

  if (!validations.results.config.success) {
    validationErrors.push('后端配置数据格式无效');
    reportFrontendDiagnostic('error', 'initialize_store_bootstrap:config_invalid', validations.results.config.errors);
  }

  if (!validations.results.stats.success) {
    validationErrors.push('后端统计数据格式无效');
    reportFrontendDiagnostic('error', 'initialize_store_bootstrap:stats_invalid', validations.results.stats.errors);
  }

  return {
    validations,
    validatedTasks: validations.results.tasks.success ? validations.results.tasks.data : [],
    validatedConfig: validations.results.config.success
      ? validations.results.config.data
      : fallbackConfig,
    validatedStats: validations.results.stats.success ? validations.results.stats.data : fallbackStats,
    validationErrors,
  };
};

export const buildInitializeStorePatch = ({
  tasks,
  config,
  stats,
  validationErrors,
  ensureStats,
}: {
  tasks: VideoTask[];
  config: DownloadConfig;
  stats: DownloadStats;
  validationErrors: string[];
  ensureStats: (stats: DownloadStats) => DownloadStats;
}) => ({
  tasks,
  config,
  stats: ensureStats(stats),
  isLoading: false,
  validationErrors,
  lastValidationTime: Date.now(),
});

export const prepareInitializeStoreSuccess = async ({
  queryTasks,
  queryStats,
  currentConfig,
  currentStats,
  normalizeTask,
  mergeConfig,
  ensureStats,
}: {
  queryTasks: <TTask>() => Promise<TTask[]>;
  queryStats: () => Promise<unknown>;
  currentConfig: DownloadConfig;
  currentStats: DownloadStats;
  normalizeTask: (task: unknown) => VideoTask;
  mergeConfig: (config: DownloadConfig) => DownloadConfig;
  ensureStats: (stats: DownloadStats) => DownloadStats;
}) => {
  const { rawTasks, rawStats } = await fetchInitialRuntimeSnapshot(queryTasks, queryStats);
  const normalizedConfig = mergeConfig(currentConfig);
  const normalizedTasks = rawTasks.map(normalizeTask);

  const { validations, validatedTasks, validatedConfig, validatedStats, validationErrors } =
    validateInitialRuntimeSnapshot({
      normalizedTasks,
      normalizedConfig,
      rawStats,
      fallbackConfig: currentConfig,
      fallbackStats: currentStats,
    });

  return {
    validations,
    validatedTasks,
    patch: buildInitializeStorePatch({
      tasks: validatedTasks,
      config: validatedConfig,
      stats: validatedStats,
      validationErrors,
      ensureStats,
    }),
  };
};

export const buildInitializeStoreSuccessSummary = ({
  validatedTasks,
  validations,
  durationMs,
}: {
  validatedTasks: VideoTask[];
  validations: ReturnType<typeof validateInitialRuntimeSnapshot>['validations'];
  durationMs: number;
}) => ({
  任务数: validatedTasks.length,
  配置状态: validations.results.config.success ? '有效' : '使用默认',
  统计状态: validations.results.stats.success ? '有效' : '使用默认',
  验证耗时: `${durationMs.toFixed(2)}ms`,
  数据质量: validations.success ? '100%' : '部分无效',
});

export const buildInitializeStoreFailurePatch = (
  existingErrors: string[],
  error: unknown
) => ({
  isLoading: false,
  validationErrors: [
    ...existingErrors,
    `初始化失败: ${error instanceof Error ? error.message : String(error)}`,
  ],
  lastValidationTime: Date.now(),
});
