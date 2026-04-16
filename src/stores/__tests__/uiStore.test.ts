import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import { notify, useUIStore } from '../uiStore';

describe('uiStore', () => {
  beforeEach(() => {
    useUIStore.setState({ notifications: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('adds and removes notifications', () => {
    const { addNotification, removeNotification } = useUIStore.getState();

    addNotification({ type: 'success', title: '导入成功', message: '已添加任务' });

    const [notification] = useUIStore.getState().notifications;
    expect(notification).toMatchObject({
      type: 'success',
      title: '导入成功',
      message: '已添加任务',
    });
    expect(notification.id).toBeTruthy();

    removeNotification(notification.id);

    expect(useUIStore.getState().notifications).toEqual([]);
  });

  it('auto-dismisses timed notifications', () => {
    vi.useFakeTimers();

    notify.info('后台已连接', '初始化完成', 1000);
    expect(useUIStore.getState().notifications).toHaveLength(1);

    vi.advanceTimersByTime(1000);

    expect(useUIStore.getState().notifications).toHaveLength(0);
  });

  it('clears all notifications at once', () => {
    const { addNotification, clearAllNotifications } = useUIStore.getState();

    addNotification({ type: 'info', title: 'A', message: '' });
    addNotification({ type: 'warning', title: 'B', message: '' });
    expect(useUIStore.getState().notifications).toHaveLength(2);

    clearAllNotifications();

    expect(useUIStore.getState().notifications).toEqual([]);
  });
});
