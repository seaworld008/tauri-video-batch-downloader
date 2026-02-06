import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/tauri';
import { invokeTauri } from '../tauriBridge';

vi.mock('@tauri-apps/api/tauri', () => ({
  invoke: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(invoke).mockReset();
});

describe('invokeTauri', () => {
  it('passes args through unchanged', async () => {
    vi.mocked(invoke).mockResolvedValue('ok');

    await invokeTauri('test_command', {
      filePath: 'sample/path',
      taskIds: ['task-1', 'task-2'],
      nestedValue: {
        keep_original_key: true,
      },
    });

    expect(invoke).toHaveBeenCalledWith(
      'test_command',
      expect.objectContaining({
        filePath: 'sample/path',
        taskIds: ['task-1', 'task-2'],
        nestedValue: {
          keep_original_key: true,
        },
      })
    );
  });

  it('passes through when no args are provided', async () => {
    vi.mocked(invoke).mockResolvedValue('ok');

    await invokeTauri('no_args_command');

    expect(invoke).toHaveBeenCalledWith('no_args_command');
  });
});
