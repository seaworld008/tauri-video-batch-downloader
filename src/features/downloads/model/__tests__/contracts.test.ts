import { describe, expect, it } from 'vitest';
import {
  parseDownloadEventEnvelopeV1,
  parseTaskProgressedPayload,
  parseTaskStatsUpdatedPayload,
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
      display_speed_bps: 256,
      progress: 0.5,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.progress).toBe(0.5);
      expect(result.data.display_speed_bps).toBe(256);
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

  it('parses task.stats_updated payload', () => {
    const result = parseTaskStatsUpdatedPayload({
      total_tasks: 12,
      completed_tasks: 8,
      average_speed: 300,
      display_total_speed_bps: 1200,
      queue_paused: true,
      average_transfer_duration: 5.4,
      average_commit_duration: 1.7,
      p95_commit_duration: 3.2,
      failed_commit_count: 2,
      commit_warning_count: 4,
      commit_elevated_warning_count: 1,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.total_tasks).toBe(12);
      expect(result.data.display_total_speed_bps).toBe(1200);
      expect(result.data.queue_paused).toBe(true);
      expect(result.data.average_commit_duration).toBe(1.7);
      expect(result.data.p95_commit_duration).toBe(3.2);
      expect(result.data.failed_commit_count).toBe(2);
    }
  });

  it('rejects invalid task.stats_updated payload', () => {
    const result = parseTaskStatsUpdatedPayload('not-object');
    expect(result.success).toBe(false);
  });
});
