import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardToolbar } from '../DashboardToolbar';

const systemCommandMocks = vi.hoisted(() => ({
  openDownloadFolderCommand: vi.fn(),
  selectOutputDirectoryCommand: vi.fn(),
}));

const frontendLoggingMocks = vi.hoisted(() => ({
  reportFrontendIssue: vi.fn(),
}));

const toastMock = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
  }),
}));

const storeActions = vi.hoisted(() => ({
  startAllDownloads: vi.fn(),
  pauseAllDownloads: vi.fn(),
  removeTasks: vi.fn().mockResolvedValue(undefined),
  clearSelection: vi.fn(),
  setSelectedTasks: vi.fn(),
  startDownload: vi.fn(),
  pauseDownload: vi.fn(),
  applyOutputDirectoryOverride: vi.fn(),
  setFilterStatus: vi.fn(),
  setSearchQuery: vi.fn(),
  refreshStats: vi.fn().mockResolvedValue(undefined),
  forceSync: vi.fn().mockResolvedValue(undefined),
}));

const storeState = vi.hoisted(() => ({
  tasks: [],
  selectedTasks: [],
  filterStatus: 'all',
  searchQuery: '',
  stats: {
    total_tasks: 0,
    completed_tasks: 0,
    failed_tasks: 0,
    total_downloaded: 0,
    average_speed: 0,
    display_total_speed_bps: 0,
    active_downloads: 0,
    queue_paused: false,
    average_transfer_duration: 0,
    average_commit_duration: 0,
    p95_commit_duration: 0,
    failed_commit_count: 0,
    commit_warning_count: 0,
    commit_elevated_warning_count: 0,
  },
}));

const configState = vi.hoisted(() => ({
  config: {
    download: {
      output_directory: '/downloads',
    },
  },
}));

vi.mock('../../../features/downloads/api/systemCommands', () => systemCommandMocks);
vi.mock('../../../utils/frontendLogging', () => frontendLoggingMocks);
vi.mock('react-hot-toast', () => ({
  default: toastMock.toast,
}));
vi.mock('../../../stores/downloadStore', () => ({
  useDownloadStore: (selector: (state: any) => unknown) =>
    selector({
      ...storeState,
      ...storeActions,
    }),
}));
vi.mock('../../../stores/configStore', () => ({
  useConfigStore: (selector: (state: any) => unknown) => selector(configState),
}));

describe('DashboardToolbar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeState.tasks = [];
    storeState.selectedTasks = [];
    storeState.filterStatus = 'all';
    storeState.searchQuery = '';
    storeState.stats = {
      total_tasks: 0,
      completed_tasks: 0,
      failed_tasks: 0,
      total_downloaded: 0,
      average_speed: 0,
      display_total_speed_bps: 0,
      active_downloads: 0,
      queue_paused: false,
      average_transfer_duration: 0,
      average_commit_duration: 0,
      p95_commit_duration: 0,
      failed_commit_count: 0,
      commit_warning_count: 0,
      commit_elevated_warning_count: 0,
    };
    configState.config.download.output_directory = '/downloads';
    frontendLoggingMocks.reportFrontendIssue.mockReset();
  });

  it('uses the authoritative toolbar settings entrypoint when the settings button is clicked', async () => {
    const user = userEvent.setup();
    const onOpenSettings = vi.fn();

    render(<DashboardToolbar onOpenSettings={onOpenSettings} />);

    await user.click(screen.getByRole('button', { name: '去设置' }));

    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('opens the configured download folder through the shared system command seam', async () => {
    const user = userEvent.setup();

    render(<DashboardToolbar />);

    await user.click(screen.getByTitle('默认下载目录：/downloads。点击打开目录'));

    expect(systemCommandMocks.openDownloadFolderCommand).toHaveBeenCalledTimes(1);
  });

  it('reports download-folder open failures through the shared frontend logging seam', async () => {
    const user = userEvent.setup();
    systemCommandMocks.openDownloadFolderCommand.mockRejectedValueOnce(new Error('shell failed'));

    render(<DashboardToolbar />);

    await user.click(screen.getByTitle('默认下载目录：/downloads。点击打开目录'));

    await waitFor(() => {
      expect(frontendLoggingMocks.reportFrontendIssue).toHaveBeenCalledWith(
        'error',
        'dashboard_toolbar:open_download_folder_failed',
        expect.any(Error)
      );
    });
    expect(toastMock.toast.error).toHaveBeenCalledWith('打开下载目录失败');
  });

  it('uses the shared directory selection seam for temporary output override', async () => {
    const user = userEvent.setup();

    storeState.tasks = [
      {
        id: 'pending-task',
        title: 'Pending task',
        url: 'https://example.com/pending.mp4',
        output_path: '/downloads/pending.mp4',
        status: 'pending',
        progress: 0,
        downloaded_size: 0,
        speed: 0,
        display_speed_bps: 0,
        created_at: new Date(0).toISOString(),
        updated_at: new Date(0).toISOString(),
      },
    ];
    systemCommandMocks.selectOutputDirectoryCommand.mockResolvedValue('/picked-downloads');

    render(<DashboardToolbar />);

    await user.click(screen.getByRole('button', { name: '全部开始' }));
    await user.click(screen.getByRole('button', { name: '本次更改位置' }));

    expect(systemCommandMocks.selectOutputDirectoryCommand).toHaveBeenCalledWith({
      defaultPath: '/downloads',
      title: '选择本次保存位置',
    });
  });

  it('cleans inactive tasks through the confirm dialog instead of deleting immediately', async () => {
    const user = userEvent.setup();

    storeState.tasks = [
      {
        id: 'completed-task',
        title: 'Completed task',
        url: 'https://example.com/completed.mp4',
        output_path: '/downloads/completed.mp4',
        status: 'completed',
        progress: 100,
        downloaded_size: 10,
        speed: 0,
        display_speed_bps: 0,
        created_at: new Date(0).toISOString(),
        updated_at: new Date(0).toISOString(),
      },
      {
        id: 'failed-task',
        title: 'Failed task',
        url: 'https://example.com/failed.mp4',
        output_path: '/downloads/failed.mp4',
        status: 'failed',
        progress: 30,
        downloaded_size: 3,
        speed: 0,
        display_speed_bps: 0,
        created_at: new Date(0).toISOString(),
        updated_at: new Date(0).toISOString(),
      },
      {
        id: 'active-task',
        title: 'Active task',
        url: 'https://example.com/active.mp4',
        output_path: '/downloads/active.mp4',
        status: 'downloading',
        progress: 40,
        downloaded_size: 4,
        speed: 128,
        display_speed_bps: 128,
        created_at: new Date(0).toISOString(),
        updated_at: new Date(0).toISOString(),
      },
    ];

    render(<DashboardToolbar />);

    await user.click(screen.getByRole('button', { name: '清理残留任务' }));

    expect(storeActions.removeTasks).not.toHaveBeenCalled();
    expect(screen.getByText('确认清理残留任务')).toBeInTheDocument();
    expect(screen.getByText('Completed task')).toBeInTheDocument();
    expect(screen.getByText('Failed task')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '确认清理' }));

    await waitFor(() => {
      expect(storeActions.removeTasks).toHaveBeenCalledWith(['completed-task', 'failed-task']);
    });
    expect(storeActions.clearSelection).toHaveBeenCalledTimes(1);
  });
});
