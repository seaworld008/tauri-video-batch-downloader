import {
  DownloadConfigSchema,
  DownloadStatsSchema,
  TaskStatusSchema,
  VideoTaskSchema,
  validateRelatedData,
  type DownloadConfig,
  type DownloadStats,
  type VideoTask,
} from '../../../schemas';
import { reportFrontendDiagnostic } from '../../../utils/frontendLogging';

const sanitizeRecoveredTaskFallback = (task: VideoTask): VideoTask | null => {
  if (!task || typeof task !== 'object') {
    return null;
  }

  const candidate = task as Record<string, unknown>;
  const id = typeof candidate.id === 'string' ? candidate.id.trim() : '';
  const url = typeof candidate.url === 'string' ? candidate.url.trim() : '';
  const title = typeof candidate.title === 'string' ? candidate.title.trim() : '';
  const outputPath = typeof candidate.output_path === 'string' ? candidate.output_path.trim() : '';
  const statusParsed = TaskStatusSchema.safeParse(candidate.status);

  if (!id || !url || !title || !outputPath || !statusParsed.success) {
    return null;
  }

  const rawProgress = Number(candidate.progress);
  const progress = Number.isFinite(rawProgress) ? Math.min(Math.max(rawProgress, 0), 100) : 0;
  const rawDownloaded = Number(candidate.downloaded_size);
  const downloadedSize = Number.isFinite(rawDownloaded) && rawDownloaded >= 0 ? rawDownloaded : 0;

  return {
    ...task,
    id,
    url,
    title,
    output_path: outputPath,
    status: statusParsed.data,
    progress,
    downloaded_size: downloadedSize,
  };
};

export const fetchInitialRuntimeSnapshot = async (
  queryTasks: <TTask>() => Promise<TTask[]>,
  queryStats: () => Promise<unknown>
): Promise<{ rawTasks: unknown[]; rawStats: unknown }> => {
  const [rawTasks, rawStats] = await Promise.all([queryTasks<unknown>(), queryStats()]);

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
  const validatedTasks: VideoTask[] = [];
  const taskItemErrors: string[] = [];

  normalizedTasks.forEach((task, index) => {
    const parsedTask = VideoTaskSchema.safeParse(task);
    if (parsedTask.success) {
      validatedTasks.push(parsedTask.data);
      return;
    }

    const issueMessages = parsedTask.error.issues.map(
      err => `${err.path.map(String).join('.')}: ${err.message}`
    );
    const fallbackTask = sanitizeRecoveredTaskFallback(task);
    const taskLabel = (task as { id?: string })?.id || `index:${index}`;

    reportFrontendDiagnostic('warn', 'initialize_store_bootstrap:task_item_invalid', {
      taskId: taskLabel,
      preservedFallback: Boolean(fallbackTask),
      errors: issueMessages,
    });

    if (fallbackTask) {
      validatedTasks.push(fallbackTask);
    } else {
      taskItemErrors.push(`任务[${taskLabel}]: ${issueMessages.join('; ')}`);
    }
  });

  const validations = validateRelatedData([
    { name: 'config', schema: DownloadConfigSchema, data: normalizedConfig },
    { name: 'stats', schema: DownloadStatsSchema, data: rawStats },
  ]);

  const tasksValidationResult = {
    success: taskItemErrors.length === 0,
    data: validatedTasks,
    errors: taskItemErrors,
  };

  const mergedResults = {
    ...validations.results,
    tasks: tasksValidationResult,
  } as typeof validations.results & { tasks: typeof tasksValidationResult };

  const validationErrors: string[] = [];

  if (!tasksValidationResult.success) {
    validationErrors.push('后端任务数据格式无效');
    reportFrontendDiagnostic(
      'error',
      'initialize_store_bootstrap:tasks_invalid',
      tasksValidationResult.errors
    );
  }

  if (!validations.results.config.success) {
    validationErrors.push('后端配置数据格式无效');
    reportFrontendDiagnostic(
      'error',
      'initialize_store_bootstrap:config_invalid',
      validations.results.config.errors
    );
  }

  if (!validations.results.stats.success) {
    validationErrors.push('后端统计数据格式无效');
    reportFrontendDiagnostic(
      'error',
      'initialize_store_bootstrap:stats_invalid',
      validations.results.stats.errors
    );
  }

  return {
    validations: {
      success: validations.success && tasksValidationResult.success,
      results: mergedResults,
    },
    validatedTasks,
    validatedConfig: validations.results.config.success
      ? validations.results.config.data
      : fallbackConfig,
    validatedStats: validations.results.stats.success
      ? validations.results.stats.data
      : fallbackStats,
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

export const buildInitializeStoreFailurePatch = (existingErrors: string[], error: unknown) => ({
  isLoading: false,
  validationErrors: [
    ...existingErrors,
    `初始化失败: ${error instanceof Error ? error.message : String(error)}`,
  ],
  lastValidationTime: Date.now(),
});
