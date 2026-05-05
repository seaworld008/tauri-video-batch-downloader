import React, { useMemo } from 'react';
import { useDownloadStore } from '../../stores/downloadStore';
import { useConfigStore } from '../../stores/configStore';
import toast from 'react-hot-toast';
import { ensureDownloadStats } from '../../utils/downloadStats';
import { buildTaskOutputPathPreview } from '../../features/downloads/model/outputPathOverride';
import {
  openDownloadFolderCommand,
  selectOutputDirectoryCommand,
} from '../../features/downloads/api/systemCommands';
import { reportFrontendIssue } from '../../utils/frontendLogging';
import { DownloadStartConfirmDialog } from './DownloadStartConfirmDialog';
import { DeleteTasksConfirmDialog } from './DeleteTasksConfirmDialog';
import { ToolbarActions } from './ToolbarActions';
import { ToolbarFilters } from './ToolbarFilters';

interface DashboardToolbarProps {
  onRefresh?: () => void;
  onOpenSettings?: () => void;
}

export const DashboardToolbar: React.FC<DashboardToolbarProps> = ({
  onRefresh,
  onOpenSettings,
}) => {
  const tasks = useDownloadStore(state => state.tasks);
  const selectedTasks = useDownloadStore(state => state.selectedTasks);
  const startAllDownloads = useDownloadStore(state => state.startAllDownloads);
  const pauseAllDownloads = useDownloadStore(state => state.pauseAllDownloads);
  const removeTasks = useDownloadStore(state => state.removeTasks);
  const clearSelection = useDownloadStore(state => state.clearSelection);
  const setSelectedTasks = useDownloadStore(state => state.setSelectedTasks);
  const startDownload = useDownloadStore(state => state.startDownload);
  const pauseDownload = useDownloadStore(state => state.pauseDownload);
  const applyOutputDirectoryOverride = useDownloadStore(
    state => state.applyOutputDirectoryOverride
  );
  const filterStatus = useDownloadStore(state => state.filterStatus);
  const setFilterStatus = useDownloadStore(state => state.setFilterStatus);
  const searchQuery = useDownloadStore(state => state.searchQuery);
  const setSearchQuery = useDownloadStore(state => state.setSearchQuery);
  const refreshStats = useDownloadStore(state => state.refreshStats);
  const forceSync = useDownloadStore(state => state.forceSync);
  const backendStats = useDownloadStore(state => state.stats);
  const config = useConfigStore(state => state.config);

  const [startConfirmOpen, setStartConfirmOpen] = React.useState(false);
  const [startConfirmWorking, setStartConfirmWorking] = React.useState(false);
  const [startConfirmTaskIds, setStartConfirmTaskIds] = React.useState<string[]>([]);
  const [startConfirmDirectory, setStartConfirmDirectory] = React.useState(
    config.download.output_directory
  );
  const [deleteConfirmOpen, setDeleteConfirmOpen] = React.useState(false);
  const [deleteConfirmWorking, setDeleteConfirmWorking] = React.useState(false);
  const [deleteConfirmTaskIds, setDeleteConfirmTaskIds] = React.useState<string[]>([]);
  const [deleteConfirmTitle, setDeleteConfirmTitle] = React.useState('');
  const [deleteConfirmDescription, setDeleteConfirmDescription] = React.useState('');
  const pendingStartActionRef = React.useRef<(() => Promise<void>) | null>(null);
  const pendingDeleteActionRef = React.useRef<(() => Promise<void>) | null>(null);

  const hasSelection = selectedTasks.length > 0;
  const safeBackendStats = useMemo(() => ensureDownloadStats(backendStats), [backendStats]);

  const stats = useMemo(
    () => ({
      all: tasks.length,
      downloading: tasks.filter(
        task => task.status === 'downloading' || task.status === 'committing'
      ).length,
      completed: tasks.filter(task => task.status === 'completed').length,
      failed: tasks.filter(task => task.status === 'failed').length,
      paused: tasks.filter(task => task.status === 'paused').length,
      pending: tasks.filter(task => task.status === 'pending').length,
    }),
    [tasks]
  );

  const filteredTaskIds = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();

    return tasks
      .filter(task => {
        const statusMatches =
          filterStatus === 'all'
            ? true
            : filterStatus === 'downloading'
              ? task.status === 'downloading' || task.status === 'committing'
              : task.status === filterStatus;

        if (!statusMatches) {
          return false;
        }

        if (!normalizedQuery) {
          return true;
        }

        return (
          task.title.toLowerCase().includes(normalizedQuery) ||
          task.url.toLowerCase().includes(normalizedQuery)
        );
      })
      .map(task => task.id);
  }, [filterStatus, searchQuery, tasks]);

  const canBulkSelectFiltered = filteredTaskIds.length > 0;
  const canDeleteFilteredWithoutSelection =
    !hasSelection &&
    canBulkSelectFiltered &&
    (filterStatus !== 'all' || searchQuery.trim().length > 0);
  const inactiveTaskIds = useMemo(
    () =>
      tasks
        .filter(task => ['completed', 'failed', 'paused', 'cancelled'].includes(task.status))
        .map(task => task.id),
    [tasks]
  );
  const canClearInactiveTasks = !hasSelection && inactiveTaskIds.length > 0;

  const canStartAll = stats.pending + stats.paused + stats.failed > 0;
  const isQueuePaused = safeBackendStats.queue_paused;
  const hasPausableTasks = useMemo(
    () => tasks.some(task => task.status === 'downloading'),
    [tasks]
  );

  const startConfirmTasks = useMemo(
    () => tasks.filter(task => startConfirmTaskIds.includes(task.id)),
    [tasks, startConfirmTaskIds]
  );
  const deleteConfirmTasks = useMemo(
    () => tasks.filter(task => deleteConfirmTaskIds.includes(task.id)),
    [tasks, deleteConfirmTaskIds]
  );

  const startConfirmSamplePath = useMemo(
    () =>
      buildTaskOutputPathPreview(
        startConfirmTasks[0],
        config.download.output_directory,
        startConfirmDirectory
      ),
    [config.download.output_directory, startConfirmDirectory, startConfirmTasks]
  );

  const closeStartConfirm = React.useCallback(() => {
    setStartConfirmOpen(false);
    setStartConfirmWorking(false);
    setStartConfirmTaskIds([]);
    setStartConfirmDirectory(config.download.output_directory);
    pendingStartActionRef.current = null;
  }, [config.download.output_directory]);

  const closeDeleteConfirm = React.useCallback(() => {
    setDeleteConfirmOpen(false);
    setDeleteConfirmWorking(false);
    setDeleteConfirmTaskIds([]);
    setDeleteConfirmTitle('');
    setDeleteConfirmDescription('');
    pendingDeleteActionRef.current = null;
  }, []);

  const openStartConfirm = React.useCallback(
    (startAction: () => Promise<void>, taskIds: string[]) => {
      if (taskIds.length === 0) {
        toast('没有可开始的下载任务');
        return;
      }

      pendingStartActionRef.current = startAction;
      setStartConfirmTaskIds(taskIds);
      setStartConfirmDirectory(config.download.output_directory);
      setStartConfirmOpen(true);
    },
    [config.download.output_directory]
  );

  const openDeleteConfirm = React.useCallback(
    (taskIds: string[], title: string, description: string, action: () => Promise<void>) => {
      if (taskIds.length === 0) {
        toast('没有可清理的任务');
        return;
      }

      pendingDeleteActionRef.current = action;
      setDeleteConfirmTaskIds(taskIds);
      setDeleteConfirmTitle(title);
      setDeleteConfirmDescription(description);
      setDeleteConfirmOpen(true);
    },
    []
  );

  const runPendingStartAction = React.useCallback(async () => {
    if (!pendingStartActionRef.current) {
      return;
    }

    setStartConfirmWorking(true);
    try {
      if (
        startConfirmTaskIds.length > 0 &&
        startConfirmDirectory &&
        startConfirmDirectory !== config.download.output_directory
      ) {
        await applyOutputDirectoryOverride(startConfirmTaskIds, startConfirmDirectory);
      }

      await pendingStartActionRef.current();
    } finally {
      closeStartConfirm();
    }
  }, [
    applyOutputDirectoryOverride,
    closeStartConfirm,
    config.download.output_directory,
    startConfirmDirectory,
    startConfirmTaskIds,
  ]);

  const runPendingDeleteAction = React.useCallback(async () => {
    if (!pendingDeleteActionRef.current) {
      return;
    }

    setDeleteConfirmWorking(true);
    try {
      await pendingDeleteActionRef.current();
    } finally {
      closeDeleteConfirm();
    }
  }, [closeDeleteConfirm]);

  const handleChangeDirectoryForThisRun = React.useCallback(async () => {
    try {
      const selected = await selectOutputDirectoryCommand({
        title: '选择本次保存位置',
        defaultPath: startConfirmDirectory || config.download.output_directory,
      });
      if (selected) {
        setStartConfirmDirectory(selected);
      }
    } catch (error) {
      reportFrontendIssue('error', 'dashboard_toolbar:select_temp_directory_failed', error);
      toast.error('选择本次保存位置失败');
    }
  }, [config.download.output_directory, startConfirmDirectory]);

  const handleOpenDownloadFolder = React.useCallback(async () => {
    try {
      await openDownloadFolderCommand();
    } catch (error) {
      reportFrontendIssue('error', 'dashboard_toolbar:open_download_folder_failed', error);
      toast.error('打开下载目录失败');
    }
  }, []);

  const handleBatchAction = React.useCallback(
    async (action: 'start' | 'pause' | 'delete') => {
      if (!hasSelection) {
        const startableTaskIds = tasks
          .filter(task => ['pending', 'paused', 'failed'].includes(task.status))
          .map(task => task.id);

        switch (action) {
          case 'start':
            openStartConfirm(async () => {
              await startAllDownloads();
            }, startableTaskIds);
            break;
          case 'pause':
            await pauseAllDownloads();
            break;
          default:
            break;
        }
        return;
      }

      const selectedItems = tasks.filter(task => selectedTasks.includes(task.id));
      const startableSelectedTaskIds = selectedItems
        .filter(task => ['pending', 'paused', 'failed'].includes(task.status))
        .map(task => task.id);

      switch (action) {
        case 'start':
          openStartConfirm(async () => {
            await Promise.all(
              selectedItems
                .filter(task => ['pending', 'paused', 'failed'].includes(task.status))
                .map(task => startDownload(task.id))
            );
          }, startableSelectedTaskIds);
          break;
        case 'pause':
          await Promise.all(
            selectedItems
              .filter(task => task.status === 'downloading')
              .map(task => pauseDownload(task.id))
          );
          break;
        case 'delete':
          openDeleteConfirm(
            selectedTasks,
            '确认删除选中任务',
            `即将删除 ${selectedTasks.length} 个已选任务。只有在你点击“确认清理”后才会执行。`,
            async () => {
              await removeTasks(selectedTasks);
              clearSelection();
            }
          );
          break;
      }
    },
    [
      clearSelection,
      hasSelection,
      openDeleteConfirm,
      openStartConfirm,
      pauseAllDownloads,
      pauseDownload,
      removeTasks,
      selectedTasks,
      startAllDownloads,
      startDownload,
      tasks,
    ]
  );

  const handleDeleteFiltered = React.useCallback(() => {
    openDeleteConfirm(
      filteredTaskIds,
      '确认清理筛选结果',
      `即将清理当前筛选结果中的 ${filteredTaskIds.length} 个任务。只有在你点击“确认清理”后才会执行。`,
      async () => {
        await removeTasks(filteredTaskIds);
        clearSelection();
      }
    );
  }, [clearSelection, filteredTaskIds, openDeleteConfirm, removeTasks]);

  const handleClearInactive = React.useCallback(() => {
    openDeleteConfirm(
      inactiveTaskIds,
      '确认清理残留任务',
      `即将清理全部 ${inactiveTaskIds.length} 个非活跃任务。正在下载和提交中的任务会被保留，只有在你点击“确认清理”后才会执行。`,
      async () => {
        await removeTasks(inactiveTaskIds);
        clearSelection();
      }
    );
  }, [clearSelection, inactiveTaskIds, openDeleteConfirm, removeTasks]);

  const handleRefresh = React.useCallback(async () => {
    await forceSync();
    await refreshStats();
    if (onRefresh) {
      onRefresh();
    }
  }, [forceSync, onRefresh, refreshStats]);

  return (
    <>
      <div className='bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 sticky top-0 z-10 shadow-sm'>
        <div className='px-4 py-3 flex flex-col gap-3'>
          <ToolbarActions
            searchQuery={searchQuery}
            outputDirectory={config.download.output_directory}
            hasSelection={hasSelection}
            isQueuePaused={isQueuePaused}
            canStartAll={canStartAll}
            hasPausableTasks={hasPausableTasks}
            canBulkSelectFiltered={canBulkSelectFiltered}
            canDeleteFilteredWithoutSelection={canDeleteFilteredWithoutSelection}
            canClearInactiveTasks={canClearInactiveTasks}
            onSearchChange={setSearchQuery}
            onOpenDownloadFolder={handleOpenDownloadFolder}
            onOpenSettings={onOpenSettings}
            onBatchAction={action => void handleBatchAction(action)}
            onSelectFiltered={() => setSelectedTasks(filteredTaskIds)}
            onDeleteFiltered={handleDeleteFiltered}
            onClearInactive={handleClearInactive}
            onRefresh={() => void handleRefresh()}
          />

          <ToolbarFilters
            filterStatus={filterStatus}
            stats={stats}
            onFilterChange={setFilterStatus}
          />
        </div>
      </div>

      <DownloadStartConfirmDialog
        open={startConfirmOpen}
        working={startConfirmWorking}
        taskCount={startConfirmTaskIds.length}
        defaultDirectory={config.download.output_directory}
        effectiveDirectory={startConfirmDirectory}
        samplePath={startConfirmSamplePath}
        onClose={closeStartConfirm}
        onChangeDirectory={handleChangeDirectoryForThisRun}
        onConfirm={runPendingStartAction}
      />

      <DeleteTasksConfirmDialog
        open={deleteConfirmOpen}
        working={deleteConfirmWorking}
        title={deleteConfirmTitle}
        description={deleteConfirmDescription}
        taskTitles={deleteConfirmTasks.map(task => task.title)}
        onClose={closeDeleteConfirm}
        onConfirm={runPendingDeleteAction}
      />
    </>
  );
};
