import React from 'react';
import {
  DocumentArrowUpIcon,
  PlayIcon,
  ClockIcon,
  CheckCircleIcon,
  InformationCircleIcon,
  LightBulbIcon,
} from '@heroicons/react/24/outline';

interface WorkflowTipsProps {
  stage: 'empty' | 'imported' | 'downloading' | 'completed';
  taskCount?: number;
  downloadingCount?: number;
  completedCount?: number;
  onAction?: () => void;
  actionLabel?: string;
}

export const WorkflowTips: React.FC<WorkflowTipsProps> = ({
  stage,
  taskCount = 0,
  downloadingCount = 0,
  completedCount = 0,
  onAction,
  actionLabel,
}) => {
  const getTipContent = () => {
    switch (stage) {
      case 'empty':
        return {
          icon: DocumentArrowUpIcon,
          iconColor: 'text-blue-500',
          bgColor: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800',
          title: '开始批量下载视频',
          description: '导入包含视频链接的 CSV 或 Excel 文件，快速创建下载任务',
          steps: [
            '📄 准备包含视频链接的 CSV/Excel 文件',
            '📁 点击"选择文件"按钮导入数据',
            '👀 预览和确认导入的视频信息',
            '🚀 开始批量下载所有视频',
          ],
          tip: '💡 支持 UTF-8、GBK、GB2312 等多种编码格式',
        };

      case 'imported':
        return {
          icon: PlayIcon,
          iconColor: 'text-green-500',
          bgColor: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800',
          title: '任务导入成功！',
          description: `已成功导入 ${taskCount} 个视频任务，现在可以开始下载了`,
          steps: [
            '✅ 检查导入的任务列表和信息',
            '🔍 可以使用搜索和筛选功能管理任务',
            '☑️ 选择要下载的特定任务（可选）',
            '⚡ 点击"开始选中任务"按钮开始下载',
          ],
          tip: '🎯 点击上方醒目的开始按钮立即开始下载所有任务',
        };

      case 'downloading':
        return {
          icon: ClockIcon,
          iconColor: 'text-yellow-500',
          bgColor: 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800',
          title: '正在下载中...',
          description: `${downloadingCount} 个任务正在下载，${completedCount} 个已完成`,
          steps: [
            '📊 实时查看下载进度和速度',
            '⏸️ 可以随时暂停或恢复下载',
            '🔄 失败的任务会自动重试',
            '📁 下载完成的文件会保存到指定目录',
          ],
          tip: '⏱️ 大文件下载需要时间，请耐心等待',
        };

      case 'completed':
        return {
          icon: CheckCircleIcon,
          iconColor: 'text-emerald-500',
          bgColor:
            'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800',
          title: '下载完成！',
          description: `所有 ${completedCount} 个视频已成功下载完成`,
          steps: [
            '📂 打开下载文件夹查看视频文件',
            '🗂️ 文件已按照课程分类整理',
            '🧹 可以清除已完成的任务记录',
            '➕ 导入新的任务继续下载',
          ],
          tip: '🎉 恭喜！所有视频下载任务已成功完成',
        };
    }
  };

  const content = getTipContent();
  const Icon = content.icon;

  return (
    <div className={`rounded-xl p-6 border ${content.bgColor} mb-6`}>
      {/* 头部 */}
      <div className='flex items-center mb-4'>
        <div className={`p-2 rounded-full bg-white dark:bg-gray-800 shadow-sm mr-3`}>
          <Icon className={`w-6 h-6 ${content.iconColor}`} />
        </div>
        <div>
          <h3 className='text-lg font-semibold text-gray-900 dark:text-gray-100'>
            {content.title}
          </h3>
          <p className='text-sm text-gray-600 dark:text-gray-400'>{content.description}</p>
        </div>
      </div>

      {/* 工作流程步骤 */}
      <div className='space-y-2 mb-4'>
        <div className='flex items-center mb-2'>
          <InformationCircleIcon className='w-4 h-4 text-blue-500 mr-2' />
          <span className='text-sm font-medium text-gray-800 dark:text-gray-200'>工作流程：</span>
        </div>
        <div className='grid grid-cols-1 md:grid-cols-2 gap-2 ml-6'>
          {content.steps.map((step, index) => (
            <div key={index} className='flex items-center text-sm text-gray-700 dark:text-gray-300'>
              <span className='w-6 h-6 bg-white dark:bg-gray-700 rounded-full flex items-center justify-center text-xs font-medium text-gray-600 dark:text-gray-400 mr-2 border'>
                {index + 1}
              </span>
              <span>{step}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 提示信息 */}
      <div className='flex items-start p-3 bg-white/50 dark:bg-gray-800/50 rounded-lg mb-4'>
        <LightBulbIcon className='w-4 h-4 text-amber-500 mr-2 mt-0.5 flex-shrink-0' />
        <span className='text-sm text-gray-700 dark:text-gray-300'>{content.tip}</span>
      </div>

      {/* 行动按钮 */}
      {onAction && actionLabel && (
        <button
          onClick={onAction}
          className='w-full md:w-auto px-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white font-medium rounded-lg transition-all duration-200 shadow-sm hover:shadow-md transform hover:scale-105'
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
};

// 简化的提示条组件
export const WorkflowHint: React.FC<{
  message: string;
  type?: 'info' | 'success' | 'warning' | 'error';
  showIcon?: boolean;
}> = ({ message, type = 'info', showIcon = true }) => {
  const getTypeStyles = () => {
    switch (type) {
      case 'success':
        return {
          bg: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800',
          icon: <CheckCircleIcon className='w-4 h-4 text-green-500' />,
          text: 'text-green-800 dark:text-green-200',
        };
      case 'warning':
        return {
          bg: 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800',
          icon: <InformationCircleIcon className='w-4 h-4 text-yellow-500' />,
          text: 'text-yellow-800 dark:text-yellow-200',
        };
      case 'error':
        return {
          bg: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',
          icon: <InformationCircleIcon className='w-4 h-4 text-red-500' />,
          text: 'text-red-800 dark:text-red-200',
        };
      default: // info
        return {
          bg: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800',
          icon: <InformationCircleIcon className='w-4 h-4 text-blue-500' />,
          text: 'text-blue-800 dark:text-blue-200',
        };
    }
  };

  const styles = getTypeStyles();

  return (
    <div className={`flex items-center p-3 rounded-lg border ${styles.bg} mb-4`}>
      {showIcon && <div className='mr-3'>{styles.icon}</div>}
      <span className={`text-sm ${styles.text}`}>{message}</span>
    </div>
  );
};
