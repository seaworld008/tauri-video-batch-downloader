import { describe, expect, it } from 'vitest';
import { buildTaskIdPayload } from '../tauriPayloads';

describe('buildTaskIdPayload', () => {
  it('includes request_id fields for idempotent command submission', () => {
    const payload = buildTaskIdPayload('task-1', 'req-1');

    expect(payload.task_id).toBe('task-1');
    expect(payload.taskId).toBe('task-1');
    expect(payload.request_id).toBe('req-1');
    expect(payload.requestId).toBe('req-1');
  });
});

