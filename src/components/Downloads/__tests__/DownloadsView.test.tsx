import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DownloadsView } from '../DownloadsView';

vi.mock('../OptimizedDownloadsView', () => ({
  OptimizedDownloadsView: () => <div data-testid='optimized-downloads-view' />,
}));

describe('DownloadsView', () => {
  it('renders optimized downloads view wrapper', () => {
    render(<DownloadsView />);
    expect(screen.getByTestId('optimized-downloads-view')).toBeInTheDocument();
  });
});
