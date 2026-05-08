import React, { useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { ClipboardDocumentIcon, FolderOpenIcon } from '@heroicons/react/24/outline';

import { revealPathInFolderCommand } from '../../features/downloads/api/systemCommands';
import { buildTaskSupportBundle } from '../../features/downloads/model/downloadDiagnostics';
import type { VideoTask } from '../../types';
import { formatSpeed } from '../../utils/format';

const buttonFocusClass =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';

const copyTextToClipboard = async (text: string): Promise<void> => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  document.body.removeChild(textarea);

  if (!copied) {
    throw new Error('clipboard_copy_failed');
  }
};

function formatTime(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h`;
}

const getRevealPath = (task: VideoTask): string =>
  (task.resolved_path?.trim() || task.output_path.trim()).trim();

export const TaskItem = React.memo<{
  task: VideoTask;
  style: React.CSSProperties;
  isSelected: boolean;
  onSelect: (selected: boolean) => void;
  index: number;
}>(({ task, style, isSelected, onSelect, index }) => {
  const displaySpeed = task.display_speed_bps ?? 0;
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const canReveal = task.status === 'completed' && getRevealPath(task).length > 0;

  useEffect(() => {
    if (!menuPosition) return;

    const closeMenu = (event: MouseEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      setMenuPosition(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuPosition(null);
      }
    };

    document.addEventListener('mousedown', closeMenu);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeMenu);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [menuPosition]);

  const handleSelectChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onSelect(e.target.checked);
  };

  const handleCopyDiagnostic = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    try {
      await copyTextToClipboard(buildTaskSupportBundle(task));
      toast.success('任务诊断已复制');
    } catch {
      toast.error('复制诊断失败，请检查剪贴板权限');
    }
  };

  const handleContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!canReveal) return;
    event.preventDefault();
    setMenuPosition({ x: event.clientX, y: event.clientY });
  };

  const handleRevealInFolder = async () => {
    const path = getRevealPath(task);
    setMenuPosition(null);

    if (!path) {
      toast.error('没有可定位的下载文件路径');
      return;
    }

    try {
      await revealPathInFolderCommand(path);
      toast.success('已在目录中显示');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '无法在目录中显示文件');
    }
  };

  const statusColor = useMemo(() => {
    switch (task.status) {
      case 'completed':
        return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400';
      case 'downloading':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400';
      case 'committing':
        return 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300';
      case 'failed':
        return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400';
      case 'paused':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400';
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300';
    }
  }, [task.status]);

  const progressPercentage = Math.round(task.progress);

  return (
    <div
      style={style}
      className={`absolute flex items-center px-4 py-3 border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors duration-150 ${
        isSelected ? 'bg-blue-50 dark:bg-blue-900/10' : ''
      }`}
      data-testid='task-item'
      data-status={task.status}
      onContextMenu={handleContextMenu}
    >
      <div className='flex items-center h-full mr-4' onClick={e => e.stopPropagation()}>
        <input
          type='checkbox'
          checked={isSelected}
          onChange={handleSelectChange}
          data-testid='task-checkbox'
          className='w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 focus-visible:ring-2 focus-visible:ring-ring dark:bg-gray-700 dark:border-gray-600'
        />
      </div>

      <div className='flex-1 min-w-0 pr-4'>
        <div className='flex items-center justify-between mb-1.5'>
          <h4
            className='text-sm font-medium text-gray-900 dark:text-gray-100 truncate pr-4'
            title={task.title}
            data-testid='task-title'
          >
            <span className='text-gray-400 dark:text-gray-500 mr-2 font-normal text-xs'>
              #{index + 1}
            </span>
            {task.title}
          </h4>
          <div className='flex items-center gap-2 shrink-0'>
            <button
              type='button'
              onClick={handleCopyDiagnostic}
              className={`p-1 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:text-gray-100 dark:hover:bg-gray-700 ${buttonFocusClass}`}
              title='复制任务诊断'
              aria-label={`复制任务诊断：${task.title}`}
            >
              <ClipboardDocumentIcon className='w-4 h-4' />
            </button>
            <span
              className={`px-2 py-0.5 text-xs font-medium rounded-full whitespace-nowrap ${statusColor}`}
              data-testid='task-status'
            >
              {task.status === 'pending'
                ? '等待中'
                : task.status === 'downloading'
                  ? '下载中'
                  : task.status === 'committing'
                    ? '提交中'
                    : task.status === 'completed'
                      ? '已完成'
                      : task.status === 'failed'
                        ? '失败'
                        : task.status === 'paused'
                          ? '暂停'
                          : task.status}
            </span>
          </div>
        </div>

        <div className='flex items-center space-x-4 text-xs text-gray-500 dark:text-gray-400'>
          {task.status === 'downloading' && (
            <>
              <span className='w-16'>{progressPercentage}%</span>
              <span className='w-24 font-mono tabular-nums whitespace-nowrap'>
                {formatSpeed(displaySpeed)}
              </span>
              <span>剩余: {task.eta ? formatTime(task.eta) : '--'}</span>
            </>
          )}
          {task.status === 'committing' && (
            <>
              <span className='w-16'>{progressPercentage}%</span>
              <span className='w-24 text-indigo-600 dark:text-indigo-300 whitespace-nowrap'>
                提交中
              </span>
              <span>剩余: --</span>
            </>
          )}
          {task.status !== 'downloading' && task.status !== 'committing' && (
            <span className='truncate text-gray-400'>{task.output_path}</span>
          )}
        </div>

        <div
          className='w-full bg-gray-100 dark:bg-gray-700 rounded-full h-1 mt-2 overflow-hidden'
          data-testid='progress-bar'
        >
          <div
            className={`h-full transition-all duration-300 ${
              task.status === 'failed'
                ? 'bg-red-500'
                : task.status === 'completed'
                  ? 'bg-green-500'
                  : 'bg-blue-600'
            }`}
            style={{ width: `${progressPercentage}%` }}
          />
        </div>
      </div>

      {menuPosition && (
        <div
          ref={menuRef}
          className='fixed z-50 min-w-44 rounded-md border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-900'
          style={{ left: menuPosition.x, top: menuPosition.y }}
          role='menu'
        >
          <button
            type='button'
            className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800 ${buttonFocusClass}`}
            onClick={handleRevealInFolder}
            role='menuitem'
          >
            <FolderOpenIcon className='h-4 w-4' />
            在目录中显示
          </button>
        </div>
      )}
    </div>
  );
});

TaskItem.displayName = 'TaskItem';
