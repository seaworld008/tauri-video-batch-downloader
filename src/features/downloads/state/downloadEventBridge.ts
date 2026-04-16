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

let listenersInitialized = false;
let listenerSetupPromise: Promise<void> | null = null;
let activeSyncTimer: number | null = null;
const PROGRESS_UI_UPDATE_INTERVAL_MS = 1000;

export const initializeDownloadEventBridge = async () => {
  if (listenersInitialized) return;
  if (listenerSetupPromise) return listenerSetupPromise;

  const setupListeners = async () => {
    try {
      let progressEventCount = 0;
      const lastProgressUpdate = new Map<string, number>();
      const warmupProgressEventsByTask = new Map<string, number>();

      const updateTaskStatus = (payload: StatusEventPayload) => {
        if (
          payload.status === 'completed' ||
          payload.status === 'failed' ||
          payload.status === 'cancelled'
        ) {
          lastProgressUpdate.delete(payload.task_id);
          warmupProgressEventsByTask.delete(payload.task_id);
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
      };

      const updateTaskProgress = (update: ProgressEventPayload) => {
        useDownloadStore.setState(state => ({
          tasks: reduceTasksWithProgressUpdate(state.tasks, update),
        }));
      };

      const shouldDispatchProgressUpdate = (taskId: string) => {
        const now = Date.now();
        const last = lastProgressUpdate.get(taskId) ?? 0;
        const warmupCount = warmupProgressEventsByTask.get(taskId) ?? 0;
        const isWarmupEvent = warmupCount < 2;
        const shouldEmit = last === 0 || isWarmupEvent || now - last >= PROGRESS_UI_UPDATE_INTERVAL_MS;

        if (shouldEmit) {
          lastProgressUpdate.set(taskId, now);
          warmupProgressEventsByTask.set(taskId, warmupCount + 1);
        }

        return shouldEmit;
      };


      const unlistenDownloadEvents = await listen<any>('download.events', event => {
        const parsed = parseDownloadEventEnvelope(event.payload);
        if (parsed.success === false) {
          reportFrontendDiagnosticIfEnabled('warn', '[download.events] 忽略无效事件', {
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
              progressEventCount++;
              return;
            }
            progressEventCount++;
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
            useDownloadStore.setState(state => ({
              stats: ensureDownloadStats({
                ...calculateStatsFromTasks(state.tasks),
                ...parsedPayload.data,
              }),
            }));
            break;
          }
        }
      });

      const cleanup = () => {
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
      };

      if (typeof window !== 'undefined') {
        window.addEventListener('beforeunload', cleanup, { once: true });
      }

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
    if (typeof window !== 'undefined') {
      window.setTimeout(() => {
        void initializeDownloadEventBridge();
      }, 1000);
    }
  }

  if (typeof window !== 'undefined' && activeSyncTimer === null) {
    activeSyncTimer = window.setInterval(() => {
      const state = useDownloadStore.getState();
      const hasActiveDownloads = state.tasks.some(
        task => task.status === 'downloading' || task.status === 'committing'
      );
      const hasPendingTasks = state.tasks.some(task => task.status === 'pending');

      if (!hasActiveDownloads && !hasPendingTasks) return;

      state.syncRuntimeState('downloadEventBridge:polling').catch(err =>
        reportFrontendDiagnosticIfEnabled('warn', '[sync] runtime sync failed', err)
      );
    }, 1500);
  }
};
