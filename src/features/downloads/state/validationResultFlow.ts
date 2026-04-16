import type { StateValidationResult, SyncStrategy, StateIssue } from '../../../utils/stateValidator';

export const isValidationConsistent = (validationResult: StateValidationResult): boolean =>
  validationResult.isConsistent;

export const getValidationSyncPayload = (
  validationResult: StateValidationResult
): { issues: StateIssue[]; syncSuggestion: SyncStrategy } => ({
  issues: validationResult.issues,
  syncSuggestion: validationResult.syncSuggestion,
});

type SyncExecutor = (issues: StateIssue[], syncSuggestion: SyncStrategy) => Promise<boolean>;

export const executeValidationSync = async (
  validationResult: StateValidationResult,
  syncExecutor: SyncExecutor
): Promise<boolean> => {
  const { issues, syncSuggestion } = getValidationSyncPayload(validationResult);
  return syncExecutor(issues, syncSuggestion);
};
