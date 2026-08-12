# Background Jobs Child Process

The background-job processor runs in a forked child process (`child_process.fork`), not on the main Next.js Node thread. This document describes the parent/child split, the IPC protocol, the per-job write batching, and the handler audit that shaped the proxy.

## Why a child process

Twenty-four background-job handlers run through `lib/background-jobs/processor.ts` (registered in `lib/background-jobs/handlers/index.ts`). Before this refactor, that processor was a `setInterval` polling loop on the same Node thread that serves Next.js HTTP. Heavy handlers — most notably `MEMORY_HOUSEKEEPING` on a character with tens of thousands of memories — pinned the event loop and blocked HTTP responses for minutes. The `Promise.race` timeout in `executeJob` could not fire because its `setTimeout` was starved on the same loop.

Moving the processor into a child process means the HTTP event loop is free regardless of what handlers are doing. Native modules (`better-sqlite3-multiple-ciphers`, `sharp`) load cleanly in a forked Node process, crash isolation is total (a SIGSEGV in `sharp` only kills the child), and `child_process.fork` has less surface area against the packaged Electron shell than `worker_threads` would.

## Architecture

```
┌─ main (HTTP + Next.js) ──────────────────────┐         ┌─ child (jobs) ───────────────────┐
│ - SQLCipher RW connection (sole writer)      │         │ - SQLCipher READONLY connection  │
│ - instance lock holder                       │         │ - vectorStoreManager (warm)      │
│ - vectorStoreManager (warm, for chat reads)  │  ◄IPC►  │ - mount-chunk cache (warm)       │
│ - mount-chunk cache (warm, for chat reads)   │         │ - all 18 handlers                │
│ - logger (single file writer)                │         │ - parses jobs, returns writes    │
│ - claim loop + write-applier + ack           │         │ - file-system writes are staged  │
└──────────────────────────────────────────────┘         └──────────────────────────────────┘
```

The parent owns the only RW SQLite connection, the instance lock at `<dataDir>/data/quilltap.lock`, and the only file logger. The child opens its own readonly SQLCipher connection using the same `ENCRYPTION_MASTER_PEPPER` from inherited environment.

## IPC protocol

Parent → child:

| Type | Payload | Purpose |
|------|---------|---------|
| `job` | `{ id, jobType, payload, attempt, deadline }` | Dispatch a claimed job to the child |
| `invalidate` | `{ target: 'vectorStore' \| 'mountPoint', key }` | Tell the child to drop a cached entry after the parent applied a related write |
| `shutdown` | `{}` | Drain in-flight, exit cleanly |
| `host-rpc-response` | `{ requestId, ok, result?, error? }` | Reply to a child `host-rpc` request; correlated by `requestId` |

Child → parent:

| Type | Payload | Purpose |
|------|---------|---------|
| `job-result` | `{ id, ok, writes, error? }` | Job finished; `writes` is the batched list of repository write calls accumulated during the handler run (`{ method, args }[]`) |
| `log` | `{ record }` | Forwards a log record to the parent's file transport (single writer; no rotation races) |
| `status` | `{ inFlight, completedSinceLast, ... }` | Periodic snapshot for `getProcessorStatus()` |
| `shutdown-ack` | `{}` | Child's acknowledgement that it has drained in-flight jobs and is exiting; lets the parent resolve its shutdown promise instead of waiting on the kill timeout. |
| `host-rpc` | `{ requestId, method, args }` | Synchronous request for an RW operation the child cannot perform on its readonly connection. The parent runs it immediately (outside the per-job buffered-writes transaction) and replies with `host-rpc-response`. Methods (see the `switch` in `host/host-rpc-dispatcher.ts`): `uploadFile`, `writeCharacterAvatarToVault`, `writeLanternBackgroundToMountStore`, `writeConversationSummaryToVaults`, `removeConversationSummariesFromVaults`, and `startScheduledAutonomousRun`. The first five are file-storage / vault writes whose server-computed return values (`storageKey`/`blobId`/`linkId`) the buffered-write proxy cannot model; `startScheduledAutonomousRun` is an *ordering* bridge (see its note in the handler audit) — it must commit `currentRunId` on the parent's RW connection *before* the turn job it enqueues becomes claimable. Side-effects committed here are **not** rolled back if the job's later buffered writes fail; periodic file reconciliation cleans up orphan blobs. See `host/host-rpc-dispatcher.ts` and `child/host-rpc-client.ts`. |

## Job lifecycle

1. Parent's claim loop calls `repos.backgroundJobs.claimNextJob()` against its RW connection.
2. Parent posts `{ type: 'job', ... }` to the child.
3. Child runs the handler. The handler imports `getRepositories()`, which returns a proxy in the child runtime: read methods hit the readonly DB directly; write methods append `{ method, args }` to a per-job buffer in `AsyncLocalStorage` and return a synthetic result synchronously.
4. Child posts `{ type: 'job-result', ok, writes }` when the handler resolves.
5. Parent applies the batch, **partitioned by target database** (see [Per-database partitioned apply](#per-database-partitioned-apply) below), then marks the job COMPLETED. If a partition the job depends on throws, the parent marks FAILED with the error and lets the existing retry policy in `lib/database/repositories/background-jobs.repository.ts` handle requeueing.

## Concurrency

A single global cap on in-flight jobs of any type, enforced in the dispatcher (`host/job-dispatcher.ts`). This replaced the old per-type caps. The cap is read live from the `maxConcurrentJobs` instance setting (via `getMaxConcurrentJobs()`); `DEFAULT_MAX_IN_FLIGHT = 4` is only the fallback when the setting is unreadable. (The earlier `chatSettings.memoryExtractionConcurrency` per-type slider is gone; a single instance-wide knob took its place.)

**Trade-off**: a flat global cap means a burst of one job type starves others. Concretely, a full slate of concurrent housekeeping jobs (long-running, read-heavy) will queue all memory-extraction work behind them. Memory extraction produces the memories that the next conversation will recall, so housekeeping bursts can delay future memory availability by seconds-to-minutes. This is acceptable because (a) housekeeping is rarely concurrent in normal operation, (b) the chat path doesn't depend on extraction completion to assemble its prompt, (c) per the design guidance, the chat path is OK getting "a little ahead of memory extraction." If this trade-off bites in practice, the fix is per-category caps (deferred follow-up), not raising the global cap.

## Batched writes and read-your-writes

Writes are batched at job end. The proxy resolves write calls immediately with **client-generated IDs** (string UUIDs via `crypto.randomUUID()`, matching the existing schema convention — every Quilltap table uses string UUIDs). Subsequent reads inside the same handler cannot see those uncommitted rows. If a handler genuinely needs read-your-writes within a single job, the handler must be restructured to compute everything from in-memory state before flushing.

The proxy logs a runtime warning ("Read after buffered write on same table") when a read hits a table already written this job, deduped per `(jobId, readMethod)`. This is a cheap diagnostic for read-your-writes regressions: it compares method names, not row identity, so it flags suspicion rather than proof.

The grouping key is the *table* a method implies, not the repository object — a repository fronting several tables would otherwise warn on pairs that cannot stale each other. `TABLE_GROUP_RESOLVERS` in `child-repositories-proxy.ts` holds the per-repository resolvers (today: `connections` splits `api_keys` from `connection_profiles`); a repository with no resolver is treated as a single table. **When you add a repository that fronts more than one table, add a resolver entry** — otherwise its every read/write pairing warns.

## Per-database partitioned apply

A single batch can contain writes to three *separate* SQLite databases: the main DB (`quilltap.db`), the dedicated mount-index/doc-store DB, and the llm-logs DB. An autonomous-room turn, for example, buffers its assistant message + run-state (main DB) alongside any `doc_*` tool side-effects (mount-index DB) in one batch. Each database is a distinct `better-sqlite3` connection (`getRawDatabase()`, `getRawMountIndexDatabase()`, `getRawLLMLogsDatabase()`).

The applier (`lib/background-jobs/host/job-dispatcher.ts`, with pure partition logic in `write-partition.ts`) splits the batch by target database — keyed off the repo prefix of each `repoKey.method`; `__finalizeFile` rides with the main partition — and commits **each partition in its own hand-driven `BEGIN IMMEDIATE … COMMIT` on its own connection**. A failure in one database can therefore neither roll back nor leak into another. (Before this, the whole batch ran inside one transaction on the *main* connection while mount-index/llm-logs writes auto-committed statement-by-statement inside that loop, so a doc-store failure rolled back unrelated chat state *and* leaked partial doc-store rows.)

Ordering and failure policy depend on whether the job's main-DB writes are **primary** (`MAIN_PRIMARY_JOB_TYPES` — currently just `AUTONOMOUS_ROOM_TURN`):

- **Idempotent handlers** (everything else): secondary partitions (mount-index, llm-logs) apply *before* main, so a secondary failure prevents the main commit — e.g. an `embeddingStatus.markAsEmbedded` (main) is never committed if the `docMountChunks.updateEmbedding` (mount-index) it pairs with failed. Any partition failure throws → job FAILED → the existing retry path re-runs the (idempotent) handler.
- **Main-primary handlers** (autonomous turns are not idempotent — retrying duplicates the chat turn): the main partition commits *first and authoritatively*. A main failure aborts before any secondary write runs (no leak) and surfaces to the caller (job FAILED → the room reconciles to `paused`). Once main commits, secondary partitions are applied **best-effort**: a genuine doc-store failure is rolled back, logged, and dropped, leaving the committed chat turn intact. (Decision recorded 2026-06-05.)

The whole multi-partition apply is serialized across jobs (an `applyChain` promise), which is also what makes the folder reconcile below race-free.

### Cross-job concurrent folder reconcile

`docMountFolders` rows carry a `(mountPointId, COALESCE(parentId,''), name)` unique index. Two jobs running concurrently in the child both read the readonly DB, neither sees the other's buffered create, and both buffer a `docMountFolders.create` for the same path. The per-job folder memo (`job-folder-cache.ts`) only de-duplicates *within* one job; the second job's create still collides at apply time.

The mount-index partition handles this: a `docMountFolders.create` that hits the unique index is caught (`isUniqueConstraintError`), resolved to the already-committed row via `findByMountPointAndPath`, and the discarded buffered folder id is recorded in a per-partition remap. Subsequent writes in the same batch (child folders' `parentId`, file links' `folderId`) are rewritten through that remap so they point at the surviving row. Because applies are serialized, the conflicting row is fully committed and visible on the connection before this job's transaction begins, and SQLite's default ABORT conflict resolution rolls back only the offending statement (the transaction stays usable).

## Deferred-file-write pattern

Two handlers (`story-background` and `character-avatar`) write image files to `<dataDir>/files/` *before* the DB write. In a streaming model this would mean: child writes the file, child sends writes batch, parent's transaction fails, file is now an orphan with no DB row referencing it.

The fix is the **deferred-file-write pattern**: the child stages files in `<dataDir>/files/.staging/<jobId>/` and includes a `{ method: '__finalizeFile', args: { stagingPath, finalPath } }` entry in the writes batch. The parent applies it inside the transaction body via `fs.renameSync` (atomic on the same volume). If the transaction throws, the parent cleans up `.staging/<jobId>/`. This narrows the orphan window to "child wrote file, then died before sending job-result" — the same as the pre-refactor worst case, not wider.

## Handler audit

| Handler | Read-your-writes? | Idempotent under retry? | External side effects | Expected RPC writes |
|---------|-------------------|-------------------------|-----------------------|---------------------|
| memory-extraction | No | Yes (memories upserted by content hash) | LLM extraction call (before-batch) | `memories.create`, `memories.upsert`, `chats.updateMessage` |
| carina-memory-extraction | No | Yes (gate dedupes by content; SELF-only from a one-slice synthetic transcript) | Cheap-LLM extraction call (before-batch) | `memories.create`, `memories.update`, `chats.updateMessage`, `createMemoryExtractionEvent` |
| inter-character-memory | No | Yes (legacy drain — no-op handler) | None | None |
| context-summary | No | Yes (deterministic summary) | LLM call (before-batch) | `chats.update`, `createContextSummaryEvent`, enqueue danger classification |
| memory-housekeeping | No | Yes (decisions made from upfront reads) | None | `memories.delete`, `memories.update` (bulk) |
| memory-regenerate-chat | No | Yes (idempotent re-run) | Memory deletion before-batch | `deleteMemoriesByChatIdWithVectors`, enqueue extraction |
| memory-regenerate-all | No | Yes (dedup snapshot prevents duplicates) | None | `enqueueMemoryRegenerateChat` |
| embedding-generate | No | Yes (hash-keyed) | LLM embedding call (before-batch) | `memories.updateForCharacter`, `embeddingStatus.markAsEmbedded`, `embeddingStatus.markAsFailed`, `vectorRepo.addEntry`, `vectorRepo.updateEntryEmbedding`, `vectorRepo.saveMeta` |
| embedding-refit | No | Yes (deterministic refit) | TF-IDF corpus fitting | `tfidfVocabularies.upsertByProfileId`, enqueue reindex-all |
| embedding-reindex | No | Yes (idempotent) | Help-doc sync | `backgroundJobs.cancelByType`, `embeddingStatus.markAllPendingByProfileId`, `backgroundJobs.createBatch`, `helpDocs.clearAllEmbeddings`, `vectorStoreManager.deleteStore` |
| embedding-reapply-profile | No | Yes (pure rewrite) | None | `reapplyEmbeddingProfile` (internal) |
| title-update | No | Yes (deterministic) | LLM call (before-batch) | `chats.update`, enqueue story-background |
| llm-log-cleanup | No | Yes (delete-by-date) | None | `llmLogs.cleanupOldLogs` |
| **story-background** | No | **Requires deferred-file-write** | LLM appearance + prompt + image generation; file upload (before-batch) | `folders.create`, `folders.findByPath`, `files.create`, `chats.update`, `projects.update`, `__finalizeFile` |
| chat-danger-classification | No | Yes (sticky classification) | LLM call (before-batch) | `createSystemEvent`, `chats.update`, enqueue concierge announcement |
| scene-state-tracking | No | Yes (deterministic derivation) | LLM call (before-batch) | `createSystemEvent`, `chats.update` |
| **character-avatar** | No | **Requires deferred-file-write** | Danger classification LLM, image generation, file upload (before-batch) | `folders.create`, `folders.findByPath`, `files.create`, `chats.update`, `characters.update`, `__finalizeFile` |
| character-headshoulders-backfill | No | Yes (idempotent overwrite; skips if already set) | Cheap-LLM `generateField` (before-batch) | `characters.update` (→ `linkDocumentContent` ×2 via `writeDatabaseDocument` — text docs only, no deferred file) |
| conversation-render | No | Yes (deterministic upsert) | None | `chats.update`, `conversationChunks.upsert`, enqueue embedding-generate |
| wardrobe-announcement | No | Yes (deterministic) | None | `postOutfitChangeWhisper` (notify) |
| **autonomous-room-turn** | No | **No — main-primary** (each turn is a distinct chat turn; retry would duplicate it). The sole `MAIN_PRIMARY_JOB_TYPES` member; commits main first/authoritatively, secondaries best-effort. | LLM turn via the ordinary Salon path (`handleSendMessage`, `continueMode`); enqueues memory extraction; stale-run guard (`payload.runId !== chat.currentRunId` → clean exit) | assistant message + run-state writes (`chats.update*`), context-summary side-effects, self-re-enqueue of the next `AUTONOMOUS_ROOM_TURN`; `doc_*` tool writes (mount-index partition) when a character uses document tools mid-turn |
| autonomous-run-start | No | Yes (run-start contract is single-sourced; rolls the row back on enqueue failure) | Posts the "run begun" banner | Flips `currentRunId`/run-state to `running` and enqueues the first turn. **Scheduled path routes the whole run-start through host-RPC** (`startScheduledAutonomousRun`) so `currentRunId` commits on the parent's RW connection *before* the turn job is claimable — otherwise the turn handler's stale-run guard reads the previous run id and self-aborts, wedging the room. Manual/API path runs synchronously on the parent and is race-free by construction. |
| autonomous-room-schedule-tick | No | Yes (advances `scheduleNextRunAt`; freshness-window + 60s wedge-grace self-heal) | None | For each due room: `startScheduledAutonomousRun` (via the bridge above) + `chats.update` to advance the cron anchor; skips stale slots |
| autonomous-room-announce | No | Yes (deterministic banners; shared run-start patch helper) | None | `runStartPatch` spread into callers' `chats.update`; lifecycle system-event writes (start/end/paused/halfway/nearing-end/grace) |
| regenerate-conversation-summaries | No | Yes (bridge replaces each conversation's prior file by frontmatter UUID; best-effort per chat) | None | `writeConversationSummaryToVaults` per summarized chat — short-circuits to the parent via host-RPC inside the forked child (like the other vault bridges) |

## Method-name overrides

Most methods match the standard read prefix (`find*`, `get*`, `list*`, `count*`, `search*`, `has*`, `exists*`) or write prefix (`create*`, `update*`, `delete*`, `upsert*`, `bulk*`, `set*`). The audit identified these non-conforming names that need explicit overrides in the proxy:

**Read overrides**: `getMessages`, `getEquippedOutfitForCharacter`, `findByPath`, `findByInterchangeIndex`, `findByUserId` (background jobs), `findDistinctChatIds`.

**Write overrides**: `markAsEmbedded`, `markAsFailed`, `markAllPendingByProfileId`, `cleanupOldLogs`, `upsertByProfileId`, `createBatch` (background jobs), `clearAllEmbeddings`, `cancelByType`, `updateMessage` (chats), `updateForCharacter` (memories), `addEntry`, `updateEntryEmbedding`, `saveMeta`, `deleteStore`, `deleteMemoriesByChatIdWithVectors`, `linkDocumentContent` / `linkBlobContent` (doc-mount file links — the database-store content writers reached by `doc_write_file` / `doc_copy_file` during an autonomous turn; their in-child callers discard the return, so the buffered write applies cleanly on the parent).

**Child-unsupported (tailored throw, NOT a buffered write)**: `linkFilesystemFile` (doc-mount file links). It find-or-creates a file + link row and returns ids that its in-child callers (`scanner.processMountFile`, `reindexSingleFile`'s filesystem branch — reached only via `doc_copy`/`doc_move` to a *filesystem* mount and the fire-and-forget post-edit reindex) immediately consume to insert chunk rows. A buffered write can't supply the parent-generated link id, so the chunks would dangle and the link's `chunkCount` would lie. It is listed in `CHILD_UNSUPPORTED_METHODS` so the proxy throws a tailored message instead of inviting a naive `'write'` override; the throw is always caught by those best-effort callers (file written, left unindexed). Making the filesystem-mount reindex work in the child would require host-RPC (run the link + chunk inserts on the parent so the real id is returned), the same pattern `FileStorageManager.uploadFile` already uses — this remains a follow-up.

The analogous image-bridge writers `writeCharacterAvatarToVault` / `writeLanternBackgroundToMountStore` consumed `linkBlobContent`'s `blobId`/`linkId` on their project-less vault paths and had the same root cause. **These are now fixed via host-RPC** (4.7-dev): each bridge short-circuits to `callHost('writeCharacterAvatarToVault' | 'writeLanternBackgroundToMountStore', input)` when `QUILLTAP_JOB_CHILD === '1'`, so the whole write (including the sha-deduped blob/link inserts and the server-computed `storageKey`) runs on the parent's RW connection and the real ids come back synchronously. Because the short-circuit lives **inside the bridge** rather than at the call sites, every in-child caller is covered — not just the `character-avatar`/`story-background` handlers but also the `generate_image` tool handler when a character invokes it during an autonomous turn. Parent-side callers (startup seed, HTTP routes) skip the short-circuit because `QUILLTAP_JOB_CHILD` is unset there, so there is no re-dispatch loop. See `host/host-rpc-dispatcher.ts`.

**Service-level methods** (called directly on child, not routed through the repository proxy): `reapplyEmbeddingProfile`, `enqueue*`, `post*Notification`, `post*Whisper`, `createSystemEvent`, `createContextSummaryEvent`, `createMemoryExtractionEvent`. Enqueue helpers append a `backgroundJobs.create` write to the batch; system-event helpers append the corresponding events table write.

**Built-in RPC methods** (provided by the parent applier, not by any repository): `__finalizeFile` (deferred-file-write rename + cleanup-on-rollback).

## Crash and restart policy

On non-zero child exit, the parent logs the failure, backs off 5 seconds, and respawns. The cap is 5 restarts in 60 seconds; past that, the parent leaves the child dead and surfaces the failure via `getProcessorStatus().childCrashed = true`. Operators see this in `/api/v1/system/jobs`. PROCESSING jobs left behind by a dying child are returned to PENDING by `resetOrphanedJobs` on the next claim cycle.

## Dev hot-reload

The Next.js dev server reloads the module graph; if the host module re-evaluates, it could try to spawn a second child. The host caches its `ChildProcess` reference on `globalThis` (the same trick used by the dev-only repository singleton) so a single child survives module reloads.

## Cache invalidation flow

Both parent and child build their own per-character vector stores and mount-chunk caches lazily. After the parent applies an embedding write that affects character X, it calls `unloadStore(X)` locally and posts `{ type: 'invalidate', target: 'vectorStore', key: characterId }` to the child. The child's RPC handler unloads its copy. Stale reads on the child are bounded to the IPC round-trip (~ms).

The same pattern applies to `mount-chunk-cache` after `doc-mount-chunks` writes.
