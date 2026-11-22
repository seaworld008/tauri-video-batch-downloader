import { useConfigStore } from '../stores/configStore';

const isSoundEnabled = (): boolean => {
  try {
    return typeof useConfigStore?.getState === 'function'
      ? (useConfigStore.getState()?.config?.ui?.notification_sound ?? true)
      : true;
  } catch {
    return true;
  }
};

export const playNotificationChime = (kind: 'success' | 'error'): void => {
  if (!isSoundEnabled() || typeof window === 'undefined') {
    return;
  }

  try {
    const AudioCtx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) {
      return;
    }

    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();

    oscillator.type = 'sine';
    if (kind === 'success') {
      oscillator.frequency.setValueAtTime(587.33, now);
      oscillator.frequency.setValueAtTime(880, now + 0.08);
    } else {
      oscillator.frequency.setValueAtTime(329.63, now);
      oscillator.frequency.setValueAtTime(220, now + 0.09);
    }

    gain.gain.setValueAtTime(0.05, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.onended = () => {
      if (typeof ctx.close === 'function') {
        void ctx.close().catch(() => undefined);
      }
    };
    oscillator.start(now);
    oscillator.stop(now + 0.22);
  } catch {
    // Web Audio API may be blocked or unavailable in headless environments.
  }
};

export const sendDesktopNotification = (title: string, body?: string): void => {
  if (typeof document === 'undefined' || !document.hidden) {
    return;
  }

  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
    return;
  }

  try {
    new Notification(title, body ? { body } : undefined);
  } catch {
    // Ignore native notification failures in restricted WebViews.
  }
};
