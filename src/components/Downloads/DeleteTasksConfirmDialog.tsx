import React from 'react';
import { ExclamationTriangleIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useI18n } from '../../i18n/hooks';

interface DeleteTasksConfirmDialogProps {
  open: boolean;
  working: boolean;
  title: string;
  description: string;
  taskTitles: string[];
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
}

export const DeleteTasksConfirmDialog: React.FC<DeleteTasksConfirmDialogProps> = ({
  open,
  working,
  title,
  description,
  taskTitles,
  onClose,
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
  }, [open, onClose, working]);

  if (!open) {
    return null;
  }

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
        <div className='flex items-start justify-between gap-4 mb-4'>
          <div className='flex items-start gap-3'>
            <div className='rounded-full bg-red-100 dark:bg-red-900/30 p-2'>
              <ExclamationTriangleIcon className='h-5 w-5 text-red-600 dark:text-red-300' />
            </div>
            <div>
              <h3 className='text-lg font-semibold text-gray-900 dark:text-white'>{title}</h3>
              <p className='text-sm text-gray-500 dark:text-gray-400 mt-1'>{description}</p>
            </div>
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

        {taskTitles.length > 0 && (
          <div className='rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-4 mb-5'>
            <div className='text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2'>
              {t('dialogs.pendingItemsTitle')}
            </div>
            <div className='space-y-1 text-sm text-gray-800 dark:text-gray-100'>
              {taskTitles.slice(0, 3).map((taskTitle, index) => (
                <div key={`${taskTitle}-${index}`} className='truncate' title={taskTitle}>
                  {taskTitle}
                </div>
              ))}
              {taskTitles.length > 3 && (
                <div className='text-xs text-gray-500 dark:text-gray-400'>
                  {t('dialogs.moreTasks', { count: taskTitles.length - 3 })}
                </div>
              )}
            </div>
          </div>
        )}

        <div className='flex gap-2'>
          <button
            onClick={onClose}
            disabled={working}
            className='flex-1 px-3 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors'
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={() => void onConfirm()}
            disabled={working}
            className='flex-1 px-3 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50 transition-colors'
          >
            {working ? t('dialogs.processing') : t('dialogs.confirmClear')}
          </button>
        </div>
      </div>
    </div>
  );
};
