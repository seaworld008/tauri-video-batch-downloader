import type { DownloadStats, VideoTask } from '../../../schemas';
import type { StateValidationResult } from '../../../utils/stateValidator';
import { executeValidationSync, isValidationConsistent } from './validationResultFlow';

type NormalizeTask<TTask> = (task: VideoTask) => TTask;
type EnsureStats<TStats> = (stats: DownloadStats) => TStats;
type SetState<T> = (partial: Partial<T> | ((state: T) => Partial<T>)) => void;
type ValidateStateFn = (
  tasks: VideoTask[],
  stats: DownloadStats
) => Promise<StateValidationResult>;
type SyncStatesFn<TState, TTask, TStats> = (
  validationResult: StateValidationResult,
  storeUpdater: ReturnType<typeof createValidationStoreUpdater<TState, TTask, TStats>>
) => Promise<boolean>;

export const shouldRunValidation = (shouldValidateFn: () => boolean): boolean => shouldValidateFn();

export const createValidationStoreUpdater = <TState, TTask, TStats>(
  set: SetState<TState>,
  normalizeTask: NormalizeTask<TTask>,
  ensureStatsFn: EnsureStats<TStats>
) => ({
  updateTasks: (tasks: VideoTask[]) =>
    set({ tasks: tasks.map(normalizeTask) } as unknown as Partial<TState>),
  updateStats: (stats: DownloadStats) =>
    set({ stats: ensureStatsFn(stats) } as unknown as Partial<TState>),
});

export const runValidationAndSync = async <TState, TTask, TStats>({
  tasks,
  stats,
  shouldValidateFn,
  validateStateFn,
  set,
  normalizeTask,
  ensureStatsFn,
  syncStatesFn,
}: {
  tasks: VideoTask[];
  stats: DownloadStats;
  shouldValidateFn: () => boolean;
  validateStateFn: ValidateStateFn;
  set: SetState<TState>;
  normalizeTask: NormalizeTask<TTask>;
  ensureStatsFn: EnsureStats<TStats>;
  syncStatesFn: SyncStatesFn<TState, TTask, TStats>;
}): Promise<boolean> => {
  if (!shouldRunValidation(shouldValidateFn)) {
    return true;
  }

  const validationResult = await validateStateFn(tasks, stats);

  if (isValidationConsistent(validationResult)) {
    return true;
  }

  return executeValidationSync(
    validationResult,
    (issues, syncSuggestion) =>
      syncStatesFn(
        { ...validationResult, issues, syncSuggestion },
        createValidationStoreUpdater(set, normalizeTask, ensureStatsFn)
      )
  );
};
