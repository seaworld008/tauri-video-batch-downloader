import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ManualInputPanel } from '../ManualInputPanel';

const systemCommandMocks = vi.hoisted(() => ({
  getVideoInfoCommand: vi.fn(),
  readClipboardTextCommand: vi.fn(),
  selectOutputDirectoryCommand: vi.fn(),
}));

const notifyMocks = vi.hoisted(() => ({
  notify: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const downloadStoreActions = vi.hoisted(() => ({
  addTasks: vi.fn(),
  enqueueDownloads: vi.fn(),
  recordRecentImport: vi.fn(),
  setFilterStatus: vi.fn(),
  setSearchQuery: vi.fn(),
}));

const configState = vi.hoisted(() => ({
  config: {
    download: {
      output_directory: '/default-downloads',
    },
  },
}));

vi.mock('../../../stores/downloadStore', () => ({
  useDownloadStore: (selector: (state: any) => unknown) =>
    selector({
      ...downloadStoreActions,
    }),
}));

vi.mock('../../../stores/configStore', () => ({
  useConfigStore: (selector: (state: any) => unknown) => selector(configState),
}));

vi.mock('../../../stores/uiStore', () => notifyMocks);
vi.mock('../../../features/downloads/api/systemCommands', () => systemCommandMocks);

describe('ManualInputPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configState.config.download.output_directory = '/default-downloads';
  });

  it('selects output directory through the shared system command seam', async () => {
    const user = userEvent.setup();
    systemCommandMocks.selectOutputDirectoryCommand.mockResolvedValue('/picked-downloads');

    render(<ManualInputPanel />);

    await user.type(screen.getByTestId('url-input'), 'https://example.com/video.mp4');
    await user.click(screen.getByTestId('add-url'));
    await user.click(screen.getByDisplayValue('/default-downloads'));

    await waitFor(() => {
      expect(systemCommandMocks.selectOutputDirectoryCommand).toHaveBeenCalledTimes(1);
    });

    expect(screen.getByDisplayValue('/picked-downloads')).toBeInTheDocument();
  });

  it('reads clipboard text through the native system command seam', async () => {
    const user = userEvent.setup();
    systemCommandMocks.readClipboardTextCommand.mockResolvedValue(
      'not-a-url\nhttps://example.com/video.mp4'
    );

    render(<ManualInputPanel />);

    await user.click(screen.getByTitle('从剪贴板粘贴'));

    expect(systemCommandMocks.readClipboardTextCommand).toHaveBeenCalledTimes(1);
    expect(screen.getByText('待添加列表 (1)')).toBeInTheDocument();
    expect(screen.getByText('https://example.com/video.mp4')).toBeInTheDocument();
    expect(notifyMocks.notify.success).toHaveBeenCalledWith('添加成功', '从剪贴板添加了 1 个链接');
  });
});
