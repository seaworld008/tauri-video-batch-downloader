import React from 'react';
import { useDownloadStore } from '../../stores/downloadStore';
import { useSystemInfo } from '../../hooks/useSystemInfo';

export const StatusBar: React.FC = () => {
  const { stats } = useDownloadStore();
  const { systemInfo, isLoading } = useSystemInfo();

  return (
    <div className="h-8 bg-gray-100 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 px-4 flex items-center justify-between text-xs text-gray-600 dark:text-gray-400">
      {/* 左侧：下载状态 */}
      <div className="flex items-center space-x-6">
        <div className="flex items-center space-x-2">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
          <span>运行</span>
        </div>

        {stats.active_downloads > 0 && (
          <div className="flex items-center space-x-2">
            <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></div>
            <span>{stats.active_downloads} 个任务正在下载</span>
          </div>
        )}

        {stats.average_speed > 0 && (
          <div>平均速度: {formatSpeed(stats.average_speed)}</div>
        )}
      </div>

      {/* 右侧：系统信息 */}
      <div className="flex items-center space-x-6">
        {systemInfo ? (
          <>
            <div>CPU: {systemInfo.cpu_usage.toFixed(1)}%</div>
            <div>内存: {systemInfo.memory_usage.toFixed(1)}%</div>
            {systemInfo.network_speed.download > 0 && (
              <div>
                下载: ↓{formatSpeed(systemInfo.network_speed.download)} ↑{formatSpeed(systemInfo.network_speed.upload)}
              </div>
            )}
          </>
        ) : (
          <span className="text-gray-400">
            {isLoading ? '系统信息加载中...' : '系统信息不可用'}
          </span>
        )}

        <div>{new Date().toLocaleTimeString()}</div>
      </div>
    </div>
  );
};

function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond === 0) return '0 B/s';

  const k = 1024;
  const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  const i = Math.floor(Math.log(bytesPerSecond) / Math.log(k));

  return `${parseFloat((bytesPerSecond / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

