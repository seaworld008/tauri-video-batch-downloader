import React, { useMemo } from 'react';
import { useDownloadStore } from '../../stores/downloadStore';
import { useConfigStore } from '../../stores/configStore';
import { open } from '@tauri-apps/api/dialog';
import { invoke } from '@tauri-apps/api/tauri';
import toast from 'react-hot-toast';
import {
  PlayIcon,
  PauseIcon,
  TrashIcon,
  ArrowPathIcon,
  FunnelIcon,
  MagnifyingGlassIcon,
  CheckCircleIcon,
  FolderIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import type { TaskStatus } from '../../types';
import { ensureDownloadStats } from '../../utils/downloadStats';

interface DashboardToolbarProps {
  onRefresh?: () => void;
}

export const DashboardToolbar: React.FC<DashboardToolbarProps> = ({ onRefresh }) => {
  const {
    tasks,
    selectedTasks,
    startAllDownloads,
    pauseAllDownloads,
    removeTasks,
    clearSelection,
    startDownload,
    pauseDownload,
    filterStatus,
    setFilterStatus,
    searchQuery,
    setSearchQuery,
    refreshTasks,
    refreshStats,
    forceSync,
    stats: backendStats,
  } = useDownloadStore();

  const { config, updateDownloadConfig } = useConfigStore();
  const [startConfirmOpen, setStartConfirmOpen] = React.useState(false);
  const [startConfirmWorking, setStartConfirmWorking] = React.useState(false);
  const pendingStartActionRef = React.useRef<(() => Promise<void>) | null>(null);

  const hasSelection = selectedTasks.length > 0;
  const safeBackendStats = useMemo(() => ensureDownloadStats(backendStats), [backendStats]);

  // 状态统计
  const stats = useMemo(
    () => ({
      all: tasks.length,
      downloading: tasks.filter(t => t.status === 'downloading').length,
      completed: tasks.filter(t => t.status === 'completed').length,
      failed: tasks.filter(t => t.status === 'failed').length,
      paused: tasks.filter(t => t.status === 'paused').length,
      pending: tasks.filter(t => t.status === 'pending').length,
    }),
    [tasks]
  );
  const canStartAll = stats.pending + stats.paused + stats.failed > 0;
  const isQueuePaused = safeBackendStats.queue_paused;

  const closeStartConfirm = React.useCallback(() => {
    setStartConfirmOpen(false);
    setStartConfirmWorking(false);
    pendingStartActionRef.current = null;
  }, []);

  const openStartConfirm = React.useCallback((startAction: () => Promise<void>) => {
    pendingStartActionRef.current = startAction;
    setStartConfirmOpen(true);
  }, []);

  const runPendingStartAction = React.useCallback(async () => {
    if (!pendingStartActionRef.current) {
      return;
    }
    setStartConfirmWorking(true);
    try {
      await pendingStartActionRef.current();
    } finally {
      closeStartConfirm();
    }
  }, [closeStartConfirm]);

  const handleChangeDirAndStart = React.useCallback(async () => {
    const selected = await open({ directory: true, defaultPath: config.download.output_directory });
    if (selected && typeof selected === 'string') {
      await updateDownloadConfig({ output_directory: selected });
      await runPendingStartAction();
    }
  }, [config.download.output_directory, updateDownloadConfig, runPendingStartAction]);

  const handleOpenDownloadFolder = React.useCallback(async () => {
    try {
      await invoke('open_download_folder');
    } catch (error) {
      console.error('Failed to open download folder', error);
      toast.error('打开下载目录失败');
    }
  }, []);

  const handleSelectDownloadFolder = React.useCallback(async () => {
    try {
      const selected = await open({
        directory: true,
        defaultPath: config.download.output_directory,
      });
      if (selected && typeof selected === 'string') {
        await updateDownloadConfig({ output_directory: selected });
      }
    } catch (error) {
      console.error('Failed to change directory', error);
      toast.error('更改目录失败');
    }
  }, [config.download.output_directory, updateDownloadConfig]);

  React.useEffect(() => {
    if (!startConfirmOpen) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeStartConfirm();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [startConfirmOpen, closeStartConfirm]);

  // 批量操作处理 - 使用 useCallback 避免每次渲染创建新函数
  const handleBatchAction = React.useCallback(
    async (action: 'start' | 'pause' | 'delete') => {
      if (!hasSelection) {
        // 全局操作
        switch (action) {
          case 'start':
            openStartConfirm(async () => {
              await startAllDownloads();
            });
            break;
          case 'pause':
            await pauseAllDownloads();
            break;
        }
        return;
      }

      // 选中项操作
      const selectedItems = tasks.filter(t => selectedTasks.includes(t.id));

      switch (action) {
        case 'start':
          openStartConfirm(async () => {
            await Promise.all(
              selectedItems
                .filter(t => ['pending', 'paused', 'failed'].includes(t.status))
                .map(t => startDownload(t.id))
            );
          });
          break;
        case 'pause':
          await Promise.all(
            selectedItems.filter(t => t.status === 'downloading').map(t => pauseDownload(t.id))
          );
          break;
        case 'delete':
          if (confirm(`确定要删除选中的 ${selectedTasks.length} 个任务吗？`)) {
            await removeTasks(selectedTasks);
            clearSelection();
          }
          break;
      }
    },
    [
      hasSelection,
      tasks,
      selectedTasks,
      startAllDownloads,
      pauseAllDownloads,
      removeTasks,
      clearSelection,
      startDownload,
      pauseDownload,
      openStartConfirm,
    ]
  );

  return (
    <>
      <div className='bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 sticky top-0 z-10 shadow-sm'>
        <div className='px-4 py-3 flex flex-col gap-3'>
          {/* 第一行：搜索与主要操作 */}
          <div className='flex items-center justify-between gap-4'>
            {/* 左侧：搜索框与目录显示 */}
            <div className='flex items-center gap-3 flex-1 max-w-2xl'>
              <div className='relative flex-1'>
                <div className='absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none'>
                  <MagnifyingGlassIcon className='h-4 w-4 text-gray-400' />
                </div>
                <input
                  type='text'
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder='搜索任务...'
                  data-testid='search-input'
                  className='block w-full pl-9 pr-3 py-1.5 text-sm bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-colors'
                />
              </div>

              {/* 目录显示与更改 */}
              <div
                onClick={handleOpenDownloadFolder}
                className='hidden md:flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-blue-600 dark:hover:text-blue-400 transition-all max-w-[200px]'
                title='点击打开下载目录'
              >
                <FolderIcon className='h-3.5 w-3.5 flex-shrink-0' />
                <span className='truncate'>{config.download.output_directory || '未设置目录'}</span>
              </div>
              <button
                onClick={handleSelectDownloadFolder}
                className='hidden md:inline-flex items-center px-2.5 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors'
                title='更改下载目录'
              >
                更改目录
              </button>
            </div>

            {/* 右侧：操作按钮组 */}
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
                onClick={() => handleBatchAction('start')}
                disabled={hasSelection ? false : !canStartAll}
                data-testid='batch-start'
                className='inline-flex items-center px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm'
              >
                <PlayIcon className='h-4 w-4 mr-1.5' />
                {hasSelection ? '开始选中' : '全部开始'}
              </button>

              <button
                onClick={() => handleBatchAction('pause')}
                disabled={hasSelection ? false : stats.downloading === 0}
                data-testid='batch-pause'
                className='inline-flex items-center px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-600 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors'
              >
                <PauseIcon className='h-4 w-4 mr-1.5' />
                {hasSelection ? '暂停选中' : '全部暂停'}
              </button>

              {hasSelection && (
                <button
                  onClick={() => handleBatchAction('delete')}
                  className='inline-flex items-center px-3 py-1.5 text-sm font-medium text-red-600 bg-red-50 border border-red-200 rounded-md hover:bg-red-100 dark:bg-red-900/20 dark:border-red-800 dark:text-red-400 transition-colors'
                >
                  <TrashIcon className='h-4 w-4 mr-1.5' />
                  删除
                </button>
              )}

              <div className='h-6 w-px bg-gray-200 dark:bg-gray-700 mx-1' />

              <button
                onClick={async () => {
                  await forceSync();
                  await refreshStats();
                }}
                className='p-1.5 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors'
                title='刷新列表'
              >
                <ArrowPathIcon className='h-5 w-5' />
              </button>
            </div>
          </div>

          {/* 第二行：状态筛选 Tabs */}
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

      {startConfirmOpen && (
        <div
          className='fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4'
          onClick={closeStartConfirm}
        >
          <div
            className='bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-md w-full p-6'
            onClick={e => e.stopPropagation()}
          >
            <div className='flex items-center justify-between mb-4'>
              <h3 className='text-lg font-semibold text-gray-900 dark:text-white'>开始下载确认</h3>
              <button
                onClick={closeStartConfirm}
                className='p-1.5 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700'
                aria-label='关闭'
              >
                <XMarkIcon className='h-5 w-5 text-gray-500' />
              </button>
            </div>
            <div className='text-sm text-gray-600 dark:text-gray-300 mb-4 whitespace-pre-line'>
              当前下载目录：
              {'\n'}
              {config.download.output_directory || '未设置目录'}
            </div>
            <div className='flex flex-col sm:flex-row gap-2'>
              <button
                onClick={closeStartConfirm}
                className='flex-1 px-3 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors'
              >
                取消
              </button>
              <button
                onClick={handleChangeDirAndStart}
                disabled={startConfirmWorking}
                className='flex-1 px-3 py-2 text-sm font-medium text-blue-600 bg-blue-50 rounded-md hover:bg-blue-100 disabled:opacity-50 transition-colors'
              >
                更改目录
              </button>
              <button
                onClick={runPendingStartAction}
                disabled={startConfirmWorking}
                className='flex-1 px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors'
              >
                直接开始
              </button>
            </div>
          </div>
        </div>
      )}
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
      <span
        className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] bg-white/50 dark:bg-black/20`}
      >
        {count}
      </span>
    </button>
  );
};
