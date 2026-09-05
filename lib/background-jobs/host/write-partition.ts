/**
 * Write-batch partitioning for the job applier (parent-side).
 *
 * A background-job handler runs in the forked child and buffers ALL of its
 * repository writes into one batch the parent applies. Those writes can target
 * three *separate* SQLite databases:
 *
 *   - the **main** DB (`quilltap.db`) — chats, characters, memories, folders,
 *     files, projects, background_jobs, embedding_status, vector indices, …
 *   - the dedicated **mount-index** DB (doc-store folders/files/links/chunks)
 *   - the dedicated **llm-logs** DB
 *
 * Before this module the applier wrapped the *whole* batch in a single
 * `BEGIN IMMEDIATE` on the **main** connection, then let mount-index / llm-logs
 * writes auto-commit statement-by-statement on their own connections inside
 * that loop. Two problems fell out of that shared fate:
 *
 *   1. A mount-index write failure (e.g. the cross-job concurrent folder
 *      create hitting the `(mountPointId, parentId, name)` unique index) rolled
 *      back the main-DB chat/run-state writes — poisoning an autonomous turn —
 *      while any mount-index rows already auto-committed before the throw
 *      *leaked* (they were never inside a transaction that could roll back).
 *   2. There was no atomicity for the mount-index / llm-logs portion at all.
 *
 * The applier now partitions a batch by target database and commits each
 * partition in its OWN transaction on its OWN connection, so a failure in one
 * database can neither roll back nor leak into another. This module holds the
 * pure (no-I/O, fully unit-testable) classification + partition logic.
 *
 * @module lib/background-jobs/host/write-partition
 */

import type { ChildWritePayload } from '../ipc-types';

/** Which dedicated SQLite database a buffered write targets. */
export type WriteDbTarget = 'main' | 'mountIndex' | 'llmLogs';

/**
 * Repository keys whose rows live in the dedicated mount-index database
 * (`getRawMountIndexDatabase()`), not the main DB. Mirrors the repos that
 * override `getCollection()` to use `getRawMountIndexDatabase()` — see
 * `lib/database/repositories/doc-mount-*.repository.ts` and
 * `project-doc-mount-links.repository.ts`. Keep in sync when adding a repo
 * backed by the mount-index DB.
 */
export const MOUNT_INDEX_REPO_KEYS: ReadonlySet<string> = new Set([
  'docMountPoints',
  'docMountFiles',
  'docMountFileLinks',
  'docMountFolders',
  'docMountChunks',
  'docMountDocuments',
  'docMountBlobs',
  'projectDocMountLinks',
]);

/**
 * Repository keys whose rows live in the dedicated llm-logs database
 * (`getRawLLMLogsDatabase()`).
 */
export const LLM_LOGS_REPO_KEYS: ReadonlySet<string> = new Set(['llmLogs']);

/**
 * The dotted method that creates a `doc_mount_folders` row. Singled out by the
 * applier for idempotent cross-job conflict handling (two jobs concurrently
 * buffering a create for the same folder path).
 */
export const DOC_MOUNT_FOLDER_CREATE = 'docMountFolders.create';

/**
 * Fields on a mount-index write's data object (`args[0]`) that hold a folder
 * id and therefore may need rewriting when an earlier same-batch folder create
 * was reconciled to an already-existing folder row. `parentId` lives on folder
 * rows; `folderId` lives on file-link rows.
 */
export const FOLDER_REF_FIELDS: readonly string[] = ['parentId', 'folderId'];

/**
 * Classify which database a single buffered write targets.
 *
 * `__finalizeFile` is a built-in filesystem rename the applier performs inside
 * the main-DB transaction (so the renamed file is atomic with the DB rows that
 * reference it), so it rides with the `'main'` partition. Anything whose repo
 * key isn't explicitly mount-index or llm-logs defaults to `'main'` — the safe
 * default, since main is the all-or-nothing primary partition.
 */
export function classifyWriteTarget(method: string): WriteDbTarget {
  if (method === '__finalizeFile') return 'main';
  const repoKey = method.split('.', 1)[0];
  if (MOUNT_INDEX_REPO_KEYS.has(repoKey)) return 'mountIndex';
  if (LLM_LOGS_REPO_KEYS.has(repoKey)) return 'llmLogs';
  return 'main';
}

/** A batch split by target database, preserving per-partition write order. */
export interface PartitionedWrites {
  main: ChildWritePayload[];
  mountIndex: ChildWritePayload[];
  llmLogs: ChildWritePayload[];
}

/**
 * Split a write batch into per-database partitions, preserving the original
 * relative order within each partition (intra-partition ordering carries
 * dependencies — e.g. a folder must be created before the file that lives in
 * it).
 */
export function partitionWrites(writes: ChildWritePayload[]): PartitionedWrites {
  const out: PartitionedWrites = { main: [], mountIndex: [], llmLogs: [] };
  for (const w of writes) {
    out[classifyWriteTarget(w.method)].push(w);
  }
  return out;
}

/**
 * Job types whose **main-DB** writes (the assistant message + run-state
 * transition) must survive a failure in a *secondary* database's writes.
 *
 * These handlers are NOT idempotent under retry — re-running one to recover a
 * dropped secondary (doc-store) write would duplicate the chat turn. So for
 * these the applier commits the main partition first and authoritatively, then
 * applies secondary partitions best-effort: a secondary failure is rolled back
 * (no leak), logged, and swallowed, leaving the chat intact. Every other job
 * type is idempotent and uses all-or-nothing semantics (any partition failure
 * fails the job so the existing retry path re-runs it).
 *
 * Decision recorded 2026-06-05 (see project_autonomous_turn_poison_write memory).
 */
export const MAIN_PRIMARY_JOB_TYPES: ReadonlySet<string> = new Set([
  'AUTONOMOUS_ROOM_TURN',
]);

/** True when a job's main-DB writes take priority over secondary-DB writes. */
export function isMainPrimaryJobType(jobType: string | undefined): boolean {
  return jobType !== undefined && MAIN_PRIMARY_JOB_TYPES.has(jobType);
}

/**
 * Rewrite folder-id references in a write's data object (`args[0]`) using a
 * remap of `bufferedFolderId → existingFolderId`. Used by the mount-index
 * partition apply when a concurrent folder create was reconciled to an
 * already-existing row, so later writes in the same batch that point at the
 * (now-discarded) buffered folder id are redirected to the surviving row.
 *
 * Pure and non-mutating: returns the same payload reference when nothing
 * changed, or a shallow copy with a rewritten `args[0]` when it did.
 */
export function rewriteFolderRefs(
  write: ChildWritePayload,
  remap: ReadonlyMap<string, string>,
): ChildWritePayload {
  if (remap.size === 0) return write;
  const data = write.args[0];
  if (!data || typeof data !== 'object' || Array.isArray(data)) return write;

  let changed = false;
  const next: Record<string, unknown> = { ...(data as Record<string, unknown>) };
  for (const field of FOLDER_REF_FIELDS) {
    const value = next[field];
    if (typeof value === 'string' && remap.has(value)) {
      next[field] = remap.get(value);
      changed = true;
    }
  }
  if (!changed) return write;

  const args = write.args.slice();
  args[0] = next;
  return { method: write.method, args };
}

/**
 * Whether an error thrown by a write is a SQLite uniqueness/primary-key
 * constraint violation — the signature of a concurrent folder create losing
 * the race to an already-committed row.
 *
 * Re-exported from the database layer, which owns the single definition: the
 * `folders.ensureByPath` chokepoint recovers from exactly the same error, and
 * two copies of this predicate would drift.
 */
export { isUniqueConstraintError } from '@/lib/database/sqlite-errors';
