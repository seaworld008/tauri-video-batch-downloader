import React from 'react';
import type { TaskStatus } from '../../types';

export type ToolbarFilterStatus = TaskStatus | 'all';

interface ToolbarFilterStats {
  all: number;
  downloading: number;
  completed: number;
  failed: number;
  paused: number;
  pending: number;
}

interface ToolbarFiltersProps {
  filterStatus: ToolbarFilterStatus;
  stats: ToolbarFilterStats;
  onFilterChange: (status: ToolbarFilterStatus) => void;
}

export const ToolbarFilters: React.FC<ToolbarFiltersProps> = ({
  filterStatus,
  stats,
  onFilterChange,
}) => (
  <div
    className='flex items-center gap-1 overflow-x-auto pb-1 scrollbar-hide'
    data-testid='status-filter'
  >
    <FilterTab
      active={filterStatus === 'all'}
      onClick={() => onFilterChange('all')}
      label='全部任务'
      count={stats.all}
      value='all'
    />
    <FilterTab
      active={filterStatus === 'downloading'}
      onClick={() => onFilterChange('downloading')}
      label='下载中'
      count={stats.downloading}
      color='blue'
      value='downloading'
    />
    <FilterTab
      active={filterStatus === 'pending'}
      onClick={() => onFilterChange('pending')}
      label='等待中'
      count={stats.pending}
      color='yellow'
      value='pending'
    />
    <FilterTab
      active={filterStatus === 'paused'}
      onClick={() => onFilterChange('paused')}
      label='已暂停'
      count={stats.paused}
      color='orange'
      value='paused'
    />
    <FilterTab
      active={filterStatus === 'completed'}
      onClick={() => onFilterChange('completed')}
      label='已完成'
      count={stats.completed}
      color='green'
      value='completed'
    />
    <FilterTab
      active={filterStatus === 'failed'}
      onClick={() => onFilterChange('failed')}
      label='失败'
      count={stats.failed}
      color='red'
      value='failed'
    />
  </div>
);

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
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background
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
