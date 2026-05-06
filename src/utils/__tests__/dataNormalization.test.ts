import { describe, expect, it } from 'vitest';

import { normalizeTaskData } from '../dataNormalization';

describe('normalizeTaskData', () => {
  it('normalizes backend task status enum values to frontend status values', () => {
    expect(normalizeTaskData({ status: 'Pending' }).status).toBe('pending');
    expect(normalizeTaskData({ status: 'Downloading' }).status).toBe('downloading');
    expect(normalizeTaskData({ status: 'Completed' }).status).toBe('completed');
  });
});
