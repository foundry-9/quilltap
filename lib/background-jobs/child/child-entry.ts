/**
 * Job-runner child entry point
 *
 * The parent forks this file via `child_process.fork`. The child:
 *   1. installs a logger transport that forwards records to the parent
 *   2. asserts the SQLCipher pepper is in env (inherited from the parent)
 *   3. warms the readonly DB connection and the repository proxy
 *   4. listens on `process.on('message', ...)` for `job`, `invalidate`,
 *      and `shutdown` messages
 *   5. for each job: runs the registered handler inside an
 *      AsyncLocalStorage scope that buffers repository write payloads,
 *      then posts a `job-result` message back with the buffered writes
 *
 * No DB writes happen in the child. The parent applies the batched
 * writes in a single `db.transaction(...)`.
 */

import { installChildLoggerTransport, logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/error-utils';
import { getHandler } from '../handlers';
import { runWithJobScope, flushPendingWrites, getChildRepositoriesProxy } from './child-repositories-proxy';
import {
  ParentToChildMessage,
  ChildJobResultMessage,
  ChildShutdownAckMessage,
  ChildStatusMessage,
  isParentToChildMessage,
} from '../ipc-types';
import { handleHostRpcResponse } from './host-rpc-client';
import { runAttributedToJob } from '../activity-registry';
import { activityKindForJobType } from '../activity-kinds';
import type { BackgroundJob } from '@/lib/schemas/types';

// Bootstrap: replace the singleton logger's transports so every record
// produced inside this process — including from `logger.child(...)` loggers
// already created at module top-levels — funnels through the parent.
installChildLoggerTransport();

const log = logger.child({ module: 'jobs:child:entry' });

if (process.env.QUILLTAP_JOB_CHILD !== '1') {
  log.error('child-entry started without QUILLTAP_JOB_CHILD=1; refusing to run');
  process.exit(1);
}

if (!process.env.ENCRYPTION_MASTER_PEPPER) {
  log.error('child-entry started without ENCRYPTION_MASTER_PEPPER; refusing to run');
  process.exit(1);
}

if (typeof process.send !== 'function') {
  log.error('child-entry started without an IPC channel; refusing to run');
  process.exit(1);
}

// Warm the proxy so the first job dispatch doesn't pay the construction
// cost on a hot path.
getChildRepositoriesProxy();

// Initialize the plugin/provider registry in the child. Handlers like
// EMBEDDING_GENERATE call into `providerRegistry.createEmbeddingProvider`,
// and `initializePlugins` is the canonical wiring path. It's read-only
// (scans plugins, loads modules, registers in memory) so it's safe to
// run inside the child's readonly DB context. We do this asynchronously
// so the child can already accept jobs while plugins finish loading;
// any job that requires a registered provider before init completes will
// fail and retry on the dispatcher's normal backoff.
(async () => {
  try {
    const { initializePlugins } = await import('@/lib/startup/plugin-initialization');
    const result = await initializePlugins();
    log.info('Plugin registry initialized in child', {
      total: result.stats.total,
      enabled: result.stats.enabled,
      errors: result.stats.errors,
    });
  } catch (err) {
    log.error('Failed to initialize plugin registry in child; LLM/embedding handlers will fail until restart', {
      error: getErrorMessage(err),
    });
  }
})();

log.info('Job-runner child ready', {
  pid: process.pid,
  node: process.versions.node,
  electron: process.versions.electron ?? null,
});

// ============================================================================
// In-flight tracking
// ============================================================================

interface ChildState {
  inFlight: number;
  completedSinceLastStatus: number;
  failedSinceLastStatus: number;
  shuttingDown: boolean;
  shutdownAckSent: boolean;
}

const state: ChildState = {
  inFlight: 0,
  completedSinceLastStatus: 0,
  failedSinceLastStatus: 0,
  shuttingDown: false,
  shutdownAckSent: false,
};

// ============================================================================
// Message routing
// ============================================================================

process.on('message', (raw: unknown) => {
  if (!isParentToChildMessage(raw)) {
    log.warn('Ignoring malformed parent message', { raw });
    return;
  }
  const msg = raw as ParentToChildMessage;
  switch (msg.type) {
    case 'job':
      runJob(msg.job).catch(err => {
        log.error('Unexpected error escaping runJob', { error: getErrorMessage(err) });
      });
      break;
    case 'invalidate':
      handleInvalidate(msg.target, msg.key).catch(err => {
        log.warn('Cache invalidation failed', {
          target: msg.target,
          key: msg.key,
          error: getErrorMessage(err),
        });
      });
      break;
    case 'shutdown':
      beginShutdown();
      break;
    case 'host-rpc-response':
      handleHostRpcResponse(msg);
      break;
  }
});

process.on('disconnect', () => {
  // Parent went away — exit cleanly. Don't try to send anything.
  log.warn('IPC channel disconnected; child exiting');
  process.exit(0);
});

// ============================================================================
// Job execution
// ============================================================================

async function runJob(job: BackgroundJob): Promise<void> {
  if (state.shuttingDown) {
    // Parent should not be sending jobs after a shutdown was requested,
    // but if it does, surface a failure rather than silently dropping.
    sendJobResult(job.id, false, [], 'Child is shutting down');
    return;
  }

  state.inFlight++;
  log.info('Running job in child', { jobId: job.id, type: job.type, attempts: job.attempts });

  try {
    await runWithJobScope(job.id, async () => {
      const handler = getHandler(job.type);
      // Attribute the handler to its own chip kind without adding a count —
      // the job row already is the count. Inline work of the *same* kind
      // inside the handler collapses into it; inline work of another kind
      // (a Concierge classification during scene tracking, say) still counts
      // and mirrors up to the parent.
      await runAttributedToJob(activityKindForJobType(job.type), () => handler(job));
      const writes = flushPendingWrites();
      sendJobResult(job.id, true, writes);
    });
    state.completedSinceLastStatus++;
  } catch (err) {
    const errorMessage = getErrorMessage(err);
    const stack = err instanceof Error ? err.stack : undefined;
    log.warn('Job handler threw', { jobId: job.id, type: job.type, error: errorMessage });
    sendJobResult(job.id, false, [], errorMessage, stack);
    state.failedSinceLastStatus++;
  } finally {
    state.inFlight--;
    if (state.shuttingDown && state.inFlight === 0 && !state.shutdownAckSent) {
      finalizeShutdown();
    }
  }
}

function sendJobResult(jobId: string, ok: boolean, writes: ReturnType<typeof flushPendingWrites>, errorMessage?: string, stack?: string): void {
  const msg: ChildJobResultMessage = {
    type: 'job-result',
    jobId,
    ok,
    writes,
    ...(errorMessage ? { error: { message: errorMessage, stack } } : {}),
  };
  trySend(msg);
}

// ============================================================================
// Cache invalidation
// ============================================================================

async function handleInvalidate(target: 'vectorStore' | 'mountPoint', key: string): Promise<void> {
  // Lazy import so the parent doesn't pay the cost.
  if (target === 'vectorStore') {
    const mod = await import('@/lib/embedding/vector-store');
    mod.getVectorStoreManager().unloadStore(key);
  } else if (target === 'mountPoint') {
    const mod = await import('@/lib/mount-index/mount-chunk-cache');
    mod.invalidateMountPoint(key);
  }
}

// ============================================================================
// Shutdown
// ============================================================================

function beginShutdown(): void {
  if (state.shuttingDown) return;
  state.shuttingDown = true;
  log.info('Shutdown requested; draining in-flight jobs', { inFlight: state.inFlight });
  if (state.inFlight === 0) {
    finalizeShutdown();
  } else {
    // Safety: cap the drain at 30 seconds — parent already kills us at 5 s,
    // but if we get a clean disconnect signal the drain timer covers us.
    setTimeout(() => {
      if (!state.shutdownAckSent) {
        log.warn('Shutdown drain timeout; forcing exit', { inFlight: state.inFlight });
        finalizeShutdown();
      }
    }, 30_000).unref();
  }
}

function finalizeShutdown(): void {
  state.shutdownAckSent = true;
  const ack: ChildShutdownAckMessage = { type: 'shutdown-ack' };
  trySend(ack);
  // Give the IPC channel one tick to flush, then exit.
  setTimeout(() => process.exit(0), 50).unref();
}

// ============================================================================
// Periodic status
// ============================================================================

const STATUS_INTERVAL_MS = 2_000;
setInterval(() => {
  if (state.shuttingDown) return;
  const msg: ChildStatusMessage = {
    type: 'status',
    inFlight: state.inFlight,
    completedSinceLast: state.completedSinceLastStatus,
    failedSinceLast: state.failedSinceLastStatus,
  };
  trySend(msg);
  state.completedSinceLastStatus = 0;
  state.failedSinceLastStatus = 0;
}, STATUS_INTERVAL_MS).unref();

// ============================================================================
// Crash containment
// ============================================================================

process.on('uncaughtException', (err: Error) => {
  log.error('Uncaught exception in job-runner child', { error: err.message, stack: err.stack });
  // Let the parent restart us — exit non-zero.
  process.exit(1);
});

process.on('unhandledRejection', (reason: unknown) => {
  log.error('Unhandled rejection in job-runner child', {
    error: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
  process.exit(1);
});

// ============================================================================
// Helpers
// ============================================================================

function trySend(msg: unknown): void {
  if (typeof process.send !== 'function') return;
  try {
    process.send(msg);
  } catch (err) {
    log.warn('Failed to post IPC message', {
      type: (msg as { type?: unknown })?.type,
      error: getErrorMessage(err),
    });
  }
}
