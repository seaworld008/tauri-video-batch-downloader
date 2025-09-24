import React from 'react';
import toast from 'react-hot-toast';
import { useDownloadStore } from '../../stores/downloadStore';

interface TaskControlsProps {
  selectedTasks: string[];
  onStartAll?: () => Promise<void> | void;
  onPauseAll?: () => Promise<void> | void;
  onDeleteSelected?: (taskIds: string[]) => Promise<void> | void;
  onRetryFailed?: () => Promise<void> | void;
  onClearCompleted?: () => Promise<void> | void;
  disabled?: boolean;
}

export const TaskControls: React.FC<TaskControlsProps> = ({
  selectedTasks,
  onStartAll,
  onPauseAll,
  onDeleteSelected,
  onRetryFailed,
  onClearCompleted,
  disabled = false
}) => {
  const {
    tasks,
    startAllDownloads: storeStartAll,
    pauseAllDownloads: storePauseAll,
    retryFailedTasks: storeRetryFailed,
    clearCompletedTasks: storeClearCompleted,
    removeTasks: storeRemoveTasks,
    clearSelection
  } = useDownloadStore();

  const startAll = onStartAll ?? storeStartAll;
  const pauseAll = onPauseAll ?? storePauseAll;
  const retryFailed = onRetryFailed ?? storeRetryFailed;
  const clearCompleted = onClearCompleted ?? storeClearCompleted;
  const deleteSelected = onDeleteSelected
    ? () => onDeleteSelected(selectedTasks)
    : () => storeRemoveTasks(selectedTasks);


  const selectedTaskObjects = tasks.filter(task => selectedTasks.includes(task.id));
  const hasSelection = selectedTasks.length > 0;
  const isGloballyDisabled = disabled;
  
  // 统计不同状态的任务数量
  const downloadingCount = tasks.filter(t => t.status === 'downloading').length;
  const pendingCount = tasks.filter(t => t.status === 'pending' || t.status === 'paused').length;
  const failedCount = tasks.filter(t => t.status === 'failed').length;
  const completedCount = tasks.filter(t => t.status === 'completed').length;

  const handleBatchStart = async () => {
    try {
      if (hasSelection) {
        const startableTasks = selectedTaskObjects.filter(
          task => task.status === 'pending' || task.status === 'paused' || task.status === 'failed'
        );

        if (startableTasks.length === 0) {
          toast('选中的任务中没有可启动的任务');
          return;
        }

        await Promise.all(
          startableTasks.map(task => useDownloadStore.getState().startDownload(task.id))
        );
        toast.success(`已启动 ${startableTasks.length} 个选中的下载任务`);
      } else {
        await startAll();
      }
    } catch (error) {
      console.error('批量启动下载失败:', error);
      toast.error(`批量启动下载失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleBatchPause = async () => {
    if (hasSelection) {
      // 暂停选中的下载中任务
      const pausableTasks = selectedTaskObjects.filter(task => task.status === 'downloading');
      
      await Promise.all(
        pausableTasks.map(task => useDownloadStore.getState().pauseDownload(task.id))
      );
    } else {
      // 暂停所有下载中任务
      await pauseAll();
    }
  };

  const handleBatchRemove = async () => {
    if (hasSelection) {
      const confirmMessage = `确定要删除选中的 ${selectedTasks.length} 个任务吗？正在下载的任务将被取消。`;
      if (window.confirm(confirmMessage)) {
        await deleteSelected();
        clearSelection();
      }
    }
  };

  const handleRetryFailed = async () => {
    await retryFailed();
  };

  const handleClearCompleted = async () => {
    const confirmMessage = `确定要清除所有已完成的任务吗？这将删除 ${completedCount} 个已完成的任务记录。`;
    if (window.confirm(confirmMessage)) {
      await clearCompleted();
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 p-4 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
      {/* 左侧：主要控制按钮 */}
      <div className="flex items-center gap-2">
        {/* 开始/继续按钮 - 增强视觉突出效果 */}
        <ControlButton
          icon="▶️"
          text={hasSelection ? `开始选中任务 (${selectedTasks.length})` : "开始所有任务"}
          onClick={handleBatchStart}
          disabled={isGloballyDisabled || (hasSelection ? 
            selectedTaskObjects.every(t => t.status === 'downloading' || t.status === 'completed') :
            pendingCount === 0
          )}
          variant="primary"
          enhanced={true}
        />

        {/* 暂停按钮 */}
        <ControlButton
          icon="⏸️"
          text={hasSelection ? "暂停选中任务" : "暂停所有任务"}
          onClick={handleBatchPause}
          disabled={isGloballyDisabled || (hasSelection ?
            selectedTaskObjects.every(t => t.status !== 'downloading') :
            downloadingCount === 0
          )}
          variant="secondary"
        />

        {/* 分隔符 */}
        <div className="w-px h-6 bg-gray-300 dark:bg-gray-600 mx-2" />

        {/* 重试失败任务 */}
        <ControlButton
          icon="🔄"
          text={`重试失败任务 (${failedCount})`}
          onClick={handleRetryFailed}
          disabled={isGloballyDisabled || failedCount === 0}
          variant="secondary"
        />

        {/* 清除已完成 */}
        <ControlButton
          icon="🧹"
          text={`清除已完成 (${completedCount})`}
          onClick={handleClearCompleted}
          disabled={isGloballyDisabled || completedCount === 0}
          variant="secondary"
        />
      </div>

      {/* 右侧：选择相关操作 */}
      <div className="flex items-center gap-2">
        {hasSelection && (
          <>
            <div className="text-sm text-gray-600 dark:text-gray-400">
              已选择 {selectedTasks.length} 个任务
            </div>
            
            <ControlButton
              icon="🗑️"
              text="删除选中"
              onClick={isGloballyDisabled ? () => undefined : handleBatchRemove}
              disabled={isGloballyDisabled}
              variant="danger"
              size="sm"
            />
            
            <ControlButton
              icon="✖️"
              text="取消选择"
              onClick={isGloballyDisabled ? () => undefined : clearSelection}
              disabled={isGloballyDisabled}
              variant="ghost"
              size="sm"
            />
          </>
        )}
      </div>
    </div>
  );
};

// 控制按钮组件
interface ControlButtonProps {
  icon: string;
  text: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md';
  enhanced?: boolean; // 增强视觉突出效果
}

const ControlButton: React.FC<ControlButtonProps> = ({
  icon,
  text,
  onClick,
  disabled = false,
  variant = 'secondary',
  size = 'md',
  enhanced = false
}) => {
  const getVariantClasses = () => {
    const baseClasses = 'font-medium rounded-lg transition-all duration-200 flex items-center gap-2';
    
    switch (variant) {
      case 'primary':
        const primaryClasses = enhanced 
          ? `${baseClasses} bg-gradient-to-r from-blue-600 via-blue-700 to-purple-600 hover:from-blue-700 hover:via-blue-800 hover:to-purple-700 text-white shadow-lg hover:shadow-xl disabled:bg-primary-300 disabled:cursor-not-allowed animate-pulse hover:animate-none transform hover:scale-105 ring-2 ring-blue-300 hover:ring-blue-400`
          : `${baseClasses} bg-primary-600 hover:bg-primary-700 text-white shadow-sm hover:shadow-md disabled:bg-primary-300 disabled:cursor-not-allowed`;
        return primaryClasses;
      case 'danger':
        return `${baseClasses} bg-red-600 hover:bg-red-700 text-white shadow-sm hover:shadow-md disabled:bg-red-300 disabled:cursor-not-allowed`;
      case 'ghost':
        return `${baseClasses} text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:text-gray-400 disabled:cursor-not-allowed`;
      default: // secondary
        return `${baseClasses} bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed`;
    }
  };

  const getSizeClasses = () => {
    switch (size) {
      case 'sm':
        return 'px-3 py-1.5 text-sm';
      default: // md
        return 'px-4 py-2 text-sm';
    }
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`${getVariantClasses()} ${getSizeClasses()}`}
    >
      <span className="text-base">{icon}</span>
      <span>{text}</span>
    </button>
  );
};