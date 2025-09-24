import React, { useState } from 'react';
import { useDownloadStore } from '../../stores/downloadStore';
import { formatBytes } from '../../utils/format';
import type { VideoTask, TaskStatus } from '../../types';

interface VideoTableItemProps {
  task: VideoTask;
  isVirtualized?: boolean;
}

export const VideoTableItem: React.FC<VideoTableItemProps> = ({ task, isVirtualized = false }) => {
  const [showActions, setShowActions] = useState(false);
  const { 
    selectedTasks,
    toggleTaskSelection,
    startDownload,
    pauseDownload,
    resumeDownload,
    cancelDownload,
    removeTasks
  } = useDownloadStore();

  const isSelected = selectedTasks.includes(task.id);

  const getStatusColor = (status: TaskStatus) => {
    switch (status) {
      case 'pending':
        return 'text-yellow-600 bg-yellow-50 dark:bg-yellow-900/20 dark:text-yellow-400';
      case 'downloading':
        return 'text-blue-600 bg-blue-50 dark:bg-blue-900/20 dark:text-blue-400';
      case 'paused':
        return 'text-orange-600 bg-orange-50 dark:bg-orange-900/20 dark:text-orange-400';
      case 'completed':
        return 'text-green-600 bg-green-50 dark:bg-green-900/20 dark:text-green-400';
      case 'failed':
        return 'text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-400';
      case 'cancelled':
        return 'text-gray-600 bg-gray-50 dark:bg-gray-900/20 dark:text-gray-400';
      default:
        return 'text-gray-600 bg-gray-50 dark:bg-gray-900/20 dark:text-gray-400';
    }
  };

  const getStatusIcon = (status: TaskStatus) => {
    switch (status) {
      case 'pending':
        return '⏳';
      case 'downloading':
        return '⬇️';
      case 'paused':
        return '⏸️';
      case 'completed':
        return '✅';
      case 'failed':
        return '❌';
      case 'cancelled':
        return '🚫';
      default:
        return '❓';
    }
  };

  const handleAction = async (action: 'start' | 'pause' | 'resume' | 'cancel' | 'remove') => {
    try {
      switch (action) {
        case 'start':
          await startDownload(task.id);
          break;
        case 'pause':
          await pauseDownload(task.id);
          break;
        case 'resume':
          await resumeDownload(task.id);
          break;
        case 'cancel':
          await cancelDownload(task.id);
          break;
        case 'remove':
          const confirmMessage = `确定要删除任务"${task.title}"吗？${task.status === 'downloading' ? '正在下载的任务将被取消。' : ''}`;
          if (window.confirm(confirmMessage)) {
            await removeTasks([task.id]);
          }
          break;
      }
    } catch (error) {
      console.error(`Failed to ${action} task:`, error);
    }
  };

  // 从video_info或fallback到基础字段获取信息
  const getVideoInfo = () => {
    const videoInfo = task.video_info;
    return {
      zlName: videoInfo?.zl_name || '未知专栏',
      kcName: videoInfo?.kc_name || task.title || '未知课程',
      zlId: videoInfo?.zl_id || videoInfo?.id || '未知',
      kcId: videoInfo?.kc_id || task.id.substring(0, 8) || '未知',
      recordUrl: videoInfo?.record_url || task.url
    };
  };

  const videoInfo = getVideoInfo();

  // 截取URL显示
  const getTruncatedUrl = (url: string, maxLength: number = 40) => {
    if (url.length <= maxLength) return url;
    return url.substring(0, maxLength) + '...';
  };

  return (
    <div 
      className={`border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors ${
        isSelected ? 'bg-primary-50 dark:bg-primary-900/20' : ''
      }`}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      <div className="px-4 py-3">
        <div className="grid grid-cols-12 gap-2 items-center text-sm">
          {/* 选择框 */}
          <div className="col-span-1">
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => toggleTaskSelection(task.id)}
              className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
            />
          </div>

          {/* 专栏名称 */}
          <div className="col-span-2">
            <div 
              className="font-medium text-gray-900 dark:text-gray-100 truncate"
              title={videoInfo.zlName}
            >
              {videoInfo.zlName}
            </div>
            {videoInfo.zlName === '未知专栏' && (
              <div className="text-xs text-amber-600 dark:text-amber-400">
                需要字段映射
              </div>
            )}
          </div>

          {/* 课程名称 */}
          <div className="col-span-2">
            <div 
              className="font-medium text-gray-900 dark:text-gray-100 truncate"
              title={videoInfo.kcName}
            >
              {videoInfo.kcName}
            </div>
            {task.error_message && (
              <div className="text-xs text-red-600 dark:text-red-400 truncate">
                {task.error_message}
              </div>
            )}
          </div>

          {/* 专栏ID */}
          <div className="col-span-1">
            <div 
              className="text-gray-600 dark:text-gray-400 font-mono text-xs truncate"
              title={videoInfo.zlId}
            >
              {videoInfo.zlId}
            </div>
          </div>

          {/* 课程ID */}
          <div className="col-span-1">
            <div 
              className="text-gray-600 dark:text-gray-400 font-mono text-xs truncate"
              title={videoInfo.kcId}
            >
              {videoInfo.kcId}
            </div>
          </div>

          {/* 视频链接 */}
          <div className="col-span-3">
            <div className="flex items-center space-x-1">
              <a
                href={videoInfo.recordUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 truncate text-xs"
                title={videoInfo.recordUrl}
              >
                {getTruncatedUrl(videoInfo.recordUrl)}
              </a>
              {task.downloader_type && (
                <span className="text-xs text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 px-1 py-0.5 rounded">
                  {task.downloader_type}
                </span>
              )}
            </div>
          </div>

          {/* 下载进度 */}
          <div className="col-span-2">
            <div className="flex flex-col space-y-1">
              {/* 进度条 */}
              <div className="flex items-center space-x-2">
                <span className="text-xs">{getStatusIcon(task.status)}</span>
                <div className="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-1.5">
                  <div
                    className={`h-1.5 rounded-full transition-all duration-300 ${
                      task.status === 'completed' ? 'bg-green-500' :
                      task.status === 'failed' ? 'bg-red-500' :
                      task.status === 'downloading' ? 'bg-blue-500' :
                      'bg-gray-400'
                    }`}
                    style={{ width: `${Math.min(task.progress, 100)}%` }}
                  />
                </div>
                <span className="text-xs font-mono w-12 text-right">
                  {task.progress.toFixed(0)}%
                </span>
              </div>
              
              {/* 速度和大小信息 */}
              <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                <span className={`px-1.5 py-0.5 rounded text-xs ${getStatusColor(task.status)}`}>
                  {task.status}
                </span>
                {task.status === 'downloading' && task.speed > 0 && (
                  <span>{formatBytes(task.speed)}/s</span>
                )}
                {task.file_size && (
                  <span>{formatBytes(task.downloaded_size)}/{formatBytes(task.file_size)}</span>
                )}
              </div>
            </div>

            {/* 操作按钮 - 仅在hover时显示 */}
            {showActions && (
              <div className="flex items-center justify-center space-x-1 mt-1">
                {task.status === 'pending' && (
                  <>
                    <ActionButton
                      icon="▶️"
                      tooltip="开始下载"
                      onClick={() => handleAction('start')}
                      variant="primary"
                    />
                    <ActionButton
                      icon="🗑️"
                      tooltip="删除"
                      onClick={() => handleAction('remove')}
                      variant="danger"
                    />
                  </>
                )}
                {task.status === 'downloading' && (
                  <>
                    <ActionButton
                      icon="⏸️"
                      tooltip="暂停"
                      onClick={() => handleAction('pause')}
                      variant="secondary"
                    />
                    <ActionButton
                      icon="🚫"
                      tooltip="取消"
                      onClick={() => handleAction('cancel')}
                      variant="danger"
                    />
                  </>
                )}
                {task.status === 'paused' && (
                  <>
                    <ActionButton
                      icon="▶️"
                      tooltip="继续"
                      onClick={() => handleAction('resume')}
                      variant="primary"
                    />
                    <ActionButton
                      icon="🚫"
                      tooltip="取消"
                      onClick={() => handleAction('cancel')}
                      variant="danger"
                    />
                  </>
                )}
                {task.status === 'failed' && (
                  <>
                    <ActionButton
                      icon="🔄"
                      tooltip="重试"
                      onClick={() => handleAction('start')}
                      variant="primary"
                    />
                    <ActionButton
                      icon="🗑️"
                      tooltip="删除"
                      onClick={() => handleAction('remove')}
                      variant="danger"
                    />
                  </>
                )}
                {(task.status === 'completed' || task.status === 'cancelled') && (
                  <ActionButton
                    icon="🗑️"
                    tooltip="删除"
                    onClick={() => handleAction('remove')}
                    variant="danger"
                  />
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// 小型操作按钮组件
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
  disabled = false 
}) => {
  const getVariantClasses = () => {
    switch (variant) {
      case 'primary':
        return 'text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300 hover:bg-primary-50 dark:hover:bg-primary-900/20';
      case 'danger':
        return 'text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20';
      default:
        return 'text-gray-600 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700';
    }
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={tooltip}
      className={`p-1 rounded transition-colors ${getVariantClasses()} ${
        disabled ? 'opacity-50 cursor-not-allowed' : ''
      }`}
    >
      <span className="text-xs">{icon}</span>
    </button>
  );
};