import type { TaskStatus, VideoTask } from '../../../schemas';

export interface DownloadViewStateFields {
  tasks: VideoTask[];
  selectedTasks: string[];
  filterStatus: TaskStatus | 'all';
  searchQuery: string;
  sortBy: keyof VideoTask;
  sortDirection: 'asc' | 'desc';
}

export interface DownloadViewStateActions {
  setSelectedTasks: (taskIds: string[]) => void;
  toggleTaskSelection: (taskId: string) => void;
  selectAllTasks: () => void;
  clearSelection: () => void;
  setFilterStatus: (status: TaskStatus | 'all') => void;
  setSearchQuery: (query: string) => void;
  setSortBy: (field: keyof VideoTask, direction?: 'asc' | 'desc') => void;
}

type SliceState = DownloadViewStateFields & DownloadViewStateActions;
type SetState<T> = (partial: Partial<T> | ((state: T) => Partial<T>)) => void;

export const DEFAULT_DOWNLOAD_VIEW_STATE: Pick<
  DownloadViewStateFields,
  'selectedTasks' | 'filterStatus' | 'searchQuery' | 'sortBy' | 'sortDirection'
> = {
  selectedTasks: [],
  filterStatus: 'all',
  searchQuery: '',
  sortBy: 'created_at',
  sortDirection: 'desc',
};

export const createDownloadViewStateActions = <T extends SliceState>(
  set: SetState<T>
): DownloadViewStateActions => ({
  setSelectedTasks: taskIds => {
    set({ selectedTasks: taskIds } as Partial<T>);
  },

  toggleTaskSelection: taskId => {
    set(state => ({
      selectedTasks: state.selectedTasks.includes(taskId)
        ? state.selectedTasks.filter(id => id !== taskId)
        : [...state.selectedTasks, taskId],
    } as Partial<T>));
  },

  selectAllTasks: () => {
    set(state => ({ selectedTasks: state.tasks.map(task => task.id) } as Partial<T>));
  },

  clearSelection: () => {
    set({ selectedTasks: [] } as Partial<T>);
  },

  setFilterStatus: status => {
    set({ filterStatus: status } as Partial<T>);
  },

  setSearchQuery: query => {
    set({ searchQuery: query } as Partial<T>);
  },

  setSortBy: (field, direction) => {
    set(state => {
      const isSameField = state.sortBy === field;
      const nextDirection = direction ?? (isSameField
        ? state.sortDirection === 'asc'
          ? 'desc'
          : 'asc'
        : 'asc');

      return {
        sortBy: field,
        sortDirection: nextDirection,
      } as Partial<T>;
    });
  },
});
