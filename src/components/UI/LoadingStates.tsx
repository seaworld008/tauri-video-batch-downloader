/**
 * 统一的加载状态组件
 * 提供一致的用户反馈体验
 */
import React from 'react';
import { ArrowPathIcon, CheckCircleIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({ 
  size = 'md', 
  className = '' 
}) => {
  const sizeClasses = {
    sm: 'w-4 h-4',
    md: 'w-6 h-6',
    lg: 'w-8 h-8',
  };

  return (
    <ArrowPathIcon 
      className={`animate-spin text-blue-500 ${sizeClasses[size]} ${className}`} 
    />
  );
};

interface LoadingButtonProps {
  isLoading: boolean;
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export const LoadingButton: React.FC<LoadingButtonProps> = ({
  isLoading,
  children,
  onClick,
  disabled = false,
  variant = 'primary',
  size = 'md',
  className = '',
}) => {
  const baseClasses = 'inline-flex items-center justify-center font-medium rounded-lg transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed';
  
  const variantClasses = {
    primary: 'bg-blue-600 hover:bg-blue-700 text-white focus:ring-blue-500',
    secondary: 'bg-gray-600 hover:bg-gray-700 text-white focus:ring-gray-500',
    danger: 'bg-red-600 hover:bg-red-700 text-white focus:ring-red-500',
  };
  
  const sizeClasses = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2 text-base',
    lg: 'px-6 py-3 text-lg',
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || isLoading}
      className={`${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
    >
      {isLoading && (
        <LoadingSpinner size="sm" className="mr-2" />
      )}
      {children}
    </button>
  );
};

interface LoadingOverlayProps {
  isVisible: boolean;
  message?: string;
  progress?: number;
  children?: React.ReactNode;
  className?: string;
}

export const LoadingOverlay: React.FC<LoadingOverlayProps> = ({
  isVisible,
  message = '加载中...',
  progress,
  children,
  className = '',
}) => {
  if (!isVisible) return null;

  return (
    <div className={`fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 ${className}`}>
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-sm mx-4">
        <div className="flex flex-col items-center space-y-4">
          <LoadingSpinner size="lg" />
          
          <div className="text-center">
            <p className="text-lg font-medium text-gray-900 dark:text-gray-100">
              {message}
            </p>
            
            {progress !== undefined && (
              <div className="mt-3 w-full">
                <div className="flex justify-between text-sm text-gray-600 dark:text-gray-400 mb-1">
                  <span>进度</span>
                  <span>{Math.round(progress)}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div 
                    className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${Math.min(progress, 100)}%` }}
                  />
                </div>
              </div>
            )}
          </div>
          
          {children}
        </div>
      </div>
    </div>
  );
};

interface StatusMessageProps {
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message?: string;
  onClose?: () => void;
  action?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
}

export const StatusMessage: React.FC<StatusMessageProps> = ({
  type,
  title,
  message,
  onClose,
  action,
  className = '',
}) => {
  const getTypeStyles = () => {
    switch (type) {
      case 'success':
        return {
          bgColor: 'bg-green-50 border-green-200',
          textColor: 'text-green-800',
          icon: <CheckCircleIcon className="w-5 h-5 text-green-500" />,
        };
      case 'error':
        return {
          bgColor: 'bg-red-50 border-red-200',
          textColor: 'text-red-800',
          icon: <ExclamationTriangleIcon className="w-5 h-5 text-red-500" />,
        };
      case 'warning':
        return {
          bgColor: 'bg-yellow-50 border-yellow-200',
          textColor: 'text-yellow-800',
          icon: <ExclamationTriangleIcon className="w-5 h-5 text-yellow-500" />,
        };
      default:
        return {
          bgColor: 'bg-blue-50 border-blue-200',
          textColor: 'text-blue-800',
          icon: <ArrowPathIcon className="w-5 h-5 text-blue-500" />,
        };
    }
  };

  const styles = getTypeStyles();

  return (
    <div className={`border rounded-lg p-4 ${styles.bgColor} ${className}`}>
      <div className="flex items-start space-x-3">
        <div className="flex-shrink-0">
          {styles.icon}
        </div>
        
        <div className="flex-grow">
          <h3 className={`text-sm font-medium ${styles.textColor}`}>
            {title}
          </h3>
          
          {message && (
            <p className={`text-sm ${styles.textColor} opacity-90 mt-1`}>
              {message}
            </p>
          )}
          
          {action && (
            <div className="mt-3">
              <button
                type="button"
                onClick={action.onClick}
                className={`text-sm font-medium ${styles.textColor} hover:underline`}
              >
                {action.label}
              </button>
            </div>
          )}
        </div>
        
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className={`text-sm ${styles.textColor} hover:opacity-75`}
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
};

interface InlineLoadingProps {
  text?: string;
  size?: 'sm' | 'md';
  className?: string;
}

export const InlineLoading: React.FC<InlineLoadingProps> = ({
  text = '加载中...',
  size = 'sm',
  className = '',
}) => {
  return (
    <div className={`flex items-center space-x-2 ${className}`}>
      <LoadingSpinner size={size} />
      <span className={`${size === 'sm' ? 'text-sm' : 'text-base'} text-gray-600`}>
        {text}
      </span>
    </div>
  );
};

interface SkeletonProps {
  lines?: number;
  className?: string;
}

export const Skeleton: React.FC<SkeletonProps> = ({
  lines = 3,
  className = '',
}) => {
  return (
    <div className={`space-y-3 animate-pulse ${className}`}>
      {Array.from({ length: lines }).map((_, index) => (
        <div
          key={index}
          className="h-4 bg-gray-200 rounded"
          style={{
            width: `${85 + Math.random() * 15}%`, // 随机宽度让骨架屏更自然
          }}
        />
      ))}
    </div>
  );
};

export default {
  LoadingSpinner,
  LoadingButton,
  LoadingOverlay,
  StatusMessage,
  InlineLoading,
  Skeleton,
};