import { describe, expect, it } from 'vitest';
import {
  parseDownloadEventEnvelopeV1,
  parseTaskProgressedPayload,
  parseTaskStatusChangedPayload,
  SUPPORTED_DOWNLOAD_EVENT_SCHEMA,
} from '../contracts';

describe('download_event_v1 contracts', () => {
  it('parses a valid envelope', () => {
    const result = parseDownloadEventEnvelopeV1({
      schema_version: SUPPORTED_DOWNLOAD_EVENT_SCHEMA,
      event_id: 'evt-1',
      event_type: 'task.progressed',
      ts: '2026-04-10T10:00:00Z',
      payload: { task_id: 'task-1', progress: 0.5 },
    });

    expect(result.success).toBe(true);
  });

  it('rejects unknown schema version', () => {
    const result = parseDownloadEventEnvelopeV1({
      schema_version: 99,
      event_id: 'evt-1',
      event_type: 'task.progressed',
      ts: '2026-04-10T10:00:00Z',
      payload: {},
    });

    expect(result.success).toBe(false);
  });

  it('parses task.progressed payload', () => {
    const result = parseTaskProgressedPayload({
      task_id: 'task-1',
      downloaded_size: 512,
      total_size: 1024,
      progress: 0.5,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.progress).toBe(0.5);
    }
  });

  it('rejects invalid task.progressed payload', () => {
    const result = parseTaskProgressedPayload({
      task_id: 'task-1',
      downloaded_size: 'bad',
    });

    expect(result.success).toBe(false);
  });

  it('parses task.status_changed payload', () => {
    const result = parseTaskStatusChangedPayload({
      task_id: 'task-1',
      status: 'Downloading',
      error_message: null,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('Downloading');
    }
  });
});
