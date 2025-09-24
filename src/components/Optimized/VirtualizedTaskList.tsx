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
import { VideoTask } from '../../schemas';
import { perfMonitor, usePerformanceTracker } from '../../utils/performanceMonitor';

interface VirtualizedTaskListProps {
  tasks: VideoTask[];
  itemHeight: number;
  containerHeight: number;
  overscan?: number; // 缓冲区项目数量
  onTaskClick?: (task: VideoTask) => void;
  onTaskSelect?: (taskId: string, selected: boolean) => void;
  selectedTasks?: string[];
  className?: string;
}

interface VirtualItem {
  index: number;
  task: VideoTask;
  top: number;
  height: number;
}

/**
 * 轻量级任务项组件 - 使用React.memo优化
 */
const TaskItem = React.memo<{
  task: VideoTask;
  style: React.CSSProperties;
  isSelected: boolean;
  onClick: () => void;
  onSelect: (selected: boolean) => void;
}>(({ task, style, isSelected, onClick, onSelect }) => {
  const { trackCallback } = usePerformanceTracker('TaskItem');
  
  const handleClick = trackCallback('click', onClick);
  const handleSelectChange = trackCallback('select', (e: React.ChangeEvent<HTMLInputElement>) => {
    onSelect(e.target.checked);
  });
  
  const statusColor = useMemo(() => {
    switch (task.status) {
      case 'completed': return 'bg-green-100 text-green-800';
      case 'downloading': return 'bg-blue-100 text-blue-800';
      case 'failed': return 'bg-red-100 text-red-800';
      case 'paused': return 'bg-yellow-100 text-yellow-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  }, [task.status]);
  
  const progressPercentage = Math.round(task.progress);
  
  return (
    <div
      style={style}
      className={`absolute flex items-center p-3 border-b border-gray-200 hover:bg-gray-50 cursor-pointer transition-colors duration-150 ${
        isSelected ? 'bg-blue-50 border-blue-200' : ''
      }`}
      onClick={handleClick}
    >
      <input
        type="checkbox"
        checked={isSelected}
        onChange={handleSelectChange}
        onClick={(e) => e.stopPropagation()}
        className="mr-3 rounded"
      />
      
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <h4 className="text-sm font-medium text-gray-900 truncate" title={task.title}>
            {task.title}
          </h4>
          <span className={`px-2 py-1 text-xs font-medium rounded-full ${statusColor}`}>
            {task.status}
          </span>
        </div>
        
        <div className="flex items-center space-x-4 text-sm text-gray-600">
          <span>{progressPercentage}%</span>
          {task.speed > 0 && (
            <span>{formatSpeed(task.speed)}</span>
          )}
          {task.eta && (
            <span>ETA: {formatTime(task.eta)}</span>
          )}
        </div>
        
        {/* 进度条 */}
        <div className="w-full bg-gray-200 rounded-full h-1.5 mt-2">
          <div
            className="bg-blue-600 h-1.5 rounded-full transition-all duration-300"
            style={{ width: `${progressPercentage}%` }}
          />
        </div>
      </div>
    </div>
  );
});

TaskItem.displayName = 'TaskItem';

/**
 * 虚拟化任务列表主组件
 */
export const VirtualizedTaskList: React.FC<VirtualizedTaskListProps> = ({
  tasks,
  itemHeight,
  containerHeight,
  overscan = 5,
  onTaskClick,
  onTaskSelect,
  selectedTasks = [],
  className = ''
}) => {
  const { trackEffect, trackCallback } = usePerformanceTracker('VirtualizedTaskList');
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [isScrolling, setIsScrolling] = useState(false);
  const scrollTimeoutRef = useRef<NodeJS.Timeout>();
  
  // 计算可见项目范围
  const visibleRange = useMemo(() => {
    const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
    const endIndex = Math.min(
      tasks.length - 1,
      Math.ceil((scrollTop + containerHeight) / itemHeight) + overscan
    );
    
    return { startIndex, endIndex };
  }, [scrollTop, itemHeight, containerHeight, overscan, tasks.length]);
  
  // 生成虚拟项目列表
  const virtualItems = useMemo<VirtualItem[]>(() => {
    const items: VirtualItem[] = [];
    
    for (let i = visibleRange.startIndex; i <= visibleRange.endIndex; i++) {
      if (i < tasks.length) {
        items.push({
          index: i,
          task: tasks[i],
          top: i * itemHeight,
          height: itemHeight
        });
      }
    }
    
    return items;
  }, [visibleRange, tasks, itemHeight]);
  
  // 总高度
  const totalHeight = tasks.length * itemHeight;
  
  // 滚动处理
  const handleScroll = trackCallback('scroll', useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const newScrollTop = e.currentTarget.scrollTop;
    setScrollTop(newScrollTop);
    setIsScrolling(true);
    
    // 防抖处理停止滚动
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }
    scrollTimeoutRef.current = setTimeout(() => {
      setIsScrolling(false);
    }, 150);
  }, []));
  
  // 任务点击处理
  const handleTaskClick = trackCallback('taskClick', useCallback((task: VideoTask) => {
    onTaskClick?.(task);
  }, [onTaskClick]));
  
  // 任务选择处理
  const handleTaskSelect = trackCallback('taskSelect', useCallback((taskId: string, selected: boolean) => {
    onTaskSelect?.(taskId, selected);
  }, [onTaskSelect]));
  
  // 性能监控：记录滚动性能
  useEffect(() => {
    trackEffect('scrollUpdate', async () => {
      perfMonitor.recordDataProcessing('VirtualList.scroll', virtualItems.length, performance.now());
    });
  }, [virtualItems.length, trackEffect]);
  
  // 清理定时器
  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, []);
  
  // 滚动到特定任务
  const scrollToTask = useCallback((taskId: string) => {
    const taskIndex = tasks.findIndex(task => task.id === taskId);
    if (taskIndex !== -1 && containerRef.current) {
      const scrollTop = taskIndex * itemHeight;
      containerRef.current.scrollTop = scrollTop;
    }
  }, [tasks, itemHeight]);
  
  
  return (
    <div className={`relative ${className}`}>
      <div
        ref={containerRef}
        className="overflow-auto"
        style={{ height: containerHeight }}
        onScroll={handleScroll}
      >
        {/* 占位容器 - 维持总高度 */}
        <div style={{ height: totalHeight, position: 'relative' }}>
          {/* 虚拟项目渲染 */}
          {virtualItems.map(({ task, top, height, index }) => (
            <TaskItem
              key={task.id}
              task={task}
              style={{
                top,
                height,
                left: 0,
                right: 0,
              }}
              isSelected={selectedTasks.includes(task.id)}
              onClick={() => handleTaskClick(task)}
              onSelect={(selected) => handleTaskSelect(task.id, selected)}
            />
          ))}
          
          {/* 滚动指示器 */}
          {isScrolling && (
            <div className="fixed top-4 right-4 bg-black bg-opacity-75 text-white px-2 py-1 rounded text-sm z-50">
              {Math.round((scrollTop / (totalHeight - containerHeight)) * 100)}%
            </div>
          )}
        </div>
      </div>
      
      {/* 性能统计显示（开发模式） */}
      {process.env.NODE_ENV === 'development' && (
        <div className="absolute top-2 left-2 text-xs text-gray-500 bg-white bg-opacity-75 px-2 py-1 rounded">
          渲染: {virtualItems.length}/{tasks.length}
        </div>
      )}
    </div>
  );
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

export default VirtualizedTaskList;