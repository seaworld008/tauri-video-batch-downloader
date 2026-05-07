import React from 'react';
import { ArrowPathIcon, WrenchScrewdriverIcon } from '@heroicons/react/24/outline';
import type {
  ExternalToolId,
  ExternalToolStatus,
} from '../../features/downloads/api/systemCommands';

const buttonFocusClass =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';

interface ExternalToolsSectionProps {
  tools: ExternalToolStatus[];
  isLoading: boolean;
  isUpdating: string | null;
  onRefresh: () => void;
  onCheckUpdates: () => void;
  onUpdate: (tool: ExternalToolId) => void;
  onRollback: (tool: ExternalToolId) => void;
  onSelectOverride: (tool: ExternalToolId) => void;
  onClearOverride: (tool: ExternalToolId) => void;
}

const statusLabel = (status: ExternalToolStatus['status']) => {
  switch (status) {
    case 'available':
      return '可用';
    case 'missing':
      return '缺失';
    case 'failed':
      return '异常';
    case 'version_unsupported':
      return '不兼容';
    default:
      return status;
  }
};

const sourceLabel = (source?: ExternalToolStatus['source']) => {
  switch (source) {
    case 'user_override':
      return '用户指定';
    case 'managed':
      return 'App 管理';
    case 'bundled_sidecar':
      return '随包内置';
    case 'path_fallback':
      return 'PATH';
    default:
      return '未检测';
  }
};

const toolGuidance = (tool: ExternalToolStatus) => {
  if (tool.status === 'version_unsupported') {
    return '兼容性探测未通过。请选择新版可执行文件，或回退到上一个 App 管理版本。';
  }

  if (tool.id === 'yt-dlp') {
    if (tool.update_available) {
      return '更新会先校验 checksum，再执行兼容性探测；探测失败不会替换当前可用版本。';
    }
    return '可由 App 管理更新和回退；用户指定路径会优先于 App 管理版本。';
  }

  if (tool.id === 'ffmpeg') {
    return 'FFmpeg 采用可信本地文件手动更新；选择后会先执行版本和兼容性探测，通过后才切换。';
  }

  return null;
};

const overrideButtonLabel = (tool: ExternalToolStatus) =>
  tool.id === 'ffmpeg' ? '选择新版文件' : '选择本地文件';

export const ExternalToolsSection: React.FC<ExternalToolsSectionProps> = ({
  tools,
  isLoading,
  isUpdating,
  onRefresh,
  onCheckUpdates,
  onUpdate,
  onRollback,
  onSelectOverride,
  onClearOverride,
}) => (
  <div className='bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6'>
    <div className='flex items-center justify-between gap-3 mb-5'>
      <div className='flex items-center min-w-0'>
        <WrenchScrewdriverIcon className='w-6 h-6 text-sky-600 dark:text-sky-400 mr-3 shrink-0' />
        <h2 className='text-xl font-semibold text-gray-900 dark:text-gray-100'>外部工具</h2>
      </div>
      <div className='flex gap-2 shrink-0'>
        <button
          type='button'
          onClick={onRefresh}
          disabled={isLoading}
          className={`inline-flex items-center px-3 py-2 text-sm bg-gray-600 text-white rounded-md hover:bg-gray-700 disabled:opacity-60 ${buttonFocusClass}`}
        >
          <ArrowPathIcon className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
          刷新
        </button>
        <button
          type='button'
          onClick={onCheckUpdates}
          disabled={isLoading}
          className={`inline-flex items-center px-3 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-60 ${buttonFocusClass}`}
        >
          检查更新
        </button>
      </div>
    </div>

    <div className='space-y-3'>
      {tools.map(tool => (
        <div
          key={tool.id}
          className='rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-4'
        >
          <div className='flex flex-col gap-3'>
            <div className='flex items-start justify-between gap-3'>
              <div className='min-w-0'>
                <div className='flex items-center gap-2'>
                  <span className='font-medium text-gray-900 dark:text-gray-100'>
                    {tool.display_name}
                  </span>
                  <span className='text-xs px-2 py-0.5 rounded-md bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200'>
                    {statusLabel(tool.status)}
                  </span>
                  {tool.update_available && (
                    <span className='text-xs px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-200'>
                      可更新
                    </span>
                  )}
                </div>
                <div className='mt-1 text-xs text-gray-500 dark:text-gray-400 break-all'>
                  {sourceLabel(tool.source)} · {tool.path || '未找到路径'}
                </div>
              </div>
              <div className='text-right text-xs text-gray-500 dark:text-gray-400 shrink-0'>
                <div>{tool.current_version || '未知版本'}</div>
                {tool.latest_version && <div>最新 {tool.latest_version}</div>}
              </div>
            </div>

            {tool.last_error && (
              <div className='text-xs text-red-600 dark:text-red-300 break-words'>
                {tool.last_error}
              </div>
            )}

            {toolGuidance(tool) && (
              <div className='text-xs text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md px-3 py-2'>
                {toolGuidance(tool)}
              </div>
            )}

            <div className='flex flex-wrap gap-2 justify-end'>
              {tool.can_auto_update && (
                <button
                  type='button'
                  onClick={() => onUpdate(tool.id)}
                  disabled={isUpdating === tool.id}
                  className={`px-3 py-1.5 text-xs bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-60 ${buttonFocusClass}`}
                >
                  {isUpdating === tool.id ? '更新中' : '更新到最新版'}
                </button>
              )}
              {tool.can_rollback && tool.source !== 'user_override' && (
                <button
                  type='button'
                  onClick={() => onRollback(tool.id)}
                  disabled={isUpdating === tool.id}
                  className={`px-3 py-1.5 text-xs bg-amber-600 text-white rounded-md hover:bg-amber-700 disabled:opacity-60 ${buttonFocusClass}`}
                >
                  回退上一版
                </button>
              )}
              <button
                type='button'
                onClick={() => onSelectOverride(tool.id)}
                className={`px-3 py-1.5 text-xs bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 ${buttonFocusClass}`}
              >
                {overrideButtonLabel(tool)}
              </button>
              {tool.source === 'user_override' && (
                <button
                  type='button'
                  onClick={() => onClearOverride(tool.id)}
                  className={`px-3 py-1.5 text-xs border border-gray-300 dark:border-gray-600 rounded-md text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 ${buttonFocusClass}`}
                >
                  清除指定
                </button>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  </div>
);
