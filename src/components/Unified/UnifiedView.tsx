import React, { useState } from 'react';
import {
  Cog6ToothIcon,
  InformationCircleIcon,
  DocumentArrowUpIcon,
  LinkIcon,
  XMarkIcon,
  ChevronUpIcon,
  ChevronDownIcon,
} from '@heroicons/react/24/outline';
import { FileImportPanel } from './FileImportPanel';
import { ManualInputPanel } from './ManualInputPanel';
import { DashboardToolbar } from '../Downloads/DashboardToolbar';
import { VirtualizedTaskList } from '../Optimized/VirtualizedTaskList';
import { SettingsView } from '../Settings/SettingsView';
import { useDownloadStore } from '../../stores/downloadStore';
import { StatusBar } from './StatusBar';

type TabType = 'file' | 'manual';

export const UnifiedView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabType>('manual');
  const [showSettings, setShowSettings] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [isInputCollapsed, setIsInputCollapsed] = useState(false);
  const tasks = useDownloadStore(state => state.tasks);

  const toggleSettings = () => setShowSettings(!showSettings);

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
            onClick={toggleSettings}
            data-testid='nav-settings'
            className={`p-2 rounded-lg transition-all ${showSettings ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400' : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700'}`}
            title='设置'
          >
            <Cog6ToothIcon className='w-5 h-5' />
          </button>
          <button
            onClick={() => setShowAbout(true)}
            className='p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700 transition-colors'
            title='关于'
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
                  添加链接
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
                  批量导入
                </button>
              </div>

              <button
                onClick={() => setIsInputCollapsed(!isInputCollapsed)}
                className='p-1.5 rounded-md text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors'
                title={isInputCollapsed ? '展开' : '收起'}
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
          <DashboardToolbar />
        </div>

        {/* Task List */}
        <div className='flex-1 overflow-hidden bg-gray-50 dark:bg-gray-900 px-4 pb-0 relative'>
          <div
            className='h-full max-w-7xl mx-auto border-x border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm overflow-hidden flex flex-col'
            data-testid='task-list'
          >
            {tasks.length === 0 ? (
              <div className='flex-1 flex flex-col items-center justify-center text-gray-400 p-10'>
                <DocumentArrowUpIcon className='w-16 h-16 mb-4 opacity-20' />
                <p className='text-lg font-medium'>暂无下载任务</p>
                <p className='text-sm opacity-70'>请在上方添加链接或导入文件</p>
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
        data-testid='settings-drawer'
      >
        <div className='flex flex-col h-full'>
          <div className='flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700 shrink-0 bg-gray-50 dark:bg-gray-800/50'>
            <h2 className='text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2'>
              <Cog6ToothIcon className='w-5 h-5 text-gray-500' />
              设置
            </h2>
            <button
              onClick={() => setShowSettings(false)}
              className='p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full transition-colors'
            >
              <XMarkIcon className='w-5 h-5 text-gray-500' />
            </button>
          </div>
          <div className='flex-1 overflow-y-auto p-6'>
            <SettingsView />
          </div>
        </div>
      </div>

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
            <p className='text-gray-500 dark:text-gray-400 mb-6 font-mono text-sm'>v1.0.0</p>
            <p className='text-gray-600 dark:text-gray-300 mb-8 text-sm leading-relaxed'>
              专业的批量视频下载工具
              <br />
              支持多线程下载、自动嗅探和断点续传
            </p>
            <button
              onClick={() => setShowAbout(false)}
              className='w-full py-2.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-white rounded-xl font-medium transition-colors'
            >
              关闭
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
