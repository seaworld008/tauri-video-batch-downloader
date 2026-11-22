import React from 'react';
import { FolderIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useI18n } from '../../i18n/hooks';

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
  const { t } = useI18n();

  React.useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !working) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, working, onClose]);

  if (!open) {
    return null;
  }

  const isTemporaryOverride = defaultDirectory !== effectiveDirectory;

  return (
    <div
      className='fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4'
      onClick={() => {
        if (!working) {
          onClose();
        }
      }}
    >
      <div
        role='dialog'
        aria-modal='true'
        className='bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-lg w-full p-6'
        onClick={event => event.stopPropagation()}
      >
        <div className='flex items-center justify-between mb-4'>
          <div>
            <h3 className='text-lg font-semibold text-gray-900 dark:text-white'>
              {t('dialogs.startConfirmTitle')}
            </h3>
            <p className='text-sm text-gray-500 dark:text-gray-400 mt-1'>
              {t('dialogs.startConfirmSubtitle', { count: taskCount })}
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={working}
            className='p-1.5 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50'
            aria-label={t('common.close')}
          >
            <XMarkIcon className='h-5 w-5 text-gray-500' />
          </button>
        </div>

        <div className='space-y-4 mb-5'>
          <div className='rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-4'>
            <div className='text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2'>
              {t('dialogs.defaultDir')}
            </div>
            <div className='text-sm text-gray-800 dark:text-gray-100 break-all'>
              {defaultDirectory || t('toolbar.unsetDir')}
            </div>
          </div>

          <div className='rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/80 dark:bg-blue-900/20 p-4'>
            <div className='flex items-center justify-between gap-3 mb-2'>
              <div className='text-xs font-medium uppercase tracking-wide text-blue-700 dark:text-blue-300'>
                {t('dialogs.effectiveDir')}
              </div>
              {isTemporaryOverride && (
                <span className='inline-flex items-center rounded-full bg-blue-100 dark:bg-blue-900/50 px-2 py-0.5 text-[11px] font-medium text-blue-700 dark:text-blue-200'>
                  {t('dialogs.thisRunOnly')}
                </span>
              )}
            </div>
            <div className='text-sm text-gray-900 dark:text-white break-all'>
              {effectiveDirectory || t('toolbar.unsetDir')}
            </div>
            {samplePath && (
              <div className='mt-3 text-xs text-gray-600 dark:text-gray-300 break-all'>
                {t('dialogs.samplePath', { path: samplePath })}
              </div>
            )}
          </div>
        </div>

        <div className='flex flex-col sm:flex-row gap-2'>
          <button
            onClick={onClose}
            disabled={working}
            className='flex-1 px-3 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors'
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={() => void onChangeDirectory()}
            disabled={working}
            className='flex-1 inline-flex items-center justify-center px-3 py-2 text-sm font-medium text-blue-700 dark:text-blue-200 bg-blue-50 dark:bg-blue-900/20 rounded-md hover:bg-blue-100 dark:hover:bg-blue-900/30 disabled:opacity-50 transition-colors'
          >
            <FolderIcon className='h-4 w-4 mr-1.5' />
            {t('dialogs.changeThisRunDir')}
          </button>
          <button
            onClick={() => void onConfirm()}
            disabled={working}
            className='flex-1 px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors'
          >
            {working ? t('dialogs.processing') : t('dialogs.startDownload')}
          </button>
        </div>
      </div>
    </div>
  );
};
