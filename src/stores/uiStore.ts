import { create } from 'zustand';
import type { Notification } from '../types';

interface UIState {
  notifications: Notification[];
  addNotification: (notification: Omit<Notification, 'id' | 'timestamp'>) => void;
  removeNotification: (id: string) => void;
  clearAllNotifications: () => void;
}

const notificationTimers = new Map<string, ReturnType<typeof setTimeout>>();

export const useUIStore = create<UIState>((set, get) => ({
  notifications: [],

  addNotification: notification => {
    const newNotification: Notification = {
      ...notification,
      id: Date.now().toString() + Math.random().toString(36).slice(2, 11),
      timestamp: Date.now(),
    };

    set(state => ({
      notifications: [...state.notifications, newNotification],
    }));

    if (notification.duration && notification.duration > 0) {
      const timerId = setTimeout(() => {
        notificationTimers.delete(newNotification.id);
        get().removeNotification(newNotification.id);
      }, notification.duration);
      notificationTimers.set(newNotification.id, timerId);
    }
  },

  removeNotification: id => {
    const timerId = notificationTimers.get(id);
    if (timerId !== undefined) {
      clearTimeout(timerId);
      notificationTimers.delete(id);
    }
    set(state => ({
      notifications: state.notifications.filter(notification => notification.id !== id),
    }));
  },

  clearAllNotifications: () => {
    for (const timerId of notificationTimers.values()) {
      clearTimeout(timerId);
    }
    notificationTimers.clear();
    set({ notifications: [] });
  },
}));

export const notify = {
  success: (title: string, message?: string, duration = 4000) => {
    useUIStore.getState().addNotification({
      type: 'success',
      title,
      message: message || '',
      duration,
    });
  },

  error: (title: string, message?: string, duration = 6000) => {
    useUIStore.getState().addNotification({
      type: 'error',
      title,
      message: message || '',
      duration,
    });
  },

  warning: (title: string, message?: string, duration = 5000) => {
    useUIStore.getState().addNotification({
      type: 'warning',
      title,
      message: message || '',
      duration,
    });
  },

  info: (title: string, message?: string, duration = 4000) => {
    useUIStore.getState().addNotification({
      type: 'info',
      title,
      message: message || '',
      duration,
    });
  },
};
