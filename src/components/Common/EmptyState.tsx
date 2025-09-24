import React from 'react';

interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  size?: 'sm' | 'md' | 'lg';
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  title,
  description,
  icon = '📭',
  action,
  size = 'md'
}) => {
  const getSizeClasses = () => {
    switch (size) {
      case 'sm':
        return {
          container: 'py-8',
          icon: 'text-4xl mb-4',
          title: 'text-lg',
          description: 'text-sm',
          button: 'px-4 py-2 text-sm'
        };
      case 'lg':
        return {
          container: 'py-20',
          icon: 'text-8xl mb-8',
          title: 'text-3xl',
          description: 'text-lg',
          button: 'px-6 py-3 text-base'
        };
      default: // md
        return {
          container: 'py-12',
          icon: 'text-6xl mb-6',
          title: 'text-xl',
          description: 'text-base',
          button: 'px-5 py-2.5 text-sm'
        };
    }
  };

  const sizeClasses = getSizeClasses();

  return (
    <div className={`flex flex-col items-center justify-center text-center ${sizeClasses.container}`}>
      {/* 图标 */}
      <div className={`${sizeClasses.icon} mb-4`}>
        {icon}
      </div>

      {/* 标题 */}
      <h3 className={`${sizeClasses.title} font-semibold text-gray-900 dark:text-gray-100 mb-2`}>
        {title}
      </h3>

      {/* 描述 */}
      {description && (
        <p className={`${sizeClasses.description} text-gray-600 dark:text-gray-400 mb-6 max-w-md leading-relaxed`}>
          {description}
        </p>
      )}

      {/* 操作按钮 */}
      {action && (
        <button
          onClick={action.onClick}
          className={`
            ${sizeClasses.button} 
            font-medium bg-primary-600 hover:bg-primary-700 text-white 
            rounded-lg transition-colors duration-200 shadow-sm hover:shadow-md
            focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2
          `}
        >
          {action.label}
        </button>
      )}
    </div>
  );
};

// 专门用于加载状态的空状态组件
export const LoadingState: React.FC<{ message?: string }> = ({ 
  message = '加载中...' 
}) => (
  <div className="flex flex-col items-center justify-center py-12">
    <div className="loading-spinner w-8 h-8 border-2 border-primary-600 mb-4"></div>
    <p className="text-gray-600 dark:text-gray-400">{message}</p>
  </div>
);

// 专门用于错误状态的空状态组件
export const ErrorState: React.FC<{ 
  title?: string;
  description?: string;
  onRetry?: () => void;
}> = ({ 
  title = '出现错误',
  description = '请稍后重试或联系支持人员。',
  onRetry
}) => (
  <EmptyState
    title={title}
    description={description}
    icon="❌"
    action={onRetry ? {
      label: '重试',
      onClick: onRetry
    } : undefined}
  />
);