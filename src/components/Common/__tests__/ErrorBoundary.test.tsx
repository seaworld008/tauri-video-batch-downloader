import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const frontendLoggingMocks = vi.hoisted(() => ({
  reportFrontendIssue: vi.fn(),
}));

vi.mock('../../../i18n/hooks', () => ({
  useSafeTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('../../../utils/frontendLogging', () => frontendLoggingMocks);

import { ErrorBoundary } from '../ErrorBoundary';

const Boom = () => {
  throw new Error('boundary boom');
};

describe('ErrorBoundary', () => {
  it('reports caught errors through frontend logging seam', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );

    expect(screen.getByText('errors.systemError')).toBeInTheDocument();
    expect(frontendLoggingMocks.reportFrontendIssue).toHaveBeenCalledWith(
      'error',
      'error_boundary:caught_error',
      expect.objectContaining({
        error: expect.any(Error),
        componentStack: expect.any(String),
      })
    );
  });
});
