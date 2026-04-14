import React, { useMemo } from 'react';
import { useDownloadStore } from '../../stores/downloadStore';
import { useConfigStore } from '../../stores/configStore';
import { useUIStore } from '../../stores/uiStore';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import toast from 'react-hot-toast';
import {
  PlayIcon,
  PauseIcon,
  TrashIcon,
  ArrowPathIcon,
  MagnifyingGlassIcon,
  FolderIcon,
  CogIcon,
} from '@heroicons/react/24/outline';
import type { TaskStatus } from '../../types';
import { ensureDownloadStats } from '../../utils/downloadStats';
import {
  buildTaskOutputPathPreview,
} from '../../features/downloads/model/outputPathOverride';
import { DownloadStartConfirmDialog } from './DownloadStartConfirmDialog';
import { DeleteTasksConfirmDialog } from './DeleteTasksConfirmDialog';

interface DashboardToolbarProps {
  onRefresh?: () => void;
}

export const DashboardToolbar: React.FC<DashboardToolbarProps> = ({ onRefresh }) => {
  const tasks = useDownloadStore(state => state.tasks);
  const selectedTasks = useDownloadStore(state => state.selectedTasks);
  const startAllDownloads = useDownloadStore(state => state.startAllDownloads);
  const pauseAllDownloads = useDownloadStore(state => state.pauseAllDownloads);
  const removeTasks = useDownloadStore(state => state.removeTasks);
  const clearSelection = useDownloadStore(state => state.clearSelection);
  const setSelectedTasks = useDownloadStore(state => state.setSelectedTasks);
  const startDownload = useDownloadStore(state => state.startDownload);
  const pauseDownload = useDownloadStore(state => state.pauseDownload);
  const applyOutputDirectoryOverride = useDownloadStore(state => state.applyOutputDirectoryOverride);
  const filterStatus = useDownloadStore(state => state.filterStatus);
  const setFilterStatus = useDownloadStore(state => state.setFilterStatus);
  const searchQuery = useDownloadStore(state => state.searchQuery);
  const setSearchQuery = useDownloadStore(state => state.setSearchQuery);
  const refreshStats = useDownloadStore(state => state.refreshStats);
  const forceSync = useDownloadStore(state => state.forceSync);
  const backendStats = useDownloadStore(state => state.stats);
  const config = useConfigStore(state => state.config);
  const setCurrentView = useUIStore(state => state.setCurrentView);

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
    !hasSelection && canBulkSelectFiltered && (filterStatus !== 'all' || searchQuery.trim().length > 0);
  const inactiveTaskIds = useMemo(
    () =>
      tasks
        .filter(task =>
          ['completed', 'failed', 'paused', 'cancelled'].includes(task.status)
        )
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
      const selected = await open({
        directory: true,
        multiple: false,
        defaultPath: startConfirmDirectory || config.download.output_directory,
      });
      if (typeof selected === 'string' && selected) {
        setStartConfirmDirectory(selected);
      }
    } catch (error) {
      console.error('Failed to select temporary directory', error);
      toast.error('选择本次保存位置失败');
    }
  }, [config.download.output_directory, startConfirmDirectory]);

  const handleOpenDownloadFolder = React.useCallback(async () => {
    try {
      await invoke('open_download_folder');
    } catch (error) {
      console.error('Failed to open download folder', error);
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

  return (
    <>
      <div className='bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 sticky top-0 z-10 shadow-sm'>
        <div className='px-4 py-3 flex flex-col gap-3'>
          <div className='flex items-center justify-between gap-4'>
            <div className='flex items-center gap-3 flex-1 max-w-2xl'>
              <div className='relative flex-1'>
                <div className='absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none'>
                  <MagnifyingGlassIcon className='h-4 w-4 text-gray-400' />
                </div>
                <input
                  type='text'
                  value={searchQuery}
                  onChange={event => setSearchQuery(event.target.value)}
                  placeholder='搜索任务...'
                  data-testid='search-input'
                  className='block w-full pl-9 pr-3 py-1.5 text-sm bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-colors'
                />
              </div>

              <div
                onClick={handleOpenDownloadFolder}
                className='hidden md:flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-blue-600 dark:hover:text-blue-400 transition-all max-w-[240px]'
                title={`默认下载目录：${config.download.output_directory || '未设置'}。点击打开目录`}
              >
                <FolderIcon className='h-3.5 w-3.5 flex-shrink-0' />
                <span className='truncate'>{config.download.output_directory || '未设置目录'}</span>
              </div>

              <button
                onClick={() => setCurrentView('settings')}
                className='hidden md:inline-flex items-center px-2.5 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors'
                title='前往设置修改默认下载目录'
              >
                <CogIcon className='h-3.5 w-3.5 mr-1' />
                去设置
              </button>
            </div>

            <div className='flex items-center gap-2'>
              {isQueuePaused && (
                <div
                  className='hidden md:inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-amber-700 bg-amber-100 border border-amber-200 rounded-md dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-800'
                  title='队列已暂停：仅暂停下载中的任务，等待中的任务仍保留为等待中'
                >
                  <PauseIcon className='h-3.5 w-3.5' />
                  队列已暂停
                </div>
              )}
              <button
                onClick={() => void handleBatchAction('start')}
                disabled={hasSelection ? false : !canStartAll}
                data-testid='batch-start'
                className='inline-flex items-center px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm'
              >
                <PlayIcon className='h-4 w-4 mr-1.5' />
                {hasSelection ? '开始选中' : '全部开始'}
              </button>

              <button
                onClick={() => void handleBatchAction('pause')}
                disabled={hasSelection ? false : !hasPausableTasks}
                data-testid='batch-pause'
                className='inline-flex items-center px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-600 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors'
              >
                <PauseIcon className='h-4 w-4 mr-1.5' />
                {hasSelection ? '暂停选中' : '全部暂停'}
              </button>

              {hasSelection && (
                <button
                  onClick={() => void handleBatchAction('delete')}
                  className='inline-flex items-center px-3 py-1.5 text-sm font-medium text-red-600 bg-red-50 border border-red-200 rounded-md hover:bg-red-100 dark:bg-red-900/20 dark:border-red-800 dark:text-red-400 transition-colors'
                >
                  <TrashIcon className='h-4 w-4 mr-1.5' />
                  删除
                </button>
              )}

              {!hasSelection && canBulkSelectFiltered && (
                <button
                  onClick={() => setSelectedTasks(filteredTaskIds)}
                  className='inline-flex items-center px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-600 dark:hover:bg-gray-700 transition-colors'
                  title='选中当前筛选结果，便于批量处理'
                >
                  选中当前筛选
                </button>
              )}

              {canDeleteFilteredWithoutSelection && (
                <button
                  onClick={() =>
                    openDeleteConfirm(
                      filteredTaskIds,
                      '确认清理筛选结果',
                      `即将清理当前筛选结果中的 ${filteredTaskIds.length} 个任务。只有在你点击“确认清理”后才会执行。`,
                      async () => {
                        await removeTasks(filteredTaskIds);
                        clearSelection();
                      }
                    )
                  }
                  className='inline-flex items-center px-3 py-1.5 text-sm font-medium text-red-600 bg-red-50 border border-red-200 rounded-md hover:bg-red-100 dark:bg-red-900/20 dark:border-red-800 dark:text-red-400 transition-colors'
                  title='按当前筛选条件批量清理残留任务'
                >
                  清理筛选结果
                </button>
              )}

              {canClearInactiveTasks && (
                <button
                  onClick={() =>
                    openDeleteConfirm(
                      inactiveTaskIds,
                      '确认清理残留任务',
                      `即将清理全部 ${inactiveTaskIds.length} 个非活跃任务。正在下载和提交中的任务会被保留，只有在你点击“确认清理”后才会执行。`,
                      async () => {
                        await removeTasks(inactiveTaskIds);
                        clearSelection();
                      }
                    )
                  }
                  className='inline-flex items-center px-3 py-1.5 text-sm font-medium text-red-600 bg-red-50 border border-red-200 rounded-md hover:bg-red-100 dark:bg-red-900/20 dark:border-red-800 dark:text-red-400 transition-colors'
                  title='一键清理历史残留任务，仅保留当前活跃下载'
                >
                  清理残留任务
                </button>
              )}

              <div className='h-6 w-px bg-gray-200 dark:bg-gray-700 mx-1' />

              <button
                onClick={async () => {
                  await forceSync();
                  await refreshStats();
                  if (onRefresh) {
                    onRefresh();
                  }
                }}
                className='p-1.5 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors'
                title='刷新列表'
              >
                <ArrowPathIcon className='h-5 w-5' />
              </button>
            </div>
          </div>

          <div
            className='flex items-center gap-1 overflow-x-auto pb-1 scrollbar-hide'
            data-testid='status-filter'
          >
            <FilterTab
              active={filterStatus === 'all'}
              onClick={() => setFilterStatus('all')}
              label='全部任务'
              count={stats.all}
              value='all'
            />
            <FilterTab
              active={filterStatus === 'downloading'}
              onClick={() => setFilterStatus('downloading')}
              label='下载中'
              count={stats.downloading}
              color='blue'
              value='downloading'
            />
            <FilterTab
              active={filterStatus === 'pending'}
              onClick={() => setFilterStatus('pending')}
              label='等待中'
              count={stats.pending}
              color='yellow'
              value='pending'
            />
            <FilterTab
              active={filterStatus === 'paused'}
              onClick={() => setFilterStatus('paused')}
              label='已暂停'
              count={stats.paused}
              color='orange'
              value='paused'
            />
            <FilterTab
              active={filterStatus === 'completed'}
              onClick={() => setFilterStatus('completed')}
              label='已完成'
              count={stats.completed}
              color='green'
              value='completed'
            />
            <FilterTab
              active={filterStatus === 'failed'}
              onClick={() => setFilterStatus('failed')}
              label='失败'
              count={stats.failed}
              color='red'
              value='failed'
            />
          </div>
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

interface FilterTabProps {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  color?: 'blue' | 'green' | 'yellow' | 'red' | 'orange' | 'gray';
  value: string;
}

const FilterTab: React.FC<FilterTabProps> = ({
  active,
  onClick,
  label,
  count,
  color = 'gray',
  value,
}) => {
  const activeClasses = {
    blue: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 ring-1 ring-blue-500/20',
    green:
      'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 ring-1 ring-green-500/20',
    yellow:
      'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400 ring-1 ring-yellow-500/20',
    red: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 ring-1 ring-red-500/20',
    orange:
      'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 ring-1 ring-orange-500/20',
    gray: 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100 ring-1 ring-gray-500/20',
  };

  return (
    <button
      onClick={onClick}
      data-value={value}
      className={`
        flex items-center px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200 whitespace-nowrap
        ${
          active
            ? activeClasses[color]
            : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-300'
        }
      `}
    >
      {label}
      <span className='ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] bg-white/50 dark:bg-black/20'>
        {count}
      </span>
    </button>
  );
};
