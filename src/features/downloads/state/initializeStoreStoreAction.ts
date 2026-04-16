import type { DownloadConfig, DownloadStats, VideoTask } from '../../../schemas';

import {
  buildInitializeStoreFailurePatch,
  buildInitializeStoreSuccessSummary,
  prepareInitializeStoreSuccess,
} from './initializeStoreBootstrap';
import {
  reportFrontendDiagnosticIfEnabled,
  reportFrontendIssue,
} from '../../../utils/frontendLogging';

export interface ExecuteInitializeStoreStoreActionParams {
  validationStartTime: number;
  queryTasks: <TTask>() => Promise<TTask[]>;
  queryStats: () => Promise<unknown>;
  currentConfig: DownloadConfig;
  currentStats: DownloadStats;
  normalizeTask: (task: unknown) => VideoTask;
  mergeConfig: (config: DownloadConfig) => DownloadConfig;
  ensureStats: (stats: DownloadStats) => DownloadStats;
  recordValidation: (success: boolean, durationMs: number) => void;
  getValidationErrors: () => string[];
  applySuccessPatch: (
    patch: ReturnType<typeof prepareInitializeStoreSuccess> extends Promise<infer TResult>
      ? TResult extends { patch: infer TPatch }
        ? TPatch
        : never
      : never
  ) => void;
  applyFailurePatch: (patch: ReturnType<typeof buildInitializeStoreFailurePatch>) => void;
}

export const executeInitializeStoreStoreAction = async ({
  validationStartTime,
  queryTasks,
  queryStats,
  currentConfig,
  currentStats,
  normalizeTask,
  mergeConfig,
  ensureStats,
  recordValidation,
  getValidationErrors,
  applySuccessPatch,
  applyFailurePatch,
}: ExecuteInitializeStoreStoreActionParams) => {
  try {
    const { validations, validatedTasks, patch } = await prepareInitializeStoreSuccess({
      queryTasks,
      queryStats,
      currentConfig,
      currentStats,
      normalizeTask,
      mergeConfig,
      ensureStats,
    });

    const validationDuration = performance.now() - validationStartTime;
    recordValidation(validations.success, validationDuration);
    applySuccessPatch(patch);

    const summary = buildInitializeStoreSuccessSummary({
      validatedTasks,
      validations,
      durationMs: validationDuration,
    });

    reportFrontendDiagnosticIfEnabled('info', 'download_store:initialize:success', summary);

    return {
      validations,
      validatedTasks,
      patch,
      summary,
    };
  } catch (error) {
    const validationDuration = performance.now() - validationStartTime;
    recordValidation(false, validationDuration);

    const failurePatch = buildInitializeStoreFailurePatch(getValidationErrors(), error);
    applyFailurePatch(failurePatch);

    reportFrontendIssue('error', 'download_store:initialize:failed', error);

    throw error;
  }
};
