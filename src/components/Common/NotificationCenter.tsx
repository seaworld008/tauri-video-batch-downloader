import React from 'react';
import { Transition } from '@headlessui/react';
import { useUIStore } from '../../stores/uiStore';

const typeStyles: Record<string, { border: string; icon: string; iconBg: string }> = {
  success: {
    border: 'border-green-500',
    icon: 'text-green-500',
    iconBg: 'bg-green-50 dark:bg-green-900/30',
  },
  error: {
    border: 'border-red-500',
    icon: 'text-red-500',
    iconBg: 'bg-red-50 dark:bg-red-900/30',
  },
  warning: {
    border: 'border-yellow-500',
    icon: 'text-yellow-500',
    iconBg: 'bg-yellow-50 dark:bg-yellow-900/30',
  },
  info: {
    border: 'border-blue-500',
    icon: 'text-blue-500',
    iconBg: 'bg-blue-50 dark:bg-blue-900/30',
  },
};

const icons: Record<string, string> = {
  success: '✓',
  error: '✕',
  warning: '!',
  info: 'ℹ',
};

export const NotificationCenter: React.FC = () => {
  const notifications = useUIStore(state => state.notifications);
  const removeNotification = useUIStore(state => state.removeNotification);

  if (notifications.length === 0) {
    return null;
  }

  return (
    <div className='pointer-events-none fixed top-5 right-5 z-50 flex flex-col gap-3 max-w-sm w-full'>
      {notifications.map(notification => {
        const style = typeStyles[notification.type] ?? typeStyles.info;
        return (
          <Transition
            key={notification.id}
            appear
            show
            enter='transition transform duration-200'
            enterFrom='opacity-0 translate-y-2 scale-95'
            enterTo='opacity-100 translate-y-0 scale-100'
            leave='transition transform duration-150'
            leaveFrom='opacity-100 translate-y-0 scale-100'
            leaveTo='opacity-0 translate-y-2 scale-95'
          >
            <div
              className={`pointer-events-auto flex items-start gap-3 rounded-xl border-l-4 bg-white dark:bg-gray-900 shadow-lg p-4 ${style.border}`}
            >
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full ${style.iconBg}`}
              >
                <span className={`text-lg font-semibold ${style.icon}`}>
                  {icons[notification.type] ?? icons.info}
                </span>
              </div>
              <div className='flex-1'>
                <p className='text-sm font-semibold text-gray-900 dark:text-gray-100'>
                  {notification.title}
                </p>
                {notification.message && (
                  <p className='mt-1 text-xs text-gray-600 dark:text-gray-300 leading-relaxed'>
                    {notification.message}
                  </p>
                )}
                {notification.actions && notification.actions.length > 0 && (
                  <div className='mt-2 flex flex-wrap gap-2'>
                    {notification.actions.map(action => (
                      <button
                        key={action.label}
                        onClick={() => action.action()}
                        className={`text-xs font-medium rounded-md px-2 py-1 transition-colors ${
                          action.style === 'primary'
                            ? 'bg-blue-600 text-white hover:bg-blue-700'
                            : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                        }`}
                      >
                        {action.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button
                className='text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors text-lg leading-none'
                onClick={() => removeNotification(notification.id)}
              >
                ×
              </button>
            </div>
          </Transition>
        );
      })}
    </div>
  );
};
