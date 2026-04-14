import React, { useState } from 'react';
import { useDownloadStore } from '../../stores/downloadStore';
import { formatBytes, formatDuration, formatDate, formatSpeed } from '../../utils/format';
import type { VideoTask, TaskStatus } from '../../types';

interface TaskItemProps {
  task: VideoTask;
  isVirtualized?: boolean;
}

// 使用 React.memo 优化性能，避免频繁重渲染导致滚动卡顿或崩溃
export const TaskItem = React.memo(
  ({ task, isVirtualized = false }: TaskItemProps) => {
    const [showDetails, setShowDetails] = useState(false);
    const selectedTasks = useDownloadStore(state => state.selectedTasks);
    const toggleTaskSelection = useDownloadStore(state => state.toggleTaskSelection);
    const startDownload = useDownloadStore(state => state.startDownload);
    const pauseDownload = useDownloadStore(state => state.pauseDownload);
    const cancelDownload = useDownloadStore(state => state.cancelDownload);
    const removeTasks = useDownloadStore(state => state.removeTasks);

    const isSelected = selectedTasks.includes(task.id);
    const displaySpeed = task.display_speed_bps ?? 0;

    const getStatusColor = (status: TaskStatus) => {
      switch (status) {
        case 'pending':
          return 'text-yellow-600 bg-yellow-100 dark:bg-yellow-900/20 dark:text-yellow-400';
        case 'downloading':
          return 'text-blue-600 bg-blue-100 dark:bg-blue-900/20 dark:text-blue-400';
        case 'committing':
          return 'text-indigo-600 bg-indigo-100 dark:bg-indigo-900/20 dark:text-indigo-300';
        case 'paused':
          return 'text-orange-600 bg-orange-100 dark:bg-orange-900/20 dark:text-orange-400';
        case 'completed':
          return 'text-green-600 bg-green-100 dark:bg-green-900/20 dark:text-green-400';
        case 'failed':
          return 'text-red-600 bg-red-100 dark:bg-red-900/20 dark:text-red-400';
        case 'cancelled':
          return 'text-gray-600 bg-gray-100 dark:bg-gray-900/20 dark:text-gray-400';
        default:
          return 'text-gray-600 bg-gray-100 dark:bg-gray-900/20 dark:text-gray-400';
      }
    };

    const getStatusText = (status: TaskStatus) => {
      const statusMap: Record<TaskStatus, string> = {
        pending: '等待中',
        downloading: '下载中',
        committing: '提交中',
        paused: '已暂停',
        completed: '已完成',
        failed: '失败',
        cancelled: '已取消',
      };
      return statusMap[status] || status;
    };

    const handleAction = async (action: 'start' | 'pause' | 'cancel' | 'remove') => {
      try {
        switch (action) {
          case 'start':
            await startDownload(task.id);
            break;
          case 'pause':
            await pauseDownload(task.id);
            break;
          case 'cancel':
            await cancelDownload(task.id);
            break;
          case 'remove':
            const confirmMessage = `确定要删除任务"${task.title}"吗？${
              task.status === 'downloading' ? '正在下载的任务将被取消。' : ''
            }`;
            if (window.confirm(confirmMessage)) {
              await removeTasks([task.id]);
            }
            break;
        }
      } catch (error) {
        console.error(`Failed to ${action} task:`, error);
      }
    };

    const getActionButtons = () => {
      switch (task.status) {
        case 'pending':
          return (
            <div className='flex items-center space-x-1'>
              <ActionButton
                icon='▶️'
                tooltip='开始下载'
                onClick={() => handleAction('start')}
                variant='primary'
              />
              <ActionButton
                icon='🗑️'
                tooltip='删除任务'
                onClick={() => handleAction('remove')}
                variant='danger'
              />
            </div>
          );
        case 'downloading':
          return (
            <div className='flex items-center space-x-1'>
              <ActionButton
                icon='⏸️'
                tooltip='暂停下载'
                onClick={() => handleAction('pause')}
                variant='secondary'
              />
              <ActionButton
                icon='🚫'
                tooltip='取消下载'
                onClick={() => handleAction('cancel')}
                variant='danger'
              />
            </div>
          );
        case 'committing':
          return null;
        case 'paused':
          return (
            <div className='flex items-center space-x-1'>
              <ActionButton
                icon='▶️'
                tooltip='继续下载'
                onClick={() => handleAction('start')}
                variant='primary'
              />
              <ActionButton
                icon='🚫'
                tooltip='取消下载'
                onClick={() => handleAction('cancel')}
                variant='danger'
              />
            </div>
          );
        case 'failed':
          return (
            <div className='flex items-center space-x-1'>
              <ActionButton
                icon='🔄'
                tooltip='重新开始'
                onClick={() => handleAction('start')}
                variant='primary'
              />
              <ActionButton
                icon='🗑️'
                tooltip='删除任务'
                onClick={() => handleAction('remove')}
                variant='danger'
              />
            </div>
          );
        case 'completed':
        case 'cancelled':
          return (
            <ActionButton
              icon='🗑️'
              tooltip='删除任务'
              onClick={() => handleAction('remove')}
              variant='danger'
            />
          );
        default:
          return null;
      }
    };

    return (
      <div
        className={`border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors ${
          isSelected ? 'bg-primary-50 dark:bg-primary-900/20' : ''
        }`}
      >
        <div className='px-6 py-4'>
          <div className='grid grid-cols-12 gap-4 items-center'>
            {/* 选择框 */}
            <div className='col-span-1'>
              <input
                type='checkbox'
                checked={isSelected}
                onChange={() => toggleTaskSelection(task.id)}
                className='w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500'
              />
            </div>

            {/* 任务名称 */}
            <div className='col-span-4'>
              <div className='flex flex-col'>
                <button
                  onClick={() => setShowDetails(!showDetails)}
                  className='text-left font-medium text-gray-900 dark:text-gray-100 hover:text-primary-600 dark:hover:text-primary-400 truncate'
                  title={task.title}
                >
                  {task.title}
                </button>
                <div className='text-xs text-gray-500 dark:text-gray-400 truncate' title={task.url}>
                  {task.url}
                </div>
                {task.error_message && (
                  <div
                    className='text-xs text-red-600 dark:text-red-400 mt-1 truncate'
                    title={task.error_message}
                  >
                    错误: {task.error_message}
                  </div>
                )}
              </div>
            </div>

            {/* 状态 */}
            <div className='col-span-2'>
              <span
                className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(
                  task.status
                )}`}
              >
                {getStatusText(task.status)}
              </span>
            </div>

            {/* 进度 */}
            <div className='col-span-2'>
              <div className='flex flex-col space-y-1'>
                <div className='w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2'>
                  <div
                    className='bg-primary-600 h-2 rounded-full transition-all duration-300'
                    style={{ width: `${Math.min(task.progress, 100)}%` }}
                  />
                </div>
                <div className='text-xs text-gray-500 dark:text-gray-400 flex justify-between'>
                  <span>{task.progress.toFixed(1)}%</span>
                  {task.status === 'downloading' && displaySpeed > 0 && (
                    <span className='font-mono tabular-nums'>{formatSpeed(displaySpeed)}</span>
                  )}
                  {task.status === 'committing' && (
                    <span className='text-indigo-600 dark:text-indigo-300'>提交中</span>
                  )}
                </div>
              </div>
            </div>

            {/* 更新时间 */}
            <div className='col-span-2'>
              <div className='text-sm text-gray-600 dark:text-gray-400'>
                {formatDate(task.updated_at)}
              </div>
              <div className='text-xs text-gray-500 dark:text-gray-500'>
                {task.file_size
                  ? `${formatBytes(task.downloaded_size)} / ${formatBytes(task.file_size)}`
                  : `${formatBytes(task.downloaded_size)}`}
              </div>
            </div>

            {/* 操作按钮 */}
            <div className='col-span-1'>{getActionButtons()}</div>
          </div>
        </div>

        {/* 详细信息展开面板 */}
        {showDetails && (
          <div className='px-6 pb-4 border-t border-gray-100 dark:border-gray-800'>
            <div className='grid grid-cols-2 gap-6 mt-4 text-sm'>
              <div>
                <h4 className='font-medium text-gray-900 dark:text-gray-100 mb-2'>下载信息</h4>
                <div className='space-y-1 text-gray-600 dark:text-gray-400'>
                  <div>
                    <span className='font-medium'>URL:</span> {task.url}
                  </div>
                  <div>
                    <span className='font-medium'>输出路径:</span> {task.output_path}
                  </div>
                  {task.downloader_type && (
                    <div>
                      <span className='font-medium'>下载器:</span> {task.downloader_type}
                    </div>
                  )}
                  {task.eta && task.status === 'downloading' && (
                    <div>
                      <span className='font-medium'>预计剩余:</span> {formatDuration(task.eta)}
                    </div>
                  )}
                </div>
              </div>
              <div>
                <h4 className='font-medium text-gray-900 dark:text-gray-100 mb-2'>时间信息</h4>
                <div className='space-y-1 text-gray-600 dark:text-gray-400'>
                  <div>
                    <span className='font-medium'>创建时间:</span> {formatDate(task.created_at)}
                  </div>
                  <div>
                    <span className='font-medium'>更新时间:</span> {formatDate(task.updated_at)}
                  </div>
                  <div>
                    <span className='font-medium'>任务ID:</span> {task.id}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  },
  (prevProps, nextProps) => {
    // 自定义比较函数
    return (
      prevProps.isVirtualized === nextProps.isVirtualized &&
      prevProps.task.id === nextProps.task.id &&
      prevProps.task.status === nextProps.task.status &&
      prevProps.task.progress === nextProps.task.progress &&
      prevProps.task.downloaded_size === nextProps.task.downloaded_size &&
      prevProps.task.display_speed_bps === nextProps.task.display_speed_bps &&
      prevProps.task.eta === nextProps.task.eta &&
      prevProps.task.updated_at === nextProps.task.updated_at &&
      // 注意：这里我们假设 useDownloadStore 中的函数引用是不变的，或者不需要触发重渲染
      // selectedTasks 的变化通过 context/store 传递，这里只需要比较 ID 是否还在选中列表中
      useDownloadStore.getState().selectedTasks.includes(prevProps.task.id) ===
        useDownloadStore.getState().selectedTasks.includes(nextProps.task.id)
    );
  }
);

// 操作按钮组件
interface ActionButtonProps {
  icon: string;
  tooltip: string;
  onClick: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
}

const ActionButton: React.FC<ActionButtonProps> = ({
  icon,
  tooltip,
  onClick,
  variant = 'secondary',
  disabled = false,
}) => {
  const getVariantClasses = () => {
    switch (variant) {
      case 'primary':
        return 'text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300';
      case 'danger':
        return 'text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300';
      default:
        return 'text-gray-600 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300';
    }
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={tooltip}
      className={`p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${getVariantClasses()} ${
        disabled ? 'opacity-50 cursor-not-allowed' : ''
      }`}
    >
      <span className='text-sm'>{icon}</span>
    </button>
  );
};
