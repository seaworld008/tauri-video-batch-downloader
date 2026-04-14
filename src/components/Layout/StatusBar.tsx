import React from 'react';
import { useDownloadStore } from '../../stores/downloadStore';
import { useSystemInfo } from '../../hooks/useSystemInfo';
import { formatSpeed } from '../../utils/format';

export const StatusBar: React.FC = () => {
  const stats = useDownloadStore(state => state.stats);
  const tasks = useDownloadStore(state => state.tasks);
  const { systemInfo, isLoading } = useSystemInfo();

  const pausedCount = tasks.filter(t => t.status === 'paused').length;
  const downloadingCount = tasks.filter(t => t.status === 'downloading').length;
  const committingCount = tasks.filter(t => t.status === 'committing').length;

  return (
    <div className='h-8 bg-gray-100 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 px-4 flex items-center justify-between text-xs text-gray-600 dark:text-gray-400'>
      {/* 左侧：下载状态 */}
      <div className='flex items-center space-x-6'>
        <div className='flex items-center space-x-2'>
          <div className='w-2 h-2 rounded-full bg-green-500 animate-pulse'></div>
          <span>运行</span>
        </div>

        {stats.active_downloads > 0 && (
          <div className='flex items-center space-x-2'>
            <div className='w-2 h-2 rounded-full bg-blue-500 animate-pulse'></div>
            <span>{stats.active_downloads} 个任务活跃中</span>
          </div>
        )}

        {downloadingCount > 0 && <div>传输中: {downloadingCount}</div>}

        {committingCount > 0 && <div>提交中: {committingCount}</div>}

        {pausedCount > 0 && (
          <div className='flex items-center space-x-2'>
            <div className='w-2 h-2 rounded-full bg-orange-500'></div>
            <span>{pausedCount} 个任务已暂停</span>
          </div>
        )}

        {stats.display_total_speed_bps && stats.display_total_speed_bps > 0 && (
          <div>总速度: {formatSpeed(stats.display_total_speed_bps)}</div>
        )}

        {(stats.average_commit_duration ?? 0) > 0 && (
          <div>提交均值: {stats.average_commit_duration?.toFixed(1)}s</div>
        )}

        {(stats.p95_commit_duration ?? 0) > 0 && (
          <div>提交 P95: {stats.p95_commit_duration?.toFixed(1)}s</div>
        )}
      </div>

      {/* 右侧：系统信息 */}
      <div className='flex items-center space-x-6'>
        {systemInfo ? (
          <>
            <div>CPU: {systemInfo.cpu_usage.toFixed(1)}%</div>
            <div>内存: {systemInfo.memory_usage.toFixed(1)}%</div>
            {systemInfo.network_speed.download > 0 && (
              <div>
                下载: ↓{formatSpeed(systemInfo.network_speed.download)} ↑
                {formatSpeed(systemInfo.network_speed.upload)}
              </div>
            )}
          </>
        ) : (
          <span className='text-gray-400'>
            {isLoading ? '系统信息加载中...' : '系统信息不可用'}
          </span>
        )}

        <div>{new Date().toLocaleTimeString()}</div>
      </div>
    </div>
  );
};
