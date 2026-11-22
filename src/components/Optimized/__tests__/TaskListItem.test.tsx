import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { VideoTask } from '../../../types';
import { TaskItem } from '../TaskListItem';

const downloadStoreActions = vi.hoisted(() => ({
  startDownload: vi.fn().mockResolvedValue('started'),
  pauseDownload: vi.fn().mockResolvedValue(undefined),
  resumeDownload: vi.fn().mockResolvedValue(undefined),
  removeTasks: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../stores/downloadStore', () => ({
  useDownloadStore: {
    getState: () => downloadStoreActions,
  },
}));

vi.mock('../../../features/downloads/api/systemCommands', () => ({
  revealPathInFolderCommand: vi.fn().mockResolvedValue(undefined),
}));

const buildTask = (overrides: Partial<VideoTask> = {}): VideoTask => ({
  id: 'task-1',
  url: 'https://example.com/video.mp4',
  title: 'Sample Video',
  output_path: '/downloads/video.mp4',
  status: 'pending',
  progress: 0,
  downloaded_size: 0,
  speed: 0,
  display_speed_bps: 0,
  created_at: new Date(0).toISOString(),
  updated_at: new Date(0).toISOString(),
  ...overrides,
});

describe('TaskListItem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts a pending task and deletes it from per-row actions', async () => {
    const user = userEvent.setup();
    render(
      <TaskItem
        index={0}
        task={buildTask({ status: 'pending' })}
        top={0}
        height={88}
        isSelected={false}
        onSelect={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: '开始任务：Sample Video' }));
    expect(downloadStoreActions.startDownload).toHaveBeenCalledWith('task-1');

    await user.click(screen.getByRole('button', { name: '删除任务：Sample Video' }));
    expect(downloadStoreActions.removeTasks).toHaveBeenCalledWith(['task-1']);
  });

  it('pauses a downloading task and resumes a paused task', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <TaskItem
        index={0}
        task={buildTask({ status: 'downloading', progress: 42 })}
        top={0}
        height={88}
        isSelected={false}
        onSelect={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: '暂停任务：Sample Video' }));
    expect(downloadStoreActions.pauseDownload).toHaveBeenCalledWith('task-1');

    rerender(
      <TaskItem
        index={0}
        task={buildTask({ status: 'paused', progress: 42 })}
        top={0}
        height={88}
        isSelected={false}
        onSelect={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: '继续任务：Sample Video' }));
    expect(downloadStoreActions.resumeDownload).toHaveBeenCalledWith('task-1');
  });

  it('displays error_message and offers single-task retry when a task fails', async () => {
    const user = userEvent.setup();
    render(
      <TaskItem
        index={0}
        task={buildTask({ status: 'failed', error_message: 'HTTP 403 Forbidden' })}
        top={0}
        height={88}
        isSelected={false}
        onSelect={vi.fn()}
      />
    );

    expect(screen.getByTestId('task-error-message')).toHaveTextContent('HTTP 403 Forbidden');
    await user.click(screen.getByRole('button', { name: '重试任务：Sample Video' }));
    expect(downloadStoreActions.startDownload).toHaveBeenCalledWith('task-1');
  });
});
