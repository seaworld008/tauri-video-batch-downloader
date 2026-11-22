import { listen } from '@tauri-apps/api/event';

import { ensureDownloadStats, calculateStatsFromTasks } from '../../../utils/downloadStats';
import {
  parseDownloadEventEnvelope,
  parseTaskProgressedPayload,
  parseTaskStatsUpdatedPayload,
  parseTaskStatusChangedPayload,
} from '../model/contracts';
import {
  reduceTasksWithProgressUpdate,
  reduceTasksWithStatusUpdate,
  type ProgressEventPayload,
  type StatusEventPayload,
} from './eventReducers';
import { useDownloadStore } from '../../../stores/downloadStore';
import { fromBackendStatus } from '../model/runtimeTaskMapping';
import {
  reportFrontendDiagnosticIfEnabled,
  reportFrontendIssue,
} from '../../../utils/frontendLogging';
import { notify } from '../../../stores/uiStore';
import { translate } from '../../../i18n/hooks';

let listenersInitialized = false;
let listenerSetupPromise: Promise<void> | null = null;
let activeSyncTimer: number | null = null;
let retryTimer: number | null = null;
let initRetryCount = 0;
const MAX_INIT_RETRIES = 5;
const PROGRESS_UI_UPDATE_INTERVAL_MS = 1000;
const TERMINAL_REFRESH_DEBOUNCE_MS = 250;
const DOWNLOAD_EVENT_CHANNEL = 'download-events';

export const initializeDownloadEventBridge = async () => {
  if (listenersInitialized) return;
  if (listenerSetupPromise) return listenerSetupPromise;

  const setupListeners = async () => {
    try {
      const lastProgressUpdate = new Map<string, number>();
      const warmupProgressEventsByTask = new Map<string, number>();
      const pendingProgressUpdates = new Map<string, ProgressEventPayload>();
      const trailingFlushTimers = new Map<string, number>();
      let terminalRefreshTimer: number | null = null;
      let terminalNotifyTimer: number | null = null;
      let pendingCompletedInfos: Array<{ title: string }> = [];
      let pendingFailedInfos: Array<{ title: string; reason: string }> = [];

      const flushTerminalNotifications = () => {
        if (pendingCompletedInfos.length === 1) {
          const item = pendingCompletedInfos[0];
          notify.success(
            translate('notifications.taskCompletedTitle'),
            translate('notifications.taskCompletedSingle', { title: item.title })
          );
        } else if (pendingCompletedInfos.length > 1) {
          notify.success(
            translate('notifications.taskCompletedTitle'),
            translate('notifications.taskCompletedBatch', { count: pendingCompletedInfos.length })
          );
        }

        if (pendingFailedInfos.length === 1) {
          const item = pendingFailedInfos[0];
          notify.error(
            translate('notifications.taskFailedTitle'),
            translate('notifications.taskFailedSingle', {
              title: item.title,
              reason: item.reason,
            })
          );
        } else if (pendingFailedInfos.length > 1) {
          notify.error(
            translate('notifications.taskFailedTitle'),
            translate('notifications.taskFailedBatch', { count: pendingFailedInfos.length })
          );
        }

        pendingCompletedInfos = [];
        pendingFailedInfos = [];
      };

      const scheduleTerminalNotification = () => {
        if (typeof window === 'undefined') {
          flushTerminalNotifications();
          return;
        }
        if (terminalNotifyTimer !== null) {
          window.clearTimeout(terminalNotifyTimer);
        }
        terminalNotifyTimer = window.setTimeout(() => {
          terminalNotifyTimer = null;
          flushTerminalNotifications();
        }, 500);
      };

      const scheduleTerminalRefresh = () => {
        const runRefresh = () => {
          void useDownloadStore
            .getState()
            .refreshTasks()
            .catch(error => {
              reportFrontendDiagnosticIfEnabled(
                'warn',
                '[download-events] 终态任务刷新失败',
                error
              );
            });
        };

        if (typeof window === 'undefined') {
          runRefresh();
          return;
        }

        if (terminalRefreshTimer !== null) {
          window.clearTimeout(terminalRefreshTimer);
        }
        terminalRefreshTimer = window.setTimeout(() => {
          terminalRefreshTimer = null;
          runRefresh();
        }, TERMINAL_REFRESH_DEBOUNCE_MS);
      };

      const clearTrailingProgress = (taskId: string) => {
        pendingProgressUpdates.delete(taskId);
        const timerId = trailingFlushTimers.get(taskId);
        if (timerId !== undefined && typeof window !== 'undefined') {
          window.clearTimeout(timerId);
        }
        trailingFlushTimers.delete(taskId);
      };

      const updateTaskStatus = (payload: StatusEventPayload) => {
        if (
          payload.status === 'completed' ||
          payload.status === 'failed' ||
          payload.status === 'cancelled' ||
          payload.status === 'paused'
        ) {
          clearTrailingProgress(payload.task_id);
        }
        if (
          payload.status === 'completed' ||
          payload.status === 'failed' ||
          payload.status === 'cancelled'
        ) {
          lastProgressUpdate.delete(payload.task_id);
          warmupProgressEventsByTask.delete(payload.task_id);
        }

        const prevTask = useDownloadStore
          .getState()
          .tasks.find(task => task.id === payload.task_id);
        const wasNonTerminal =
          prevTask &&
          prevTask.status !== 'completed' &&
          prevTask.status !== 'failed' &&
          prevTask.status !== 'cancelled';

        if (wasNonTerminal && payload.status === 'completed') {
          pendingCompletedInfos.push({ title: prevTask.title });
          scheduleTerminalNotification();
        } else if (wasNonTerminal && payload.status === 'failed') {
          pendingFailedInfos.push({
            title: prevTask.title,
            reason: payload.error_message || translate('errors.downloadFailed'),
          });
          scheduleTerminalNotification();
        }

        useDownloadStore.setState(state => {
          const nextTasks = reduceTasksWithStatusUpdate(state.tasks, payload);
          const derivedStats = calculateStatsFromTasks(nextTasks);

          return {
            tasks: nextTasks,
            stats: ensureDownloadStats({
              ...state.stats,
              total_tasks: derivedStats.total_tasks,
              completed_tasks: derivedStats.completed_tasks,
              failed_tasks: derivedStats.failed_tasks,
              active_downloads: derivedStats.active_downloads,
              total_downloaded: derivedStats.total_downloaded,
            }),
          };
        });

        if (
          payload.status === 'completed' ||
          payload.status === 'failed' ||
          payload.status === 'cancelled'
        ) {
          scheduleTerminalRefresh();
        }
      };

      const updateTaskProgress = (update: ProgressEventPayload) => {
        useDownloadStore.setState(state => ({
          tasks: reduceTasksWithProgressUpdate(state.tasks, update),
        }));
      };

      const scheduleTrailingProgressFlush = (update: ProgressEventPayload) => {
        pendingProgressUpdates.set(update.task_id, update);
        if (typeof window === 'undefined' || trailingFlushTimers.has(update.task_id)) {
          return;
        }
        const elapsed = Date.now() - (lastProgressUpdate.get(update.task_id) ?? 0);
        const delayMs = Math.max(0, PROGRESS_UI_UPDATE_INTERVAL_MS - elapsed);
        const timerId = window.setTimeout(() => {
          trailingFlushTimers.delete(update.task_id);
          const pending = pendingProgressUpdates.get(update.task_id);
          if (!pending) return;
          pendingProgressUpdates.delete(update.task_id);
          lastProgressUpdate.set(update.task_id, Date.now());
          updateTaskProgress(pending);
        }, delayMs);
        trailingFlushTimers.set(update.task_id, timerId);
      };

      const shouldDispatchProgressUpdate = (taskId: string) => {
        const now = Date.now();
        const last = lastProgressUpdate.get(taskId) ?? 0;
        const warmupCount = warmupProgressEventsByTask.get(taskId) ?? 0;
        const isWarmupEvent = warmupCount < 2;
        const shouldEmit =
          last === 0 || isWarmupEvent || now - last >= PROGRESS_UI_UPDATE_INTERVAL_MS;

        if (shouldEmit) {
          lastProgressUpdate.set(taskId, now);
          warmupProgressEventsByTask.set(taskId, warmupCount + 1);
        }

        return shouldEmit;
      };

      const unlistenDownloadEvents = await listen<any>(DOWNLOAD_EVENT_CHANNEL, event => {
        const parsed = parseDownloadEventEnvelope(event.payload);
        if (parsed.success === false) {
          reportFrontendDiagnosticIfEnabled('warn', '[download-events] 忽略无效事件', {
            error: parsed.error,
            payload: event.payload,
          });
          return;
        }

        const envelope = parsed.data;

        switch (envelope.event_type) {
          case 'task.progressed': {
            const parsedPayload = parseTaskProgressedPayload(envelope.payload);
            if (parsedPayload.success === false) return;
            if (!shouldDispatchProgressUpdate(parsedPayload.data.task_id)) {
              scheduleTrailingProgressFlush(parsedPayload.data);
              return;
            }
            clearTrailingProgress(parsedPayload.data.task_id);
            updateTaskProgress(parsedPayload.data);
            break;
          }
          case 'task.status_changed': {
            const parsedPayload = parseTaskStatusChangedPayload(envelope.payload);
            if (parsedPayload.success === false) return;
            updateTaskStatus({
              task_id: parsedPayload.data.task_id,
              status: fromBackendStatus(parsedPayload.data.status),
              error_message: parsedPayload.data.error_message ?? null,
            });
            break;
          }
          case 'task.stats_updated': {
            const parsedPayload = parseTaskStatsUpdatedPayload(envelope.payload);
            if (parsedPayload.success === false) return;
            const definedStatsPatch = Object.fromEntries(
              Object.entries(parsedPayload.data).filter(([, value]) => value !== undefined)
            );
            useDownloadStore.setState(state => ({
              stats: ensureDownloadStats({
                ...state.stats,
                ...definedStatsPatch,
              }),
            }));
            break;
          }
        }
      });

      const cleanup = () => {
        if (retryTimer !== null && typeof window !== 'undefined') {
          window.clearTimeout(retryTimer);
          retryTimer = null;
        }
        if (activeSyncTimer !== null && typeof window !== 'undefined') {
          window.clearInterval(activeSyncTimer);
          activeSyncTimer = null;
        }
        if (terminalRefreshTimer !== null && typeof window !== 'undefined') {
          window.clearTimeout(terminalRefreshTimer);
          terminalRefreshTimer = null;
        }
        if (terminalNotifyTimer !== null && typeof window !== 'undefined') {
          window.clearTimeout(terminalNotifyTimer);
          terminalNotifyTimer = null;
        }
        pendingCompletedInfos = [];
        pendingFailedInfos = [];
        if (typeof window !== 'undefined') {
          for (const timerId of trailingFlushTimers.values()) {
            window.clearTimeout(timerId);
          }
        }
        trailingFlushTimers.clear();
        pendingProgressUpdates.clear();

        if (!listenersInitialized) return;
        try {
          unlistenDownloadEvents();
        } catch (error) {
          reportFrontendDiagnosticIfEnabled(
            'warn',
            'download_event_bridge:remove_listener_failed',
            error
          );
        }
        listenersInitialized = false;
        listenerSetupPromise = null;
        initRetryCount = 0;
      };

      if (typeof window !== 'undefined') {
        window.addEventListener('beforeunload', cleanup, { once: true });
      }
      if (import.meta.hot) {
        import.meta.hot.dispose(cleanup);
      }

      initRetryCount = 0;
      listenersInitialized = true;
    } catch (error) {
      listenerSetupPromise = null;
      reportFrontendIssue('error', 'download_event_bridge:initialize_failed', error);
      throw error;
    }
  };

  listenerSetupPromise = setupListeners();

  try {
    await listenerSetupPromise;
  } catch {
    if (typeof window !== 'undefined' && initRetryCount < MAX_INIT_RETRIES) {
      initRetryCount += 1;
      const retryDelayMs = 1000 * 2 ** (initRetryCount - 1);
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
      }
      retryTimer = window.setTimeout(() => {
        retryTimer = null;
        void initializeDownloadEventBridge();
      }, retryDelayMs);
    }
    return;
  }

  if (typeof window !== 'undefined' && activeSyncTimer === null) {
    activeSyncTimer = window.setInterval(() => {
      const state = useDownloadStore.getState();
      const hasActiveDownloads = state.tasks.some(
        task => task.status === 'downloading' || task.status === 'committing'
      );

      if (!hasActiveDownloads) return;

      state
        .syncRuntimeState('downloadEventBridge:polling')
        .catch(err => reportFrontendDiagnosticIfEnabled('warn', '[sync] runtime sync failed', err));
    }, 1500);
  }
};
