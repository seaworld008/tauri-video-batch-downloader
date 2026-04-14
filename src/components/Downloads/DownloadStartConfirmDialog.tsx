import React from 'react';
import { FolderIcon, XMarkIcon } from '@heroicons/react/24/outline';

interface DownloadStartConfirmDialogProps {
  open: boolean;
  working: boolean;
  taskCount: number;
  defaultDirectory: string;
  effectiveDirectory: string;
  samplePath: string;
  onClose: () => void;
  onChangeDirectory: () => Promise<void> | void;
  onConfirm: () => Promise<void> | void;
}

export const DownloadStartConfirmDialog: React.FC<DownloadStartConfirmDialogProps> = ({
  open,
  working,
  taskCount,
  defaultDirectory,
  effectiveDirectory,
  samplePath,
  onClose,
  onChangeDirectory,
  onConfirm,
}) => {
  React.useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  const isTemporaryOverride = defaultDirectory !== effectiveDirectory;

  return (
    <div
      className='fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4'
      onClick={onClose}
    >
      <div
        className='bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-lg w-full p-6'
        onClick={event => event.stopPropagation()}
      >
        <div className='flex items-center justify-between mb-4'>
          <div>
            <h3 className='text-lg font-semibold text-gray-900 dark:text-white'>确认下载位置</h3>
            <p className='text-sm text-gray-500 dark:text-gray-400 mt-1'>
              即将开始 {taskCount} 个任务
            </p>
          </div>
          <button
            onClick={onClose}
            className='p-1.5 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700'
            aria-label='关闭'
          >
            <XMarkIcon className='h-5 w-5 text-gray-500' />
          </button>
        </div>

        <div className='space-y-4 mb-5'>
          <div className='rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-4'>
            <div className='text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2'>
              默认下载目录
            </div>
            <div className='text-sm text-gray-800 dark:text-gray-100 break-all'>
              {defaultDirectory || '未设置'}
            </div>
          </div>

          <div className='rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/80 dark:bg-blue-900/20 p-4'>
            <div className='flex items-center justify-between gap-3 mb-2'>
              <div className='text-xs font-medium uppercase tracking-wide text-blue-700 dark:text-blue-300'>
                本次保存位置
              </div>
              {isTemporaryOverride && (
                <span className='inline-flex items-center rounded-full bg-blue-100 dark:bg-blue-900/50 px-2 py-0.5 text-[11px] font-medium text-blue-700 dark:text-blue-200'>
                  仅本次生效
                </span>
              )}
            </div>
            <div className='text-sm text-gray-900 dark:text-white break-all'>
              {effectiveDirectory || '未设置'}
            </div>
            {samplePath && (
              <div className='mt-3 text-xs text-gray-600 dark:text-gray-300 break-all'>
                示例保存路径：{samplePath}
              </div>
            )}
          </div>
        </div>

        <div className='flex flex-col sm:flex-row gap-2'>
          <button
            onClick={onClose}
            className='flex-1 px-3 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors'
          >
            取消
          </button>
          <button
            onClick={() => void onChangeDirectory()}
            disabled={working}
            className='flex-1 inline-flex items-center justify-center px-3 py-2 text-sm font-medium text-blue-700 dark:text-blue-200 bg-blue-50 dark:bg-blue-900/20 rounded-md hover:bg-blue-100 dark:hover:bg-blue-900/30 disabled:opacity-50 transition-colors'
          >
            <FolderIcon className='h-4 w-4 mr-1.5' />
            本次更改位置
          </button>
          <button
            onClick={() => void onConfirm()}
            disabled={working}
            className='flex-1 px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors'
          >
            {working ? '处理中...' : '开始下载'}
          </button>
        </div>
      </div>
    </div>
  );
};
