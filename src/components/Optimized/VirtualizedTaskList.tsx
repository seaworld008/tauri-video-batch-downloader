/**
 * 🚀 虚拟化任务列表组件
 * 高性能处理大量下载任务的显示
 * 
 * 优化特性：
 * - 虚拟滚动：只渲染可见项目
 * - 内存高效：动态回收组件
 * - 平滑滚动：优化的滚动体验
 * - 智能缓冲：预渲染缓冲区项目
 */
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useDownloadStore } from '../../stores/downloadStore';
import type { VideoTask, TaskStatus } from '../../types';

interface VirtualizedTaskListProps {
  overscan?: number; // 缓冲区项目数量
  className?: string;
}

interface VirtualItem {
  index: number;
  task: VideoTask;
  top: number;
  height: number;
}

const STATUS_PRIORITY: Record<TaskStatus, number> = {
  downloading: 0,
  paused: 1,
  failed: 2,
  pending: 3,
  completed: 4,
  cancelled: 5,
};

// 工具函数
function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond === 0) return '0 B/s';
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  const i = Math.floor(Math.log(bytesPerSecond) / Math.log(1024));
  const size = bytesPerSecond / Math.pow(1024, i);
  return `${size.toFixed(1)} ${units[i]}`;
}

function formatTime(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h`;
}

/**
 * 轻量级任务项组件 - 使用React.memo优化
 */
const TaskItem = React.memo<{
  task: VideoTask;
  style: React.CSSProperties;
  isSelected: boolean;
  onSelect: (selected: boolean) => void;
  index: number;
}>(({ task, style, isSelected, onSelect, index }) => {

  const handleSelectChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onSelect(e.target.checked);
  };

  const statusColor = useMemo(() => {
    switch (task.status) {
      case 'completed': return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400';
      case 'downloading': return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400';
      case 'failed': return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400';
      case 'paused': return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400';
      default: return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300';
    }
  }, [task.status]);

  const progressPercentage = Math.round(task.progress);

  return (
    <div
      style={style}
      className={`absolute flex items-center px-4 py-3 border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors duration-150 ${isSelected ? 'bg-blue-50 dark:bg-blue-900/10' : ''
        }`}
    >
      <div className="flex items-center h-full mr-4" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={isSelected}
          onChange={handleSelectChange}
          className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
        />
      </div>

      <div className="flex-1 min-w-0 pr-4">
        <div className="flex items-center justify-between mb-1.5">
          <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate pr-4" title={task.title}>
            <span className="text-gray-400 dark:text-gray-500 mr-2 font-normal text-xs">#{index + 1}</span>
            {task.title}
          </h4>
          <span className={`px-2 py-0.5 text-xs font-medium rounded-full whitespace-nowrap ${statusColor}`}>
            {task.status === 'pending' ? '等待中' :
              task.status === 'downloading' ? '下载中' :
                task.status === 'completed' ? '已完成' :
                  task.status === 'failed' ? '失败' :
                    task.status === 'paused' ? '暂停' : task.status}
          </span>
        </div>

        <div className="flex items-center space-x-4 text-xs text-gray-500 dark:text-gray-400">
          {task.status === 'downloading' && (
            <>
              <span className="w-16">{progressPercentage}%</span>
              <span className="w-20">{formatSpeed(task.speed)}</span>
              <span>剩余: {task.eta ? formatTime(task.eta) : '--'}</span>
            </>
          )}
          {task.status !== 'downloading' && (
            <span className="truncate text-gray-400">{task.output_path}</span>
          )}
        </div>

        {/* 进度条 */}
        <div className="w-full bg-gray-100 dark:bg-gray-700 rounded-full h-1 mt-2 overflow-hidden">
          <div
            className={`h-full transition-all duration-300 ${task.status === 'failed' ? 'bg-red-500' :
              task.status === 'completed' ? 'bg-green-500' :
                'bg-blue-600'
              }`}
            style={{ width: `${progressPercentage}%` }}
          />
        </div>
      </div>
    </div>
  );
});

TaskItem.displayName = 'TaskItem';

/**
 * 虚拟化任务列表主组件 - 适配 UnifiedView
 */
export const VirtualizedTaskList: React.FC<VirtualizedTaskListProps> = ({
  overscan = 3,
  className = ''
}) => {
  // 从 Store 获取数据，替代 Props 传递，简化 UnifiedView
  const {
    tasks,
    filterStatus,
    searchQuery,
    selectedTasks,
    toggleTaskSelection,
    sortBy,
    sortDirection
  } = useDownloadStore();

  // 本地计算过滤列表 (如果 Store 没有直接提供)
  const filteredTasks = useMemo(() => {
    let result = tasks;

    // 状态过滤
    if (filterStatus !== 'all') {
      result = result.filter(t => t.status === filterStatus);
    }

    // 搜索过滤
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(t => t.title.toLowerCase().includes(query) || t.url.toLowerCase().includes(query));
    }

    return result;
  }, [tasks, filterStatus, searchQuery]);

  const sortedTasks = useMemo(() => {
    const result = [...filteredTasks];

    return result.sort((a, b) => {
      const priorityDiff =
        (STATUS_PRIORITY[a.status] ?? Number.MAX_SAFE_INTEGER) -
        (STATUS_PRIORITY[b.status] ?? Number.MAX_SAFE_INTEGER);
      if (priorityDiff !== 0) {
        return priorityDiff;
      }

      let aValue: any = (a as any)[sortBy];
      let bValue: any = (b as any)[sortBy];

      if (sortBy === 'created_at' || sortBy === 'updated_at') {
        aValue = new Date(aValue).getTime();
        bValue = new Date(bValue).getTime();
      }

      if (typeof aValue === 'string' && typeof bValue === 'string') {
        aValue = aValue.toLowerCase();
        bValue = bValue.toLowerCase();
      }

      if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filteredTasks, sortBy, sortDirection]);

  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(600); // 默认高度

  const itemHeight = 88; // 固定高度，根据 CSS 调整

  // 监听容器大小变化
  useEffect(() => {
    if (!containerRef.current) return;

    const resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        setContainerHeight(entry.contentRect.height);
      }
    });

    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  // Auto-scroll to top when new tasks are added
  const prevTaskCountRef = useRef(tasks.length);

  useEffect(() => {
    if (tasks.length > prevTaskCountRef.current) {
      if (containerRef.current) {
        containerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }
    prevTaskCountRef.current = tasks.length;
  }, [tasks.length]);

  // 计算可见项目范围
  const visibleRange = useMemo(() => {
    const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
    const endIndex = Math.min(
      sortedTasks.length - 1,
      Math.ceil((scrollTop + containerHeight) / itemHeight) + overscan
    );

    return { startIndex, endIndex };
  }, [scrollTop, itemHeight, containerHeight, overscan, sortedTasks.length]);

  // 生成虚拟项目列表
  const virtualItems = useMemo<VirtualItem[]>(() => {
    const items: VirtualItem[] = [];
    for (let i = visibleRange.startIndex; i <= visibleRange.endIndex; i++) {
      if (i < sortedTasks.length) {
        items.push({
          index: i,
          task: sortedTasks[i],
          top: i * itemHeight,
          height: itemHeight
        });
      }
    }
    return items;
  }, [visibleRange, sortedTasks, itemHeight]);

  const totalHeight = sortedTasks.length * itemHeight;

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  const handleTaskSelect = useCallback((taskId: string, selected: boolean) => {
    if (selected) {
      if (!selectedTasks.includes(taskId)) {
        toggleTaskSelection(taskId); // DownloadStore 里通常是 toggle
      }
    } else {
      if (selectedTasks.includes(taskId)) {
        toggleTaskSelection(taskId);
      }
    }
  }, [selectedTasks, toggleTaskSelection]);

  return (
    <div className={`h-full w-full ${className}`}>
      <div
        ref={containerRef}
        className="h-full w-full overflow-y-auto custom-scrollbar"
        onScroll={handleScroll}
      >
        <div style={{ height: totalHeight, position: 'relative' }}>
          {virtualItems.map(({ task, top, height, index }) => (
            <TaskItem
              key={task.id}
              index={index} // 实际列表索引
              task={task}
              style={{
                top,
                height,
                left: 0,
                right: 0,
              }}
              isSelected={selectedTasks.includes(task.id)}
              onSelect={(selected) => handleTaskSelect(task.id, selected)}
            />
          ))}

          {sortedTasks.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center text-gray-400">
              <p>没有符合条件的任务</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
