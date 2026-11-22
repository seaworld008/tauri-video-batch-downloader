import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useKeyboardShortcuts } from '../useKeyboardShortcuts';

interface HarnessProps {
  onFocusSearch: () => void;
  onToggleSettings: () => void;
  onSelectAll: () => void;
  onTogglePauseResume: () => void;
  onEscape: () => void;
  onToggleShortcutsModal: () => void;
}

const ShortcutHarness: React.FC<HarnessProps> = handlers => {
  useKeyboardShortcuts(handlers);
  return (
    <div data-testid='stage'>
      <input data-testid='editor' type='text' />
      <button data-testid='btn' type='button'>
        Action
      </button>
    </div>
  );
};

describe('useKeyboardShortcuts', () => {
  const createHandlers = () => ({
    onFocusSearch: vi.fn(),
    onToggleSettings: vi.fn(),
    onSelectAll: vi.fn(),
    onTogglePauseResume: vi.fn(),
    onEscape: vi.fn(),
    onToggleShortcutsModal: vi.fn(),
  });

  it('triggers global shortcuts from non-editable elements', () => {
    const handlers = createHandlers();
    render(<ShortcutHarness {...handlers} />);
    const stage = screen.getByTestId('stage');

    fireEvent.keyDown(stage, { key: 'k', ctrlKey: true });
    expect(handlers.onFocusSearch).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(stage, { key: '/' });
    expect(handlers.onFocusSearch).toHaveBeenCalledTimes(2);

    fireEvent.keyDown(stage, { key: ',', ctrlKey: true });
    expect(handlers.onToggleSettings).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(stage, { key: 'a', metaKey: true });
    expect(handlers.onSelectAll).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(stage, { key: ' ', code: 'Space' });
    expect(handlers.onTogglePauseResume).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(stage, { key: '?' });
    expect(handlers.onToggleShortcutsModal).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(stage, { key: 'Escape' });
    expect(handlers.onEscape).toHaveBeenCalledTimes(1);
  });

  it('suppresses text-sensitive shortcuts inside editable inputs while allowing Ctrl/Cmd+K, Ctrl/Cmd+,, and Escape', () => {
    const handlers = createHandlers();
    render(<ShortcutHarness {...handlers} />);
    const input = screen.getByTestId('editor');
    const button = screen.getByTestId('btn');

    fireEvent.keyDown(input, { key: '/' });
    fireEvent.keyDown(input, { key: 'a', ctrlKey: true });
    fireEvent.keyDown(input, { key: ' ', code: 'Space' });
    fireEvent.keyDown(input, { key: '?' });
    fireEvent.keyDown(button, { key: ' ', code: 'Space' });

    expect(handlers.onFocusSearch).not.toHaveBeenCalled();
    expect(handlers.onSelectAll).not.toHaveBeenCalled();
    expect(handlers.onTogglePauseResume).not.toHaveBeenCalled();
    expect(handlers.onToggleShortcutsModal).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: 'k', metaKey: true });
    fireEvent.keyDown(input, { key: ',', ctrlKey: true });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(handlers.onFocusSearch).toHaveBeenCalledTimes(1);
    expect(handlers.onToggleSettings).toHaveBeenCalledTimes(1);
    expect(handlers.onEscape).toHaveBeenCalledTimes(1);
  });
});
