import React from 'react';
import { ArrowPathIcon, WrenchScrewdriverIcon } from '@heroicons/react/24/outline';
import type {
  ExternalToolId,
  ExternalToolStatus,
} from '../../features/downloads/api/systemCommands';
import { useI18n } from '../../i18n/hooks';

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

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

const statusLabel = (status: ExternalToolStatus['status'], t: TranslateFn) => {
  switch (status) {
    case 'available':
      return t('settings.externalTools.statusAvailable');
    case 'missing':
      return t('settings.externalTools.statusMissing');
    case 'failed':
      return t('settings.externalTools.statusFailed');
    case 'version_unsupported':
      return t('settings.externalTools.statusUnsupported');
    default:
      return status;
  }
};

const sourceLabel = (source: ExternalToolStatus['source'] | undefined, t: TranslateFn) => {
  switch (source) {
    case 'user_override':
      return t('settings.externalTools.sourceOverride');
    case 'managed':
      return t('settings.externalTools.sourceManaged');
    case 'bundled_sidecar':
      return t('settings.externalTools.sourceBundled');
    case 'path_fallback':
      return t('settings.externalTools.sourcePath');
    default:
      return t('settings.externalTools.sourceUnknown');
  }
};

const toolGuidance = (tool: ExternalToolStatus, t: TranslateFn) => {
  if (tool.status === 'version_unsupported') {
    return t('settings.externalTools.guidanceUnsupported');
  }

  if (tool.id === 'yt-dlp') {
    if (tool.update_available) {
      return t('settings.externalTools.guidanceYtdlpUpdateAvailable');
    }
    return t('settings.externalTools.guidanceYtdlpDefault');
  }

  if (tool.id === 'ffmpeg') {
    return t('settings.externalTools.guidanceFfmpeg');
  }

  return null;
};

const overrideButtonLabel = (tool: ExternalToolStatus, t: TranslateFn) =>
  tool.id === 'ffmpeg'
    ? t('settings.externalTools.selectNewBinary')
    : t('settings.externalTools.selectLocalBinary');

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
}) => {
  const { t } = useI18n();

  return (
    <div className='bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6'>
      <div className='flex items-center justify-between gap-3 mb-5'>
        <div className='flex items-center min-w-0'>
          <WrenchScrewdriverIcon className='w-6 h-6 text-sky-600 dark:text-sky-400 mr-3 shrink-0' />
          <h2 className='text-xl font-semibold text-gray-900 dark:text-gray-100'>
            {t('settings.externalTools.title')}
          </h2>
        </div>
        <div className='flex gap-2 shrink-0'>
          <button
            type='button'
            onClick={onRefresh}
            disabled={isLoading}
            className={`inline-flex items-center px-3 py-2 text-sm bg-gray-600 text-white rounded-md hover:bg-gray-700 disabled:opacity-60 ${buttonFocusClass}`}
          >
            <ArrowPathIcon className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            {t('settings.externalTools.refresh')}
          </button>
          <button
            type='button'
            onClick={onCheckUpdates}
            disabled={isLoading}
            className={`inline-flex items-center px-3 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-60 ${buttonFocusClass}`}
          >
            {t('settings.externalTools.checkUpdates')}
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
                      {statusLabel(tool.status, t)}
                    </span>
                    {tool.update_available && (
                      <span className='text-xs px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-200'>
                        {t('settings.externalTools.updateAvailableBadge')}
                      </span>
                    )}
                  </div>
                  <div className='mt-1 text-xs text-gray-500 dark:text-gray-400 break-all'>
                    {sourceLabel(tool.source, t)} ·{' '}
                    {tool.path || t('settings.externalTools.pathMissing')}
                  </div>
                </div>
                <div className='text-right text-xs text-gray-500 dark:text-gray-400 shrink-0'>
                  <div>{tool.current_version || t('settings.externalTools.unknownVersion')}</div>
                  {tool.latest_version && (
                    <div>
                      {t('settings.externalTools.latestVersion', {
                        version: tool.latest_version,
                      })}
                    </div>
                  )}
                </div>
              </div>

              {tool.last_error && (
                <div className='text-xs text-red-600 dark:text-red-300 break-words'>
                  {tool.last_error}
                </div>
              )}

              {toolGuidance(tool, t) && (
                <div className='text-xs text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md px-3 py-2'>
                  {toolGuidance(tool, t)}
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
                    {isUpdating === tool.id
                      ? t('settings.externalTools.updating')
                      : t('settings.externalTools.updateToLatest')}
                  </button>
                )}
                {tool.can_rollback && tool.source !== 'user_override' && (
                  <button
                    type='button'
                    onClick={() => onRollback(tool.id)}
                    disabled={isUpdating === tool.id}
                    className={`px-3 py-1.5 text-xs bg-amber-600 text-white rounded-md hover:bg-amber-700 disabled:opacity-60 ${buttonFocusClass}`}
                  >
                    {t('settings.externalTools.rollback')}
                  </button>
                )}
                <button
                  type='button'
                  onClick={() => onSelectOverride(tool.id)}
                  className={`px-3 py-1.5 text-xs bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 ${buttonFocusClass}`}
                >
                  {overrideButtonLabel(tool, t)}
                </button>
                {tool.source === 'user_override' && (
                  <button
                    type='button'
                    onClick={() => onClearOverride(tool.id)}
                    className={`px-3 py-1.5 text-xs border border-gray-300 dark:border-gray-600 rounded-md text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 ${buttonFocusClass}`}
                  >
                    {t('settings.externalTools.clearOverride')}
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
