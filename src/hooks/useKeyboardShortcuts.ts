import { useEffect } from 'react';

interface KeyboardShortcutsHandlers {
  onFocusSearch: () => void;
  onToggleSettings: () => void;
  onSelectAll: () => void;
  onTogglePauseResume: () => void;
  onEscape: () => void;
  onToggleShortcutsModal: () => void;
}

const isEditableElement = (target: EventTarget | null): boolean => {
  if (!target || typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) {
    return false;
  }
  const tagName = target.tagName.toLowerCase();
  if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
    return true;
  }
  return target.isContentEditable;
};

const isInteractiveControl = (target: EventTarget | null): boolean => {
  if (!target || typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) {
    return false;
  }
  const tagName = target.tagName.toLowerCase();
  return tagName === 'button' || tagName === 'a' || target.getAttribute('role') === 'button';
};

export const useKeyboardShortcuts = ({
  onFocusSearch,
  onToggleSettings,
  onSelectAll,
  onTogglePauseResume,
  onEscape,
  onToggleShortcutsModal,
}: KeyboardShortcutsHandlers): void => {
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onEscape();
        return;
      }

      const modPressed = event.ctrlKey || event.metaKey;
      const editable = isEditableElement(event.target);

      if (modPressed && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        onFocusSearch();
        return;
      }

      if (modPressed && event.key === ',') {
        event.preventDefault();
        onToggleSettings();
        return;
      }

      if (editable) {
        return;
      }

      if (event.key === '/' && !modPressed && !event.altKey) {
        event.preventDefault();
        onFocusSearch();
        return;
      }

      if (modPressed && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        onSelectAll();
        return;
      }

      if (event.key === '?' && !modPressed && !event.altKey) {
        event.preventDefault();
        onToggleShortcutsModal();
        return;
      }

      if (event.code === 'Space' && !modPressed && !event.altKey) {
        if (isInteractiveControl(event.target)) {
          return;
        }
        event.preventDefault();
        onTogglePauseResume();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    onEscape,
    onFocusSearch,
    onSelectAll,
    onTogglePauseResume,
    onToggleSettings,
    onToggleShortcutsModal,
  ]);
};
