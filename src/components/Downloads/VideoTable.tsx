import React from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useDownloadStore } from '../../stores/downloadStore';
import { VideoTableItem } from './VideoTableItem';
import type { VideoTask } from '../../types';

interface VideoTableProps {
  tasks: VideoTask[];
  selectedTasks?: string[];
  isLoading?: boolean;
}

export const VideoTable: React.FC<VideoTableProps> = ({ tasks }) => {
  const { sortBy, sortDirection, setSortBy } = useDownloadStore();
  const parentRef = React.useRef<HTMLDivElement>(null);

  // 排序任务
  const sortedTasks = React.useMemo(() => {
    return [...tasks].sort((a, b) => {
      let aValue: any;
      let bValue: any;

      // 处理video_info中的字段
      if (sortBy === 'zl_name' || sortBy === 'kc_name' || sortBy === 'zl_id' || sortBy === 'kc_id') {
        aValue = a.video_info?.[sortBy] || '';
        bValue = b.video_info?.[sortBy] || '';
      } else {
        aValue = a[sortBy as keyof VideoTask];
        bValue = b[sortBy as keyof VideoTask];
      }

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

  // 虚拟化配置 - 用于处理大量视频任务
  const rowVirtualizer = useVirtualizer({
    count: sortedTasks.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 80, // 减少行高以适应表格样式
    overscan: 10, // 预渲染更多项目以优化滚动体验
  });

  const handleSort = (field: keyof VideoTask | 'zl_name' | 'kc_name' | 'zl_id' | 'kc_id') => {
    setSortBy(field as keyof VideoTask);
  };

  const SortableHeader: React.FC<{ 
    field: keyof VideoTask | 'zl_name' | 'kc_name' | 'zl_id' | 'kc_id';
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
      aria-label="视频下载表格"
    >
      {/* 表头 - 6列视频表格布局 */}
      <div className="bg-gray-50 dark:bg-gray-900/50 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <div className="grid grid-cols-12 gap-2 items-center text-sm">
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
          
          <div className="col-span-2">
            <SortableHeader field="zl_name">专栏名称</SortableHeader>
          </div>
          
          <div className="col-span-2">
            <SortableHeader field="kc_name">课程名称</SortableHeader>
          </div>
          
          <div className="col-span-1">
            <SortableHeader field="zl_id">专栏ID</SortableHeader>
          </div>
          
          <div className="col-span-1">
            <SortableHeader field="kc_id">课程ID</SortableHeader>
          </div>
          
          <div className="col-span-3">
            <SortableHeader field="url">视频链接</SortableHeader>
          </div>
          
          <div className="col-span-2">
            <SortableHeader field="progress">下载进度</SortableHeader>
          </div>
        </div>
      </div>

      {/* 虚拟化表格内容 */}
      <div
        ref={parentRef}
        className="overflow-auto"
        style={{ height: '500px' }} // 适当的固定高度
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
              <VideoTableItem 
                task={sortedTasks[virtualItem.index]}
                isVirtualized
              />
            </div>
          ))}
        </div>
      </div>

      {/* 底部统计信息 */}
      <div className="bg-gray-50 dark:bg-gray-900/50 px-4 py-3 border-t border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between text-sm text-gray-500 dark:text-gray-400">
          <span>共 {sortedTasks.length} 个视频</span>
          <div className="flex items-center space-x-4">
            <span>等待中: {sortedTasks.filter(t => t.status === 'pending').length}</span>
            <span>下载中: {sortedTasks.filter(t => t.status === 'downloading').length}</span>
            <span>已完成: {sortedTasks.filter(t => t.status === 'completed').length}</span>
            <span>失败: {sortedTasks.filter(t => t.status === 'failed').length}</span>
          </div>
        </div>
      </div>
    </div>
  );
};