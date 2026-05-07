import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UnifiedView } from '../UnifiedView';
import { useDownloadStore } from '../../../stores/downloadStore';

vi.mock('../../../stores/downloadStore');
vi.mock('../FileImportPanel', () => ({
  FileImportPanel: () => <div data-testid='file-import-panel' />,
}));
vi.mock('../ManualInputPanel', () => ({
  ManualInputPanel: () => <div data-testid='manual-input-panel' />,
}));
vi.mock('../../Downloads/DashboardToolbar', () => ({
  DashboardToolbar: ({ onOpenSettings }: { onOpenSettings?: () => void }) => (
    <button data-testid='toolbar-open-settings' onClick={onOpenSettings}>
      toolbar-open-settings
    </button>
  ),
}));
vi.mock('../../Optimized/VirtualizedTaskList', () => ({
  VirtualizedTaskList: () => <div data-testid='virtualized-task-list' />,
}));
vi.mock('../../Settings/SettingsView', () => ({
  SettingsView: () => <div data-testid='settings-page' />,
}));
vi.mock('../StatusBar', () => ({
  StatusBar: () => <div data-testid='unified-status-bar' />,
}));

const mockUseDownloadStore = vi.mocked(useDownloadStore);

describe('UnifiedView', () => {
  const storeActions = {
    startAllDownloads: vi.fn(),
    retryFailedTasks: vi.fn(),
    clearCompletedTasks: vi.fn(),
    clearRecoveredSession: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    const mockState = {
      tasks: [{ id: 'task-1', status: 'pending' }],
      recoveredSessionTaskIds: ['task-1'],
      ...storeActions,
    };

    mockUseDownloadStore.mockImplementation((selector?: unknown) =>
      typeof selector === 'function'
        ? (selector as (state: typeof mockState) => unknown)(mockState)
        : mockState
    );
  });

  it('opens settings drawer when toolbar requests the authoritative mainline settings entrypoint', () => {
    render(<UnifiedView />);

    expect(screen.getByTestId('settings-drawer')).toHaveClass('translate-x-full');

    fireEvent.click(screen.getByTestId('toolbar-open-settings'));

    expect(screen.getByTestId('settings-drawer')).toHaveClass('translate-x-0');
    expect(screen.getByTestId('settings-page')).toBeInTheDocument();
  });

  it('shows recovered session actions without mutating task state optimistically', async () => {
    storeActions.startAllDownloads.mockResolvedValue(undefined);
    storeActions.retryFailedTasks.mockResolvedValue(undefined);
    storeActions.clearCompletedTasks.mockResolvedValue(undefined);

    const mockState = {
      tasks: [
        { id: 'pending-1', status: 'pending' },
        { id: 'paused-1', status: 'paused' },
        { id: 'failed-1', status: 'failed' },
        { id: 'completed-1', status: 'completed' },
      ],
      recoveredSessionTaskIds: ['pending-1', 'paused-1', 'failed-1', 'completed-1'],
      ...storeActions,
    };

    mockUseDownloadStore.mockImplementation((selector?: unknown) =>
      typeof selector === 'function'
        ? (selector as (state: typeof mockState) => unknown)(mockState)
        : mockState
    );

    render(<UnifiedView />);

    expect(screen.getByTestId('session-recovery-banner')).toBeInTheDocument();
    expect(screen.getByText('上次会话已恢复')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /继续 2 个/ }));
    await waitFor(() => expect(storeActions.startAllDownloads).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: /重试失败 1 个/ }));
    await waitFor(() => expect(storeActions.retryFailedTasks).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: /清理完成 1 个/ }));
    await waitFor(() => expect(storeActions.clearCompletedTasks).toHaveBeenCalledTimes(1));
    expect(mockState.tasks.find(task => task.id === 'paused-1')?.status).toBe('paused');
  });

  it('allows dismissing the recovered session hint', () => {
    render(<UnifiedView />);

    expect(screen.getByTestId('session-recovery-banner')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '暂时隐藏上次会话提示' }));

    expect(screen.queryByTestId('session-recovery-banner')).not.toBeInTheDocument();
    expect(storeActions.clearRecoveredSession).toHaveBeenCalledTimes(1);
  });
});
