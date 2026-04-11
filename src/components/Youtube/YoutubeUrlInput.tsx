import React, { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  PlayIcon,
  ArrowDownTrayIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline';
import { notify } from '../../stores/uiStore';
import { useDownloadStore } from '../../stores/downloadStore';
import type { YoutubeVideoInfo, VideoTask } from '../../types';

interface YoutubeUrlInputProps {}

export const YoutubeUrlInput: React.FC<YoutubeUrlInputProps> = () => {
  const [url, setUrl] = useState<string>('');
  const [videoInfo, setVideoInfo] = useState<YoutubeVideoInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [outputDir, setOutputDir] = useState<string>('');
  const addTasks = useDownloadStore(state => state.addTasks);
  const startDownload = useDownloadStore(state => state.startDownload);

  // 获取视频信息
  const handleGetVideoInfo = async () => {
    if (!url.trim()) {
      notify.error('请输入YouTube视频URL', 'URL不能为空');
      return;
    }

    setIsLoading(true);
    try {
      console.log('🔍 Getting video info for:', url);
      const info = await invoke<YoutubeVideoInfo>('get_youtube_info', { url: url.trim() });
      console.log('✅ Video info retrieved:', info);
      setVideoInfo(info);
      notify.success('视频信息获取成功', `标题: ${info.title}`);
    } catch (error) {
      console.error('❌ Failed to get video info:', error);
      notify.error('获取视频信息失败', error as string);
      setVideoInfo(null);
    } finally {
      setIsLoading(false);
    }
  };

  // 选择输出目录
  const handleSelectOutputDir = async () => {
    try {
      const selected = await invoke<string | null>('select_output_directory');
      if (selected) {
        setOutputDir(selected);
        console.log('📁 Output directory selected:', selected);
      }
    } catch (error) {
      console.error('❌ Failed to select output directory:', error);
      notify.error('选择目录失败', error as string);
    }
  };

  // 开始下载
  const handleStartDownload = async () => {
    if (!videoInfo) {
      notify.error('请先获取视频信息', '');
      return;
    }

    if (!outputDir) {
      notify.error('请选择输出目录', '');
      return;
    }

    try {
      console.log('🚀 Starting YouTube download...');

      // 创建下载任务 - 符合类型安全要求
      const task: VideoTask = {
        id: `youtube_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        url: url.trim(),
        title: videoInfo.title,
        output_path: outputDir,
        status: 'pending',
        progress: 0,
        downloaded_size: 0,
        file_size: undefined,
        speed: 0,
        eta: undefined,
        error_message: undefined,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        downloader_type: 'youtube',

        // 额外的视频信息
        video_info: {
          zl_id: videoInfo.id,
          zl_name: 'YouTube',
          record_url: url.trim(),
          kc_id: videoInfo.id,
          kc_name: videoInfo.title,
        },
      };

      // 添加到任务列表
      const [addedTask] = await addTasks([task]);
      const resolvedTask = addedTask ?? task;

      const result = await startDownload(resolvedTask.id);

      console.log('✅ YouTube download started');
      notify.success(
        result === 'queued' ? '任务已排队' : 'YouTube下载已开始',
        `正在处理: ${videoInfo.title}`
      );

      // 清空表单
      setUrl('');
      setVideoInfo(null);
    } catch (error) {
      console.error('❌ Failed to start YouTube download:', error);
      notify.error('启动下载失败', error as string);
    }
  };

  // 清空表单
  const handleClear = () => {
    setUrl('');
    setVideoInfo(null);
    setOutputDir('');
  };

  return (
    <div className='space-y-6'>
      {/* YouTube URL 输入 */}
      <div className='bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6'>
        <div className='flex items-center mb-4'>
          <PlayIcon className='w-6 h-6 text-red-500 mr-3' />
          <h3 className='text-lg font-semibold text-gray-900 dark:text-gray-100'>
            YouTube 视频下载
          </h3>
        </div>

        <div className='space-y-4'>
          {/* URL 输入框 */}
          <div>
            <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
              YouTube 视频链接
            </label>
            <div className='flex gap-3'>
              <input
                type='url'
                value={url}
                onChange={e => setUrl(e.target.value)}
                placeholder='https://www.youtube.com/watch?v=...'
                className='flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg 
                         bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 
                         focus:ring-2 focus:ring-blue-500 focus:border-transparent
                         placeholder-gray-400 dark:placeholder-gray-500'
                disabled={isLoading}
                onKeyPress={e => {
                  if (e.key === 'Enter' && !isLoading) {
                    handleGetVideoInfo();
                  }
                }}
              />
              <button
                onClick={handleGetVideoInfo}
                disabled={isLoading || !url.trim()}
                className='px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 
                         text-white rounded-lg font-medium transition-colors
                         flex items-center gap-2 min-w-[120px] justify-center'
              >
                {isLoading ? (
                  <>
                    <ArrowPathIcon className='w-4 h-4 animate-spin' />
                    获取中...
                  </>
                ) : (
                  <>
                    <PlayIcon className='w-4 h-4' />
                    获取信息
                  </>
                )}
              </button>
            </div>
          </div>

          {/* 输出目录选择 */}
          <div>
            <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
              保存目录
            </label>
            <div className='flex gap-3'>
              <input
                type='text'
                value={outputDir}
                readOnly
                placeholder='点击选择保存目录...'
                className='flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg 
                         bg-gray-50 dark:bg-gray-600 text-gray-900 dark:text-gray-100 
                         placeholder-gray-400 dark:placeholder-gray-500 cursor-pointer'
                onClick={handleSelectOutputDir}
              />
              <button
                onClick={handleSelectOutputDir}
                className='px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg 
                         font-medium transition-colors flex items-center gap-2'
              >
                选择目录
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 视频信息显示 */}
      {videoInfo && (
        <div className='bg-green-50 dark:bg-green-900/20 rounded-xl border border-green-200 dark:border-green-800 p-6'>
          <div className='flex items-center mb-4'>
            <CheckCircleIcon className='w-6 h-6 text-green-600 dark:text-green-400 mr-3' />
            <h4 className='text-lg font-semibold text-green-800 dark:text-green-200'>视频信息</h4>
          </div>

          <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
            <div>
              <p className='text-sm font-medium text-green-700 dark:text-green-300 mb-1'>
                视频标题
              </p>
              <p className='text-green-900 dark:text-green-100 break-words'>{videoInfo.title}</p>
            </div>

            <div>
              <p className='text-sm font-medium text-green-700 dark:text-green-300 mb-1'>视频ID</p>
              <p className='text-green-900 dark:text-green-100 font-mono text-sm'>{videoInfo.id}</p>
            </div>

            <div>
              <p className='text-sm font-medium text-green-700 dark:text-green-300 mb-1'>时长</p>
              <p className='text-green-900 dark:text-green-100'>
                {Math.floor(videoInfo.duration / 60)}:
                {(videoInfo.duration % 60).toString().padStart(2, '0')}
              </p>
            </div>

            <div>
              <p className='text-sm font-medium text-green-700 dark:text-green-300 mb-1'>
                可用格式
              </p>
              <p className='text-green-900 dark:text-green-100'>
                {videoInfo.formats?.length || 0} 个格式可用
              </p>
            </div>
          </div>

          {videoInfo.description && (
            <div className='mt-4'>
              <p className='text-sm font-medium text-green-700 dark:text-green-300 mb-2'>
                视频描述
              </p>
              <p className='text-green-900 dark:text-green-100 text-sm line-clamp-3 bg-green-100 dark:bg-green-800/30 p-3 rounded-lg'>
                {videoInfo.description}
              </p>
            </div>
          )}

          {/* 下载操作 */}
          <div className='flex gap-3 mt-6'>
            <button
              onClick={handleStartDownload}
              disabled={!outputDir}
              className='px-6 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 
                       text-white rounded-lg font-medium transition-colors
                       flex items-center gap-2'
            >
              <ArrowDownTrayIcon className='w-4 h-4' />
              开始下载
            </button>

            <button
              onClick={handleClear}
              className='px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg 
                       font-medium transition-colors'
            >
              清空
            </button>
          </div>
        </div>
      )}

      {/* 使用说明 */}
      <div className='bg-blue-50 dark:bg-blue-900/20 rounded-xl border border-blue-200 dark:border-blue-800 p-4'>
        <div className='flex items-start'>
          <ExclamationTriangleIcon className='w-5 h-5 text-blue-600 dark:text-blue-400 mr-3 mt-0.5' />
          <div>
            <h5 className='text-sm font-semibold text-blue-800 dark:text-blue-200 mb-1'>
              使用说明
            </h5>
            <ul className='text-sm text-blue-700 dark:text-blue-300 space-y-1'>
              <li>• 支持标准的YouTube视频链接格式</li>
              <li>• 首先点击"获取信息"来验证视频链接有效性</li>
              <li>• 选择保存目录后点击"开始下载"</li>
              <li>• 下载任务将显示在下载管理页面</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};
