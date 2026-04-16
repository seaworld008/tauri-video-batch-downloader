import { fireEvent, render, screen } from '@testing-library/react';
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
  beforeEach(() => {
    const mockState = {
      tasks: [{ id: 'task-1', status: 'pending' }],
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
});
