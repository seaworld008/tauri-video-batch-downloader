import React from 'react';
import { useDownloadStore } from '../../stores/downloadStore';
import {
  ArrowDownTrayIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import { formatBytes } from '../../utils/format';

export const StatusBar: React.FC = () => {
  const tasks = useDownloadStore(state => state.tasks);

  // Calculate real-time stats
  const activeStats = React.useMemo(() => {
    return tasks.reduce(
      (acc, task) => {
        if (task.status === 'downloading') {
          acc.downloading++;
          acc.speed += task.speed || 0;
        } else if (task.status === 'paused') {
          acc.paused++;
        } else if (task.status === 'pending') {
          acc.pending++;
        } else if (task.status === 'failed') {
          acc.failed++;
        } else if (task.status === 'completed') {
          acc.completed++;
        }
        return acc;
      },
      { downloading: 0, pending: 0, paused: 0, failed: 0, completed: 0, speed: 0 }
    );
  }, [tasks]);

  const totalDownloaded = React.useMemo(
    () => tasks.reduce((sum, task) => sum + (task.downloaded_size || 0), 0),
    [tasks]
  );

  return (
    <div
      className='bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 px-4 py-2 text-xs text-gray-600 dark:text-gray-400 select-none shrink-0 z-20'
      data-testid='download-stats'
    >
      <div className='grid grid-cols-1 lg:grid-cols-2 gap-4'>
        <section className='min-w-0 rounded-md border border-gray-200 bg-gray-50/70 px-3 py-2 dark:border-gray-700 dark:bg-gray-900/30'>
          <div className='mb-2 flex items-center justify-between'>
            <div className='flex items-center gap-1.5 text-[11px] font-medium text-gray-500 dark:text-gray-400'>
              <ArrowDownTrayIcon className='w-3.5 h-3.5' />
              <span>下载态势</span>
            </div>
            <span className='text-[11px] tabular-nums text-gray-500 dark:text-gray-400'>实时</span>
          </div>

          <div className='grid grid-cols-2 gap-x-5 gap-y-2'>
            <div className='flex min-w-0 items-center gap-4 rounded bg-white px-3 py-1.5 dark:bg-gray-800/80'>
              <span className='truncate text-gray-500 dark:text-gray-400'>总速度</span>
              <span className='ml-auto inline-flex min-w-[5.75rem] justify-end font-semibold tabular-nums text-gray-800 dark:text-gray-100'>
                {activeStats.speed > 0 ? `${formatBytes(activeStats.speed)}/s` : '0 B/s'}
              </span>
            </div>

            <div
              data-testid='active-tasks'
              className='flex min-w-0 items-center gap-4 rounded bg-white px-3 py-1.5 dark:bg-gray-800/80'
            >
              <span className='truncate text-gray-500 dark:text-gray-400'>下载中</span>
              <span className='ml-auto inline-flex min-w-[3.75rem] justify-end font-semibold tabular-nums text-blue-600 dark:text-blue-400'>
                {activeStats.downloading}
              </span>
            </div>

            <div className='flex min-w-0 items-center gap-4 rounded bg-white px-3 py-1.5 dark:bg-gray-800/80'>
              <span className='truncate text-gray-500 dark:text-gray-400'>已暂停</span>
              <span className='ml-auto inline-flex min-w-[3.75rem] justify-end font-semibold tabular-nums text-orange-600 dark:text-orange-400'>
                {activeStats.paused}
              </span>
            </div>

            <div className='flex min-w-0 items-center gap-4 rounded bg-white px-3 py-1.5 dark:bg-gray-800/80'>
              <span className='truncate text-gray-500 dark:text-gray-400'>等待</span>
              <span className='ml-auto inline-flex min-w-[3.75rem] justify-end font-semibold tabular-nums text-yellow-600 dark:text-yellow-500'>
                {activeStats.pending}
              </span>
            </div>
          </div>
        </section>

        <section className='min-w-0 rounded-md border border-gray-200 bg-gray-50/70 px-3 py-2 dark:border-gray-700 dark:bg-gray-900/30'>
          <div className='mb-2 flex items-center justify-between'>
            <span className='text-[11px] font-medium text-gray-500 dark:text-gray-400'>
              任务总览
            </span>
            <span className='inline-flex items-center gap-1 rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-[11px] text-green-700 dark:border-green-800 dark:bg-green-900/30 dark:text-green-400'>
              <CheckCircleIcon className='w-3 h-3' />
              就绪
            </span>
          </div>

          <div className='grid grid-cols-2 gap-x-5 gap-y-2'>
            <div
              data-testid='total-tasks'
              className='flex min-w-0 items-center gap-4 rounded bg-white px-3 py-1.5 dark:bg-gray-800/80'
            >
              <span className='truncate text-gray-500 dark:text-gray-400'>总任务</span>
              <span className='ml-auto inline-flex min-w-[3.75rem] justify-end font-semibold tabular-nums text-gray-800 dark:text-gray-100'>
                {tasks.length}
              </span>
            </div>

            <div
              data-testid='completed-tasks'
              className='flex min-w-0 items-center gap-4 rounded bg-white px-3 py-1.5 dark:bg-gray-800/80'
            >
              <span className='truncate text-gray-500 dark:text-gray-400'>已完成</span>
              <span className='ml-auto inline-flex min-w-[3.75rem] justify-end font-semibold tabular-nums text-green-600 dark:text-green-400'>
                {activeStats.completed}
              </span>
            </div>

            <div className='flex min-w-0 items-center gap-4 rounded bg-white px-3 py-1.5 dark:bg-gray-800/80'>
              <span className='inline-flex items-center gap-1 truncate text-gray-500 dark:text-gray-400'>
                <ExclamationTriangleIcon className='w-3.5 h-3.5 text-red-500' />
                错误
              </span>
              <span className='ml-auto inline-flex min-w-[3.75rem] justify-end font-semibold tabular-nums text-red-600 dark:text-red-400'>
                {activeStats.failed}
              </span>
            </div>

            <div
              data-testid='total-downloaded'
              className='flex min-w-0 items-center gap-4 rounded bg-white px-3 py-1.5 dark:bg-gray-800/80'
            >
              <span className='truncate text-gray-500 dark:text-gray-400'>已下载</span>
              <span className='ml-auto inline-flex min-w-[6.5rem] justify-end font-semibold tabular-nums text-gray-800 dark:text-gray-100'>
                {formatBytes(totalDownloaded)}
              </span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};
