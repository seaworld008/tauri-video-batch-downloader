import React from 'react';
import { useDownloadStore } from '../../stores/downloadStore';
import {
  ArrowDownTrayIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import { formatBytes, formatSpeed } from '../../utils/format';
import { useI18n } from '../../i18n/hooks';

export const StatusBar: React.FC = () => {
  const { t } = useI18n();
  const tasks = useDownloadStore(state => state.tasks);
  const stats = useDownloadStore(state => state.stats);

  // Calculate real-time stats
  const activeStats = React.useMemo(() => {
    return tasks.reduce(
      (acc, task) => {
        if (task.status === 'downloading') {
          acc.downloading++;
        } else if (task.status === 'committing') {
          acc.committing++;
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
      { downloading: 0, committing: 0, pending: 0, paused: 0, failed: 0, completed: 0 }
    );
  }, [tasks]);

  const totalDownloaded = React.useMemo(
    () => tasks.reduce((sum, task) => sum + (task.downloaded_size || 0), 0),
    [tasks]
  );

  const overviewBadge = React.useMemo(() => {
    if (stats.queue_paused) {
      return {
        label: t('statusBar.badgePaused'),
        className:
          'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
        dotClass: 'bg-amber-500',
        kind: 'dot' as const,
      };
    }
    if (activeStats.downloading > 0 || activeStats.committing > 0) {
      return {
        label: t('statusBar.badgeDownloading'),
        className:
          'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
        dotClass: 'bg-blue-500 animate-pulse',
        kind: 'dot' as const,
      };
    }
    if (activeStats.failed > 0) {
      return {
        label: t('statusBar.badgeFailed'),
        className:
          'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300',
        dotClass: '',
        kind: 'error' as const,
      };
    }
    if (activeStats.pending > 0) {
      return {
        label: t('statusBar.badgePending'),
        className:
          'border-yellow-200 bg-yellow-50 text-yellow-700 dark:border-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
        dotClass: 'bg-yellow-500',
        kind: 'dot' as const,
      };
    }
    return {
      label: t('statusBar.badgeReady'),
      className:
        'border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-900/30 dark:text-green-400',
      dotClass: '',
      kind: 'ready' as const,
    };
  }, [
    stats.queue_paused,
    activeStats.downloading,
    activeStats.committing,
    activeStats.failed,
    activeStats.pending,
    t,
  ]);

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
              <span>{t('statusBar.transferTitle')}</span>
            </div>
            <span className='text-[11px] tabular-nums text-gray-500 dark:text-gray-400'>
              {t('statusBar.realtime')}
            </span>
          </div>

          <div className='grid grid-cols-2 gap-x-5 gap-y-2'>
            <div className='flex min-w-0 items-center gap-4 rounded bg-white px-3 py-1.5 dark:bg-gray-800/80'>
              <span className='truncate text-gray-500 dark:text-gray-400'>
                {t('statusBar.totalSpeed')}
              </span>
              <span className='ml-auto inline-flex min-w-[5.75rem] justify-end font-semibold tabular-nums text-gray-800 dark:text-gray-100'>
                {stats.display_total_speed_bps && stats.display_total_speed_bps > 0
                  ? formatSpeed(stats.display_total_speed_bps)
                  : '0 B/s'}
              </span>
            </div>

            <div
              data-testid='active-tasks'
              className='flex min-w-0 items-center gap-4 rounded bg-white px-3 py-1.5 dark:bg-gray-800/80'
            >
              <span className='truncate text-gray-500 dark:text-gray-400'>
                {t('statusBar.downloading')}
              </span>
              <span className='ml-auto inline-flex min-w-[3.75rem] justify-end font-semibold tabular-nums text-blue-600 dark:text-blue-400'>
                {activeStats.downloading}
              </span>
            </div>

            <div className='flex min-w-0 items-center gap-4 rounded bg-white px-3 py-1.5 dark:bg-gray-800/80'>
              <span className='truncate text-gray-500 dark:text-gray-400'>
                {t('statusBar.committing')}
              </span>
              <span className='ml-auto inline-flex min-w-[3.75rem] justify-end font-semibold tabular-nums text-indigo-600 dark:text-indigo-300'>
                {activeStats.committing}
              </span>
            </div>

            <div className='flex min-w-0 items-center gap-4 rounded bg-white px-3 py-1.5 dark:bg-gray-800/80'>
              <span className='truncate text-gray-500 dark:text-gray-400'>
                {t('statusBar.paused')}
              </span>
              <span className='ml-auto inline-flex min-w-[3.75rem] justify-end font-semibold tabular-nums text-orange-600 dark:text-orange-400'>
                {activeStats.paused}
              </span>
            </div>

            <div className='flex min-w-0 items-center gap-4 rounded bg-white px-3 py-1.5 dark:bg-gray-800/80'>
              <span className='truncate text-gray-500 dark:text-gray-400'>
                {t('statusBar.pending')}
              </span>
              <span className='ml-auto inline-flex min-w-[3.75rem] justify-end font-semibold tabular-nums text-yellow-600 dark:text-yellow-500'>
                {activeStats.pending}
              </span>
            </div>

            <div className='flex min-w-0 items-center gap-4 rounded bg-white px-3 py-1.5 dark:bg-gray-800/80'>
              <span className='truncate text-gray-500 dark:text-gray-400'>
                {t('statusBar.avgCommit')}
              </span>
              <span className='ml-auto inline-flex min-w-[5rem] justify-end font-semibold tabular-nums text-indigo-600 dark:text-indigo-300'>
                {stats.average_commit_duration && stats.average_commit_duration > 0
                  ? `${stats.average_commit_duration.toFixed(1)}s`
                  : '--'}
              </span>
            </div>

            <div className='flex min-w-0 items-center gap-4 rounded bg-white px-3 py-1.5 dark:bg-gray-800/80'>
              <span className='truncate text-gray-500 dark:text-gray-400'>
                {t('statusBar.p95Commit')}
              </span>
              <span className='ml-auto inline-flex min-w-[5rem] justify-end font-semibold tabular-nums text-indigo-600 dark:text-indigo-300'>
                {stats.p95_commit_duration && stats.p95_commit_duration > 0
                  ? `${stats.p95_commit_duration.toFixed(1)}s`
                  : '--'}
              </span>
            </div>
          </div>
        </section>

        <section className='min-w-0 rounded-md border border-gray-200 bg-gray-50/70 px-3 py-2 dark:border-gray-700 dark:bg-gray-900/30'>
          <div className='mb-2 flex items-center justify-between'>
            <span className='text-[11px] font-medium text-gray-500 dark:text-gray-400'>
              {t('statusBar.overviewTitle')}
            </span>
            <span
              data-testid='status-overview-badge'
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${overviewBadge.className}`}
            >
              {overviewBadge.kind === 'error' ? (
                <ExclamationTriangleIcon className='w-3 h-3' />
              ) : overviewBadge.kind === 'ready' ? (
                <CheckCircleIcon className='w-3 h-3' />
              ) : (
                <span className={`w-1.5 h-1.5 rounded-full ${overviewBadge.dotClass}`} />
              )}
              {overviewBadge.label}
            </span>
          </div>

          <div className='grid grid-cols-2 gap-x-5 gap-y-2'>
            <div
              data-testid='total-tasks'
              className='flex min-w-0 items-center gap-4 rounded bg-white px-3 py-1.5 dark:bg-gray-800/80'
            >
              <span className='truncate text-gray-500 dark:text-gray-400'>
                {t('statusBar.totalTasks')}
              </span>
              <span className='ml-auto inline-flex min-w-[3.75rem] justify-end font-semibold tabular-nums text-gray-800 dark:text-gray-100'>
                {tasks.length}
              </span>
            </div>

            <div
              data-testid='completed-tasks'
              className='flex min-w-0 items-center gap-4 rounded bg-white px-3 py-1.5 dark:bg-gray-800/80'
            >
              <span className='truncate text-gray-500 dark:text-gray-400'>
                {t('statusBar.completed')}
              </span>
              <span className='ml-auto inline-flex min-w-[3.75rem] justify-end font-semibold tabular-nums text-green-600 dark:text-green-400'>
                {activeStats.completed}
              </span>
            </div>

            <div className='flex min-w-0 items-center gap-4 rounded bg-white px-3 py-1.5 dark:bg-gray-800/80'>
              <span className='inline-flex items-center gap-1 truncate text-gray-500 dark:text-gray-400'>
                <ExclamationTriangleIcon className='w-3.5 h-3.5 text-red-500' />
                {t('statusBar.errors')}
              </span>
              <span className='ml-auto inline-flex min-w-[3.75rem] justify-end font-semibold tabular-nums text-red-600 dark:text-red-400'>
                {activeStats.failed}
              </span>
            </div>

            <div
              data-testid='total-downloaded'
              className='flex min-w-0 items-center gap-4 rounded bg-white px-3 py-1.5 dark:bg-gray-800/80'
            >
              <span className='truncate text-gray-500 dark:text-gray-400'>
                {t('statusBar.downloaded')}
              </span>
              <span className='ml-auto inline-flex min-w-[6.5rem] justify-end font-semibold tabular-nums text-gray-800 dark:text-gray-100'>
                {formatBytes(totalDownloaded)}
              </span>
            </div>

            <div className='flex min-w-0 items-center gap-4 rounded bg-white px-3 py-1.5 dark:bg-gray-800/80'>
              <span className='truncate text-gray-500 dark:text-gray-400'>
                {t('statusBar.commitWarnings')}
              </span>
              <span className='ml-auto inline-flex min-w-[4.5rem] justify-end font-semibold tabular-nums text-amber-600 dark:text-amber-400'>
                {stats.commit_warning_count ?? 0}
              </span>
            </div>

            <div className='flex min-w-0 items-center gap-4 rounded bg-white px-3 py-1.5 dark:bg-gray-800/80'>
              <span className='truncate text-gray-500 dark:text-gray-400'>
                {t('statusBar.commitFailures')}
              </span>
              <span className='ml-auto inline-flex min-w-[4.5rem] justify-end font-semibold tabular-nums text-red-600 dark:text-red-400'>
                {stats.failed_commit_count ?? 0}
              </span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};
