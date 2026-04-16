import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import {
  exportConfigCommand,
  getConfigCommand,
  importConfigCommand,
  resetConfigCommand,
  updateConfigCommand,
} from '../configCommands';
import type { AppConfig } from '../../../../types';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

describe('config api command seam', () => {
  const config: AppConfig = {
    download: {
      concurrent_downloads: 3,
      retry_attempts: 3,
      timeout_seconds: 30,
      user_agent: 'ua',
      proxy: undefined,
      headers: {},
      output_directory: 'downloads',
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
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(invoke).mockResolvedValue(undefined as never);
  });

  it('wraps get/update/reset/export/import config commands with stable payloads', async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce(config as never)
      .mockResolvedValueOnce(undefined as never)
      .mockResolvedValueOnce(config as never)
      .mockResolvedValueOnce(undefined as never)
      .mockResolvedValueOnce(config as never);

    await expect(getConfigCommand()).resolves.toEqual(config);
    await expect(updateConfigCommand(config)).resolves.toBeUndefined();
    await expect(resetConfigCommand()).resolves.toEqual(config);
    await expect(exportConfigCommand('/tmp/config.json')).resolves.toBeUndefined();
    await expect(importConfigCommand('/tmp/config.json')).resolves.toEqual(config);

    expect(invoke).toHaveBeenNthCalledWith(1, 'get_config');
    expect(invoke).toHaveBeenNthCalledWith(2, 'update_config', {
      newConfig: config,
      new_config: config,
    });
    expect(invoke).toHaveBeenNthCalledWith(3, 'reset_config');
    expect(invoke).toHaveBeenNthCalledWith(4, 'export_config', {
      filePath: '/tmp/config.json',
      file_path: '/tmp/config.json',
    });
    expect(invoke).toHaveBeenNthCalledWith(5, 'import_config', {
      filePath: '/tmp/config.json',
      file_path: '/tmp/config.json',
    });
  });
});
