/**
 * Scheduled Retention & Cleanup Maintenance
 *
 * A single parent-side daily tick that reaps data with no bearing on
 * characters, stories, or memories:
 *  1. finished background jobs (COMPLETED after a short window, DEAD after a
 *     longer one);
 *  2. superseded generated story-backgrounds & wardrobe avatars of *stale*
 *     chats (collapse down to the currently-referenced ones);
 *  3. regenerable caches of stale chats (compression cache, rendered
 *     markdown/HTML, raw provider payloads, thinking traces, memory-gate
 *     debug logs) plus cold-tiering of their conversation-chunk embeddings;
 *  4. orphaned store children (links/folders/documents whose mount point
 *     vanished — a pre-Bug-9 non-atomic delete, or a hand-built index);
 *  5. orphaned mount-index files (belt-and-suspenders after the collapse);
 *  6. closed terminal (Ariel) PTY sessions and their transcript files;
 *  7. orphaned thumbnail-cache entries whose source file is gone.
 *
 * ## Why parent-side, not a forked-child job
 * The asset collapse and orphan sweep bottom out in `deleteWithGC`, which opens
 * a write transaction on the raw mount-index DB. The forked job child runs
 * against a readonly connection with buffered writes and cannot do that. So
 * there is no `MAINTENANCE` job type, no child handler, and no queue row — this
 * runs inline on the parent (the only DB writer), exactly like the LLM-log
 * cleanup and memory-housekeeping schedulers.
 *
 * ## Dev-restart friendliness
 * These are in-process `setInterval` timers, not durable cron: "daily" means
 * "24h after process start." The startup tick is deferred by a 5-minute grace
 * and short-circuits if a successful sweep ran within the last 20h, so frequent
 * `npm run dev` restarts don't re-sweep on every boot. Unlike the housekeeping
 * scheduler (which peeks recent job rows), this tick has no job rows, so it
 * reads/writes `lastMaintenanceSweepAt` in `instance_settings` instead. The
 * 24h interval fires regardless of the startup short-circuit.
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import {
  getLastMaintenanceSweepAt,
  setLastMaintenanceSweepAt,
} from '@/lib/instance-settings';
import { cleanupFinishedJobs } from './queue-service';
import { collapseStaleChatAssets } from './maintenance/collapse-stale-chat-assets';
import { collapseStaleChatCaches } from './maintenance/collapse-stale-chat-caches';
import { sweepOrphanedThumbnails } from './maintenance/sweep-orphaned-thumbnails';
import { CLOSED_TERMINAL_RETENTION_DAYS, retentionCutoff } from './maintenance/retention-constants';

const moduleLogger = logger.child({ module: 'scheduled-maintenance' });

/** Scheduler state */
let maintenanceScheduler: ReturnType<typeof setInterval> | null = null;
let maintenanceSchedulerRunning = false;

/** Default interval: run daily (24 hours) */
const DEFAULT_MAINTENANCE_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Startup grace: wait this long after boot before the first tick, so the UI
 *  finishes compiling and the first page load completes before the sweep runs. */
const STARTUP_GRACE_MS = 5 * 60 * 1000;

/** Skip the initial startup tick if a successful sweep ran within this window.
 *  Prevents dev-restart thrashing. */
const RECENT_RUN_WINDOW_MS = 20 * 60 * 60 * 1000;

/** Summary returned by a single maintenance pass. */
export interface MaintenanceSweepSummary {
  jobs: { completed: number; dead: number };
  assets: { staleChats: number; chatsCollapsed: number; filesDeleted: number };
  caches: {
    staleChats: number;
    chatsCollapsed: number;
    chatRowsCleared: number;
    messageRowsCleared: number;
    chunkEmbeddingsCleared: number;
  };
  orphanedFilesSwept: number;
  orphanedStoreChildrenSwept: { links: number; folders: number; documents: number };
  terminals: { rows: number; transcripts: number };
  orphanedThumbnailsSwept: { scanned: number; deleted: number; unparseable: number };
  /** Sweeps that threw (and were swallowed so the rest could run). */
  failures: string[];
}

/**
 * Start the daily maintenance driver.
 * @param intervalMs - How often to run (default: 24 hours)
 */
export function scheduleMaintenance(intervalMs: number = DEFAULT_MAINTENANCE_INTERVAL_MS): void {
  if (maintenanceSchedulerRunning) {
    return;
  }

  maintenanceSchedulerRunning = true;
  maintenanceScheduler = setInterval(() => {
    runScheduledMaintenance().catch((error) => {
      moduleLogger.error('Error in scheduled maintenance interval', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, intervalMs);

  moduleLogger.info('Maintenance scheduler started', { intervalMs, startupGraceMs: STARTUP_GRACE_MS });

  // Run once shortly after startup, unless a sweep already completed recently
  // (dev-restart friendly). The recurring setInterval still fires either way.
  setTimeout(() => {
    runStartupMaintenanceTick().catch((error) => {
      moduleLogger.error('Error in initial maintenance run', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, STARTUP_GRACE_MS);
}

/** Stop the maintenance driver. */
export function stopMaintenanceScheduler(): void {
  if (maintenanceScheduler) {
    clearInterval(maintenanceScheduler);
    maintenanceScheduler = null;
  }
  maintenanceSchedulerRunning = false;
  moduleLogger.info('Maintenance scheduler stopped');
}

/** Return true if the scheduler is currently running. */
export function isMaintenanceSchedulerRunning(): boolean {
  return maintenanceSchedulerRunning;
}

/**
 * Startup tick wrapper that short-circuits when a sweep completed within the
 * recent-run window. Keeps development restarts from re-running a full sweep
 * every time the server comes up.
 */
async function runStartupMaintenanceTick(): Promise<void> {
  try {
    const lastSweep = await getLastMaintenanceSweepAt();
    if (lastSweep && Date.now() - lastSweep.getTime() < RECENT_RUN_WINDOW_MS) {
      moduleLogger.info('Skipping startup maintenance tick — recent sweep already completed', {
        lastMaintenanceSweepAt: lastSweep.toISOString(),
      });
      return;
    }
  } catch (error) {
    moduleLogger.warn('Recent-run check failed; running startup maintenance tick anyway', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  await runScheduledMaintenance();
}

/**
 * One maintenance pass. Each sweep is run in order and independently
 * try/caught, so a failure in one cannot abort the rest. The
 * `lastMaintenanceSweepAt` timestamp is recorded at the end (the tick ran) so
 * the startup short-circuit works across dev restarts.
 */
export async function runScheduledMaintenance(): Promise<MaintenanceSweepSummary> {
  moduleLogger.info('Starting scheduled maintenance pass');

  const summary: MaintenanceSweepSummary = {
    jobs: { completed: 0, dead: 0 },
    assets: { staleChats: 0, chatsCollapsed: 0, filesDeleted: 0 },
    caches: {
      staleChats: 0,
      chatsCollapsed: 0,
      chatRowsCleared: 0,
      messageRowsCleared: 0,
      chunkEmbeddingsCleared: 0,
    },
    orphanedFilesSwept: 0,
    orphanedStoreChildrenSwept: { links: 0, folders: 0, documents: 0 },
    terminals: { rows: 0, transcripts: 0 },
    orphanedThumbnailsSwept: { scanned: 0, deleted: 0, unparseable: 0 },
    failures: [],
  };

  // 1. Finished background jobs (COMPLETED short window, DEAD longer window).
  try {
    summary.jobs = await cleanupFinishedJobs();
  } catch (error) {
    summary.failures.push('jobs');
    moduleLogger.warn('Job cleanup sweep failed — continuing', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // 2. Stale-chat asset collapse.
  try {
    const result = await collapseStaleChatAssets();
    summary.assets = {
      staleChats: result.staleChats,
      chatsCollapsed: result.chatsCollapsed,
      filesDeleted: result.filesDeleted,
    };
  } catch (error) {
    summary.failures.push('assets');
    moduleLogger.warn('Stale-chat asset collapse failed — continuing', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // 3. Stale-chat cache collapse + conversation-chunk cold-tiering.
  try {
    const result = await collapseStaleChatCaches();
    summary.caches = {
      staleChats: result.staleChats,
      chatsCollapsed: result.chatsCollapsed,
      chatRowsCleared: result.chatRowsCleared,
      messageRowsCleared: result.messageRowsCleared,
      chunkEmbeddingsCleared: result.chunkEmbeddingsCleared,
    };
  } catch (error) {
    summary.failures.push('caches');
    moduleLogger.warn('Stale-chat cache collapse failed — continuing', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // 4. Orphaned store children — links/folders/documents whose mount point
  //    vanished (a pre-Bug-9 non-atomic delete, or a hand-built index). Run
  //    BEFORE the orphaned-file sweep so a reaped link can drop its file too.
  try {
    summary.orphanedStoreChildrenSwept =
      await getRepositories().docMountFileLinks.sweepOrphanedStoreChildren();
  } catch (error) {
    summary.failures.push('orphan-store-children');
    moduleLogger.warn('Orphaned store-children sweep failed — continuing', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // 5. Orphaned mount-index files — run AFTER the collapse to mop up stragglers.
  try {
    summary.orphanedFilesSwept = await getRepositories().docMountFileLinks.sweepOrphanedFiles();
  } catch (error) {
    summary.failures.push('orphans');
    moduleLogger.warn('Orphaned-file sweep failed — continuing', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // 6. Closed terminal sessions + transcript files.
  try {
    summary.terminals = await getRepositories().terminalSessions.cleanupClosedSessions(
      retentionCutoff(CLOSED_TERMINAL_RETENTION_DAYS),
    );
  } catch (error) {
    summary.failures.push('terminals');
    moduleLogger.warn('Terminal-session cleanup failed — continuing', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // 7. Orphaned thumbnail-cache entries whose source file is gone (derived,
  //    regenerated on demand, so deletion is always safe).
  try {
    summary.orphanedThumbnailsSwept = await sweepOrphanedThumbnails();
  } catch (error) {
    summary.failures.push('orphan-thumbnails');
    moduleLogger.warn('Orphaned-thumbnail sweep failed — continuing', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    await setLastMaintenanceSweepAt();
  } catch (error) {
    moduleLogger.warn('Failed to record lastMaintenanceSweepAt', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  moduleLogger.info('Scheduled maintenance pass complete', summary);
  return summary;
}
