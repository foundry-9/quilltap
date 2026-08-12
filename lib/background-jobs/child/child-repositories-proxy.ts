/**
 * Child-side repository proxy
 *
 * Inside the forked job-runner child, `getRepositories()` returns this
 * proxy instead of the raw repository container. For each repository the
 * proxy intercepts method calls:
 *   - **Read methods** (whitelisted by name pattern or explicit override)
 *     pass through to the real repository, which queries the readonly
 *     SQLCipher connection.
 *   - **Write methods** push a `{ method, args }` payload into the
 *     per-job AsyncLocalStorage buffer and return a synthetic result
 *     synchronously. The real write never touches the readonly DB; the
 *     parent applies the batch later in a single transaction.
 *   - **Unknown methods** throw, so a new repository method that doesn't
 *     fit either pattern surfaces loudly instead of silently corrupting
 *     state.
 *
 * The audit in `docs/developer/BACKGROUND_JOBS_CHILD.md` produced the
 * override tables below. When adding a new repository method, classify
 * it there first.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import crypto from 'node:crypto';
import { getRepositories as getRealRepositories } from '@/lib/database/repositories';
import type { RepositoryContainer } from '@/lib/repositories/factory';
import type { ChildWritePayload } from '../ipc-types';
import { logger } from '@/lib/logger';
import { runWithJobFolderCache } from './job-folder-cache';

const log = logger.child({ module: 'jobs:child:proxy' });

// ============================================================================
// Per-job pending-writes buffer (AsyncLocalStorage)
// ============================================================================

interface JobScope {
  jobId: string;
  writes: ChildWritePayload[];
  /**
   * Set of repo.method strings appended during this job. Used to surface
   * read-your-writes regressions: if a read lands on a table already written
   * this job, log a warning so the regression is visible during testing.
   */
  recentlyWrittenKeys: Set<string>;
  /**
   * Per-job dedup of read-your-writes warnings so we don't spam the log
   * when a handler does many reads against the same table after a write.
   */
  warnedReads: Set<string>;
  /**
   * Count of write args down-converted by {@link sanitizeForIpc} this job.
   * Surfaced once per job in {@link flushPendingWrites} for observability.
   */
  sanitizedArgs: number;
}

const jobScopeStore = new AsyncLocalStorage<JobScope>();

export function runWithJobScope<T>(jobId: string, fn: () => Promise<T>): Promise<T> {
  const scope: JobScope = {
    jobId,
    writes: [],
    recentlyWrittenKeys: new Set(),
    warnedReads: new Set(),
    sanitizedArgs: 0,
  };
  // Nest a fresh per-job folder-ensure memo. It lives in its own
  // dependency-free module so lib/mount-index/folder-paths can read it via
  // getJobFolderEnsureCache without importing this heavy proxy (and the
  // repositories barrel it pulls in). See job-folder-cache.ts.
  return jobScopeStore.run(scope, () => runWithJobFolderCache(fn));
}

export function flushPendingWrites(): ChildWritePayload[] {
  const scope = jobScopeStore.getStore();
  if (!scope) return [];
  const writes = scope.writes.slice();
  if (scope.sanitizedArgs > 0) {
    log.debug('Down-converted Float32Array write args for IPC transport', {
      jobId: scope.jobId,
      writeCount: writes.length,
      sanitizedArgs: scope.sanitizedArgs,
    });
  }
  scope.writes.length = 0;
  return writes;
}

/**
 * Convert IPC-hostile values in a buffered write's args into structured-clone-
 * and JSON-safe equivalents before they cross the child→parent boundary.
 *
 * Embeddings are produced as `Float32Array` (see `applyEmbeddingProfile`). The
 * job-runner child ships buffered writes to the parent over the fork IPC
 * channel; if that channel's effective serialization is not `'advanced'`
 * (V8 structured-clone), a `Float32Array` arrives at the parent as a plain
 * object and fails the repository embedding schemas. Every embedding schema
 * also accepts a plain `number[]` and transforms it back into a `Float32Array`
 * on validation, so down-converting here is lossless and independent of the
 * channel's serialization mode.
 *
 * Only `Float32Array` is rewritten. `Buffer`/other typed-array views are left
 * intact (reinterpreting their bytes as numbers would corrupt them), and class
 * instances / Maps / etc. are left for the IPC layer to handle. Objects and
 * arrays are rebuilt only when they actually contain a `Float32Array`, so the
 * common no-embedding write incurs no copy and the caller's in-memory args are
 * never mutated.
 */
function sanitizeForIpc(value: unknown, depth = 0): unknown {
  if (value instanceof Float32Array) {
    return Array.from(value);
  }
  if (value === null || typeof value !== 'object' || depth > 8) {
    return value;
  }
  // Buffers and other typed-array views (Uint8Array, etc.) are left as-is.
  if (ArrayBuffer.isView(value)) {
    return value;
  }
  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map((v) => {
      const s = sanitizeForIpc(v, depth + 1);
      if (s !== v) changed = true;
      return s;
    });
    return changed ? out : value;
  }
  // Only descend into plain objects; leave class instances / Maps untouched.
  const proto = Object.getPrototypeOf(value);
  if (proto === Object.prototype || proto === null) {
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const s = sanitizeForIpc(v, depth + 1);
      if (s !== v) changed = true;
      out[k] = s;
    }
    return changed ? out : value;
  }
  return value;
}

export function appendWrite(method: string, args: unknown[]): void {
  const scope = jobScopeStore.getStore();
  if (!scope) {
    throw new Error(`Cannot append write "${method}" outside of a job scope`);
  }
  const safeArgs = args.map((a) => {
    const sanitized = sanitizeForIpc(a);
    if (sanitized !== a) scope.sanitizedArgs++;
    return sanitized;
  });
  scope.writes.push({ method, args: safeArgs });
  scope.recentlyWrittenKeys.add(method);
}

// ============================================================================
// Method classification
// ============================================================================

const READ_PREFIXES = ['find', 'get', 'list', 'count', 'search', 'has', 'exists', 'is', 'fetch', 'query', 'load', 'read'];
const WRITE_PREFIXES = ['create', 'update', 'delete', 'upsert', 'bulk', 'set', 'mark', 'reset', 'cleanup', 'clear', 'increment', 'decrement', 'add', 'remove', 'cancel', 'touch', 'save'];

/**
 * Explicit overrides for methods whose names don't match the prefixes above.
 * Format: `'<repoKey>.<methodName>': 'read' | 'write'`.
 */
const METHOD_OVERRIDES: Record<string, 'read' | 'write'> = {
  // ---- Reads with non-conforming names -------------------------------------
  'chats.getMessages': 'read',
  'chats.getEquippedOutfitForCharacter': 'read',
  'folders.findByPath': 'read',
  'conversationChunks.findByInterchangeIndex': 'read',
  'backgroundJobs.findByUserId': 'read',
  'backgroundJobs.findDistinctChatIds': 'read',
  'vectorIndices.entryExists': 'read',

  // ---- Writes with non-conforming names ------------------------------------
  // memories
  'memories.updateForCharacter': 'write',
  // chats
  'chats.updateMessage': 'write',
  // background jobs
  'backgroundJobs.cancelByType': 'write',
  'backgroundJobs.createBatch': 'write',
  // embedding status
  'embeddingStatus.markAsEmbedded': 'write',
  'embeddingStatus.markAsFailed': 'write',
  'embeddingStatus.markAllPendingByProfileId': 'write',
  // tfidf vocabularies
  'tfidfVocabularies.upsertByProfileId': 'write',
  // help docs
  'helpDocs.clearAllEmbeddings': 'write',
  // llm logs
  'llmLogs.cleanupOldLogs': 'write',
  // vector indices
  'vectorIndices.addEntry': 'write',
  'vectorIndices.updateEntryEmbedding': 'write',
  'vectorIndices.saveMeta': 'write',
  'vectorIndices.deleteStore': 'write',
  // conversation chunks
  'conversationChunks.upsert': 'write',
  // doc mount points
  'docMountPoints.refreshStats': 'write',
  // doc-mount file-link content writers (database-backed stores). These
  // INSERT/UPDATE doc_mount_files / doc_mount_documents|blobs / doc_mount_file_links
  // via getRawMountIndexDatabase(), so they can only work in the child by being
  // buffered (the child DB is readonly; the parent applies them on its RW
  // connection). Their in-child callers — database-store.writeDatabaseDocument
  // and file-ops.writeDestBytes, reached by doc_write_file / doc_copy_file during
  // AUTONOMOUS_ROOM_TURN — DISCARD the return value, so the `undefined` synthetic
  // write result (syntheticWriteResult only shapes create*/upsert*) is fine. A
  // caller that consumes the return must NOT run in the child; see
  // CHILD_UNSUPPORTED_METHODS for why linkFilesystemFile is deliberately excluded.
  'docMountFileLinks.linkDocumentContent': 'write',
  'docMountFileLinks.linkBlobContent': 'write',
};

/**
 * Methods that must NOT run through the child proxy — neither as a read (the
 * child's DB is readonly) nor as a buffered write — because a buffered write
 * cannot satisfy a caller that consumes the method's *generated* row ids within
 * the same job.
 *
 * Unlike {@link FORBIDDEN_METHODS} (which fall through to the generic
 * "not classified" hint), these throw a tailored message so a future maintainer
 * doesn't "fix" the throw with a naive `METHOD_OVERRIDES = 'write'` entry — that
 * would actively corrupt state rather than fail loudly.
 *
 * `linkFilesystemFile` find-or-creates a file row + link row and returns their
 * ids; its in-child callers (`scanner.processMountFile`, `reindexSingleFile`'s
 * filesystem branch — both reached via doc_copy/doc_move to a *filesystem* mount
 * and fire-and-forget reindex during a turn) immediately read `link.id` to insert
 * chunk rows. A buffered write returns `undefined` (so `.id` throws) and, even
 * with a synthetic id, the parent's real `linkFilesystemFile` mints its own link
 * id, so the buffered chunks would dangle and the link's `chunkCount` would lie.
 * This path must run on the parent (host-RPC) or be deferred; it is not
 * child-safe. The throw is always caught by those best-effort callers, so the
 * file is written but left unindexed — the same soft-fail as before this entry.
 */
const CHILD_UNSUPPORTED_METHODS: Record<string, string> = {
  'docMountFileLinks.linkFilesystemFile':
    'it find-or-creates a file+link row and returns ids that its callers ' +
    '(scanner.processMountFile, reindexSingleFile) consume to insert chunk rows; ' +
    'a buffered write cannot supply the parent-generated id, so chunks would ' +
    'dangle. Run it on the parent (host-RPC) or defer it — see ' +
    'docs/developer/BACKGROUND_JOBS_CHILD.md.',
};

/**
 * Repository methods that should never be exposed inside the child — they
 * spawn LLM calls, manage processor state, or are transactional helpers
 * that must run on the parent.
 */
const FORBIDDEN_METHODS: Set<string> = new Set([
  'backgroundJobs.claimNextJob',
  'backgroundJobs.findNextScheduledAt',
  'backgroundJobs.markCompleted',
  'backgroundJobs.markFailed',
  'backgroundJobs.resetAllProcessingJobs',
  'backgroundJobs.resetStuckJobs',
]);

/**
 * Sub-table resolvers for repositories that own more than one table.
 *
 * The read-your-writes detector below compares a read against the buffered
 * writes, and its grouping key decides what counts as "the same data". The
 * repository object is the wrong granularity for a repo spanning several
 * tables: `connections` owns both `connection_profiles` and `api_keys`, so
 * every `AUTONOMOUS_ROOM_TURN` produced a warning pairing the buffered
 * `connections.incrementTokenUsage` (a counter bump on `connection_profiles`)
 * with a later `connections.findApiKeyByIdAndUserId` (a `SELECT` from
 * `api_keys`) — two tables that cannot stale each other. One line per turn,
 * forever, for a condition that does not exist.
 *
 * A resolver maps a method name to the table it touches, so reads and writes
 * are only compared when they land on the same one. Add an entry when a new
 * repository fronts multiple tables; repos absent from this map are treated
 * as a single group (the previous behaviour).
 */
const TABLE_GROUP_RESOLVERS: Record<string, (methodName: string) => string> = {
  // Every api_keys method carries "ApiKey" in its name (getApiKeysByUserId,
  // findApiKeyById, createApiKey, updateApiKey, deleteApiKey,
  // recordApiKeyUsage, findApiKeyByIdAndUserId); everything else on this repo
  // operates on connection_profiles.
  connections: (methodName) => (/ApiKey/.test(methodName) ? 'api_keys' : 'connection_profiles'),
};

/**
 * Grouping key for the read-your-writes heuristic: the table a call touches,
 * as best we can tell from its name. Falls back to the repository key so an
 * unmapped repo behaves exactly as it did before table groups existed.
 */
function tableGroup(repoKey: string, methodName: string): string {
  const resolver = TABLE_GROUP_RESOLVERS[repoKey];
  return resolver ? `${repoKey}.${resolver(methodName)}` : repoKey;
}

/** Same, for an already-buffered `<repoKey>.<methodName>` write key. */
function tableGroupForWriteKey(writeKey: string): string {
  const dot = writeKey.indexOf('.');
  if (dot === -1) return writeKey;
  return tableGroup(writeKey.slice(0, dot), writeKey.slice(dot + 1));
}

function classifyMethod(repoKey: string, methodName: string): 'read' | 'write' | 'unknown' {
  const fqn = `${repoKey}.${methodName}`;

  if (FORBIDDEN_METHODS.has(fqn)) return 'unknown';
  // Child-unsupported methods stay 'unknown' (→ tailored throw in wrapRepo) even
  // if a future prefix change would otherwise classify them as a write.
  if (CHILD_UNSUPPORTED_METHODS[fqn]) return 'unknown';
  if (METHOD_OVERRIDES[fqn]) return METHOD_OVERRIDES[fqn];

  // Lifecycle / introspection methods on every repo — pass through as reads.
  if (methodName === 'constructor' || methodName.startsWith('_')) return 'read';
  if (methodName === 'then' || methodName === 'toJSON' || methodName === 'toString' || methodName === 'inspect') return 'read';

  for (const p of READ_PREFIXES) {
    if (methodName.startsWith(p) && (methodName.length === p.length || /[A-Z]/.test(methodName[p.length]))) {
      return 'read';
    }
  }
  for (const p of WRITE_PREFIXES) {
    if (methodName.startsWith(p) && (methodName.length === p.length || /[A-Z]/.test(methodName[p.length]))) {
      return 'write';
    }
  }
  return 'unknown';
}

// ============================================================================
// Synthetic result builder
// ============================================================================

/**
 * Produce a placeholder return value for a buffered write AND mutate the
 * args so the parent applies the same synthetic ID the handler just saw.
 *
 * Most handlers don't read back from a write within the same job (the
 * audit confirms this), but several do `const m = await repos.x.create({...});`
 * followed by `await repos.x.update(m.id, …)` where `m.id` is consumed
 * synchronously. If the proxy generates one ID for the synthetic return
 * but lets the parent's real `create` invent a *different* ID, the
 * subsequent update fails ("not found"). So when we generate the ID we
 * write it back into args[0] before buffering — the buffered write now
 * has the same ID the handler is using.
 */
function syntheticWriteResult(methodName: string, args: unknown[]): unknown {
  if (methodName.startsWith('create') && !methodName.startsWith('createBatch')) {
    // Repository create() methods follow the base shape:
    //   create(data: Omit<T, 'id'|'createdAt'|'updatedAt'>, options?: CreateOptions)
    // and the desired ID lives in `options.id`, not `data.id`
    // (see `lib/database/repositories/base.repository.ts:_create`).
    // Inject the synthetic ID into args[1] so the parent's real `_create`
    // uses the same ID we just handed back to the caller.
    const data = (args[0] && typeof args[0] === 'object') ? args[0] as Record<string, unknown> : {};
    const options = (args[1] && typeof args[1] === 'object') ? args[1] as Record<string, unknown> : {};
    if (typeof options.id !== 'string') {
      options.id = (typeof data.id === 'string') ? data.id : crypto.randomUUID();
      args[1] = options;
    }
    const now = new Date().toISOString();
    return { id: options.id, createdAt: now, updatedAt: now, ...data };
  }
  if (methodName.startsWith('upsert')) {
    if (args[0] && typeof args[0] === 'object') {
      const input = args[0] as Record<string, unknown>;
      if (typeof input.id !== 'string') {
        input.id = crypto.randomUUID();
      }
      return { ...input };
    }
    return { id: crypto.randomUUID() };
  }
  return undefined;
}

// ============================================================================
// Proxy construction
// ============================================================================

function wrapRepo<T extends object>(repoKey: string, instance: T): T {
  return new Proxy(instance, {
    get(target, prop) {
      const key = String(prop);
      const real = (target as Record<string, unknown>)[key];

      // Non-function properties pass through unchanged.
      if (typeof real !== 'function') return real;

      const classification = classifyMethod(repoKey, key);

      if (classification === 'read') {
        // Diagnostic: warn (once per (jobId, readMethod)) if a read hits a
        // table recently appended to the pending-writes buffer. Heuristic —
        // checks the table a method name implies, not row identity — but
        // enough to flag suspicious patterns during testing without spamming
        // the log. See TABLE_GROUP_RESOLVERS for why the grouping key is the
        // table rather than the repository object.
        return (...args: unknown[]) => {
          const scope = jobScopeStore.getStore();
          if (scope && scope.recentlyWrittenKeys.size > 0) {
            const readKey = `${repoKey}.${key}`;
            if (!scope.warnedReads.has(readKey)) {
              const readGroup = tableGroup(repoKey, key);
              for (const writtenKey of scope.recentlyWrittenKeys) {
                if (tableGroupForWriteKey(writtenKey) === readGroup) {
                  scope.warnedReads.add(readKey);
                  log.warn('Read after buffered write on same table — possible read-your-writes issue', {
                    jobId: scope.jobId,
                    readMethod: readKey,
                    table: readGroup,
                    bufferedWrites: Array.from(scope.recentlyWrittenKeys),
                  });
                  break;
                }
              }
            }
          }
          return (real as (...a: unknown[]) => unknown).apply(target, args);
        };
      }

      if (classification === 'write') {
        return (...args: unknown[]) => {
          // Generate the synthetic result first — for create/upsert this
          // also injects an ID into args[1] (CreateOptions), so the
          // buffered write the parent applies uses the same ID the
          // caller now has.
          const result = syntheticWriteResult(key, args);
          appendWrite(`${repoKey}.${key}`, args);
          // Real repository write methods are async; mirror that here so
          // callers that chain `.then` / `.catch` / `Promise.all` against
          // the proxy don't trip on a synchronous `undefined`.
          return Promise.resolve(result);
        };
      }

      // Unknown — throw at call time so the offending handler is named
      // in the stack trace, not at proxy construction time.
      return () => {
        const fqn = `${repoKey}.${key}`;
        const unsupportedReason = CHILD_UNSUPPORTED_METHODS[fqn];
        if (unsupportedReason) {
          throw new Error(
            `Repository method "${fqn}" cannot run in the job child: ${unsupportedReason}`
          );
        }
        throw new Error(
          `Repository method "${fqn}" is not classified for child execution. ` +
          `Add it to METHOD_OVERRIDES in lib/background-jobs/child/child-repositories-proxy.ts.`
        );
      };
    },
  });
}

let cachedProxyContainer: RepositoryContainer | null = null;

/**
 * Test-only: drops the cached proxy container so the next call to
 * `getChildRepositoriesProxy()` re-wraps a fresh repo set. The production
 * runtime never calls this — the child has one repo container for its
 * entire lifetime.
 */
export function __resetProxyCacheForTesting(): void {
  cachedProxyContainer = null;
}

export function getChildRepositoriesProxy(): RepositoryContainer {
  if (cachedProxyContainer) return cachedProxyContainer;

  const real = getRealRepositories();

  // Build a wrapping object whose own keys mirror the real container, but
  // whose values are repo-Proxy wrappers. We can't Proxy the container
  // itself because property access patterns inside Quilltap include
  // `repos.memories.create(...)` — and we want the inner Proxy to be
  // returned synchronously.
  const wrapped: Record<string, unknown> = {};
  for (const key of Object.keys(real) as Array<keyof RepositoryContainer>) {
    const inst = real[key] as unknown;
    if (inst && typeof inst === 'object') {
      wrapped[key as string] = wrapRepo(key as string, inst as object);
    } else {
      wrapped[key as string] = inst;
    }
  }
  cachedProxyContainer = wrapped as unknown as RepositoryContainer;
  return cachedProxyContainer;
}
