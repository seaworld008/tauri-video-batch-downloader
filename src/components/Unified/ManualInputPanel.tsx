import React, { useState } from 'react';
import {
  PlusIcon,
  LinkIcon,
  ClipboardDocumentListIcon,
  XMarkIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  ArrowPathIcon,
  FolderOpenIcon,
  ArrowDownTrayIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline';
import { useDownloadStore } from '../../stores/downloadStore';
import { useConfigStore } from '../../stores/configStore';
import { notify } from '../../stores/uiStore';
import {
  getVideoInfoCommand,
  readClipboardTextCommand,
  selectOutputDirectoryCommand,
} from '../../features/downloads/api/systemCommands';
import type { DownloaderType, ExternalVideoInfo, SourcePlatform, VideoTask } from '../../types';

interface ManualUrlEntry {
  id: string;
  url: string;
  title?: string;
  platform?: SourcePlatform;
  externalInfo?: ExternalVideoInfo;
  isValid?: boolean;
  isProcessing?: boolean;
  error?: string;
}

const detectSourcePlatform = (url: string): SourcePlatform => {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.includes('youtube.com') || host === 'youtu.be' || host.endsWith('.youtu.be')) {
      return 'youtube';
    }
    if (host.includes('tiktok.com')) return 'tiktok';
    if (host.includes('instagram.com')) return 'instagram';
    if (host.includes('facebook.com') || host.includes('fb.watch') || host.includes('fb.com')) {
      return 'facebook';
    }
  } catch {
    return 'generic';
  }
  return 'generic';
};

const isM3u8Url = (url: string) => {
  const lower = url.toLowerCase();
  return lower.includes('.m3u8') || lower.includes('m3u8');
};

const isDirectMediaUrl = (url: string) => {
  try {
    const path = new URL(url).pathname.toLowerCase();
    return [
      '.mp4',
      '.m4v',
      '.mov',
      '.mkv',
      '.webm',
      '.avi',
      '.flv',
      '.wmv',
      '.mp3',
      '.m4a',
      '.aac',
      '.wav',
      '.ogg',
    ].some(ext => path.endsWith(ext));
  } catch {
    return false;
  }
};

const inferDownloaderType = (url: string): DownloaderType => {
  if (isM3u8Url(url)) return 'm3u8';
  if (detectSourcePlatform(url) !== 'generic') return 'ytdlp';
  return isDirectMediaUrl(url) ? 'http' : 'ytdlp';
};

const platformLabel = (platform?: SourcePlatform) => {
  switch (platform) {
    case 'youtube':
      return 'YouTube';
    case 'tiktok':
      return 'TikTok';
    case 'instagram':
      return 'Instagram';
    case 'facebook':
      return 'Facebook';
    case 'generic':
      return '网页';
    default:
      return undefined;
  }
};

export const ManualInputPanel: React.FC = () => {
  const [manualUrls, setManualUrls] = useState<ManualUrlEntry[]>([]);
  const [newUrlInput, setNewUrlInput] = useState('');
  const [outputDir, setOutputDir] = useState<string>('');
  const [isValidatingUrls, setIsValidatingUrls] = useState(false);

  const addTasks = useDownloadStore(state => state.addTasks);
  const enqueueDownloads = useDownloadStore(state => state.enqueueDownloads);
  const recordRecentImport = useDownloadStore(state => state.recordRecentImport);
  const setFilterStatus = useDownloadStore(state => state.setFilterStatus);
  const setSearchQuery = useDownloadStore(state => state.setSearchQuery);
  const defaultOutputDirFromConfig = useConfigStore(
    state => state.config.download.output_directory
  );

  const addNewUrlEntry = () => {
    if (newUrlInput.trim()) {
      const newEntry: ManualUrlEntry = {
        id: Date.now().toString(),
        url: newUrlInput.trim(),
        isValid: undefined,
        isProcessing: false,
      };
      setManualUrls([...manualUrls, newEntry]);
      setNewUrlInput('');
    }
  };

  const addFromClipboard = async () => {
    try {
      const clipboardText = await readClipboardTextCommand();
      const urls = clipboardText
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && /^https?:\/\//.test(line));

      if (urls.length === 0) {
        notify.error('剪贴板中没有找到有效的URL', '');
        return;
      }

      const newEntries: ManualUrlEntry[] = urls.map(url => ({
        id: `clipboard_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        url,
        isValid: undefined,
        isProcessing: false,
      }));

      setManualUrls([...manualUrls, ...newEntries]);
      notify.success('添加成功', `从剪贴板添加了 ${urls.length} 个链接`);
    } catch (error) {
      notify.error('读取剪贴板失败', '请检查系统剪贴板是否可用');
    }
  };

  const removeUrlEntry = (id: string) => {
    setManualUrls(manualUrls.filter(entry => entry.id !== id));
  };

  const updateUrlEntry = (id: string, updates: Partial<ManualUrlEntry>) => {
    setManualUrls(manualUrls.map(entry => (entry.id === id ? { ...entry, ...updates } : entry)));
  };

  const validateUrls = async () => {
    if (manualUrls.length === 0) return;

    setIsValidatingUrls(true);

    for (const entry of manualUrls) {
      updateUrlEntry(entry.id, { isProcessing: true });

      try {
        const isValidUrl = /^https?:\/\//.test(entry.url);
        let title = entry.url;
        let platform = detectSourcePlatform(entry.url);
        let externalInfo: ExternalVideoInfo | undefined;

        if (isValidUrl) {
          try {
            const videoInfo = await getVideoInfoCommand<any>({ url: entry.url });
            title = (videoInfo as any).title || entry.url;
            externalInfo = (videoInfo as any).external_info;
            platform = externalInfo?.source_platform ?? platform;
          } catch {
            if (inferDownloaderType(entry.url) === 'ytdlp') {
              throw new Error('公开内容探测失败，请确认链接可公开访问且 yt-dlp 可用');
            }
          }
        }

        updateUrlEntry(entry.id, {
          isValid: isValidUrl,
          title: title,
          platform,
          externalInfo,
          isProcessing: false,
          error: isValidUrl ? undefined : '无效的URL格式',
        });
      } catch (error) {
        updateUrlEntry(entry.id, {
          isValid: false,
          isProcessing: false,
          error: '验证失败',
        });
      }
    }

    setIsValidatingUrls(false);
  };

  const handleSelectOutputDir = async () => {
    try {
      const selected = await selectOutputDirectoryCommand();

      if (selected) {
        setOutputDir(selected);
      }
    } catch (error) {
      notify.error('选择目录失败', error as string);
    }
  };

  const startDownload = async () => {
    const validUrls = manualUrls.filter(entry => entry.isValid !== false); // Allow undefined (not validated yet)
    if (validUrls.length === 0) {
      notify.error('没有有效的URL', '请先添加URL');
      return;
    }

    const targetDir = outputDir || defaultOutputDirFromConfig || './downloads';

    try {
      const videoTasks: VideoTask[] = validUrls.map((entry, index) => ({
        id: `manual_${Date.now()}_${index}_${Math.random().toString(36).substr(2, 9)}`,
        url: entry.url,
        title: entry.title || `任务_${index + 1}`,
        output_path: targetDir,
        status: 'pending' as const,
        progress: 0,
        downloaded_size: 0,
        speed: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        downloader_type: inferDownloaderType(entry.url),
        video_info: {
          zl_id: entry.id,
          zl_name: '手动添加',
          record_url: entry.url,
          kc_id: entry.id,
          kc_name: entry.title || '手动添加下载',
        },
        external_info: entry.externalInfo ?? {
          source_platform: entry.platform ?? detectSourcePlatform(entry.url),
          webpage_url: entry.url,
          title: entry.title,
          requires_auth: false,
        },
      }));

      const addedTasks = await addTasks(videoTasks);
      const resolvedTasks = addedTasks.length > 0 ? addedTasks : videoTasks;

      // Update recent imports for list highlighting
      recordRecentImport(
        resolvedTasks.map(t => t.id),
        resolvedTasks
      );

      setFilterStatus('all');
      setSearchQuery('');

      // Enqueue
      enqueueDownloads(resolvedTasks.map(task => task.id));

      notify.success('任务已添加', `成功添加 ${resolvedTasks.length} 个任务到队列`);
      setManualUrls([]);
    } catch (error) {
      notify.error('启动下载失败', String(error));
    }
  };

  return (
    <div className='space-y-6 max-w-4xl mx-auto animate-fadeIn'>
      <div className='flex gap-3'>
        <div className='flex-1 relative'>
          <div className='absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none'>
            <LinkIcon className='h-5 w-5 text-gray-400' />
          </div>
          <input
            type='url'
            value={newUrlInput}
            onChange={e => setNewUrlInput(e.target.value)}
            onKeyPress={e => e.key === 'Enter' && addNewUrlEntry()}
            placeholder='输入视频链接 (HTTP/HTTPS/Bilibili...)'
            data-testid='url-input'
            className='block w-full pl-10 pr-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg leading-5 bg-white dark:bg-gray-700 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:text-sm transition-all shadow-sm'
          />
        </div>
        <button
          onClick={addNewUrlEntry}
          disabled={!newUrlInput.trim()}
          data-testid='add-url'
          className='px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded-lg font-medium transition-colors flex items-center shadow-sm'
        >
          <PlusIcon className='w-5 h-5' />
          <span className='ml-2 hidden sm:inline'>添加</span>
        </button>
        <button
          onClick={addFromClipboard}
          className='px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-lg font-medium transition-colors flex items-center shadow-sm'
          title='从剪贴板粘贴'
        >
          <ClipboardDocumentListIcon className='w-5 h-5' />
        </button>
      </div>

      {manualUrls.length > 0 && (
        <div className='bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-200 dark:border-gray-700 p-4'>
          <div className='flex items-center justify-between mb-3 px-1'>
            <span className='text-sm font-medium text-gray-500 dark:text-gray-400'>
              待添加列表 ({manualUrls.length})
            </span>
            <div className='flex gap-2'>
              <button
                onClick={validateUrls}
                disabled={isValidatingUrls}
                className='text-xs flex items-center text-blue-600 hover:text-blue-700'
              >
                {isValidatingUrls ? (
                  <ArrowPathIcon className='w-3 h-3 mr-1 animate-spin' />
                ) : (
                  <SparklesIcon className='w-3 h-3 mr-1' />
                )}
                验证链接
              </button>
              <button
                onClick={() => setManualUrls([])}
                className='text-xs text-red-500 hover:text-red-600'
              >
                清空
              </button>
            </div>
          </div>

          <div
            className='space-y-2 max-h-60 overflow-y-auto custom-scrollbar pr-1'
            data-testid='url-list'
          >
            {manualUrls.map((entry, index) => (
              <div
                key={entry.id}
                className='flex items-center gap-3 bg-white dark:bg-gray-800 p-3 rounded-lg border border-gray-100 dark:border-gray-700 shadow-sm'
                data-testid='url-entry'
              >
                <span className='text-xs text-gray-400 w-6 text-center'>{index + 1}</span>
                <div className='flex-1 min-w-0'>
                  <div className='text-sm font-medium text-gray-900 dark:text-gray-100 truncate'>
                    {entry.title || entry.url}
                  </div>
                  {entry.title && entry.title !== entry.url && (
                    <div className='text-xs text-gray-500 truncate'>{entry.url}</div>
                  )}
                  {entry.platform && (
                    <div className='text-xs text-gray-500 mt-0.5'>
                      {platformLabel(entry.platform)} ·{' '}
                      {inferDownloaderType(entry.url) === 'ytdlp' ? 'yt-dlp' : '原生下载器'}
                    </div>
                  )}
                  {entry.error && <div className='text-xs text-red-500 mt-0.5'>{entry.error}</div>}
                </div>
                <div className='flex items-center gap-2'>
                  {entry.isProcessing && (
                    <ArrowPathIcon className='w-4 h-4 text-blue-500 animate-spin' />
                  )}
                  {entry.isValid === true && <CheckCircleIcon className='w-4 h-4 text-green-500' />}
                  {entry.isValid === false && (
                    <ExclamationTriangleIcon className='w-4 h-4 text-red-500' />
                  )}
                  <button
                    onClick={() => removeUrlEntry(entry.id)}
                    className='text-gray-400 hover:text-red-500'
                  >
                    <XMarkIcon className='w-4 h-4' />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className='mt-4 pt-4 border-t border-gray-200 dark:border-gray-700 flex flex-col sm:flex-row gap-3 items-center'>
            <div className='flex-1 w-full relative'>
              <FolderOpenIcon className='w-5 h-5 text-gray-400 absolute left-3 top-2.5' />
              <input
                type='text'
                value={outputDir || defaultOutputDirFromConfig || './downloads'}
                readOnly
                onClick={handleSelectOutputDir}
                className='w-full pl-10 pr-4 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-600 cursor-pointer'
              />
            </div>
            <button
              onClick={startDownload}
              data-testid='confirm-import'
              className='w-full sm:w-auto px-6 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium shadow-sm transition-colors flex items-center justify-center'
            >
              <ArrowDownTrayIcon className='w-5 h-5 mr-2' />
              立即下载
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
