import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

const appMocks = vi.hoisted(() => ({
  initializeDownloadEventBridge: vi.fn(() => Promise.resolve()),
  initializeStore: vi.fn(() => Promise.resolve()),
  loadConfig: vi.fn(() => Promise.resolve()),
  checkExternalToolUpdatesCommand: vi.fn(() => Promise.resolve([])),
  notify: {
    warning: vi.fn(),
  },
  reportFrontendIssue: vi.fn(),
}));

vi.mock('./components/Unified/UnifiedView', () => ({
  UnifiedView: () => <div data-testid='unified-view'>Unified View</div>,
}));

vi.mock('./components/Common/NotificationCenter', () => ({
  NotificationCenter: () => <div data-testid='notification-center' />,
}));

vi.mock('react-hot-toast', () => ({
  Toaster: () => <div data-testid='toaster' />,
}));

vi.mock('./features/downloads/state/downloadEventBridge', () => ({
  initializeDownloadEventBridge: appMocks.initializeDownloadEventBridge,
}));

vi.mock('./stores/downloadStore', () => ({
  useDownloadStore: (
    selector: (state: { initializeStore: typeof appMocks.initializeStore }) => unknown
  ) => selector({ initializeStore: appMocks.initializeStore }),
}));

vi.mock('./stores/configStore', () => ({
  useConfigStore: (selector: (state: { loadConfig: typeof appMocks.loadConfig }) => unknown) =>
    selector({ loadConfig: appMocks.loadConfig }),
}));

vi.mock('./stores/uiStore', () => ({
  notify: appMocks.notify,
}));

vi.mock('./features/downloads/api/systemCommands', () => ({
  checkExternalToolUpdatesCommand: appMocks.checkExternalToolUpdatesCommand,
}));

vi.mock('./utils/frontendLogging', () => ({
  reportFrontendIssue: appMocks.reportFrontendIssue,
}));

describe('App bootstrap', () => {
  beforeEach(() => {
    window.localStorage.clear();
    appMocks.initializeDownloadEventBridge.mockClear();
    appMocks.initializeStore.mockReset();
    appMocks.initializeStore.mockResolvedValue(undefined);
    appMocks.loadConfig.mockReset();
    appMocks.loadConfig.mockResolvedValue(undefined);
    appMocks.checkExternalToolUpdatesCommand.mockReset();
    appMocks.checkExternalToolUpdatesCommand.mockResolvedValue([]);
    appMocks.notify.warning.mockClear();
    appMocks.reportFrontendIssue.mockReset();
  });

  it('uses config/store bootstrap as the main initialization path', async () => {
    render(<App />);

    expect(screen.getByText('正在启动...')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId('unified-view')).toBeInTheDocument();
    });

    expect(appMocks.initializeDownloadEventBridge).toHaveBeenCalledTimes(1);
    expect(appMocks.loadConfig).toHaveBeenCalledTimes(1);
    expect(appMocks.initializeStore).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('启动失败')).not.toBeInTheDocument();
  });

  it('continues to UnifiedView when store bootstrap fails, instead of reviving a bootstrap error screen', async () => {
    appMocks.initializeStore.mockRejectedValueOnce(new Error('backend offline'));

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('unified-view')).toBeInTheDocument();
    });

    expect(screen.queryByText('启动失败')).not.toBeInTheDocument();
    expect(screen.queryByText('backend offline')).not.toBeInTheDocument();
    expect(appMocks.loadConfig).toHaveBeenCalledTimes(1);
    expect(appMocks.initializeStore).toHaveBeenCalledTimes(1);
    expect(appMocks.reportFrontendIssue).toHaveBeenCalledWith(
      'warn',
      'app_bootstrap:initialize_store_failed',
      expect.any(Error)
    );
  });

  it('routes config bootstrap warnings through the shared frontend logging seam', async () => {
    appMocks.loadConfig.mockRejectedValueOnce(new Error('config unavailable'));

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('unified-view')).toBeInTheDocument();
    });

    expect(appMocks.reportFrontendIssue).toHaveBeenCalledWith(
      'warn',
      'app_bootstrap:load_config_failed',
      expect.any(Error)
    );
  });

  it('prompts when external tools have newer managed versions', async () => {
    appMocks.checkExternalToolUpdatesCommand.mockResolvedValueOnce([
      {
        id: 'yt-dlp',
        display_name: 'yt-dlp',
        status: 'available',
        source: 'managed',
        path: '/tmp/yt-dlp',
        current_version: '2026.01.01',
        latest_version: '2026.05.01',
        update_available: true,
        can_auto_update: true,
        can_rollback: false,
        message: '可用',
      },
    ]);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('unified-view')).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(appMocks.notify.warning).toHaveBeenCalledWith(
        '外部工具可更新',
        'yt-dlp 2026.01.01 -> 2026.05.01。可在设置中手动更新。',
        8000
      );
    });
  });

  it('throttles automatic external tool update checks', async () => {
    window.localStorage.setItem(
      'video-downloader:last-external-tool-update-check',
      String(Date.now())
    );

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('unified-view')).toBeInTheDocument();
    });

    expect(appMocks.checkExternalToolUpdatesCommand).not.toHaveBeenCalled();
    expect(appMocks.notify.warning).not.toHaveBeenCalled();
  });
});
