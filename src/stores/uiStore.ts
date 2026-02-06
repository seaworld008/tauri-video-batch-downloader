import { create } from 'zustand';
import type { ViewType, Notification, ModalOptions } from '../types';

interface UIState {
  // 视图状态
  currentView: ViewType;
  sidebarOpen: boolean;

  // 通知系统
  notifications: Notification[];

  // 模态框
  modal: ModalOptions | null;

  // 全局加载状态
  globalLoading: boolean;
  loadingMessage: string;

  // 快捷键状态
  shortcutsEnabled: boolean;

  // Actions - 视图管理
  setCurrentView: (view: ViewType) => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;

  // Actions - 通知管理
  addNotification: (notification: Omit<Notification, 'id' | 'timestamp'>) => void;
  removeNotification: (id: string) => void;
  clearAllNotifications: () => void;

  // Actions - 模态框管理
  showModal: (modal: ModalOptions) => void;
  hideModal: () => void;

  // Actions - 加载状态
  setGlobalLoading: (loading: boolean, message?: string) => void;

  // Actions - 快捷键
  setShortcutsEnabled: (enabled: boolean) => void;
}

export const useUIStore = create<UIState>((set, get) => ({
  // 初始状态
  currentView: 'dashboard',
  sidebarOpen: true,
  notifications: [],
  modal: null,
  globalLoading: false,
  loadingMessage: '',
  shortcutsEnabled: true,

  // 视图管理
  setCurrentView: view => {
    set({ currentView: view });
  },

  toggleSidebar: () => {
    set(state => ({ sidebarOpen: !state.sidebarOpen }));
  },

  setSidebarOpen: open => {
    set({ sidebarOpen: open });
  },

  // 通知管理
  addNotification: notification => {
    const newNotification: Notification = {
      ...notification,
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      timestamp: Date.now(),
    };

    set(state => ({
      notifications: [...state.notifications, newNotification],
    }));

    // 自动移除通知（如果设置了持续时间）
    if (notification.duration && notification.duration > 0) {
      setTimeout(() => {
        get().removeNotification(newNotification.id);
      }, notification.duration);
    }
  },

  removeNotification: id => {
    set(state => ({
      notifications: state.notifications.filter(n => n.id !== id),
    }));
  },

  clearAllNotifications: () => {
    set({ notifications: [] });
  },

  // 模态框管理
  showModal: modal => {
    set({ modal });
  },

  hideModal: () => {
    set({ modal: null });
  },

  // 加载状态
  setGlobalLoading: (loading, message = '') => {
    set({ globalLoading: loading, loadingMessage: message });
  },

  // 快捷键
  setShortcutsEnabled: enabled => {
    set({ shortcutsEnabled: enabled });
  },
}));

// 通知快捷方法
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

// 模态框快捷方法
export const modal = {
  confirm: (
    title: string,
    message: string,
    onConfirm: () => void | Promise<void>,
    onCancel?: () => void
  ) => {
    useUIStore.getState().showModal({
      type: 'confirm',
      title,
      message,
      confirmText: '确认',
      cancelText: '取消',
      onConfirm,
      onCancel,
    });
  },

  alert: (title: string, message: string) => {
    useUIStore.getState().showModal({
      type: 'info',
      title,
      message,
      confirmText: '确定',
      onConfirm: () => useUIStore.getState().hideModal(),
    });
  },

  error: (title: string, message: string) => {
    useUIStore.getState().showModal({
      type: 'error',
      title,
      message,
      confirmText: '确定',
      onConfirm: () => useUIStore.getState().hideModal(),
    });
  },

  custom: (options: ModalOptions) => {
    useUIStore.getState().showModal(options);
  },

  hide: () => {
    useUIStore.getState().hideModal();
  },
};
