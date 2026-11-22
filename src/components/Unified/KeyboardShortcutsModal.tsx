import React from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { useI18n } from '../../i18n/hooks';

interface KeyboardShortcutsModalProps {
  open: boolean;
  onClose: () => void;
}

const SHORTCUT_ITEMS = [
  { keys: 'Ctrl / Cmd + K  |  /', labelKey: 'shortcuts.search' },
  { keys: 'Ctrl / Cmd + ,', labelKey: 'shortcuts.settings' },
  { keys: 'Ctrl / Cmd + A', labelKey: 'shortcuts.selectAll' },
  { keys: 'Space', labelKey: 'shortcuts.togglePauseResume' },
  { keys: '?', labelKey: 'shortcuts.showHelp' },
  { keys: 'Esc', labelKey: 'shortcuts.closeOrClear' },
] as const;

export const KeyboardShortcutsModal: React.FC<KeyboardShortcutsModalProps> = ({
  open,
  onClose,
}) => {
  const { t } = useI18n();

  if (!open) {
    return null;
  }

  return (
    <div
      className='fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4'
      onClick={onClose}
      data-testid='keyboard-shortcuts-modal'
    >
      <div
        role='dialog'
        aria-modal='true'
        aria-label={t('shortcuts.title')}
        className='bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-md w-full p-6'
        onClick={event => event.stopPropagation()}
      >
        <div className='flex items-start justify-between mb-4'>
          <div>
            <h2 className='text-lg font-bold text-gray-900 dark:text-white'>
              {t('shortcuts.title')}
            </h2>
            <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
              {t('shortcuts.subtitle')}
            </p>
          </div>
          <button
            type='button'
            onClick={onClose}
            aria-label={t('unified.close')}
            className='p-1.5 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500'
          >
            <XMarkIcon className='w-5 h-5' />
          </button>
        </div>

        <div className='space-y-2.5'>
          {SHORTCUT_ITEMS.map(item => (
            <div
              key={item.labelKey}
              className='flex items-center justify-between gap-4 rounded-lg bg-gray-50 dark:bg-gray-900/50 px-3 py-2 text-sm'
            >
              <span className='text-gray-700 dark:text-gray-200'>{t(item.labelKey)}</span>
              <kbd className='px-2 py-0.5 text-xs font-mono bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded text-gray-800 dark:text-gray-100 shrink-0'>
                {item.keys}
              </kbd>
            </div>
          ))}
        </div>

        <button
          type='button'
          onClick={onClose}
          className='mt-5 w-full py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-white rounded-xl text-sm font-medium transition-colors'
        >
          {t('unified.close')}
        </button>
      </div>
    </div>
  );
};
