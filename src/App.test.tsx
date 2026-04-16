import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

const appMocks = vi.hoisted(() => ({
  initializeDownloadEventBridge: vi.fn(() => Promise.resolve()),
  initializeStore: vi.fn(() => Promise.resolve()),
  loadConfig: vi.fn(() => Promise.resolve()),
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
  useDownloadStore: (selector: (state: { initializeStore: typeof appMocks.initializeStore }) => unknown) =>
    selector({ initializeStore: appMocks.initializeStore }),
}));

vi.mock('./stores/configStore', () => ({
  useConfigStore: (selector: (state: { loadConfig: typeof appMocks.loadConfig }) => unknown) =>
    selector({ loadConfig: appMocks.loadConfig }),
}));

vi.mock('./utils/frontendLogging', () => ({
  reportFrontendIssue: appMocks.reportFrontendIssue,
}));

describe('App bootstrap', () => {
  beforeEach(() => {
    appMocks.initializeDownloadEventBridge.mockClear();
    appMocks.initializeStore.mockReset();
    appMocks.initializeStore.mockResolvedValue(undefined);
    appMocks.loadConfig.mockReset();
    appMocks.loadConfig.mockResolvedValue(undefined);
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
});
