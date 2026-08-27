/**
 * Job dispatcher (parent-side)
 *
 * Owns the claim loop: poll the `background_jobs` table on a 2 s interval,
 * claim the next pending job atomically via the repository, and post it to
 * the forked child. When the child returns a `job-result`, apply the
 * batched writes inside a single `db.transaction(...)` over the parent's
 * RW connection, then mark the job COMPLETED (or FAILED on error).
 *
 * Concurrency: a single global cap on the number of in-flight jobs of any
 * type, user-configurable via the `maxConcurrentJobs` instance setting
 * (default 4, range 1–32; read fresh each claim cycle, so changes apply within
 * ~2 s without a restart). This replaces the previous per-type caps — the
 * trade-off (a heavy job type can starve lighter ones) is documented in
 * `docs/developer/BACKGROUND_JOBS_CHILD.md`.
 */

import { getRepositories } from '@/lib/repositories/factory';
import { getMaxConcurrentJobs } from '@/lib/instance-settings';
import type { Database } from 'better-sqlite3';
import { logger } from '@/lib/logger';
import { publishRealtime } from '@/lib/realtime/bus';
import { firstIdArg, topicsForCompletedJob, topicsForWriteBatch } from '@/lib/realtime/job-topics';
import { getErrorMessage } from '@/lib/error-utils';
import { getRawDatabase } from '@/lib/database/backends/sqlite/client';
import { getRawMountIndexDatabase } from '@/lib/database/backends/sqlite/mount-index-client';
import { getRawLLMLogsDatabase } from '@/lib/database/backends/sqlite/llm-logs-client';
import type { BackgroundJob } from '@/lib/schemas/types';
import type { ChildJobResultMessage, ChildWritePayload } from '../ipc-types';
import { sendToChild, notifyChild } from './processor-host';
import {
  partitionWrites,
  isMainPrimaryJobType,
  rewriteFolderRefs,
  isUniqueConstraintError,
  DOC_MOUNT_FOLDER_CREATE,
  type WriteDbTarget,
} from './write-partition';
import fs from 'fs';
import path from 'path';

const log = logger.child({ module: 'jobs:dispatcher' });

// ============================================================================
// Tunables
// ============================================================================

const POLL_INTERVAL_MS = 2_000;
// Fallback only — the live cap is read from the `maxConcurrentJobs` instance
// setting each claim cycle (see pumpClaim). Used until the first read lands and
// whenever a read fails.
const DEFAULT_MAX_IN_FLIGHT = 4;
const MAX_WAKE_DELAY_MS = 5 * 60 * 1000;
const STUCK_JOB_CHECK_INTERVAL_MS = 5 * 60 * 1000;

// ============================================================================
// HMR-safe global state
// ============================================================================

interface DispatcherState {
  pollTimer: ReturnType<typeof setInterval> | null;
  stuckCheckTimer: ReturnType<typeof setInterval> | null;
  wakeTimer: ReturnType<typeof setTimeout> | null;
  inFlight: Map<string, BackgroundJob>;
  claiming: boolean;
  running: boolean;
  /** Last-read value of the `maxConcurrentJobs` instance setting. */
  maxInFlight: number;
}

declare global {
  var __quilltapJobDispatcher: DispatcherState | undefined;
}

function getState(): DispatcherState {
  if (!globalThis.__quilltapJobDispatcher) {
    globalThis.__quilltapJobDispatcher = {
      pollTimer: null,
      stuckCheckTimer: null,
      wakeTimer: null,
      inFlight: new Map(),
      claiming: false,
      running: false,
      maxInFlight: DEFAULT_MAX_IN_FLIGHT,
    };
  }
  return globalThis.__quilltapJobDispatcher;
}

// ============================================================================
// Lifecycle
// ============================================================================

export function startDispatcher(): void {
  const state = getState();
  if (state.running) return;
  state.running = true;

  state.pollTimer = setInterval(() => {
    pumpClaim().catch(err => {
      log.error('Error in claim loop', { error: getErrorMessage(err) });
    });
  }, POLL_INTERVAL_MS);

  if (!state.stuckCheckTimer) {
    state.stuckCheckTimer = setInterval(() => {
      resetStuckJobs().catch(err => {
        log.error('Error in stuck-job sweep', { error: getErrorMessage(err) });
      });
    }, STUCK_JOB_CHECK_INTERVAL_MS);
  }

  // On startup, reset any orphaned PROCESSING jobs — none should legitimately
  // be mid-flight when the dispatcher just started.
  resetOrphanedJobs().catch(err => {
    log.error('Error resetting orphaned jobs at startup', { error: getErrorMessage(err) });
  });

  log.info('Dispatcher started', { pollIntervalMs: POLL_INTERVAL_MS, maxInFlight: state.maxInFlight });
}

export function stopDispatcher(): void {
  const state = getState();
  if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
  if (state.stuckCheckTimer) { clearInterval(state.stuckCheckTimer); state.stuckCheckTimer = null; }
  if (state.wakeTimer) { clearTimeout(state.wakeTimer); state.wakeTimer = null; }
  state.running = false;
  log.info('Dispatcher stopped');
}

export function dispatcherWake(): void {
  const state = getState();
  if (!state.running) return;
  if (state.wakeTimer) { clearTimeout(state.wakeTimer); state.wakeTimer = null; }
  pumpClaim().catch(err => {
    log.error('Error in wake-triggered claim', { error: getErrorMessage(err) });
  });
}

export function getDispatcherSnapshot(): { inFlight: number; running: boolean; maxInFlight: number } {
  const state = getState();
  return { inFlight: state.inFlight.size, running: state.running, maxInFlight: state.maxInFlight };
}

// ============================================================================
// Claim loop
// ============================================================================

async function pumpClaim(): Promise<void> {
  const state = getState();
  if (!state.running || state.claiming) return;
  state.claiming = true;
  try {
    // Refresh the global concurrency cap from the `maxConcurrentJobs` instance
    // setting before claiming. One indexed PK read per pump (every 2 s / on
    // wake / on job completion); a failure keeps the last-known value so the
    // loop never breaks on a transient DB hiccup.
    try {
      const cap = await getMaxConcurrentJobs();
      if (cap !== state.maxInFlight) {
        log.debug('Concurrency cap changed', { from: state.maxInFlight, to: cap });
        state.maxInFlight = cap;
      }
    } catch (err) {
      log.warn('Failed to read concurrency cap; keeping current', {
        current: state.maxInFlight,
        error: getErrorMessage(err),
      });
    }

    while (state.inFlight.size < state.maxInFlight) {
      const repos = getRepositories();
      const job = await repos.backgroundJobs.claimNextJob();
      if (job) {
        // PENDING -> PROCESSING: the chips and the tasks queue both read this
        // transition, so it earns a hint of its own.
        publishRealtime('jobs');
      }
      if (!job) {
        // Queue is empty — schedule a wake-up if a future retry is due.
        if (state.inFlight.size === 0) {
          const next = await repos.backgroundJobs.findNextScheduledAt();
          if (next) armWakeTimer(next);
        }
        return;
      }
      dispatchJob(job);
    }
  } finally {
    state.claiming = false;
  }
}

function dispatchJob(job: BackgroundJob): void {
  const state = getState();
  state.inFlight.set(job.id, job);
  log.info('Dispatching job to child', { jobId: job.id, type: job.type, attempts: job.attempts });
  const ok = sendToChild({ type: 'job', job });
  if (!ok) {
    // Child is gone — return the job to PENDING and let the next claim retry.
    state.inFlight.delete(job.id);
    log.warn('Child unavailable; marking job failed for retry', { jobId: job.id });
    void getRepositories().backgroundJobs.markFailed(job.id, 'Child process unavailable');
    publishRealtime('jobs');
  }
}

function armWakeTimer(scheduledAt: string): void {
  const state = getState();
  if (state.wakeTimer) clearTimeout(state.wakeTimer);
  const rawMs = new Date(scheduledAt).getTime() - Date.now();
  const delayMs = Math.min(Math.max(rawMs, 100), MAX_WAKE_DELAY_MS);
  state.wakeTimer = setTimeout(() => {
    state.wakeTimer = null;
    log.info('Wake timer fired for scheduled retry', { scheduledAt });
    dispatcherWake();
  }, delayMs);
  state.wakeTimer.unref?.();
}

// ============================================================================
// Job result + write applier
// ============================================================================

export async function handleChildJobResult(msg: ChildJobResultMessage): Promise<void> {
  const state = getState();
  const job = state.inFlight.get(msg.jobId);
  state.inFlight.delete(msg.jobId);

  const repos = getRepositories();

  if (!msg.ok) {
    const errorMessage = msg.error?.message ?? 'Unknown handler error';
    log.warn('Job failed in child', { jobId: msg.jobId, type: job?.type, error: errorMessage });
    // Best-effort cleanup of staged files left behind by the failed handler.
    cleanupStagingDirs(msg.writes, msg.jobId);
    await repos.backgroundJobs.markFailed(msg.jobId, errorMessage);
    await reconcileFailedAutonomousTurnIfNeeded(job, errorMessage);
    publishRealtime('jobs');
    pumpClaim().catch(err => log.error('Post-fail claim error', { error: getErrorMessage(err) }));
    return;
  }

  try {
    await applyWritesAtomically(msg.jobId, msg.writes, job?.type);
    await repos.backgroundJobs.markCompleted(msg.jobId);
    log.info('Job completed', { jobId: msg.jobId, type: job?.type, writeCount: msg.writes.length });
    publishRealtime('jobs');
    // Entity hints for the state this job's work just changed. The handler ran
    // in the child, which owns no sockets; this is the first parent-side moment
    // at which the change is actually committed and visible.
    for (const hint of topicsForCompletedJob(job?.type, job?.payload as Record<string, unknown> | undefined)) {
      publishRealtime(hint.topic, hint.id);
    }
  } catch (err) {
    const errorMessage = getErrorMessage(err);
    log.error('Failed to apply child writes; marking job failed', {
      jobId: msg.jobId,
      type: job?.type,
      error: errorMessage,
    });
    cleanupStagingDirs(msg.writes, msg.jobId);
    await repos.backgroundJobs.markFailed(msg.jobId, errorMessage);
    await reconcileFailedAutonomousTurnIfNeeded(job, errorMessage);
    publishRealtime('jobs');
  }

  pumpClaim().catch(e => log.error('Post-complete claim error', { error: getErrorMessage(e) }));
}

/**
 * On terminal failure of an AUTONOMOUS_ROOM_TURN job, nudge its room out of a
 * silent `running` wedge. When a turn's buffered write-batch is rejected at
 * apply time (a tool write hits a constraint), the whole batch rolls back —
 * including the run-state transition the handler tried to write — and the
 * single-attempt job is marked DEAD, leaving the chat `running` with no turn
 * in flight. The autonomous-room service flips it to a resumable `paused`.
 *
 * Dynamic import keeps the autonomous-room service (and the queue-service it
 * pulls in) out of the dispatcher's static import graph, avoiding a cycle.
 * Best-effort and self-contained — never throws back into result handling.
 */
async function reconcileFailedAutonomousTurnIfNeeded(
  job: BackgroundJob | undefined,
  failureReason: string,
): Promise<void> {
  if (job?.type !== 'AUTONOMOUS_ROOM_TURN') return;
  try {
    const { reconcileFailedAutonomousTurn } = await import(
      '@/lib/services/chat-message/autonomous-room.service'
    );
    await reconcileFailedAutonomousTurn(
      job.payload as unknown as { chatId?: string; runId?: string } | undefined,
      failureReason,
    );
  } catch (err) {
    log.error('Autonomous-room failure reconcile failed', {
      jobId: job.id,
      error: getErrorMessage(err),
    });
  }
}

// Serialize apply calls. With several jobs in flight, multiple finish around
// the same time and the parent receives several `job-result` messages
// nearly simultaneously. Each tries to `BEGIN IMMEDIATE` on the same
// connection — the second one hits "cannot start a transaction within a
// transaction." Chain applies through a Promise so only one runs at a
// time; the dispatcher's claim loop still runs jobs in the child up to the
// global concurrency cap, but the parent's transaction boundary is single-file.
let applyChain: Promise<unknown> = Promise.resolve();

async function applyWritesAtomically(
  jobId: string,
  writes: ChildWritePayload[],
  jobType: string | undefined,
): Promise<void> {
  if (writes.length === 0) return;

  // Wait for any in-progress apply to finish before we begin our own
  // transactions. Serializing the whole multi-partition apply is what makes
  // the cross-job folder reconcile race-free: the conflicting folder another
  // job created is fully committed and visible before this job's mount-index
  // transaction begins. Failures in the previous apply must not poison this
  // one, so swallow them — the dispatcher already marks each job's outcome.
  const prev = applyChain;
  let release: () => void = () => {};
  applyChain = new Promise<void>(resolve => { release = resolve; });
  try { await prev; } catch { /* previous apply's error was already handled */ }

  try {
    await applyWritesUnsafe(jobId, writes, jobType);
  } finally {
    release();
  }
}

/**
 * Apply a job's buffered writes, partitioned by target database so a failure
 * in one database can neither roll back nor leak into another.
 *
 * Each partition (main / mount-index / llm-logs) commits in its OWN
 * transaction on its OWN connection. The ordering and failure policy depends on
 * whether the job's main-DB writes are primary (see {@link isMainPrimaryJobType}
 * and the AUTONOMOUS_ROOM_TURN rationale in `write-partition.ts`):
 *
 *   - **main-primary** (autonomous turn): commit main first and authoritatively;
 *     a main failure aborts before any secondary write runs. Once main commits,
 *     secondary partitions are best-effort — a failure is rolled back, logged,
 *     and swallowed so the non-idempotent chat turn survives a dropped doc-store
 *     effect rather than being retried into a duplicate message.
 *   - **all-or-nothing** (every other, idempotent, handler): apply secondary
 *     partitions first so a secondary failure prevents the main commit (e.g.
 *     don't mark a chunk embedded if its mount-index embedding write failed),
 *     then main. Any partition failure throws → the job is marked FAILED and the
 *     existing retry path re-runs the handler.
 *
 * Exported for unit testing (`__tests__/job-dispatcher-apply.test.ts`).
 */
export async function applyWritesUnsafe(
  jobId: string,
  writes: ChildWritePayload[],
  jobType?: string,
): Promise<void> {
  const parts = partitionWrites(writes);

  if (isMainPrimaryJobType(jobType)) {
    await applyPartition('main', getRawDatabase(), parts.main, jobId);
    await applySecondaryBestEffort('mountIndex', getRawMountIndexDatabase(), parts.mountIndex, jobId);
    await applySecondaryBestEffort('llmLogs', getRawLLMLogsDatabase(), parts.llmLogs, jobId);
  } else {
    await applyPartition('mountIndex', getRawMountIndexDatabase(), parts.mountIndex, jobId);
    await applyPartition('llmLogs', getRawLLMLogsDatabase(), parts.llmLogs, jobId);
    await applyPartition('main', getRawDatabase(), parts.main, jobId);
  }

  // After every partition commits, drop the per-job staging directory so we
  // don't accumulate empty `<dataDir>/files/.staging/<jobId>/` shells, then
  // fire cache invalidations across the whole batch. Both are idempotent and
  // safe even when a best-effort secondary partition was dropped.
  cleanupStagingDirs(writes, jobId);
  dispatchInvalidations(writes);
}

/**
 * Apply one partition's writes inside a single hand-driven transaction on the
 * given connection. Throws on any failure (after rolling the partition back and
 * undoing file renames). A no-op for an empty partition.
 *
 * We drive BEGIN/COMMIT/ROLLBACK by hand rather than using better-sqlite3's
 * `db.transaction(fn)` wrapper because the repository methods are async (the
 * database abstraction is async-first even though the underlying SQL is sync),
 * and `db.transaction` requires a synchronous body. BEGIN IMMEDIATE takes the
 * reserved lock up front so lock contention surfaces early, not mid-batch.
 */
async function applyPartition(
  partition: WriteDbTarget,
  db: Database | null,
  writes: ChildWritePayload[],
  jobId: string,
): Promise<void> {
  if (writes.length === 0) return;
  if (!db) {
    throw new Error(
      `Cannot apply ${partition} writes for job ${jobId}: database connection is not initialized`,
    );
  }

  const isMount = partition === 'mountIndex';
  // bufferedFolderId → existing folderId, populated when a concurrent folder
  // create is reconciled to an already-committed row (mount-index only).
  const folderRemap = new Map<string, string>();
  const stagedRenames: Array<{ from: string; to: string }> = [];

  db.exec('BEGIN IMMEDIATE');
  try {
    for (const raw of writes) {
      if (raw.method === '__finalizeFile') {
        const args = raw.args[0] as { stagingPath: string; finalPath: string };
        ensureDirSync(path.dirname(args.finalPath));
        fs.renameSync(args.stagingPath, args.finalPath);
        stagedRenames.push({ from: args.stagingPath, to: args.finalPath });
        continue;
      }

      // Redirect any folder reference an earlier same-batch create reconciled
      // to an existing folder row (no-op when nothing has been remapped).
      const w = isMount ? rewriteFolderRefs(raw, folderRemap) : raw;

      if (isMount && w.method === DOC_MOUNT_FOLDER_CREATE) {
        await applyFolderCreateIdempotent(w, folderRemap, jobId);
        continue;
      }

      const result = applyRepositoryWrite(w);
      if (result && typeof (result as { then?: unknown }).then === 'function') {
        await result;
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* may already be rolled back */ }
    // Undo any file renames that completed before the throw.
    for (const r of stagedRenames.reverse()) {
      try { fs.renameSync(r.to, r.from); } catch { /* best effort */ }
    }
    throw err;
  }
}

/**
 * Apply a secondary (non-main) partition best-effort: a failure is rolled back
 * inside {@link applyPartition}, logged, and swallowed so the already-committed
 * main partition (the chat turn) survives. Only reached for main-primary jobs.
 */
async function applySecondaryBestEffort(
  partition: WriteDbTarget,
  db: Database | null,
  writes: ChildWritePayload[],
  jobId: string,
): Promise<void> {
  if (writes.length === 0) return;
  try {
    await applyPartition(partition, db, writes, jobId);
  } catch (err) {
    log.error('Secondary partition failed after main commit; effect dropped, chat preserved', {
      jobId,
      partition,
      writeCount: writes.length,
      error: getErrorMessage(err),
    });
  }
}

/**
 * Apply a `docMountFolders.create` write, tolerating the rare cross-job
 * concurrent create: if another job committed the same folder path first the
 * INSERT hits the `(mountPointId, parentId, name)` unique index. Because applies
 * are serialized (see {@link applyWritesAtomically}), that row is fully
 * committed and visible on this connection, so we resolve to it and remap the
 * discarded buffered folder id for the rest of this batch's writes. SQLite's
 * default ABORT conflict resolution rolls back only the offending statement, so
 * the surrounding transaction stays usable.
 */
async function applyFolderCreateIdempotent(
  write: ChildWritePayload,
  folderRemap: Map<string, string>,
  jobId: string,
): Promise<void> {
  try {
    const result = applyRepositoryWrite(write);
    if (result && typeof (result as { then?: unknown }).then === 'function') {
      await result;
    }
    return; // created fresh
  } catch (err) {
    if (!isUniqueConstraintError(err)) throw err;

    const data = (write.args[0] ?? {}) as { mountPointId?: unknown; path?: unknown };
    const options = (write.args[1] ?? {}) as { id?: unknown };
    const bufferedId = typeof options.id === 'string' ? options.id : undefined;

    if (typeof data.mountPointId !== 'string' || typeof data.path !== 'string') {
      throw err; // can't reconcile without the identifying (mountPointId, path)
    }

    const repos = getRepositories();
    const existing = await repos.docMountFolders.findByMountPointAndPath(data.mountPointId, data.path);
    if (!existing) throw err; // unique conflict but no matching row — surface it

    if (bufferedId && bufferedId !== existing.id) {
      folderRemap.set(bufferedId, existing.id);
    }
    log.warn('Reconciled concurrent doc-store folder create to existing folder', {
      jobId,
      mountPointId: data.mountPointId,
      path: data.path,
      bufferedId,
      existingId: existing.id,
    });
  }
}

function dispatchInvalidations(writes: ChildWritePayload[]): void {
  // Realtime hints for whatever entities this batch touched. Separate from the
  // server-side cache invalidation below — that one is about *this* process's
  // in-memory caches, this one is about every open tab's query cache — but they
  // belong at the same moment: the writes have committed and are readable.
  for (const hint of topicsForWriteBatch(writes)) {
    publishRealtime(hint.topic, hint.id);
  }

  // Collect unique invalidation targets up front so we don't fire duplicates
  // when a single batch touches the same character/mount-point repeatedly.
  const vectorStoreKeys = new Set<string>();
  const mountPointKeys = new Set<string>();

  for (const w of writes) {
    // Many of the listed methods take the id as a top-level field on the
    // first arg, or as the first positional arg; firstIdArg probes both shapes.
    const charId = firstIdArg(w.args, 'characterId');
    if (charId && WRITES_INVALIDATING_VECTOR_STORE.has(w.method)) {
      vectorStoreKeys.add(charId);
    }
    const mountId = firstIdArg(w.args, 'mountPointId');
    if (mountId && WRITES_INVALIDATING_MOUNT_CACHE.has(w.method)) {
      mountPointKeys.add(mountId);
    }
  }

  if (vectorStoreKeys.size === 0 && mountPointKeys.size === 0) return;

  // Always notify the child immediately (cheap IPC). The local-side
  // invalidation goes through dynamic `import()` so it survives the
  // various module-loading shapes Next.js webpack uses (`require()`
  // returned a non-namespace object in some configurations).
  for (const key of vectorStoreKeys) notifyChild('vectorStore', key);
  for (const key of mountPointKeys) notifyChild('mountPoint', key);

  void invalidateLocalCachesAsync(vectorStoreKeys, mountPointKeys);
}

async function invalidateLocalCachesAsync(
  vectorStoreKeys: Set<string>,
  mountPointKeys: Set<string>,
): Promise<void> {
  if (vectorStoreKeys.size > 0) {
    try {
      const mod = await import('@/lib/embedding/vector-store');
      const mgr = mod.getVectorStoreManager();
      for (const key of vectorStoreKeys) {
        try { mgr.unloadStore(key); }
        catch { /* best effort */ }
      }
    } catch { /* best effort */ }
  }

  if (mountPointKeys.size > 0) {
    try {
      const mod = await import('@/lib/mount-index/mount-chunk-cache');
      for (const key of mountPointKeys) {
        try { mod.invalidateMountPoint(key); }
        catch { /* best effort */ }
      }
    } catch { /* best effort */ }
  }
}

const WRITES_INVALIDATING_VECTOR_STORE = new Set<string>([
  'vectorIndices.deleteStore',
  'vectorIndices.addEntry',
  'vectorIndices.updateEntryEmbedding',
  'vectorIndices.saveMeta',
  'memories.updateForCharacter',
  'memories.delete',
  'memories.create',
  'memories.upsert',
]);

const WRITES_INVALIDATING_MOUNT_CACHE = new Set<string>([
  'docMountChunks.upsert',
  'docMountChunks.delete',
  'docMountChunks.deleteByMountPointId',
]);

function applyRepositoryWrite(w: ChildWritePayload): unknown {
  const repos = getRepositories();
  const fn = resolveDottedMethod(repos as unknown as Record<string, unknown>, w.method);
  if (typeof fn !== 'function') {
    throw new Error(`No repository method registered for "${w.method}"`);
  }
  // May be sync or return a Promise; the caller awaits if needed.
  return fn(...w.args);
}

function resolveDottedMethod(root: Record<string, unknown>, dotted: string): unknown {
  const parts = dotted.split('.');
  let cur: unknown = root;
  for (let i = 0; i < parts.length; i++) {
    if (cur === null || cur === undefined) return undefined;
    cur = (cur as Record<string, unknown>)[parts[i]];
  }
  // Functions on classes need to be bound back to the parent object so
  // `this` is correct. Walk to the parent and return a bound copy.
  if (typeof cur === 'function' && parts.length > 1) {
    let parent: unknown = root;
    for (let i = 0; i < parts.length - 1; i++) {
      parent = (parent as Record<string, unknown>)[parts[i]];
    }
    return (cur as (...args: unknown[]) => unknown).bind(parent);
  }
  return cur;
}

function ensureDirSync(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function cleanupStagingDirs(writes: ChildWritePayload[], jobId: string): void {
  // For now we just remove any staging directories named after this jobId.
  // The child writes files into <dataDir>/files/.staging/<jobId>/...; the
  // exact base is encoded in the args' stagingPath, so derive it from the
  // first __finalizeFile call (if any).
  for (const w of writes) {
    if (w.method !== '__finalizeFile') continue;
    const args = w.args[0] as { stagingPath: string };
    const stagingRoot = findStagingRoot(args.stagingPath, jobId);
    if (!stagingRoot) continue;
    try { fs.rmSync(stagingRoot, { recursive: true, force: true }); } catch { /* best effort */ }
    return;
  }
}

function findStagingRoot(stagingPath: string, jobId: string): string | null {
  const idx = stagingPath.indexOf(`.staging${path.sep}${jobId}`);
  if (idx < 0) return null;
  const end = idx + `.staging${path.sep}${jobId}`.length;
  return stagingPath.slice(0, end);
}

// ============================================================================
// Stuck/orphan recovery
// ============================================================================

async function resetOrphanedJobs(): Promise<void> {
  const repos = getRepositories();
  const count = await repos.backgroundJobs.resetAllProcessingJobs();
  if (count > 0) {
    log.info('Reset orphaned PROCESSING jobs at startup', { count });
  }
}

export async function resetStuckJobs(timeoutMinutes: number = 10): Promise<number> {
  const repos = getRepositories();
  const count = await repos.backgroundJobs.resetStuckJobs(timeoutMinutes);
  if (count > 0) {
    log.info('Reset stuck jobs', { count, timeoutMinutes });
  }
  return count;
}
