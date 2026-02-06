import React, { useState } from 'react';
import { useDownloadStore } from '../../stores/downloadStore';
import { formatBytes } from '../../utils/format';
import type { VideoTask, TaskStatus } from '../../types';
import {
  PlayIcon,
  PauseIcon,
  StopIcon,
  ArrowPathIcon,
  TrashIcon,
  FolderIcon,
} from '@heroicons/react/24/outline';

interface VideoTableItemProps {
  task: VideoTask;
  isVirtualized?: boolean;
  style?: React.CSSProperties;
  onClick?: () => void;
  onSelect?: (selected: boolean) => void;
  isSelected?: boolean;
}

export const VideoTableItem: React.FC<VideoTableItemProps> = ({
  task,
  isVirtualized = false,
  style,
  onClick,
  onSelect,
  isSelected: propIsSelected,
}) => {
  const {
    selectedTasks,
    toggleTaskSelection,
    startDownload,
    pauseDownload,
    cancelDownload,
    removeTasks,
  } = useDownloadStore();

  const isSelected = propIsSelected ?? selectedTasks.includes(task.id);

  // 格式化时间
  const formatDate = (dateString: string) => {
    try {
      const date = new Date(dateString);
      return date.toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateString;
    }
  };

  const getStatusConfig = (status: TaskStatus) => {
    switch (status) {
      case 'pending':
        return {
          color: 'bg-yellow-500',
          text: 'text-yellow-600 dark:text-yellow-400',
          bg: 'bg-yellow-50 dark:bg-yellow-900/20',
          label: '待下载',
        };
      case 'downloading':
        return {
          color: 'bg-blue-500',
          text: 'text-blue-600 dark:text-blue-400',
          bg: 'bg-blue-50 dark:bg-blue-900/20',
          label: '下载中',
        };
      case 'paused':
        return {
          color: 'bg-orange-500',
          text: 'text-orange-600 dark:text-orange-400',
          bg: 'bg-orange-50 dark:bg-orange-900/20',
          label: '已暂停',
        };
      case 'completed':
        return {
          color: 'bg-green-500',
          text: 'text-green-600 dark:text-green-400',
          bg: 'bg-green-50 dark:bg-green-900/20',
          label: '已完成',
        };
      case 'failed':
        return {
          color: 'bg-red-500',
          text: 'text-red-600 dark:text-red-400',
          bg: 'bg-red-50 dark:bg-red-900/20',
          label: '失败',
        };
      case 'cancelled':
        return {
          color: 'bg-gray-400',
          text: 'text-gray-500 dark:text-gray-400',
          bg: 'bg-gray-100 dark:bg-gray-800',
          label: '已取消',
        };
      default:
        return {
          color: 'bg-gray-400',
          text: 'text-gray-500',
          bg: 'bg-gray-100',
          label: '未知',
        };
    }
  };

  const statusConfig = getStatusConfig(task.status);

  const handleAction = async (
    e: React.MouseEvent,
    action: 'start' | 'pause' | 'cancel' | 'remove'
  ) => {
    e.stopPropagation();
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
  const videoInfo = {
    zlName: task.video_info?.zl_name || '未知专栏',
    kcName: task.video_info?.kc_name || task.title || '未知课程',
    recordUrl: task.video_info?.record_url || task.url,
  };

  return (
    <div
      style={style}
      className={`group relative flex items-center p-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 border-b border-gray-100 dark:border-gray-800 transition-all duration-200 ${
        isSelected ? 'bg-blue-50/50 dark:bg-blue-900/10' : 'bg-white dark:bg-gray-900'
      }`}
      onClick={onClick}
    >
      {/* 左侧选择与图标区 */}
      <div className='flex items-center h-full mr-4' onClick={e => e.stopPropagation()}>
        <input
          type='checkbox'
          checked={isSelected}
          onChange={e => {
            if (onSelect) {
              onSelect(e.target.checked);
            } else {
              toggleTaskSelection(task.id);
            }
          }}
          className='w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer transition-colors'
        />
      </div>

      {/* 图标区域 */}
      <div className='hidden sm:flex flex-shrink-0 w-10 h-10 mr-4 items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'>
        {task.downloader_type === 'youtube' ? (
          <PlayIcon className='w-6 h-6 text-red-500' />
        ) : (
          <span className='text-xs font-bold text-gray-400'>VIDEO</span>
        )}
      </div>

      {/* 中间主要信息区 */}
      <div className='flex-1 min-w-0 mr-4 flex flex-col justify-center space-y-1.5'>
        <div className='flex items-center gap-2'>
          <h3
            className='text-sm font-semibold text-gray-900 dark:text-gray-100 truncate'
            title={videoInfo.kcName}
          >
            {videoInfo.kcName}
          </h3>
          {videoInfo.zlName !== '未知专栏' && (
            <span className='inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'>
              {videoInfo.zlName}
            </span>
          )}
        </div>

        {/* 进度条和状态信息 */}
        <div className='w-full max-w-xl'>
          <div className='flex items-center justify-between text-xs mb-1.5'>
            <div className='flex items-center gap-2'>
              <span className={`font-medium ${statusConfig.text}`}>
                {statusConfig.label} {task.progress > 0 && `${task.progress.toFixed(1)}%`}
              </span>
              {task.status === 'downloading' && (
                <>
                  <span className='text-gray-300 dark:text-gray-600'>|</span>
                  <span className='text-gray-500 dark:text-gray-400 font-mono'>
                    {formatBytes(task.speed)}/s
                  </span>
                </>
              )}
            </div>
            <div className='text-gray-400 font-mono'>
              {task.file_size
                ? `${formatBytes(task.downloaded_size)} / ${formatBytes(task.file_size)}`
                : formatBytes(task.downloaded_size)}
            </div>
          </div>

          <div className='h-1.5 w-full bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden'>
            <div
              className={`h-full rounded-full transition-all duration-500 ease-out ${statusConfig.color} ${
                task.status === 'downloading' ? 'animate-pulse' : ''
              }`}
              style={{ width: `${Math.max(task.progress, 2)}%` }}
            />
          </div>
        </div>

        {/* 底部额外信息 */}
        <div className='flex items-center gap-3 text-xs text-gray-400 mt-0.5'>
          <span>Added: {formatDate(task.created_at)}</span>
          <a
            href={videoInfo.recordUrl}
            target='_blank'
            rel='noreferrer'
            className='hover:text-blue-500 hover:underline truncate max-w-[200px]'
            onClick={e => e.stopPropagation()}
          >
            {videoInfo.recordUrl}
          </a>
        </div>
      </div>

      {/* 右侧操作区 - 悬浮显示 */}
      <div className='flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200 absolute right-4 bg-white/90 dark:bg-gray-900/90 px-2 py-1 rounded-lg shadow-sm backdrop-blur-sm'>
        {task.status === 'pending' || task.status === 'failed' ? (
          <button
            onClick={e => handleAction(e, 'start')}
            className='p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg transition-colors'
            title='开始下载'
          >
            <PlayIcon className='w-5 h-5' />
          </button>
        ) : null}

        {task.status === 'downloading' ? (
          <button
            onClick={e => handleAction(e, 'pause')}
            className='p-2 text-gray-500 hover:text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-900/30 rounded-lg transition-colors'
            title='暂停'
          >
            <PauseIcon className='w-5 h-5' />
          </button>
        ) : null}

        {task.status === 'paused' ? (
          <button
            onClick={e => handleAction(e, 'start')}
            className='p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg transition-colors'
            title='继续'
          >
            <PlayIcon className='w-5 h-5' />
          </button>
        ) : null}

        {task.status === 'downloading' || task.status === 'paused' ? (
          <button
            onClick={e => handleAction(e, 'cancel')}
            className='p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors'
            title='取消'
          >
            <StopIcon className='w-5 h-5' />
          </button>
        ) : null}

        <button
          onClick={e => handleAction(e, 'remove')}
          className='p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors'
          title='删除任务'
        >
          <TrashIcon className='w-5 h-5' />
        </button>
      </div>

      {/* 状态标签 - 在未悬浮且非下载中状态显示 */}
      <div className='group-hover:opacity-0 transition-opacity duration-200 absolute right-4 text-xs font-medium px-2.5 py-1 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'>
        {statusConfig.label}
      </div>
    </div>
  );
};
