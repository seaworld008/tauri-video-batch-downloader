import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StatusBar } from '../StatusBar';
import { useDownloadStore } from '../../../stores/downloadStore';
import { useSystemInfo } from '../../../hooks/useSystemInfo';

vi.mock('../../../stores/downloadStore');
vi.mock('../../../hooks/useSystemInfo');

const mockUseDownloadStore = vi.mocked(useDownloadStore);
const mockUseSystemInfo = vi.mocked(useSystemInfo);

describe('StatusBar', () => {
  beforeEach(() => {
    mockUseDownloadStore.mockReturnValue({
      tasks: [],
      stats: {
        total_tasks: 4,
        completed_tasks: 1,
        failed_tasks: 0,
        total_downloaded: 0,
        active_downloads: 2,
        average_speed: 2048,
      },
    } as any);

    mockUseSystemInfo.mockReturnValue({
      systemInfo: null,
      isLoading: true,
      error: null,
      lastUpdated: null,
      refresh: vi.fn(),
    });
  });

  it('displays placeholder when system info is loading', () => {
    render(<StatusBar />);
    expect(screen.getByText('系统信息加载中...')).toBeInTheDocument();
  });

  it('renders system metrics when data is available', () => {
    mockUseSystemInfo.mockReturnValue({
      systemInfo: {
        cpu_usage: 42.3,
        memory_usage: 65.5,
        disk_usage: 0,
        network_speed: { download: 2048, upload: 1024 },
        active_downloads: 1,
      },
      isLoading: false,
      error: null,
      lastUpdated: Date.now(),
      refresh: vi.fn(),
    });

    render(<StatusBar />);

    expect(screen.getByText(/CPU:/)).toHaveTextContent('CPU: 42.3%');
    expect(screen.getByText(/内存/)).toHaveTextContent('65.5%');
    expect(screen.getByText(/下载:/)).toHaveTextContent('下载: ↓2 KB/s ↑1 KB/s');
  });
});
