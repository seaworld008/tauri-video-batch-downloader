import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsView } from '../SettingsView';

const systemCommandMocks = vi.hoisted(() => ({
  checkExternalToolUpdatesCommand: vi.fn(),
  clearExternalToolOverrideCommand: vi.fn(),
  getExternalToolStatusCommand: vi.fn(),
  rollbackExternalToolCommand: vi.fn(),
  selectExternalToolBinaryCommand: vi.fn(),
  selectOutputDirectoryCommand: vi.fn(),
  setExternalToolOverrideCommand: vi.fn(),
  updateExternalToolCommand: vi.fn(),
}));

const frontendLoggingMocks = vi.hoisted(() => ({
  reportFrontendIssue: vi.fn(),
}));

const notifyMocks = vi.hoisted(() => ({
  notify: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const configState = vi.hoisted(() => ({
  config: {
    download: {
      concurrent_downloads: 3,
      retry_attempts: 3,
      timeout_seconds: 30,
      user_agent: 'agent',
      proxy: undefined,
      headers: {},
      output_directory: '/default-downloads',
      auto_verify_integrity: false,
      integrity_algorithm: 'sha256',
      expected_hashes: {},
    },
    ui: {
      theme: 'system',
      language: 'zh-CN',
      window_width: 1200,
      window_height: 800,
      window_x: null,
      window_y: null,
      show_completed_tasks: true,
      auto_start_downloads: false,
      show_notifications: true,
      notification_sound: true,
      minimize_to_tray: false,
      start_minimized: false,
    },
    system: {
      auto_update: true,
      check_update_on_startup: true,
      hardware_acceleration: true,
      max_memory_usage_mb: null,
      temp_directory: null,
      log_level: 'info',
    },
    youtube: {
      default_quality: '720p',
      default_format: 'mp4',
      extract_audio: false,
      audio_format: 'mp3',
      download_subtitles: false,
      subtitle_languages: ['zh-CN', 'en'],
      download_thumbnail: true,
      download_description: true,
      playlist_reverse: false,
      playlist_max_items: null,
    },
    advanced: {
      enable_logging: true,
      log_level: 'info',
      max_log_files: 10,
      cleanup_on_exit: true,
      enable_proxy: false,
      proxy_type: 'http',
      proxy_host: undefined,
      proxy_port: undefined,
      proxy_username: undefined,
      proxy_password: undefined,
      custom_user_agents: {},
      rate_limit_mbps: undefined,
      enable_statistics: true,
      statistics_retention_days: 30,
    },
  },
  updateConfig: vi.fn(),
  resetConfig: vi.fn(),
}));

vi.mock('../../../stores/configStore', () => ({
  useConfigStore: (selector: (state: any) => unknown) => selector(configState),
}));
vi.mock('../../../stores/uiStore', () => notifyMocks);
vi.mock('../../../features/downloads/api/systemCommands', () => systemCommandMocks);
vi.mock('../../../utils/frontendLogging', () => frontendLoggingMocks);

describe('SettingsView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configState.config.download.output_directory = '/default-downloads';
    frontendLoggingMocks.reportFrontendIssue.mockReset();
    systemCommandMocks.getExternalToolStatusCommand.mockResolvedValue([
      {
        id: 'yt-dlp',
        display_name: 'yt-dlp',
        status: 'available',
        source: 'bundled_sidecar',
        path: '/app/yt-dlp',
        current_version: '2026.01.01',
        update_available: false,
        can_auto_update: true,
        can_rollback: true,
      },
      {
        id: 'ffmpeg',
        display_name: 'FFmpeg',
        status: 'missing',
        source: 'path_fallback',
        path: 'ffmpeg',
        update_available: false,
        can_auto_update: false,
        can_rollback: false,
      },
    ]);
  });

  it('selects default download directory through the shared system command seam', async () => {
    const user = userEvent.setup();
    systemCommandMocks.selectOutputDirectoryCommand.mockResolvedValue('/picked-downloads');

    render(<SettingsView />);

    expect(screen.getByText('/default-downloads')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '选择目录' }));

    await waitFor(() => {
      expect(systemCommandMocks.selectOutputDirectoryCommand).toHaveBeenCalledTimes(1);
    });

    expect(screen.getByText('/picked-downloads')).toBeInTheDocument();
  });

  it('reports directory selection failures through the shared frontend logging seam', async () => {
    const user = userEvent.setup();
    systemCommandMocks.selectOutputDirectoryCommand.mockRejectedValueOnce(
      new Error('dialog unavailable')
    );

    render(<SettingsView />);

    await user.click(screen.getByRole('button', { name: '选择目录' }));

    await waitFor(() => {
      expect(frontendLoggingMocks.reportFrontendIssue).toHaveBeenCalledWith(
        'error',
        'settings_view:select_output_directory_failed',
        expect.any(Error)
      );
    });
    expect(notifyMocks.notify.error).toHaveBeenCalledWith('选择目录失败', expect.any(Error));
  });

  it('checks external tool updates from settings', async () => {
    const user = userEvent.setup();
    systemCommandMocks.checkExternalToolUpdatesCommand.mockResolvedValueOnce([
      {
        id: 'yt-dlp',
        display_name: 'yt-dlp',
        status: 'available',
        source: 'managed',
        path: '/managed/yt-dlp',
        current_version: '2026.01.01',
        latest_version: '2026.02.01',
        update_available: true,
        can_auto_update: true,
        can_rollback: true,
      },
    ]);

    render(<SettingsView />);

    await user.click(await screen.findByRole('button', { name: '检查更新' }));

    await waitFor(() => {
      expect(systemCommandMocks.checkExternalToolUpdatesCommand).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText('最新 2026.02.01')).toBeInTheDocument();
    expect(
      await screen.findByText(
        '更新会先校验 checksum，再执行兼容性探测；探测失败不会替换当前可用版本。'
      )
    ).toBeInTheDocument();
  });

  it('explains the manual trusted-binary path for ffmpeg updates', async () => {
    render(<SettingsView />);

    expect(
      await screen.findByText(
        'FFmpeg 采用可信本地文件手动更新；选择后会先执行版本和兼容性探测，通过后才切换。'
      )
    ).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: '选择新版文件' })).toBeInTheDocument();
  });

  it('rolls back a managed external tool version from settings', async () => {
    const user = userEvent.setup();
    systemCommandMocks.rollbackExternalToolCommand.mockResolvedValueOnce({
      id: 'yt-dlp',
      display_name: 'yt-dlp',
      status: 'available',
      source: 'managed',
      path: '/managed/yt-dlp',
      current_version: '2026.01.01',
      update_available: false,
      can_auto_update: true,
      can_rollback: true,
    });

    render(<SettingsView />);

    await user.click(await screen.findByRole('button', { name: '回退上一版' }));

    await waitFor(() => {
      expect(systemCommandMocks.rollbackExternalToolCommand).toHaveBeenCalledWith('yt-dlp');
    });
    expect(notifyMocks.notify.success).toHaveBeenCalledWith(
      '工具已回退',
      'yt-dlp 已切回上一个 App 管理版本'
    );
  });
});
