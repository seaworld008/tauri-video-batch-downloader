import type { VideoTask } from '../../../schemas';

export interface ImportSessionStateFields {
  recentImportTaskIds: string[];
  recentImportSnapshot: VideoTask[];
}

export interface ImportSessionStateActions {
  recordRecentImport: (taskIds: string[], snapshot: VideoTask[]) => void;
  clearRecentImport: () => void;
}

type SliceState = ImportSessionStateFields & ImportSessionStateActions;
type SetState<T> = (partial: Partial<T> | ((state: T) => Partial<T>)) => void;

export const DEFAULT_IMPORT_SESSION_STATE: ImportSessionStateFields = {
  recentImportTaskIds: [],
  recentImportSnapshot: [],
};

export const createImportSessionStateActions = <T extends SliceState>(
  set: SetState<T>
): ImportSessionStateActions => ({
  recordRecentImport: (taskIds, snapshot) => {
    set({
      recentImportTaskIds: taskIds,
      recentImportSnapshot: snapshot,
    } as Partial<T>);
  },

  clearRecentImport: () => {
    set({
      recentImportTaskIds: [],
      recentImportSnapshot: [],
    } as Partial<T>);
  },
});
