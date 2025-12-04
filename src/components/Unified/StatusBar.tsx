import React from 'react';
import { useDownloadStore } from '../../stores/downloadStore';
import {
  ArrowDownTrayIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon
} from '@heroicons/react/24/outline';
import { formatBytes } from '../../utils/format';

export const StatusBar: React.FC = () => {
  const { tasks } = useDownloadStore();

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

  return (
    <div className="bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 h-8 px-4 flex items-center justify-between text-xs text-gray-600 dark:text-gray-400 select-none shrink-0 z-20">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5" title="Total Download Speed">
          <ArrowDownTrayIcon className="w-3.5 h-3.5" />
          <span className="font-medium tabular-nums">
            {activeStats.speed > 0 ? `${formatBytes(activeStats.speed)}/s` : '0 B/s'}
          </span>
        </div>
        
        <div className="h-3 w-px bg-gray-300 dark:bg-gray-600" />
        
        <div className="flex items-center gap-1.5">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-blue-500"></span>
            {activeStats.downloading} 下载中
          </span>
          <span className="flex items-center gap-1 ml-2">
            <span className="w-2 h-2 rounded-full bg-orange-500"></span>
            {activeStats.paused} 已暂停
          </span>
          <span className="flex items-center gap-1 ml-2">
            <span className="w-2 h-2 rounded-full bg-yellow-500"></span>
            {activeStats.pending} 等待
          </span>
        </div>
      </div>

      <div className="flex items-center gap-4">
        {activeStats.failed > 0 && (
            <div className="flex items-center gap-1 text-red-500">
                <ExclamationTriangleIcon className="w-3.5 h-3.5" />
                <span>{activeStats.failed} 错误</span>
            </div>
        )}
        
        <div className="flex items-center gap-1.5" title="System Status">
            <CheckCircleIcon className="w-3.5 h-3.5 text-green-500" />
            <span>就绪</span>
        </div>
      </div>
    </div>
  );
};
