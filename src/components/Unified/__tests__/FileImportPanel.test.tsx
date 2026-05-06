import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const importCommandMocks = vi.hoisted(() => ({
  previewImportDataCommand: vi.fn(),
  importStructuredFileCommand: vi.fn(),
  selectImportFileCommand: vi.fn(),
}));

const systemCommandMocks = vi.hoisted(() => ({
  selectOutputDirectoryCommand: vi.fn(),
}));

const downloadStoreState = vi.hoisted(() => ({
  addTasks: vi.fn(async (tasks: any[]) => tasks),
  refreshTasks: vi.fn(),
  setFilterStatus: vi.fn(),
  setSearchQuery: vi.fn(),
  setSortBy: vi.fn(),
  recordRecentImport: vi.fn(),
  tasks: [],
}));

const configStoreState = vi.hoisted(() => ({
  config: {
    download: {
      output_directory: '/downloads',
    },
  },
}));

const uiStoreMocks = vi.hoisted(() => ({
  notify: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('../../../features/downloads/api/importCommands', () => importCommandMocks);
vi.mock('../../../features/downloads/api/systemCommands', () => systemCommandMocks);
vi.mock('../../../stores/downloadStore', () => ({
  useDownloadStore: (selector: (state: any) => unknown) => selector(downloadStoreState),
}));
vi.mock('../../../stores/configStore', () => ({
  useConfigStore: (selector: (state: any) => unknown) => selector(configStoreState),
}));
vi.mock('../../../stores/uiStore', () => ({
  notify: uiStoreMocks.notify,
}));

describe('FileImportPanel', () => {
  let FileImportPanel: typeof import('../FileImportPanel').FileImportPanel;

  beforeEach(async () => {
    vi.clearAllMocks();
    downloadStoreState.tasks = [];
    downloadStoreState.addTasks.mockImplementation(async (tasks: any[]) => tasks);
    downloadStoreState.refreshTasks.mockResolvedValue(undefined);
    ({ FileImportPanel } = await import('../FileImportPanel'));
  });

  it('uses the shared output-directory seam for import target selection', async () => {
    const user = userEvent.setup();

    importCommandMocks.selectImportFileCommand.mockResolvedValue('/tmp/import.csv');
    importCommandMocks.previewImportDataCommand.mockResolvedValue({
      headers: ['视频链接'],
      rows: [['https://example.com/video.mp4']],
      total_rows: 1,
      encoding: 'UTF-8',
      field_mapping: { 视频链接: 'url' },
    });
    systemCommandMocks.selectOutputDirectoryCommand.mockResolvedValue('/custom-downloads');

    render(<FileImportPanel />);

    const selectPanel = screen.getByText('点击选择 CSV 或 Excel 文件').parentElement;

    if (!selectPanel) {
      throw new Error('select panel not found');
    }

    selectPanel.click();
    await screen.findByRole('button', { name: '更改目录' });
    await user.click(screen.getByRole('button', { name: '更改目录' }));

    expect(systemCommandMocks.selectOutputDirectoryCommand).toHaveBeenCalledWith({
      defaultPath: '/downloads',
      title: '选择下载目录',
    });
  });

  it('reports duplicate import reconciliation instead of claiming new tasks were created', async () => {
    const user = userEvent.setup();
    const existingTask = {
      id: 'existing-task',
      url: 'https://example.com/video.mp4',
      title: 'Existing Video',
      output_path: '/downloads',
      status: 'completed',
      progress: 100,
      downloaded_size: 100,
      speed: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    downloadStoreState.tasks = [existingTask];
    downloadStoreState.addTasks.mockResolvedValue([existingTask]);
    importCommandMocks.selectImportFileCommand.mockResolvedValue('/tmp/import.csv');
    importCommandMocks.previewImportDataCommand.mockResolvedValue({
      headers: ['视频链接'],
      rows: [['https://example.com/video.mp4']],
      total_rows: 1,
      encoding: 'UTF-8',
      field_mapping: { 视频链接: 'record_url' },
    });
    importCommandMocks.importStructuredFileCommand.mockResolvedValue([
      {
        record_url: 'https://example.com/video.mp4',
        kc_name: 'Existing Video',
      },
    ]);

    render(<FileImportPanel />);

    const selectPanel = screen.getByText('点击选择 CSV 或 Excel 文件').parentElement;

    if (!selectPanel) {
      throw new Error('select panel not found');
    }

    selectPanel.click();
    await user.click(await screen.findByRole('button', { name: '确认导入 1 个任务' }));

    expect(uiStoreMocks.notify.info).toHaveBeenCalledWith(
      '未创建新任务',
      '已识别 1 个已有任务（已完成 1）'
    );
    expect(uiStoreMocks.notify.success).not.toHaveBeenCalledWith(
      expect.stringContaining('成功导入')
    );
  });
});
