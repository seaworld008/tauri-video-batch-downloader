import React from 'react';
import { formatBytes, formatSpeed, formatNumber } from '../../utils/format';
import type { DownloadStats as IDownloadStats } from '../../types';

interface DownloadStatsProps {
  stats: IDownloadStats;
}

export const DownloadStats: React.FC<DownloadStatsProps> = ({ stats }) => {
  const completionRate = stats.total_tasks > 0 
    ? (stats.completed_tasks / stats.total_tasks) * 100 
    : 0;

  return (
    <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
      {/* 总任务数 */}
      <StatCard
        title="总任务数"
        value={formatNumber(stats.total_tasks)}
        icon="📋"
        color="blue"
        description="所有下载任务"
      />

      {/* 已完成 */}
      <StatCard
        title="已完成"
        value={formatNumber(stats.completed_tasks)}
        icon="✅"
        color="green"
        description={`完成率 ${completionRate.toFixed(1)}%`}
        progress={completionRate}
      />

      {/* 失败任务 */}
      <StatCard
        title="失败任务"
        value={formatNumber(stats.failed_tasks)}
        icon="❌"
        color="red"
        description="需要重试或检查"
      />

      {/* 活跃下载 */}
      <StatCard
        title="活跃下载"
        value={formatNumber(stats.active_downloads)}
        icon="⬇️"
        color="orange"
        description="正在下载中"
        isAnimated={stats.active_downloads > 0}
      />

      {/* 平均速度 */}
      <StatCard
        title="平均速度"
        value={formatSpeed(stats.average_speed)}
        icon="🚀"
        color="purple"
        description="当前下载速度"
      />

      {/* 总下载量 */}
      <StatCard
        title="总下载量"
        value={formatBytes(stats.total_downloaded)}
        icon="💾"
        color="indigo"
        description="累计下载大小"
      />
    </div>
  );
};

// 统计卡片组件
interface StatCardProps {
  title: string;
  value: string;
  icon: string;
  color: 'blue' | 'green' | 'red' | 'orange' | 'purple' | 'indigo';
  description?: string;
  progress?: number;
  isAnimated?: boolean;
}

const StatCard: React.FC<StatCardProps> = ({
  title,
  value,
  icon,
  color,
  description,
  progress,
  isAnimated = false
}) => {
  const getColorClasses = () => {
    switch (color) {
      case 'blue':
        return {
          bg: 'bg-blue-50 dark:bg-blue-900/20',
          border: 'border-blue-200 dark:border-blue-800',
          text: 'text-blue-600 dark:text-blue-400',
          icon: 'text-blue-500'
        };
      case 'green':
        return {
          bg: 'bg-green-50 dark:bg-green-900/20',
          border: 'border-green-200 dark:border-green-800',
          text: 'text-green-600 dark:text-green-400',
          icon: 'text-green-500'
        };
      case 'red':
        return {
          bg: 'bg-red-50 dark:bg-red-900/20',
          border: 'border-red-200 dark:border-red-800',
          text: 'text-red-600 dark:text-red-400',
          icon: 'text-red-500'
        };
      case 'orange':
        return {
          bg: 'bg-orange-50 dark:bg-orange-900/20',
          border: 'border-orange-200 dark:border-orange-800',
          text: 'text-orange-600 dark:text-orange-400',
          icon: 'text-orange-500'
        };
      case 'purple':
        return {
          bg: 'bg-purple-50 dark:bg-purple-900/20',
          border: 'border-purple-200 dark:border-purple-800',
          text: 'text-purple-600 dark:text-purple-400',
          icon: 'text-purple-500'
        };
      case 'indigo':
        return {
          bg: 'bg-indigo-50 dark:bg-indigo-900/20',
          border: 'border-indigo-200 dark:border-indigo-800',
          text: 'text-indigo-600 dark:text-indigo-400',
          icon: 'text-indigo-500'
        };
      default:
        return {
          bg: 'bg-gray-50 dark:bg-gray-900/20',
          border: 'border-gray-200 dark:border-gray-800',
          text: 'text-gray-600 dark:text-gray-400',
          icon: 'text-gray-500'
        };
    }
  };

  const colorClasses = getColorClasses();

  return (
    <div 
      className={`
        ${colorClasses.bg} ${colorClasses.border} 
        border rounded-lg p-4 transition-all duration-300 hover:shadow-md
        ${isAnimated ? 'animate-pulse' : ''}
      `}
    >
      <div className="flex items-center justify-between mb-3">
        <div className={`p-2 rounded-lg bg-white dark:bg-gray-800 ${colorClasses.icon}`}>
          <span className="text-lg">{icon}</span>
        </div>
        
        {/* 可选的进度条 */}
        {progress !== undefined && (
          <div className="w-16 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div 
              className={`h-full bg-current transition-all duration-500 ${colorClasses.text}`}
              style={{ width: `${Math.min(progress, 100)}%` }}
            />
          </div>
        )}
      </div>

      <div>
        <h3 className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">
          {title}
        </h3>
        
        <div className={`text-xl font-bold ${colorClasses.text} mb-1`}>
          {value}
        </div>
        
        {description && (
          <p className="text-xs text-gray-500 dark:text-gray-500">
            {description}
          </p>
        )}
      </div>
    </div>
  );
};