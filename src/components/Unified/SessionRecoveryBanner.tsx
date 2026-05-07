import React, { useMemo, useState } from 'react';
import { ArrowPathIcon, CheckCircleIcon, PlayIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useDownloadStore } from '../../stores/downloadStore';

const buttonFocusClass =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';

export const SessionRecoveryBanner: React.FC = () => {
  const tasks = useDownloadStore(state => state.tasks);
  const recoveredSessionTaskIds = useDownloadStore(state => state.recoveredSessionTaskIds);
  const startAllDownloads = useDownloadStore(state => state.startAllDownloads);
  const retryFailedTasks = useDownloadStore(state => state.retryFailedTasks);
  const clearCompletedTasks = useDownloadStore(state => state.clearCompletedTasks);
  const clearRecoveredSession = useDownloadStore(state => state.clearRecoveredSession);
  const [isDismissed, setIsDismissed] = useState(false);
  const [busyAction, setBusyAction] = useState<'resume' | 'retry' | 'clear' | null>(null);
  const recoveredTaskIdSet = useMemo(
    () => new Set(recoveredSessionTaskIds),
    [recoveredSessionTaskIds]
  );
  const recoveredTasks = useMemo(
    () => tasks.filter(task => recoveredTaskIdSet.has(task.id)),
    [recoveredTaskIdSet, tasks]
  );

  const counts = useMemo(
    () =>
      recoveredTasks.reduce(
        (acc, task) => {
          if (task.status === 'pending') acc.pending += 1;
          if (task.status === 'paused') acc.paused += 1;
          if (task.status === 'failed') acc.failed += 1;
          if (task.status === 'completed') acc.completed += 1;
          return acc;
        },
        { pending: 0, paused: 0, failed: 0, completed: 0 }
      ),
    [recoveredTasks]
  );

  const recoverableCount = counts.pending + counts.paused + counts.failed + counts.completed;
  const resumableCount = counts.pending + counts.paused;

  if (isDismissed || recoveredSessionTaskIds.length === 0 || recoverableCount === 0) {
    return null;
  }

  const runAction = async (action: 'resume' | 'retry' | 'clear', callback: () => Promise<void>) => {
    setBusyAction(action);
    try {
      await callback();
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div
      className='border-b border-sky-200 dark:border-sky-900/70 bg-sky-50 dark:bg-sky-950/30 px-4 py-3'
      data-testid='session-recovery-banner'
    >
      <div className='max-w-7xl mx-auto flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between'>
        <div className='min-w-0'>
          <div className='flex items-center gap-2 text-sm font-medium text-sky-900 dark:text-sky-100'>
            <ArrowPathIcon className='w-4 h-4 shrink-0' />
            <span>上次会话已恢复</span>
          </div>
          <div className='mt-1 text-xs text-sky-800/80 dark:text-sky-100/75'>
            {counts.paused} 个可继续，{counts.pending} 个等待，{counts.failed} 个失败，
            {counts.completed} 个已完成。继续时会从可用缓存或断点恢复，必要时重新请求。
          </div>
        </div>

        <div className='flex flex-wrap items-center gap-2 lg:justify-end'>
          <button
            type='button'
            onClick={() => runAction('resume', startAllDownloads)}
            disabled={resumableCount === 0 || busyAction !== null}
            className={`inline-flex items-center gap-1.5 rounded-md bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-700 disabled:opacity-50 ${buttonFocusClass}`}
          >
            <PlayIcon className='w-3.5 h-3.5' />
            {busyAction === 'resume' ? '提交中' : `继续 ${resumableCount} 个`}
          </button>
          <button
            type='button'
            onClick={() => runAction('retry', retryFailedTasks)}
            disabled={counts.failed === 0 || busyAction !== null}
            className={`inline-flex items-center gap-1.5 rounded-md border border-sky-300 bg-white px-3 py-1.5 text-xs font-medium text-sky-800 hover:bg-sky-100 disabled:opacity-50 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-100 dark:hover:bg-sky-900 ${buttonFocusClass}`}
          >
            <ArrowPathIcon className='w-3.5 h-3.5' />
            {busyAction === 'retry' ? '重试中' : `重试失败 ${counts.failed} 个`}
          </button>
          <button
            type='button'
            onClick={() => runAction('clear', clearCompletedTasks)}
            disabled={counts.completed === 0 || busyAction !== null}
            className={`inline-flex items-center gap-1.5 rounded-md border border-sky-300 bg-white px-3 py-1.5 text-xs font-medium text-sky-800 hover:bg-sky-100 disabled:opacity-50 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-100 dark:hover:bg-sky-900 ${buttonFocusClass}`}
          >
            <CheckCircleIcon className='w-3.5 h-3.5' />
            清理完成 {counts.completed} 个
          </button>
          <button
            type='button'
            onClick={() => {
              setIsDismissed(true);
              clearRecoveredSession();
            }}
            className={`rounded-md p-1.5 text-sky-700 hover:bg-sky-100 dark:text-sky-100 dark:hover:bg-sky-900 ${buttonFocusClass}`}
            title='暂时隐藏'
            aria-label='暂时隐藏上次会话提示'
          >
            <XMarkIcon className='w-4 h-4' />
          </button>
        </div>
      </div>
    </div>
  );
};
