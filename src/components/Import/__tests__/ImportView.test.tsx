import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const dialogMocks = vi.hoisted(() => ({
  open: vi.fn(),
}));

const tauriApiMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

const downloadStoreMocks = vi.hoisted(() => ({
  addTasks: vi.fn(async (tasks: any[]) => tasks),
}));

const uiStoreMocks = vi.hoisted(() => ({
  setCurrentView: vi.fn(),
  notify: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('@tauri-apps/plugin-dialog', () => dialogMocks);

vi.mock('@tauri-apps/api/core', () => tauriApiMocks);

vi.mock('../../../stores/downloadStore', () => {
  const storeState = {
    addTasks: downloadStoreMocks.addTasks,
    tasks: [],
    enqueueDownloads: vi.fn(),
    setSelectedTasks: vi.fn(),
    refreshTasks: vi.fn(),
    setFilterStatus: vi.fn(),
    setSearchQuery: vi.fn(),
    setSortBy: vi.fn(),
    recentImportTaskIds: [],
    recentImportSnapshot: [],
    selectedTasks: [],
  };

  const useDownloadStore = (selector: any) =>
    typeof selector === 'function' ? selector(storeState) : storeState;

  (useDownloadStore as any).getState = () => storeState;
  (useDownloadStore as any).setState = (partial: any) => {
    const nextState = typeof partial === 'function' ? partial(storeState) : partial;
    Object.assign(storeState, nextState);
  };

  return { useDownloadStore };
});

vi.mock('../../../stores/configStore', () => ({
  useConfigStore: (selector: any) => {
    const state = {
      config: {
        download: {
          output_directory: 'C:/downloads',
        },
      },
    };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

vi.mock('../../../stores/uiStore', () => ({
  useUIStore: (selector: any) => {
    const state = {
      setCurrentView: uiStoreMocks.setCurrentView,
    };
    return typeof selector === 'function' ? selector(state) : state;
  },
  notify: uiStoreMocks.notify,
}));

import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';

describe('ImportView', () => {
  let ImportView: typeof import('../ImportView').ImportView;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    ({ ImportView } = await import('../ImportView'));
  });

  const basePreview = {
    headers: ['专栏ID', '课程名称', '视频链接'],
    rows: [
      ['1', '课程 A', 'https://example.com/a.mp4'],
      ['2', '课程 B', 'https://example.com/b.mp4'],
    ],
    total_rows: 2,
    encoding: 'UTF-8',
    field_mapping: {
      专栏ID: 'id',
      课程名称: 'course_name',
      视频链接: 'url',
    },
  };

  it('shows preview after selecting a file', async () => {
    vi.mocked(open).mockResolvedValue('C:/videos/sample.csv');
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === 'preview_import_data') {
        expect(args).toMatchObject({
          filePath: 'C:/videos/sample.csv',
          maxRows: 10,
        });
        return basePreview;
      }
      throw new Error(`Unexpected command ${command}`);
    });

    render(<ImportView />);

    const selectButton = screen.getByRole('button', { name: '选择文件' });
    await userEvent.click(selectButton);

    await waitFor(() => {
      expect(screen.getByText(/sample\.csv/)).toBeInTheDocument();
    });

    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('imports tasks successfully', async () => {
    vi.mocked(open).mockResolvedValue('C:/videos/sample.csv');
    vi.mocked(invoke).mockImplementation(async command => {
      if (command === 'preview_import_data') {
        return basePreview;
      }
      if (command === 'import_csv_file') {
        return [
          {
            zl_id: '1',
            kc_name: '课程 A',
            record_url: 'https://example.com/a.mp4',
          },
          {
            zl_id: '2',
            kc_name: '课程 B',
            record_url: 'https://example.com/b.mp4',
          },
        ];
      }
      throw new Error(`Unexpected command ${command}`);
    });

    render(<ImportView />);

    const selectButton = screen.getByRole('button', { name: '选择文件' });
    await userEvent.click(selectButton);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /开始导入/ })).toBeEnabled();
    });

    const isoTimestamp = '2024-01-01T00:00:00.000Z';
    downloadStoreMocks.addTasks.mockResolvedValueOnce([
      {
        id: '1',
        url: 'https://example.com/a.mp4',
        title: '课程 A',
        output_path: 'C:/downloads',
        status: 'pending',
        progress: 0,
        downloaded_size: 0,
        speed: 0,
        created_at: isoTimestamp,
        updated_at: isoTimestamp,
      },
    ]);

    const importButton = screen.getByRole('button', { name: /开始导入/ });
    await userEvent.click(importButton);

    await waitFor(() => {
      expect(downloadStoreMocks.addTasks).toHaveBeenCalled();
    });

    expect(uiStoreMocks.setCurrentView).not.toHaveBeenCalled();
    await waitFor(
      () => {
        expect(uiStoreMocks.notify.success).toHaveBeenCalledWith(
          expect.stringContaining('成功导入')
        );
      },
      { timeout: 2000 }
    );
  });
});
