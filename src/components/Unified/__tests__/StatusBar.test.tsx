import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StatusBar } from '../StatusBar';
import { useDownloadStore } from '../../../stores/downloadStore';

vi.mock('../../../stores/downloadStore');

const mockUseDownloadStore = vi.mocked(useDownloadStore);

describe('Unified StatusBar', () => {
  beforeEach(() => {
    const mockState = {
      tasks: [
        { id: 'downloading-1', status: 'downloading', downloaded_size: 1024 },
        { id: 'downloading-2', status: 'downloading', downloaded_size: 2048 },
        { id: 'committing-1', status: 'committing', downloaded_size: 512 },
        { id: 'paused-1', status: 'paused', downloaded_size: 256 },
        { id: 'failed-1', status: 'failed', downloaded_size: 128 },
        { id: 'completed-1', status: 'completed', downloaded_size: 4096 },
      ],
      stats: {
        total_tasks: 6,
        completed_tasks: 1,
        failed_tasks: 1,
        total_downloaded: 0,
        average_speed: 2048,
        display_total_speed_bps: 4096,
        active_downloads: 3,
        queue_paused: false,
        average_commit_duration: 1.4,
        p95_commit_duration: 2.7,
        failed_commit_count: 1,
        commit_warning_count: 2,
        commit_elevated_warning_count: 0,
      },
    };

    mockUseDownloadStore.mockImplementation((selector?: unknown) =>
      typeof selector === 'function'
        ? (selector as (state: typeof mockState) => unknown)(mockState)
        : mockState
    );
  });

  it('renders total speed from store stats display_total_speed_bps on the authoritative mainline status bar', () => {
    render(<StatusBar />);

    expect(screen.getByText('总速度')).toBeInTheDocument();
    expect(screen.getByText('4 KB/s')).toBeInTheDocument();
  });

  it('derives task phase counters from tasks instead of download stats placeholders', () => {
    render(<StatusBar />);

    expect(screen.getByTestId('active-tasks')).toHaveTextContent('传输中2');
    expect(screen.getByText('提交中').closest('div')).toHaveTextContent('提交中1');
    expect(screen.getByText('已暂停').closest('div')).toHaveTextContent('已暂停1');
    expect(screen.getByText('已完成').closest('div')).toHaveTextContent('已完成1');
    expect(screen.getByText('错误').closest('div')).toHaveTextContent('错误1');
  });

  it('falls back to 0 B/s when total speed stats are unavailable', () => {
    const zeroState = {
      tasks: [],
      stats: {
        total_tasks: 0,
        completed_tasks: 0,
        failed_tasks: 0,
        total_downloaded: 0,
        average_speed: 0,
        display_total_speed_bps: 0,
        active_downloads: 0,
        queue_paused: false,
        average_commit_duration: 0,
        p95_commit_duration: 0,
        failed_commit_count: 0,
        commit_warning_count: 0,
        commit_elevated_warning_count: 0,
      },
    };

    mockUseDownloadStore.mockImplementation((selector?: unknown) =>
      typeof selector === 'function'
        ? (selector as (state: typeof zeroState) => unknown)(zeroState)
        : zeroState
    );

    render(<StatusBar />);

    expect(screen.getByText('0 B/s')).toBeInTheDocument();
  });
});
