/**
 * 集成测试设置文件
 * 配置测试环境和全局模拟
 */

import { randomFillSync } from 'crypto';
import { beforeAll, afterAll, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { clearMocks } from '@tauri-apps/api/mocks';
import '@testing-library/jest-dom';

// 全局设置
beforeAll(() => {
  // 设置 WebCrypto API (jsdom 环境需要)
  Object.defineProperty(window, 'crypto', {
    value: {
      getRandomValues: (buffer: any) => {
        return randomFillSync(buffer);
      },
    },
  });

  // 设置 ResizeObserver 模拟
  global.ResizeObserver = class ResizeObserver {
    constructor(callback: ResizeObserverCallback) {
      // Mock implementation
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  };

  // 设置 IntersectionObserver 模拟
  global.IntersectionObserver = class IntersectionObserver {
    root = null;
    rootMargin = '0px';
    thresholds = [0];

    constructor(callback: IntersectionObserverCallback) {
      // Mock implementation
    }
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  };

  // 模拟 matchMedia
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => {},
    }),
  });

  // 设置全局控制台过滤
  const originalError = console.error;
  const originalWarn = console.warn;
  const originalLog = console.log;
  const showTestLogs = typeof process !== 'undefined' && process.env.VITEST_SHOW_LOGS === 'true';

  if (!showTestLogs) {
    console.log = () => {};
    console.warn = () => {};
    console.error = () => {};
  } else {
    console.error = (...args: any[]) => {
      // 过滤掉一些已知的测试环境警告
      if (
        typeof args[0] === 'string' &&
        (args[0].includes('ReactDOMTestUtils.act') ||
          args[0].includes('Warning: An invalid form control'))
      ) {
        return;
      }
      originalError.call(console, ...args);
    };
  }

  console.warn = (...args: any[]) => {
    if (!showTestLogs) {
      return;
    }
    if (typeof args[0] === 'string' && args[0].includes('componentWillReceiveProps')) {
      return;
    }
    originalWarn.call(console, ...args);
  };
  (globalThis as any).__vitestConsoleRestore__ = {
    originalError,
    originalWarn,
    originalLog,
  };
});

// 每个测试后清理
afterEach(() => {
  // 清理 React Testing Library
  cleanup();

  // 清理 Tauri 模拟
  clearMocks();

  // 清理任何定时器
  vi.clearAllTimers();
  vi.clearAllMocks();
});

// 全局清理
afterAll(() => {
  // 恢复原始控制台方法
  const restore = (globalThis as any).__vitestConsoleRestore__;
  if (restore) {
    console.error = restore.originalError;
    console.warn = restore.originalWarn;
    console.log = restore.originalLog;
    delete (globalThis as any).__vitestConsoleRestore__;
  }
});

// 设置默认的 Tauri 模拟
import { mockIPC } from '@tauri-apps/api/mocks';

// 默认的 IPC 模拟响应
export const setupDefaultMocks = () => {
  mockIPC((cmd, args) => {
    switch (cmd) {
      case 'get_download_tasks':
        return [];

      case 'get_download_stats':
        return {
          total_tasks: 0,
          completed_tasks: 0,
          failed_tasks: 0,
          total_downloaded: 0,
          average_speed: 0,
          active_downloads: 0,
          queue_paused: false,
        };

      case 'get_config':
        return {
          download: {
            concurrent_downloads: 3,
            retry_attempts: 3,
            timeout_seconds: 30,
            user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            proxy: null,
            headers: {},
            output_directory: 'downloads',
          },
        };

      case 'add_download_tasks':
        return Promise.resolve();

      case 'remove_download_tasks':
        return Promise.resolve();

      case 'start_download':
        return Promise.resolve();

      case 'pause_download':
        return Promise.resolve();

      case 'resume_download':
        return Promise.resolve();

      case 'cancel_download':
        return Promise.resolve();

      case 'update_config':
        return Promise.resolve();

      case 'import_csv_file':
        return [];

      case 'get_system_info':
        return {
          cpu_usage: 25.5,
          memory_usage: 60.2,
          disk_usage: 45.8,
          network_speed: {
            download: 1048576.0,
            upload: 262144.0,
          },
          active_downloads: 0,
        };

      default:
        console.warn(`未处理的 IPC 命令: ${cmd}`);
        return Promise.resolve();
    }
  });
};

// 辅助函数：创建测试用的任务数据
export const createMockTask = (overrides = {}) => ({
  id: `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
  url: 'https://example.com/video.mp4',
  title: '测试视频',
  output_path: '/downloads/test_video.mp4',
  status: 'pending',
  progress: 0,
  downloaded_size: 0,
  file_size: null,
  speed: 0,
  eta: null,
  error_message: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  downloader_type: 'http',
  ...overrides,
});

// 辅助函数：创建测试用的统计数据
export const createMockStats = (overrides = {}) => ({
  total_tasks: 0,
  completed_tasks: 0,
  failed_tasks: 0,
  total_downloaded: 0,
  average_speed: 0,
  active_downloads: 0,
  queue_paused: false,
  ...overrides,
});

// 辅助函数：等待异步操作完成
export const waitForAsync = (ms = 0) => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

// 辅助函数：模拟用户延迟
export const simulateUserDelay = (ms = 100) => {
  return waitForAsync(ms);
};

// E2E 测试相关的辅助函数
export const E2E_SELECTORS = {
  // 应用程序主要元素
  APP_HEADER: '[data-testid="app-header"]',
  APP_SIDEBAR: '[data-testid="app-sidebar"]',
  MAIN_CONTENT: '[data-testid="main-content"]',

  // 导航元素
  NAV_DOWNLOADS: '[data-testid="nav-downloads"]',
  NAV_SETTINGS: '[data-testid="nav-settings"]',

  // 下载页面元素
  DOWNLOADS_PAGE: '[data-testid="downloads-page"]',
  IMPORT_BUTTON: '[data-testid="import-button"]',
  TASK_LIST: '[data-testid="task-list"]',
  TASK_ITEM: '[data-testid="task-item"]',

  // 任务相关元素
  TASK_TITLE: '[data-testid="task-title"]',
  TASK_STATUS: '[data-testid="task-status"]',
  TASK_PROGRESS: '[data-testid="task-progress"]',
  PROGRESS_BAR: '[data-testid="progress-bar"]',

  // 操作按钮
  START_DOWNLOAD: '[data-testid="start-download"]',
  PAUSE_DOWNLOAD: '[data-testid="pause-download"]',
  RESUME_DOWNLOAD: '[data-testid="resume-download"]',
  CANCEL_DOWNLOAD: '[data-testid="cancel-download"]',

  // 对话框元素
  IMPORT_DIALOG: '[data-testid="import-dialog"]',
  URL_TEXTAREA: '[data-testid="url-textarea"]',
  DIALOG_CLOSE: '[data-testid="dialog-close"]',

  // 筛选和搜索
  STATUS_FILTER: '[data-testid="status-filter"]',
  SEARCH_INPUT: '[data-testid="search-input"]',

  // 统计信息
  DOWNLOAD_STATS: '[data-testid="download-stats"]',
  TOTAL_TASKS: '[data-testid="total-tasks"]',
  ACTIVE_TASKS: '[data-testid="active-tasks"]',
  COMPLETED_TASKS: '[data-testid="completed-tasks"]',

  // 设置页面
  SETTINGS_PAGE: '[data-testid="settings-page"]',
  CONCURRENT_DOWNLOADS: '[data-testid="concurrent-downloads"]',
  RETRY_ATTEMPTS: '[data-testid="retry-attempts"]',
  SAVE_SETTINGS: '[data-testid="save-settings"]',
};

// 测试用的示例数据
export const SAMPLE_URLS = [
  'https://sample-videos.com/zip/10/mp4/SampleVideo_1280x720_1mb.mp4',
  'https://sample-videos.com/zip/10/mp4/SampleVideo_1280x720_2mb.mp4',
  'https://sample-videos.com/zip/10/mp4/SampleVideo_1280x720_5mb.mp4',
];

export const SAMPLE_CSV_DATA = `专栏ID,专栏名称,课程ID,课程名称,视频链接
1,测试专栏1,101,第一课,${SAMPLE_URLS[0]}
1,测试专栏1,102,第二课,${SAMPLE_URLS[1]}
2,测试专栏2,201,第一课,${SAMPLE_URLS[2]}`;
