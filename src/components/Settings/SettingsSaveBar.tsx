import React from 'react';
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';

const buttonFocusClass =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';

interface SettingsSaveBarProps {
  hasChanges: boolean;
  isLoading: boolean;
  onReset: () => void;
  onSave: () => void;
}

export const SettingsSaveBar: React.FC<SettingsSaveBarProps> = ({
  hasChanges,
  isLoading,
  onReset,
  onSave,
}) => (
  <div className='fixed bottom-0 right-0 w-full max-w-md bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 p-4 shadow-lg z-10'>
    <div className='flex items-center justify-between'>
      <div className='flex items-center space-x-4'>
        {hasChanges && (
          <div className='flex items-center text-amber-600 dark:text-amber-400'>
            <ExclamationTriangleIcon className='w-5 h-5 mr-2' />
            <span className='text-sm'>有未保存的更改</span>
          </div>
        )}
      </div>

      <div className='flex items-center space-x-3'>
        <button
          type='button'
          onClick={onReset}
          disabled={isLoading}
          className={`px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 disabled:opacity-50 transition-colors ${buttonFocusClass}`}
        >
          恢复默认
        </button>
        <button
          type='button'
          onClick={onSave}
          disabled={isLoading || !hasChanges}
          data-testid='save-settings'
          className={`inline-flex items-center px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${buttonFocusClass}`}
        >
          {isLoading ? (
            <div className='w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2'></div>
          ) : (
            <CheckCircleIcon className='w-4 h-4 mr-2' />
          )}
          {isLoading ? '保存中...' : '保存设置'}
        </button>
      </div>
    </div>
  </div>
);
