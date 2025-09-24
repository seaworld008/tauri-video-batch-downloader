/**
 * 导入进度指示器组件
 * 提供更详细的导入状态反馈
 */
import React from 'react';
import { 
  CheckCircleIcon, 
  ExclamationTriangleIcon, 
  ArrowPathIcon,
  DocumentTextIcon,
  PlayIcon,
  ClockIcon
} from '@heroicons/react/24/outline';

export interface ImportProgressStep {
  id: string;
  title: string;
  description?: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  errorMessage?: string;
  startTime?: number;
  endTime?: number;
}

interface ImportProgressProps {
  steps: ImportProgressStep[];
  currentStep?: string;
  showTimings?: boolean;
  className?: string;
}

export const ImportProgress: React.FC<ImportProgressProps> = ({
  steps,
  currentStep,
  showTimings = false,
  className = '',
}) => {
  const getStepIcon = (step: ImportProgressStep) => {
    switch (step.status) {
      case 'completed':
        return <CheckCircleIcon className="w-5 h-5 text-green-500" />;
      case 'processing':
        return <ArrowPathIcon className="w-5 h-5 text-blue-500 animate-spin" />;
      case 'error':
        return <ExclamationTriangleIcon className="w-5 h-5 text-red-500" />;
      default:
        return <ClockIcon className="w-5 h-5 text-gray-400" />;
    }
  };

  const getStepBgColor = (step: ImportProgressStep) => {
    switch (step.status) {
      case 'completed':
        return 'bg-green-50 border-green-200';
      case 'processing':
        return 'bg-blue-50 border-blue-200';
      case 'error':
        return 'bg-red-50 border-red-200';
      default:
        return 'bg-gray-50 border-gray-200';
    }
  };

  const getStepTextColor = (step: ImportProgressStep) => {
    switch (step.status) {
      case 'completed':
        return 'text-green-800';
      case 'processing':
        return 'text-blue-800';
      case 'error':
        return 'text-red-800';
      default:
        return 'text-gray-600';
    }
  };

  const formatDuration = (startTime?: number, endTime?: number) => {
    if (!startTime) return '';
    const end = endTime || Date.now();
    const duration = end - startTime;
    return `${(duration / 1000).toFixed(1)}s`;
  };

  return (
    <div className={`space-y-3 ${className}`}>
      {steps.map((step, index) => (
        <div
          key={step.id}
          className={`
            p-4 rounded-lg border transition-all duration-200
            ${getStepBgColor(step)}
            ${step.id === currentStep ? 'ring-2 ring-blue-300' : ''}
          `}
        >
          <div className="flex items-start space-x-3">
            <div className="flex-shrink-0 mt-0.5">
              {getStepIcon(step)}
            </div>
            
            <div className="flex-grow min-w-0">
              <div className="flex items-center justify-between">
                <h4 className={`text-sm font-medium ${getStepTextColor(step)}`}>
                  {step.title}
                </h4>
                
                {showTimings && step.startTime && (
                  <span className="text-xs text-gray-500 ml-2">
                    {formatDuration(step.startTime, step.endTime)}
                  </span>
                )}
              </div>
              
              {step.description && (
                <p className="text-sm text-gray-600 mt-1">
                  {step.description}
                </p>
              )}
              
              {step.status === 'error' && step.errorMessage && (
                <div className="mt-2 text-sm text-red-600 bg-red-100 p-2 rounded">
                  {step.errorMessage}
                </div>
              )}
            </div>
          </div>
          
          {/* 处理中的步骤显示进度条 */}
          {step.status === 'processing' && (
            <div className="mt-3 w-full bg-gray-200 rounded-full h-1.5">
              <div className="bg-blue-600 h-1.5 rounded-full animate-pulse" style={{ width: '60%' }} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

/**
 * 简化版进度指示器
 */
interface SimpleProgressProps {
  current: number;
  total: number;
  status: 'processing' | 'completed' | 'error';
  message?: string;
  showPercentage?: boolean;
  className?: string;
}

export const SimpleProgress: React.FC<SimpleProgressProps> = ({
  current,
  total,
  status,
  message,
  showPercentage = true,
  className = '',
}) => {
  const percentage = total > 0 ? (current / total) * 100 : 0;
  
  const getProgressColor = () => {
    switch (status) {
      case 'completed':
        return 'bg-green-600';
      case 'error':
        return 'bg-red-600';
      default:
        return 'bg-blue-600';
    }
  };

  const getStatusIcon = () => {
    switch (status) {
      case 'completed':
        return <CheckCircleIcon className="w-4 h-4 text-green-600" />;
      case 'error':
        return <ExclamationTriangleIcon className="w-4 h-4 text-red-600" />;
      default:
        return <ArrowPathIcon className="w-4 h-4 text-blue-600 animate-spin" />;
    }
  };

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center space-x-2">
          {getStatusIcon()}
          <span className="font-medium">
            {message || `处理中 ${current}/${total}`}
          </span>
        </div>
        
        {showPercentage && (
          <span className="text-gray-500">
            {percentage.toFixed(0)}%
          </span>
        )}
      </div>
      
      <div className="w-full bg-gray-200 rounded-full h-2">
        <div
          className={`h-2 rounded-full transition-all duration-300 ${getProgressColor()}`}
          style={{ width: `${Math.min(percentage, 100)}%` }}
        />
      </div>
      
      {status === 'processing' && (
        <div className="text-xs text-gray-500">
          正在处理，请稍候...
        </div>
      )}
    </div>
  );
};

/**
 * 创建导入步骤的工厂函数
 */
export const createImportSteps = (): ImportProgressStep[] => [
  {
    id: 'file-select',
    title: '选择文件',
    description: '选择要导入的CSV或Excel文件',
    status: 'pending',
  },
  {
    id: 'file-parse',
    title: '解析文件',
    description: '读取文件内容并检测编码格式',
    status: 'pending',
  },
  {
    id: 'data-validate',
    title: '数据验证',
    description: '验证数据格式并映射字段',
    status: 'pending',
  },
  {
    id: 'tasks-create',
    title: '创建任务',
    description: '将数据转换为下载任务',
    status: 'pending',
  },
  {
    id: 'backend-sync',
    title: '后端同步',
    description: '将任务保存到后端存储',
    status: 'pending',
  },
  {
    id: 'ui-update',
    title: '界面更新',
    description: '更新前端任务列表',
    status: 'pending',
  },
];

export default ImportProgress;