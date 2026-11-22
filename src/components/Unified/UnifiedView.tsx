import React, { useCallback, useState } from 'react';
import {
  Cog6ToothIcon,
  InformationCircleIcon,
  DocumentArrowUpIcon,
  LinkIcon,
  XMarkIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  LanguageIcon,
  CommandLineIcon,
} from '@heroicons/react/24/outline';
import { FileImportPanel } from './FileImportPanel';
import { ManualInputPanel } from './ManualInputPanel';
import { DashboardToolbar } from '../Downloads/DashboardToolbar';
import { VirtualizedTaskList } from '../Optimized/VirtualizedTaskList';
import { SettingsView } from '../Settings/SettingsView';
import { useDownloadStore } from '../../stores/downloadStore';
import { useConfigStore } from '../../stores/configStore';
import { StatusBar } from './StatusBar';
import { SessionRecoveryBanner } from './SessionRecoveryBanner';
import { KeyboardShortcutsModal } from './KeyboardShortcutsModal';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts';
import { useI18n } from '../../i18n/hooks';

type TabType = 'file' | 'manual';

export const UnifiedView: React.FC = () => {
  const { t, language, changeLanguage } = useI18n();
  const [activeTab, setActiveTab] = useState<TabType>('manual');
  const [showSettings, setShowSettings] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [isInputCollapsed, setIsInputCollapsed] = useState(false);
  const hasTasks = useDownloadStore(state => state.tasks.length > 0);

  const toggleSettings = useCallback(() => setShowSettings(prev => !prev), []);

  const handleToggleLanguage = useCallback(() => {
    const nextLng = language?.toLowerCase().startsWith('en') ? 'zh' : 'en';
    const nextConfigLang = nextLng === 'en' ? 'en-US' : 'zh-CN';
    void changeLanguage(nextLng);
    if (typeof document !== 'undefined') {
      document.documentElement.lang = nextConfigLang;
    }
    const configStoreState =
      typeof useConfigStore?.getState === 'function' ? useConfigStore.getState() : undefined;
    if (configStoreState?.config?.ui && typeof configStoreState.updateConfig === 'function') {
      void configStoreState
        .updateConfig({
          ...configStoreState.config,
          ui: {
            ...configStoreState.config.ui,
            language: nextConfigLang,
          },
        })
        .catch(() => undefined);
    }
  }, [changeLanguage, language]);

  const handleFocusSearch = useCallback(() => {
    const input = document.querySelector<HTMLInputElement>('[data-testid="search-input"]');
    if (input) {
      input.focus();
      input.select();
    }
  }, []);

  const handleSelectAll = useCallback(() => {
    const storeState =
      typeof useDownloadStore?.getState === 'function' ? useDownloadStore.getState() : undefined;
    if (!storeState?.tasks || typeof storeState.setSelectedTasks !== 'function') {
      return;
    }
    storeState.setSelectedTasks(storeState.tasks.map(task => task.id));
  }, []);

  const handleTogglePauseResume = useCallback(() => {
    const storeState =
      typeof useDownloadStore?.getState === 'function' ? useDownloadStore.getState() : undefined;
    if (!storeState?.tasks) {
      return;
    }
    const hasDownloading = storeState.tasks.some(task => task.status === 'downloading');
    if (hasDownloading && typeof storeState.pauseAllDownloads === 'function') {
      void storeState.pauseAllDownloads().catch(() => undefined);
      return;
    }
    const hasStartable = storeState.tasks.some(
      task => task.status === 'pending' || task.status === 'paused' || task.status === 'failed'
    );
    if (hasStartable && typeof storeState.startAllDownloads === 'function') {
      void storeState.startAllDownloads().catch(() => undefined);
    }
  }, []);

  const handleEscape = useCallback(() => {
    if (showShortcuts) {
      setShowShortcuts(false);
      return;
    }
    if (showAbout) {
      setShowAbout(false);
      return;
    }
    if (showSettings) {
      setShowSettings(false);
      return;
    }
    const storeState =
      typeof useDownloadStore?.getState === 'function' ? useDownloadStore.getState() : undefined;
    if (storeState && typeof storeState.clearSelection === 'function') {
      storeState.clearSelection();
    }
  }, [showAbout, showSettings, showShortcuts]);

  const handleToggleShortcuts = useCallback(() => {
    setShowShortcuts(prev => !prev);
  }, []);

  useKeyboardShortcuts({
    onFocusSearch: handleFocusSearch,
    onToggleSettings: toggleSettings,
    onSelectAll: handleSelectAll,
    onTogglePauseResume: handleTogglePauseResume,
    onEscape: handleEscape,
    onToggleShortcutsModal: handleToggleShortcuts,
  });

  const isEnglish = language?.toLowerCase().startsWith('en');

  return (
    <div className='h-screen flex flex-col bg-gray-50 dark:bg-gray-900 overflow-hidden relative'>
      {/* Header Bar */}
      <header
        className='bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 h-14 flex items-center justify-between px-4 shadow-sm z-20 shrink-0'
        data-testid='app-header'
      >
        <div className='flex items-center gap-3'>
          <div className='w-8 h-8 bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg flex items-center justify-center text-white font-bold text-lg shadow-md'>
            VD
          </div>
          <h1
            className='text-lg font-bold text-gray-900 dark:text-white tracking-tight'
            data-testid='app-title'
          >
            Video Downloader <span className='text-blue-600'>Pro</span>
          </h1>
        </div>

        <div className='flex items-center gap-2'>
          <button
            type='button'
            onClick={handleToggleLanguage}
            data-testid='nav-language-toggle'
            className='inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700 transition-colors'
            title={t('header.switchLanguage')}
            aria-label={t('header.switchLanguage')}
          >
            <LanguageIcon className='w-4 h-4' />
            <span>{isEnglish ? 'EN' : '中文'}</span>
          </button>
          <button
            type='button'
            onClick={() => setShowShortcuts(true)}
            data-testid='nav-shortcuts'
            className='p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700 transition-colors'
            title={t('header.shortcuts')}
            aria-label={t('header.shortcuts')}
          >
            <CommandLineIcon className='w-5 h-5' />
          </button>
          <button
            onClick={toggleSettings}
            data-testid='nav-settings'
            className={`p-2 rounded-lg transition-all ${showSettings ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400' : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700'}`}
            title={t('header.settings')}
            aria-label={t('header.settings')}
          >
            <Cog6ToothIcon className='w-5 h-5' />
          </button>
          <button
            onClick={() => setShowAbout(true)}
            className='p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700 transition-colors'
            title={t('header.about')}
            aria-label={t('header.about')}
          >
            <InformationCircleIcon className='w-5 h-5' />
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main
        className='flex-1 flex flex-col overflow-hidden relative z-0'
        data-testid='main-content'
      >
        {/* Input Section - Collapsible */}
        <div
          className={`bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 shadow-sm shrink-0 transition-all duration-300 ease-in-out ${isInputCollapsed ? 'max-h-12' : 'max-h-[500px]'}`}
        >
          <div className='max-w-7xl mx-auto flex flex-col h-full'>
            {/* Tabs & Collapse Header */}
            <div className='flex items-center justify-between border-b border-gray-100 dark:border-gray-700 px-4 bg-gray-50/50 dark:bg-gray-800/50'>
              <div className='flex gap-1'>
                <button
                  onClick={() => {
                    setActiveTab('manual');
                    setIsInputCollapsed(false);
                  }}
                  data-testid='url-import-tab'
                  className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
                    activeTab === 'manual' && !isInputCollapsed
                      ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                      : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400'
                  }`}
                >
                  <LinkIcon className='w-4 h-4' />
                  {t('unified.addUrlsTab')}
                </button>
                <button
                  onClick={() => {
                    setActiveTab('file');
                    setIsInputCollapsed(false);
                  }}
                  data-testid='file-import-tab'
                  className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
                    activeTab === 'file' && !isInputCollapsed
                      ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                      : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400'
                  }`}
                >
                  <DocumentArrowUpIcon className='w-4 h-4' />
                  {t('unified.batchImportTab')}
                </button>
              </div>

              <button
                onClick={() => setIsInputCollapsed(!isInputCollapsed)}
                className='p-1.5 rounded-md text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors'
                title={isInputCollapsed ? t('unified.expand') : t('unified.collapse')}
              >
                {isInputCollapsed ? (
                  <ChevronDownIcon className='w-4 h-4' />
                ) : (
                  <ChevronUpIcon className='w-4 h-4' />
                )}
              </button>
            </div>

            {/* Panel Content */}
            <div
              className={`overflow-hidden transition-all duration-300 ${isInputCollapsed ? 'opacity-0 h-0' : 'opacity-100 p-6'}`}
            >
              {activeTab === 'manual' && <ManualInputPanel />}
              {activeTab === 'file' && (
                <FileImportPanel onImportSuccess={() => setIsInputCollapsed(true)} />
              )}
            </div>
          </div>
        </div>

        {/* Toolbar (Filters & Stats) */}
        <div className='shrink-0 z-10'>
          <DashboardToolbar onOpenSettings={() => setShowSettings(true)} />
        </div>

        <SessionRecoveryBanner />

        {/* Task List */}
        <div className='flex-1 overflow-hidden bg-gray-50 dark:bg-gray-900 px-4 pb-0 relative'>
          <div
            className='h-full max-w-7xl mx-auto border-x border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm overflow-hidden flex flex-col'
            data-testid='task-list'
          >
            {!hasTasks ? (
              <div className='flex-1 flex flex-col items-center justify-center text-gray-400 p-10'>
                <DocumentArrowUpIcon className='w-16 h-16 mb-4 opacity-20' />
                <p className='text-lg font-medium'>{t('unified.emptyTitle')}</p>
                <p className='text-sm opacity-70'>{t('unified.emptyHint')}</p>
              </div>
            ) : (
              <VirtualizedTaskList />
            )}
          </div>
        </div>
      </main>

      {/* Status Bar */}
      <StatusBar />

      {/* Settings Drawer (Slide-over) */}
      {/* Backdrop */}
      {showSettings && (
        <div
          className='fixed inset-0 bg-black/20 backdrop-blur-sm z-40 transition-opacity'
          onClick={() => setShowSettings(false)}
        />
      )}

      {/* Drawer */}
      <div
        className={`fixed inset-y-0 right-0 w-full max-w-md bg-white dark:bg-gray-900 shadow-2xl z-50 transform transition-transform duration-300 ease-in-out ${showSettings ? 'translate-x-0' : 'translate-x-full'}`}
        aria-hidden={!showSettings}
        data-testid='settings-drawer'
      >
        <div className='flex flex-col h-full'>
          <div className='flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700 shrink-0 bg-gray-50 dark:bg-gray-800/50'>
            <h2 className='text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2'>
              <Cog6ToothIcon className='w-5 h-5 text-gray-500' />
              {t('unified.settingsTitle')}
            </h2>
            <button
              onClick={() => setShowSettings(false)}
              className='p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full transition-colors'
            >
              <XMarkIcon className='w-5 h-5 text-gray-500' />
            </button>
          </div>
          <div className='flex-1 overflow-y-auto p-6'>{showSettings && <SettingsView />}</div>
        </div>
      </div>

      {/* Keyboard Shortcuts Modal */}
      <KeyboardShortcutsModal open={showShortcuts} onClose={() => setShowShortcuts(false)} />

      {/* About Modal */}
      {showAbout && (
        <div
          className='fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4'
          onClick={() => setShowAbout(false)}
        >
          <div
            className='bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-sm w-full p-8 text-center transform transition-all scale-100'
            onClick={e => e.stopPropagation()}
          >
            <div className='w-16 h-16 bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl flex items-center justify-center text-white font-bold text-2xl shadow-lg mx-auto mb-6'>
              VD
            </div>
            <h2 className='text-2xl font-bold text-gray-900 dark:text-white mb-2'>
              Video Downloader Pro
            </h2>
            <p className='text-gray-500 dark:text-gray-400 mb-6 font-mono text-sm'>
              v{typeof __APP_VERSION__ === 'string' && __APP_VERSION__ ? __APP_VERSION__ : '2.0.0'}
            </p>
            <p className='text-gray-600 dark:text-gray-300 mb-8 text-sm leading-relaxed'>
              {t('app.aboutDescriptionLine1')}
              <br />
              {t('app.aboutDescriptionLine2')}
            </p>
            <button
              onClick={() => setShowAbout(false)}
              className='w-full py-2.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-white rounded-xl font-medium transition-colors'
            >
              {t('unified.close')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
