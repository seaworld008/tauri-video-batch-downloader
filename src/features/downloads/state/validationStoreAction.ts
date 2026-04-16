import type { DownloadStats, VideoTask } from '../../../schemas';
import type { StateValidationResult } from '../../../utils/stateValidator';

import {
  buildForceSyncPatch,
  buildForceSyncSummary,
  forceSyncWith,
} from './validationHelpers';
import { runValidationAndSync } from './validationFlow';
import {
  reportFrontendDiagnostic,
  reportFrontendDiagnosticIfEnabled,
} from '../../../utils/frontendLogging';

type NormalizeTask<TTask> = (task: VideoTask) => TTask;
type EnsureStats<TStats> = (stats: DownloadStats) => TStats;
type SetState<TState> = (partial: Partial<TState> | ((state: TState) => Partial<TState>)) => void;
type ValidateStateFn = (
  tasks: VideoTask[],
  stats: DownloadStats
) => Promise<StateValidationResult>;
type SyncStatesFn<TState, TTask, TStats> = Parameters<
  typeof runValidationAndSync<TState, TTask, TStats>
>[0]['syncStatesFn'];

export interface ExecuteValidateAndSyncStoreActionParams<TState, TTask, TStats> {
  tasks: VideoTask[];
  stats: DownloadStats;
  shouldValidateFn: () => boolean;
  validateStateFn: ValidateStateFn;
  set: SetState<TState>;
  normalizeTask: NormalizeTask<TTask>;
  ensureStatsFn: EnsureStats<TStats>;
  syncStatesFn: SyncStatesFn<TState, TTask, TStats>;
}

export const executeValidateAndSyncStoreAction = async <TState, TTask, TStats>({
  tasks,
  stats,
  shouldValidateFn,
  validateStateFn,
  set,
  normalizeTask,
  ensureStatsFn,
  syncStatesFn,
}: ExecuteValidateAndSyncStoreActionParams<TState, TTask, TStats>): Promise<boolean> => {
  reportFrontendDiagnosticIfEnabled('info', 'validation_store_action:validate_and_sync:start');

  const syncResult = await runValidationAndSync({
    tasks,
    stats,
    shouldValidateFn,
    validateStateFn,
    set,
    normalizeTask,
    ensureStatsFn,
    syncStatesFn: async (validationResult, storeUpdater) => {
      if (!validationResult.isConsistent) {
        reportFrontendDiagnosticIfEnabled(
          'warn',
          'validation_store_action:state_inconsistent',
          validationResult.issues
        );
      }

      return syncStatesFn(validationResult, storeUpdater);
    },
  });

  if (syncResult) {
    reportFrontendDiagnosticIfEnabled('info', 'validation_store_action:validate_and_sync:success');
  } else {
    reportFrontendDiagnostic('error', 'validation_store_action:validate_and_sync:failed');
  }

  return syncResult;
};

export interface ExecuteForceSyncStoreActionParams<TTask, TStats extends DownloadStats> {
  fetchTasks: <TRawTask>() => Promise<TRawTask[]>;
  fetchStats: () => Promise<DownloadStats>;
  normalizeTask: (task: VideoTask) => TTask;
  applyPatch: (patch: { tasks: TTask[]; stats: TStats }) => void;
}

export const executeForceSyncStoreAction = async <TTask, TStats extends DownloadStats>({
  fetchTasks,
  fetchStats,
  normalizeTask,
  applyPatch,
}: ExecuteForceSyncStoreActionParams<TTask, TStats>) => {
  reportFrontendDiagnosticIfEnabled('info', 'validation_store_action:force_sync:start');

  const forceSyncResult = await forceSyncWith(fetchTasks, fetchStats, normalizeTask);
  const patch = buildForceSyncPatch(forceSyncResult) as { tasks: TTask[]; stats: TStats };

  applyPatch(patch);

  const summary = buildForceSyncSummary(forceSyncResult);
  reportFrontendDiagnosticIfEnabled('info', 'validation_store_action:force_sync:result', summary);

  return {
    patch,
    summary,
  };
};
