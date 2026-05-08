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
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDownloadStore } from '../../stores/downloadStore';
import type { VideoTask, TaskStatus } from '../../types';
import { TaskItem } from './TaskListItem';

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
  committing: 1,
  paused: 2,
  failed: 3,
  pending: 4,
  completed: 5,
  cancelled: 6,
};

/**
 * 虚拟化任务列表主组件 - 适配 UnifiedView
 */
export const VirtualizedTaskList: React.FC<VirtualizedTaskListProps> = ({
  overscan = 3,
  className = '',
}) => {
  // 从 Store 获取数据，替代 Props 传递，简化 UnifiedView
  const tasks = useDownloadStore(state => state.tasks);
  const filterStatus = useDownloadStore(state => state.filterStatus);
  const searchQuery = useDownloadStore(state => state.searchQuery);
  const selectedTasks = useDownloadStore(state => state.selectedTasks);
  const toggleTaskSelection = useDownloadStore(state => state.toggleTaskSelection);
  const sortBy = useDownloadStore(state => state.sortBy);
  const sortDirection = useDownloadStore(state => state.sortDirection);

  // 本地计算过滤列表 (如果 Store 没有直接提供)
  const filteredTasks = useMemo(() => {
    let result = tasks;

    // 状态过滤
    if (filterStatus !== 'all') {
      result = result.filter(t =>
        filterStatus === 'downloading'
          ? t.status === 'downloading' || t.status === 'committing'
          : t.status === filterStatus
      );
    }

    // 搜索过滤
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        t => t.title.toLowerCase().includes(query) || t.url.toLowerCase().includes(query)
      );
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
          height: itemHeight,
        });
      }
    }
    return items;
  }, [visibleRange, sortedTasks, itemHeight]);

  const totalHeight = sortedTasks.length * itemHeight;

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  const handleTaskSelect = useCallback(
    (taskId: string, selected: boolean) => {
      if (selected) {
        if (!selectedTasks.includes(taskId)) {
          toggleTaskSelection(taskId); // DownloadStore 里通常是 toggle
        }
      } else {
        if (selectedTasks.includes(taskId)) {
          toggleTaskSelection(taskId);
        }
      }
    },
    [selectedTasks, toggleTaskSelection]
  );

  return (
    <div className={`h-full w-full ${className}`} data-testid='task-list'>
      <div
        ref={containerRef}
        className='h-full w-full overflow-y-auto custom-scrollbar'
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
              onSelect={selected => handleTaskSelect(task.id, selected)}
            />
          ))}

          {sortedTasks.length === 0 && (
            <div className='absolute inset-0 flex items-center justify-center text-gray-400'>
              <p>没有符合条件的任务</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
