import React from 'react';
import {
  PlayIcon,
  PauseIcon,
  TrashIcon,
  ArrowPathIcon,
  MagnifyingGlassIcon,
  FolderIcon,
  CogIcon,
} from '@heroicons/react/24/outline';
import { useI18n } from '../../i18n/hooks';

interface ToolbarActionsProps {
  searchQuery: string;
  outputDirectory: string;
  hasSelection: boolean;
  isQueuePaused: boolean;
  canStartAll: boolean;
  hasPausableTasks: boolean;
  canBulkSelectFiltered: boolean;
  canDeleteFilteredWithoutSelection: boolean;
  canClearInactiveTasks: boolean;
  onSearchChange: (query: string) => void;
  onOpenDownloadFolder: () => void;
  onOpenSettings?: () => void;
  onBatchAction: (action: 'start' | 'pause' | 'delete') => void;
  onSelectFiltered: () => void;
  onDeleteFiltered: () => void;
  onClearInactive: () => void;
  onRefresh: () => void;
}

const buttonFocusClass =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';

export const ToolbarActions: React.FC<ToolbarActionsProps> = ({
  searchQuery,
  outputDirectory,
  hasSelection,
  isQueuePaused,
  canStartAll,
  hasPausableTasks,
  canBulkSelectFiltered,
  canDeleteFilteredWithoutSelection,
  canClearInactiveTasks,
  onSearchChange,
  onOpenDownloadFolder,
  onOpenSettings,
  onBatchAction,
  onSelectFiltered,
  onDeleteFiltered,
  onClearInactive,
  onRefresh,
}) => {
  const { t } = useI18n();

  return (
    <div className='flex items-center justify-between gap-4'>
      <div className='flex items-center gap-3 flex-1 max-w-2xl'>
        <div className='relative flex-1'>
          <div className='absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none'>
            <MagnifyingGlassIcon className='h-4 w-4 text-gray-400' />
          </div>
          <input
            type='text'
            value={searchQuery}
            onChange={event => onSearchChange(event.target.value)}
            placeholder={t('toolbar.searchPlaceholder')}
            data-testid='search-input'
            className='block w-full pl-9 pr-3 py-1.5 text-sm bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md focus:ring-1 focus:ring-blue-500 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus:border-blue-500 transition-colors'
          />
        </div>

        <button
          type='button'
          onClick={onOpenDownloadFolder}
          className={`hidden md:flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-blue-600 dark:hover:text-blue-400 transition-all max-w-[240px] ${buttonFocusClass}`}
          title={t('toolbar.outputDirTitle', { dir: outputDirectory || t('toolbar.unsetDir') })}
        >
          <FolderIcon className='h-3.5 w-3.5 flex-shrink-0' />
          <span className='truncate'>{outputDirectory || t('toolbar.unsetShort')}</span>
        </button>

        {onOpenSettings && (
          <button
            type='button'
            onClick={onOpenSettings}
            className={`hidden md:inline-flex items-center px-2.5 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors ${buttonFocusClass}`}
            title={t('toolbar.goSettingsTitle')}
          >
            <CogIcon className='h-3.5 w-3.5 mr-1' />
            {t('toolbar.goSettings')}
          </button>
        )}
      </div>

      <div className='flex items-center gap-2'>
        {isQueuePaused && (
          <div
            className='hidden md:inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-amber-700 bg-amber-100 border border-amber-200 rounded-md dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-800'
            title={t('toolbar.queuePausedTitle')}
          >
            <PauseIcon className='h-3.5 w-3.5' />
            {t('toolbar.queuePaused')}
          </div>
        )}
        <button
          type='button'
          onClick={() => onBatchAction('start')}
          disabled={hasSelection ? false : !canStartAll}
          data-testid='batch-start'
          className={`inline-flex items-center px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm ${buttonFocusClass}`}
        >
          <PlayIcon className='h-4 w-4 mr-1.5' />
          {hasSelection ? t('toolbar.startSelected') : t('toolbar.startAll')}
        </button>

        <button
          type='button'
          onClick={() => onBatchAction('pause')}
          disabled={hasSelection ? false : !hasPausableTasks}
          data-testid='batch-pause'
          className={`inline-flex items-center px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-600 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors ${buttonFocusClass}`}
        >
          <PauseIcon className='h-4 w-4 mr-1.5' />
          {hasSelection ? t('toolbar.pauseSelected') : t('toolbar.pauseAll')}
        </button>

        {hasSelection && (
          <button
            type='button'
            onClick={() => onBatchAction('delete')}
            className={`inline-flex items-center px-3 py-1.5 text-sm font-medium text-red-600 bg-red-50 border border-red-200 rounded-md hover:bg-red-100 dark:bg-red-900/20 dark:border-red-800 dark:text-red-400 transition-colors ${buttonFocusClass}`}
          >
            <TrashIcon className='h-4 w-4 mr-1.5' />
            {t('toolbar.delete')}
          </button>
        )}

        {!hasSelection && canBulkSelectFiltered && (
          <button
            type='button'
            onClick={onSelectFiltered}
            className={`inline-flex items-center px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-600 dark:hover:bg-gray-700 transition-colors ${buttonFocusClass}`}
            title={t('toolbar.selectFilteredTitle')}
          >
            {t('toolbar.selectFiltered')}
          </button>
        )}

        {canDeleteFilteredWithoutSelection && (
          <button
            type='button'
            onClick={onDeleteFiltered}
            className={`inline-flex items-center px-3 py-1.5 text-sm font-medium text-red-600 bg-red-50 border border-red-200 rounded-md hover:bg-red-100 dark:bg-red-900/20 dark:border-red-800 dark:text-red-400 transition-colors ${buttonFocusClass}`}
            title={t('toolbar.clearFilteredTitle')}
          >
            {t('toolbar.clearFiltered')}
          </button>
        )}

        {canClearInactiveTasks && (
          <button
            type='button'
            onClick={onClearInactive}
            className={`inline-flex items-center px-3 py-1.5 text-sm font-medium text-red-600 bg-red-50 border border-red-200 rounded-md hover:bg-red-100 dark:bg-red-900/20 dark:border-red-800 dark:text-red-400 transition-colors ${buttonFocusClass}`}
            title={t('toolbar.clearInactiveTitle')}
          >
            {t('toolbar.clearInactive')}
          </button>
        )}

        <div className='h-6 w-px bg-gray-200 dark:bg-gray-700 mx-1' />

        <button
          type='button'
          onClick={onRefresh}
          className={`p-1.5 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors ${buttonFocusClass}`}
          title={t('toolbar.refresh')}
        >
          <ArrowPathIcon className='h-5 w-5' />
        </button>
      </div>
    </div>
  );
};
