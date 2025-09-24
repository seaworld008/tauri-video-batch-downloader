import React from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useDownloadStore } from '../../stores/downloadStore';
import { TaskItem } from './TaskItem';
import type { VideoTask } from '../../types';

interface TaskListProps {
  tasks: VideoTask[];
}

export const TaskList: React.FC<TaskListProps> = ({ tasks }) => {
  const { sortBy, sortDirection, setSortBy } = useDownloadStore();
  const parentRef = React.useRef<HTMLDivElement>(null);

  // 排序任务
  const sortedTasks = React.useMemo(() => {
    return [...tasks].sort((a, b) => {
      let aValue: any = a[sortBy];
      let bValue: any = b[sortBy];

      // 处理日期字段
      if (sortBy === 'created_at' || sortBy === 'updated_at') {
        aValue = new Date(aValue).getTime();
        bValue = new Date(bValue).getTime();
      }

      // 处理字符串字段
      if (typeof aValue === 'string' && typeof bValue === 'string') {
        aValue = aValue.toLowerCase();
        bValue = bValue.toLowerCase();
      }

      if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [tasks, sortBy, sortDirection]);

  // 虚拟化配置 - 用于处理大量任务
  const rowVirtualizer = useVirtualizer({
    count: sortedTasks.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 120, // 估计每个任务项的高度
    overscan: 5, // 预渲染5个项目
  });

  const handleSort = (field: keyof VideoTask) => {
    setSortBy(field);
  };

  const SortableHeader: React.FC<{ 
    field: keyof VideoTask; 
    children: React.ReactNode;
    className?: string;
  }> = ({ field, children, className = '' }) => (
    <button
      onClick={() => handleSort(field)}
      className={`flex items-center space-x-1 font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 ${className}`}
    >
      <span>{children}</span>
      {sortBy === field && (
        <span className="text-primary-500">
          {sortDirection === 'asc' ? '↑' : '↓'}
        </span>
      )}
    </button>
  );

  return (
    <div 
      className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden"
      role="region"
      aria-label="下载任务列表"
    >
      {/* 表头 */}
      <div className="bg-gray-50 dark:bg-gray-900/50 px-6 py-4 border-b border-gray-200 dark:border-gray-700">
        <div className="grid grid-cols-12 gap-4 items-center">
          <div className="col-span-1">
            <input
              type="checkbox"
              className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
              onChange={(e) => {
                if (e.target.checked) {
                  useDownloadStore.getState().selectAllTasks();
                } else {
                  useDownloadStore.getState().clearSelection();
                }
              }}
            />
          </div>
          
          <div className="col-span-4">
            <SortableHeader field="title">任务名称</SortableHeader>
          </div>
          
          <div className="col-span-2">
            <SortableHeader field="status">状态</SortableHeader>
          </div>
          
          <div className="col-span-2">
            <SortableHeader field="progress">进度</SortableHeader>
          </div>
          
          <div className="col-span-2">
            <SortableHeader field="updated_at">更新时间</SortableHeader>
          </div>
          
          <div className="col-span-1">
            <span className="font-medium text-gray-700 dark:text-gray-300">操作</span>
          </div>
        </div>
      </div>

      {/* 虚拟化列表容器 */}
      <div
        ref={parentRef}
        className="overflow-auto"
        style={{ height: '600px' }} // 固定高度以支持虚拟化
      >
        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualItem) => (
            <div
              key={virtualItem.key}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: `${virtualItem.size}px`,
                transform: `translateY(${virtualItem.start}px)`,
              }}
            >
              <TaskItem 
                task={sortedTasks[virtualItem.index]}
                isVirtualized
              />
            </div>
          ))}
        </div>
      </div>

      {/* 底部信息 */}
      <div className="bg-gray-50 dark:bg-gray-900/50 px-6 py-3 border-t border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between text-sm text-gray-500 dark:text-gray-400">
          <span>共 {sortedTasks.length} 个任务</span>
          <div className="flex items-center space-x-4">
            <span>已完成: {sortedTasks.filter(t => t.status === 'completed').length}</span>
            <span>进行中: {sortedTasks.filter(t => t.status === 'downloading').length}</span>
            <span>失败: {sortedTasks.filter(t => t.status === 'failed').length}</span>
          </div>
        </div>
      </div>
    </div>
  );
};