import React, { useState, useEffect } from 'react';
import {
  CheckCircleIcon,
  PlayIcon,
  XMarkIcon,
  ArrowRightIcon,
  SparklesIcon,
  InformationCircleIcon,
} from '@heroicons/react/24/outline';

interface ImportSuccessGuideProps {
  taskCount: number;
  selectedCount: number;
  onDismiss: () => void;
  onStartDownload: () => void;
}

export const ImportSuccessGuide: React.FC<ImportSuccessGuideProps> = ({
  taskCount,
  selectedCount,
  onDismiss,
  onStartDownload,
}) => {
  const [isVisible, setIsVisible] = useState(true);
  const [step, setStep] = useState(1);

  useEffect(() => {
    // 自动进入步骤2（突出开始按钮）
    const timer = setTimeout(() => {
      setStep(2);
    }, 2000);
    return () => clearTimeout(timer);
  }, []);

  if (!isVisible) return null;

  const handleStartAndDismiss = () => {
    onStartDownload();
    setIsVisible(false);
    onDismiss();
  };

  const handleDismiss = () => {
    setIsVisible(false);
    onDismiss();
  };

  return (
    <>
      {/* 背景遮罩 */}
      <div className='fixed inset-0 bg-black bg-opacity-30 backdrop-blur-sm z-40' />

      {/* 引导卡片 */}
      <div className='fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-lg mx-4'>
        <div className='bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden'>
          {/* 头部 */}
          <div className='bg-gradient-to-r from-green-500 to-blue-600 p-6 text-white relative'>
            <div className='flex items-center justify-between'>
              <div className='flex items-center'>
                <div className='bg-white bg-opacity-20 rounded-full p-2 mr-3'>
                  <CheckCircleIcon className='w-6 h-6' />
                </div>
                <div>
                  <h3 className='text-xl font-bold'>导入成功！</h3>
                  <p className='text-green-100 text-sm'>已成功导入 {taskCount} 个视频任务</p>
                </div>
              </div>
              <button
                onClick={handleDismiss}
                className='text-white hover:text-gray-200 p-1 rounded-full hover:bg-white hover:bg-opacity-10 transition-colors'
              >
                <XMarkIcon className='w-5 h-5' />
              </button>
            </div>

            {/* 动画装饰 */}
            <div className='absolute top-0 right-0 opacity-10'>
              <SparklesIcon className='w-24 h-24 text-white animate-pulse' />
            </div>
          </div>

          {/* 主要内容 */}
          <div className='p-6'>
            {step === 1 ? (
              // 步骤1：确认导入成功
              <div className='text-center space-y-4'>
                <div className='bg-green-50 dark:bg-green-900/20 rounded-lg p-4 border border-green-200 dark:border-green-800'>
                  <div className='flex items-center justify-center mb-2'>
                    <CheckCircleIcon className='w-8 h-8 text-green-600 dark:text-green-400' />
                  </div>
                  <h4 className='font-semibold text-green-800 dark:text-green-200 mb-1'>
                    文件解析完成
                  </h4>
                  <p className='text-sm text-green-700 dark:text-green-300'>
                    所有 {taskCount} 个任务已成功添加到下载列表
                    <br />
                    {selectedCount > 0 && `已自动选择 ${selectedCount} 个任务`}
                  </p>
                </div>

                <div className='flex items-center justify-center text-gray-600 dark:text-gray-400'>
                  <div className='flex items-center'>
                    <div className='w-2 h-2 bg-blue-500 rounded-full animate-pulse'></div>
                    <div className='w-2 h-2 bg-blue-300 rounded-full ml-1'></div>
                    <div className='w-2 h-2 bg-blue-200 rounded-full ml-1'></div>
                    <span className='ml-3 text-sm'>准备开始下载...</span>
                  </div>
                </div>
              </div>
            ) : (
              // 步骤2：指导下一步操作
              <div className='space-y-4'>
                <div className='text-center'>
                  <div className='bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 border border-blue-200 dark:border-blue-800 mb-4'>
                    <div className='flex items-center justify-center mb-2'>
                      <InformationCircleIcon className='w-6 h-6 text-blue-600 dark:text-blue-400' />
                    </div>
                    <h4 className='font-semibold text-blue-800 dark:text-blue-200 mb-2'>
                      接下来该做什么？
                    </h4>
                    <p className='text-sm text-blue-700 dark:text-blue-300'>
                      点击下面的按钮开始下载所有选中的视频任务
                    </p>
                  </div>
                </div>

                {/* 主要行动按钮 */}
                <div className='space-y-3'>
                  <button
                    onClick={handleStartAndDismiss}
                    className='w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white font-semibold py-4 px-6 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105 flex items-center justify-center group'
                  >
                    <PlayIcon className='w-5 h-5 mr-2 group-hover:scale-110 transition-transform' />
                    <span className='text-lg'>开始下载 ({selectedCount} 个任务)</span>
                    <ArrowRightIcon className='w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform' />
                  </button>

                  <div className='text-center'>
                    <button
                      onClick={handleDismiss}
                      className='text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 text-sm underline hover:no-underline transition-colors'
                    >
                      稍后手动开始
                    </button>
                  </div>
                </div>

                {/* 提示信息 */}
                <div className='bg-gray-50 dark:bg-gray-700 rounded-lg p-3 border border-gray-200 dark:border-gray-600'>
                  <p className='text-xs text-gray-600 dark:text-gray-300 text-center'>
                    💡 提示：您也可以在任务列表中手动选择特定任务，然后点击"开始选中任务"按钮
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
};
