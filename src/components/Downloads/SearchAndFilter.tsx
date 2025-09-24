import React, { useMemo, useState } from 'react';
import { useDownloadStore } from '../../stores/downloadStore';
import type { TaskStatus, VideoTask } from '../../types';

interface SearchAndFilterProps {
  searchQuery?: string;
  filterStatus?: TaskStatus | 'all';
  tasks?: VideoTask[];
  onSearchChange?: (query: string) => void;
  onFilterChange?: (status: TaskStatus | 'all') => void;
  onRefresh?: () => Promise<void> | void;
}

export const SearchAndFilter: React.FC<SearchAndFilterProps> = ({
  searchQuery: controlledSearchQuery,
  filterStatus: controlledFilterStatus,
  tasks: controlledTasks,
  onSearchChange,
  onFilterChange,
  onRefresh,
}) => {
  const store = useDownloadStore();
  const tasks = controlledTasks ?? store.tasks;
  const searchQuery = controlledSearchQuery ?? store.searchQuery;
  const filterStatus = controlledFilterStatus ?? store.filterStatus;
  const setSearchQuery = onSearchChange ?? store.setSearchQuery;
  const setFilterStatus = onFilterChange ?? store.setFilterStatus;
  const refreshTasks = onRefresh ?? store.refreshTasks;

  const [isExpanded, setIsExpanded] = useState(false);

  const statusCounts = useMemo(() => ({
    all: tasks.length,
    pending: tasks.filter(t => t.status === 'pending').length,
    downloading: tasks.filter(t => t.status === 'downloading').length,
    paused: tasks.filter(t => t.status === 'paused').length,
    completed: tasks.filter(t => t.status === 'completed').length,
    failed: tasks.filter(t => t.status === 'failed').length,
    cancelled: tasks.filter(t => t.status === 'cancelled').length,
  }), [tasks]);

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
  };

  const handleFilterChange = (status: TaskStatus | 'all') => {
    setFilterStatus(status);
  };

  const clearFilters = () => {
    setSearchQuery('');
    setFilterStatus('all');
  };

  const hasActiveFilters = searchQuery.trim() !== '' || filterStatus !== 'all';

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
      <div className="p-4">
        <div className="flex flex-col lg:flex-row lg:items-center gap-4">
          <div className="flex-1">
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <span className="text-gray-400 text-sm">🔍</span>
              </div>
              <input
                type="text"
                placeholder="搜索任务名称、URL 或输出路径..."
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="block w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
              {searchQuery && (
                <button
                  onClick={() => handleSearchChange('')}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                >
                  ✖️
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <StatusFilter
              status="all"
              label="全部"
              count={statusCounts.all}
              isActive={filterStatus === 'all'}
              onClick={() => handleFilterChange('all')}
            />
            <StatusFilter
              status="downloading"
              label="下载中"
              count={statusCounts.downloading}
              isActive={filterStatus === 'downloading'}
              onClick={() => handleFilterChange('downloading')}
              color="blue"
            />
            <StatusFilter
              status="completed"
              label="已完成"
              count={statusCounts.completed}
              isActive={filterStatus === 'completed'}
              onClick={() => handleFilterChange('completed')}
              color="green"
            />
            <StatusFilter
              status="failed"
              label="失败"
              count={statusCounts.failed}
              isActive={filterStatus === 'failed'}
              onClick={() => handleFilterChange('failed')}
              color="red"
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="px-3 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              {isExpanded ? '收起' : '更多'} {isExpanded ? '🔼' : '🔽'}
            </button>

            <button
              onClick={() => { void refreshTasks(); }}
              className="px-3 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              title="刷新任务列表"
            >
              🔄 刷新
            </button>

            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="px-3 py-2 text-sm font-medium text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 border border-red-300 dark:border-red-500 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
              >
                重置
              </button>
            )}
          </div>
        </div>

        {isExpanded && (
          <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
            <div className="flex flex-col lg:flex-row lg:items-center gap-4">
              <div className="flex flex-wrap gap-2">
                <StatusFilter
                  status="all"
                  label="全部"
                  count={statusCounts.all}
                  isActive={filterStatus === 'all'}
                  onClick={() => handleFilterChange('all')}
                />
                <StatusFilter
                  status="pending"
                  label="等待中"
                  count={statusCounts.pending}
                  isActive={filterStatus === 'pending'}
                  onClick={() => handleFilterChange('pending')}
                  color="yellow"
                />
                <StatusFilter
                  status="downloading"
                  label="下载中"
                  count={statusCounts.downloading}
                  isActive={filterStatus === 'downloading'}
                  onClick={() => handleFilterChange('downloading')}
                  color="blue"
                />
                <StatusFilter
                  status="paused"
                  label="已暂停"
                  count={statusCounts.paused}
                  isActive={filterStatus === 'paused'}
                  onClick={() => handleFilterChange('paused')}
                  color="orange"
                />
                <StatusFilter
                  status="completed"
                  label="已完成"
                  count={statusCounts.completed}
                  isActive={filterStatus === 'completed'}
                  onClick={() => handleFilterChange('completed')}
                  color="green"
                />
                <StatusFilter
                  status="failed"
                  label="失败"
                  count={statusCounts.failed}
                  isActive={filterStatus === 'failed'}
                  onClick={() => handleFilterChange('failed')}
                  color="red"
                />
                <StatusFilter
                  status="cancelled"
                  label="已取消"
                  count={statusCounts.cancelled}
                  isActive={filterStatus === 'cancelled'}
                  onClick={() => handleFilterChange('cancelled')}
                  color="gray"
                />
              </div>
            </div>

            {searchQuery && (
              <div className="text-sm text-gray-600 dark:text-gray-400 mt-4">
                正在搜索: <span className="font-medium">"{searchQuery}"</span>
                {tasks.filter(task => {
                  const query = searchQuery.toLowerCase();
                  return (
                    task.title.toLowerCase().includes(query) ||
                    task.url.toLowerCase().includes(query) ||
                    task.output_path.toLowerCase().includes(query)
                  );
                }).length} 个匹配结果
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

interface StatusFilterProps {
  status: TaskStatus | 'all';
  label: string;
  count: number;
  isActive: boolean;
  onClick: () => void;
  color?: 'gray' | 'blue' | 'green' | 'yellow' | 'orange' | 'red';
}

const StatusFilter: React.FC<StatusFilterProps> = ({
  label,
  count,
  isActive,
  onClick,
  color = 'gray'
}) => {
  const getColorClasses = () => {
    if (isActive) {
      switch (color) {
        case 'blue':
          return 'bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-200 border-blue-300 dark:border-blue-600';
        case 'green':
          return 'bg-green-100 dark:bg-green-900/50 text-green-800 dark:text-green-200 border-green-300 dark:border-green-600';
        case 'yellow':
          return 'bg-yellow-100 dark:bg-yellow-900/50 text-yellow-800 dark:text-yellow-200 border-yellow-300 dark:border-yellow-600';
        case 'orange':
          return 'bg-orange-100 dark:bg-orange-900/50 text-orange-800 dark:text-orange-200 border-orange-300 dark:border-orange-600';
        case 'red':
          return 'bg-red-100 dark:bg-red-900/50 text-red-800 dark:text-red-200 border-red-300 dark:border-red-600';
        default:
          return 'bg-primary-100 dark:bg-primary-900/50 text-primary-800 dark:text-primary-200 border-primary-300 dark:border-primary-600';
      }
    }

    return 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-400 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600 hover:text-gray-900 dark:hover:text-gray-100';
  };

  return (
    <button
      onClick={onClick}
      className={`
        inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors
        ${getColorClasses()}
      `}
    >
      <span>{label}</span>
      <span className="bg-current bg-opacity-20 text-current px-1.5 py-0.5 rounded-full text-xs font-bold">
        {count}
      </span>
    </button>
  );
};
