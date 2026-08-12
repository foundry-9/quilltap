---
title: Quilltap DB Size Reduction — Implementation Spec
audience: Claude Code (quilltap-server)
status: ready to implement
target: main DB (quilltap.db); primary instance "Friday" (~837 MB)
---

# Quilltap DB Size Reduction — Implementation Spec

## 0. Purpose & scope

`quilltap.db` on the Friday instance is ~837 MB. A dbstat breakdown attributes it
roughly to: `chat_messages` 349 MB, `conversation_chunks` 134 MB, `memories`
103 MB, `chats` 103 MB, `vector_entries` 98 MB, plus small tables.

This spec implements three changes, safest first, that shrink the file **without
losing anything needed to re-read a conversation or to re-run memory
extraction**. The only permanently-discarded data (on chats idle past the
retention window) is: model **thinking traces** (`reasoningContent` /
`reasoningSegments`), the byte-exact raw provider payload (`rawResponse`), and
memory-gate debug telemetry (`debugMemoryLogs`). Message `content` — the text you
read and the text the extractor consumes — is never touched.

Three steps:

1. **Stale-chat cache collapse** — extend the existing daily maintenance sweep to
   NULL regenerable/discardable DB columns on chats that have gone quiet. Adds a
   global, user-configurable retention window (default 30 days). No schema
   migration.
2. **Cold-tier conversation-chunk embeddings** — NULL the embedding on
   `conversation_chunks` for stale chats, keeping chunk `content` for keyword
   search, and re-embed on demand when the chat is reopened. No schema migration.
3. **int8 embedding quantization** — change the embedding BLOB storage codec from
   raw Float32 to a self-describing quantized format (~4× smaller), with a
   one-time batched migration to re-pack existing embeddings. This is the only
   step with a schema/data migration.

Each step ends with a `VACUUM` to actually shrink the file (deletes/NULLs only
free pages *inside* the file until compaction).

**Owner note on ordering:** Steps 1 and 2 are independent and low-risk. Step 3 is
the largest single win but is a one-way data migration — schedule it last, behind
a physical backup. Suggested PR breakdown is in §7.

---

## 1. Grounding facts (verified against the codebase — do not re-derive)

Everything below was confirmed by reading the source; use these as your anchors.

### Storage & DDL
- Three SQLite DBs, all SQLCipher-encrypted (the `sqlite3` CLI can't open them —
  use `npx quilltap …`). Schema reference: `docs/developer/DDL.md` (keep it
  current — see `CLAUDE.md`).
- `chats` columns relevant here (all nullable): `compressionCache TEXT`,
  `renderedMarkdown TEXT`, `state TEXT DEFAULT '{}'`.
- `chat_messages` columns relevant here (all nullable): `content` (**authoritative
  display text — NEVER touch**), `rawResponse`, `reasoningContent`,
  `reasoningSegments`, `renderedHtml`, `debugMemoryLogs`, `thoughtSignature`
  (**leave — provider continuation token, tiny**), `opaqueContent` (**leave — real
  semantic body used in context build, not a cache**).
- `conversation_chunks`: `content TEXT` (rendered markdown of one interchange,
  regenerable), `embedding BLOB` (Float32), UNIQUE(chatId, interchangeIndex),
  `FOREIGN KEY(chatId) → chats(id) ON DELETE CASCADE`.
- `memories.embedding BLOB` (Float32), `vector_entries` = `{id, characterId,
  embedding BLOB, createdAt}` — **keyed by characterId, NOT by chat**; it is the
  memory-gate near-duplicate index and duplicates `memories.embedding` by design.
  (This is why `vector_entries` is handled in Step 3, not Step 2.)

### The maintenance sweep (Step 1's host)
- `lib/background-jobs/scheduled-maintenance.ts` → `runScheduledMaintenance()`: a
  daily **parent-process** tick (writes need the parent; the forked job child is
  read-only). Already: reaps finished jobs, collapses stale-chat generated image
  assets, sweeps orphaned mount files, reaps closed terminals, stamps
  `setLastMaintenanceSweepAt()`.
- `lib/background-jobs/maintenance/collapse-stale-chat-assets.ts` exports
  `isStale(chat, cutoffMs, repos)` — **reuse this**. It uses
  `repos.chats.getLastPlayedMessageAt(chatId)` (last message authored by a real
  character or the user; deliberately ignores personified-feature whispers —
  Lantern/Host/Carina/etc.), falling back to `chat.updatedAt`, and treats
  null/NaN as "never stale". This is exactly the "last actually changed by a new
  message" definition we want.
- `lib/background-jobs/maintenance/retention-constants.ts`:
  `STALE_CHAT_RETENTION_DAYS = 30`, `retentionCutoff(days, now)`, `DAY_MS`. Its
  header comment notes that making the window *configurable* was deferred; this
  spec does that via `instance_settings` (§2), which needs **no** schema
  migration.

### Compression cache (Step 1 target)
- `lib/services/chat-message/compression-cache.service.ts` — documented as a cache
  that "survives server restarts" with a synchronous-recompute fallback. Fully
  regenerable. Persisted as a per-participant JSON object in
  `chats.compressionCache`. It exposes DB persist/clear helpers and an in-memory
  `Map`; the sweep should clear via the service's DB-clear path if one is
  exported, else NULL the column directly (see §2 task list).

### Embedding codec (Step 3 chokepoint)
- Single source of truth: `lib/embedding/float32-conversion.ts` —
  `float32ToBlob`/`embeddingToBlob` (write) and `blobToFloat32`/`blobToEmbedding`
  (read, returns a fresh `Float32Array`), plus `parseLegacyEmbeddingText`.
- Write path: `lib/database/backends/sqlite/json-columns.ts` `documentToRow()`
  calls `embeddingToBlob` for registered blob columns.
- Read path: `lib/database/backends/sqlite/backend.ts` lines ~380 and ~425 call
  `blobToEmbedding(value)` when hydrating a registered blob column.
- Blob columns registered in `lib/database/manager.ts` (~lines 118–120):
  `memories`, `vector_entries`, `conversation_chunks`, all on `['embedding']`.
- All search/scoring code consumes the **hydrated** `Float32Array`/`number[]`
  (e.g. `lib/memory/memory-service.ts`, `conversation-summary-search.ts`,
  `memory-weighting.ts`, `lib/chat/context/*-injector.ts`,
  `lib/tools/search-scriptorium-*`). So if the codec dequantizes on read,
  **quantization is transparent to every consumer** — no search code changes.
- Precedent migrations that iterate all embeddings:
  `migrations/scripts/normalize-vector-storage.ts` and
  `normalize-embeddings-unit-vectors.ts`. Embeddings are **unit-normalized**
  (relevant to quantization scale choice).

### Re-embedding infrastructure (Step 2)
- `lib/background-jobs/handlers/embedding-generate.ts` (per-item embedding) and
  `embedding-reindex.ts` (`EMBEDDING_REINDEX_ALL`, system-wide, `scope`
  parameter). `enqueueEmbeddingReindexAll(userId, {profileId, scope})` in
  `lib/background-jobs/queue-service.ts`. Job type in `lib/schemas/job.types.ts`.
  Conversation-chunk repo: `deleteAllForChat`, `findByChatId`,
  `findAllWithEmbeddings`, `updateEmbedding`, `countByChatIds`, `upsert`.

### Settings stores
- **Two** homes for settings:
  - `chat_settings` table — **column-per-field**, so a new field needs a
    migration (e.g. `answerConfirmationSettings` JSON column added by
    `add-answer-confirmation-columns`). Repo:
    `lib/database/repositories/chat-settings.repository.ts`; API:
    `app/api/v1/settings/chat/route.ts`.
  - `instance_settings` — a **key-value** store (single-user model), **no
    migration** to add a key. Precedent: `memoryRecall`, `memoryExtractionLimits`
    via `getMemoryRecallSettings`/`setMemoryRecallSettings` in
    `lib/instance-settings`. **Use this for the retention window.**

### Conventions (from CLAUDE.md)
- User-visible changes MUST be documented in `help/*.md` (with `url` frontmatter
  and a matching `help_navigate(...)` "In-Chat Navigation" section). UI copy is in
  the house voice (steampunk + Roaring-20s + Wodehouse/Lemony-Snicket).
- Migrations live in `migrations/scripts/`, registered in
  `migrations/scripts/index.ts`, each with `id`, `description`,
  `introducedInVersion`, `dependsOn`, `shouldRun()`, `run()`. Two hard rules
  enforced by the commit skill: (1) a `PRETTY_LABELS` entry in
  `lib/startup/prettify.ts` (house voice, present-continuous, about the user's
  data); (2) any loop over a collection calls `reportProgress(...)` from
  `migrations/lib/progress.ts`. Update `docs/developer/DDL.md` for any schema
  change.
- CLI: `npx quilltap db optimize [target]` = VACUUM + ANALYZE + PRAGMA optimize;
  refuses while the server holds the lock (so: stop server first).

---

## 2. Step 1 — Stale-chat cache collapse + retention setting

**Goal:** on chats that have been quiet ≥ `staleChatDays` (default 30), NULL the
regenerable/discardable DB columns. Reclaims most of the `chats` bloat
(`compressionCache`, `renderedMarkdown`) and a real fraction of `chat_messages`
(`rawResponse`, `reasoningContent`, `reasoningSegments`, `renderedHtml`,
`debugMemoryLogs`). No schema migration (columns already exist and are nullable).

### 2.1 Retention setting (global, configurable, no migration)

- Add to `lib/schemas/settings.types.ts` a schema:
  ```ts
  export const DataRetentionSettingsSchema = z.object({
    /** A chat is "stale" after this many days with no played message.
        Governs the maintenance sweep (image collapse + cache collapse +
        cold-tier). */
    staleChatDays: z.number().int().min(1).max(3650).default(30),
  });
  export type DataRetentionSettings = z.infer<typeof DataRetentionSettingsSchema>;
  ```
- Add `getDataRetentionSettings()` / `setDataRetentionSettings()` to
  `lib/instance-settings` under key `'dataRetention'`, mirroring the existing
  `memoryRecall` accessors (parse-with-schema, default when absent).
- Expose it in the API surface the settings UI already uses for instance-level
  settings (follow the `memoryRecall` / `memoryExtractionLimits` route pattern;
  do NOT add it to the `chat_settings` column table).
- **UI:** add a small card to the Chat settings tab (`/settings?tab=chat`) — a
  single number input "Keep inactive chats' working data for N days" with helper
  copy in the house voice explaining that after this window Quilltap tidies away
  regenerable caches and model scratch-work from conversations you haven't touched
  (the conversation itself is untouched). Global only; no per-chat control.

### 2.2 Unify the existing sweep on the setting

- In `retention-constants.ts`, keep `STALE_CHAT_RETENTION_DAYS = 30` as the
  fallback default. Add a resolver the sweep calls, e.g.
  `resolveStaleChatDays(): Promise<number>` that returns
  `getDataRetentionSettings().staleChatDays ?? STALE_CHAT_RETENTION_DAYS`.
- `collapseStaleChatAssets()` and the new column-collapse (below) BOTH compute
  their cutoff from this resolved value, so the image collapse and the cache
  collapse always agree on "stale."

### 2.3 New module: `collapse-stale-chat-caches.ts`

Create `lib/background-jobs/maintenance/collapse-stale-chat-caches.ts`, modeled
on `collapse-stale-chat-assets.ts` (same `isStale` gate, same per-chat try/catch,
same summary shape). For each stale chat:

1. **`chats` columns:** if `compressionCache` is non-null, clear it via the
   compression-cache service's DB-clear helper if one is exported (preferred, so
   the in-memory `Map` stays consistent), else `UPDATE chats SET
   compressionCache=NULL`. Also NULL `renderedMarkdown` when non-null.
   - Do NOT touch `state` (may hold non-regenerable live fields); out of scope.
2. **`chat_messages` columns:** for messages belonging to the stale chat, NULL
   `rawResponse`, `reasoningContent`, `reasoningSegments`, `renderedHtml`,
   `debugMemoryLogs`. Use a single guarded UPDATE per chat:
   ```sql
   UPDATE chat_messages
      SET rawResponse=NULL, reasoningContent=NULL, reasoningSegments=NULL,
          renderedHtml=NULL, debugMemoryLogs=NULL
    WHERE chatId=?
      AND (rawResponse IS NOT NULL OR reasoningContent IS NOT NULL
        OR reasoningSegments IS NOT NULL OR renderedHtml IS NOT NULL
        OR debugMemoryLogs IS NOT NULL);
   ```
   The `AND (… IS NOT NULL)` guard makes the sweep idempotent and cheap on
   already-collapsed chats (no-op rows aren't rewritten).
3. Accumulate a summary (`chatsScanned`, `staleChats`, `chatsCollapsed`,
   `rowsCleared`, `bytesEstimate` optional) and log it, matching the asset-collapse
   logger style.

**Do NOT touch:** `content`, `thoughtSignature`, `opaqueContent`, `attachments`,
`contextSummary`, memories, `summaryAnchor`.

### 2.4 Wire into the sweep

In `runScheduledMaintenance()` (scheduled-maintenance.ts), add a numbered step
(after the image collapse) that calls `collapseStaleChatCaches()`, wrapped in the
same "log and continue" try/catch the other steps use, and fold its summary into
`MaintenanceSweepSummary`.

### 2.5 Safety note to honor

`rawResponse`/`thoughtSignature` are read by the **generation-time** services
(provider-failover, message-finalizer, regenerate-swipe) — never by the historical
read/render path, and we are not nulling `thoughtSignature`. Confirmed safe for
≥30-day-cold messages. Keep it that way: the sweep must only ever run on
`isStale` chats.

### 2.6 Tests

- Unit: a chat with `lastPlayedMessageAt` older than cutoff gets its columns
  nulled; a chat kept alive only by a feature-whisper (so `getLastPlayedMessageAt`
  is old but `lastMessageAt` is recent) IS collapsed (mirrors the existing
  `collapse-stale-chat-assets.test.ts` intent); an active chat is untouched;
  second run is a no-op (idempotent).
- Setting round-trips through `get/setDataRetentionSettings`; sweep honors a
  changed window.

---

## 3. Step 2 — Cold-tier conversation-chunk embeddings (re-index on demand)

**Goal:** reclaim the bulk of `conversation_chunks` (134 MB, mostly embedding
BLOBs) for stale chats while keeping the chat fully readable and keyword-
searchable, and re-embed transparently when the chat is reopened. No schema
migration.

### 3.1 What to drop

For each `isStale` chat, **NULL the `embedding`** on its `conversation_chunks`
rows (keep `content`, `messageIds`, `interchangeIndex`). Nulling (vs deleting the
row) means: (a) chunk `content` stays for keyword/FTS and for cheap re-embed
(embed-only, no re-chunk), and (b) the empty-embedding path already exists — the
codec stores an empty embedding as SQL NULL, and `conversation_chunks.repository`
already distinguishes chunks with vs without embeddings
(`findAllWithEmbeddings`, the `embedded` count in `countByChatIds`).

Add a repo method `clearEmbeddingsForChat(chatId): Promise<number>`:
```sql
UPDATE conversation_chunks SET embedding=NULL, updatedAt=?
 WHERE chatId=? AND embedding IS NOT NULL;
```
Call it from the Step-1 cache-collapse module (same stale set, same sweep pass) —
or as its own numbered sweep step; either is fine, keep it gated on `isStale`.

> Note: this composes with Step 3. After Step 3, resident chunk embeddings are
> int8 (¼ the bytes); cold-tiering then removes even those for the truly cold set.

### 3.2 Re-index on demand

A cold chat must transparently regain semantic search when reopened. Implement
both a lazy trigger and a manual one:

- **Lazy (on open):** where a chat is loaded for viewing (the Salon chat load /
  the conversation read path), after load, fire-and-forget a check: if the chat
  has chunks with `content` but `embedding IS NULL`
  (`countByChatIds` → `embedded < total`), enqueue re-embedding for that chat.
  Debounce so repeated opens don't stack jobs (e.g., skip if a reindex job for the
  chat is already pending — the queue can be queried by type+chatId, or store a
  short-lived in-memory guard).
- **Re-embed job:** reuse `embedding-generate.ts`. Prefer adding a per-chat scope/
  entry point (`enqueueChunkReembedForChat(userId, chatId)`) that loads the chat's
  null-embedding chunks and embeds each via the same embedder the normal chunk
  indexer uses (so profile/dim stay consistent). Model it on the existing
  per-item generate handler; do NOT reuse the system-wide `EMBEDDING_REINDEX_ALL`
  (too broad).
- **Manual:** a "Re-index this conversation" action (chat overflow menu) and/or a
  CLI subcommand, both calling the same enqueue. Optional but recommended for
  operator control.

### 3.3 Search-behavior contract (document this in help)

While a chat is cold: it remains fully readable, and **keyword** search over its
messages works normally. **Semantic** retrieval (Scriptorium /
conversation-summary search) will not surface that chat until it re-indexes
(automatic on next open, or via the manual action). State this plainly in the help
doc so the behavior isn't surprising.

### 3.4 Tests

- `clearEmbeddingsForChat` nulls only non-null embeddings, keeps `content`, is
  idempotent.
- Reopen of a cold chat enqueues exactly one re-embed job (debounce holds under
  double-open); after the job, `findAllWithEmbeddings` returns the chat's chunks.
- Stale gating: active chats never cold-tiered.

---

## 4. Step 3 — int8 embedding quantization (codec + migration)

**Goal:** shrink all resident embeddings ~4× by storing them int8 instead of
Float32, across `memories`, `conversation_chunks`, `vector_entries`. This is a
one-time data migration plus a codec change confined to
`lib/embedding/float32-conversion.ts` and the two backend read call sites; all
search code is unaffected because it consumes hydrated arrays.

### 4.1 Self-describing blob format

Define a versioned, self-describing layout so legacy Float32 blobs, int8 blobs
(and optionally float16) can coexist and be read unambiguously — required for a
safe transition and for any partially-migrated state.

```
Byte layout (little-endian):
  [0]      magic   = 0xEB
  [1]      version = 0x01
  [2]      dtype   : 0x01 = int8-symmetric, 0x02 = float16
  [3..6]   dim     : uint32
  dtype==int8: [7..10] scale : float32   (dequant: f = int8 * scale)
               [11..11+dim)   int8 body
  dtype==f16 : [7..7+2*dim)   float16 body (no scale)
```

- **Legacy detection (read):** a blob is new-format iff `len >= 7 && buf[0]===0xEB
  && buf[1]===0x01` AND the declared `dim` is self-consistent with `len`
  (int8: `len === 11 + dim`; f16: `len === 7 + 2*dim`). Otherwise treat as legacy
  raw Float32 (`len % 4 === 0`, `dim = len/4`) via the current `blobToFloat32`.
  The combined magic + self-consistent-length check makes a false positive on a
  real Float32 buffer astronomically unlikely; after the migration there are zero
  legacy blobs anyway.
- **Recommended dtype: `int8-symmetric`** (the ~4× win Charlie signed off on).
  Because embeddings are unit-normalized, per-vector symmetric quantization is
  well-conditioned: `scale = max(|v_i|)/127` (guard `scale=1` when all-zero);
  `q_i = clamp(round(v_i/scale), -127, 127)`. Dequant `v_i ≈ q_i*scale`.
- **Documented fallback: `float16`** (dtype 0x02): 2× smaller, effectively
  lossless. Node 24 (this environment) has native `Float16Array`, so the codec is
  trivial. If the recall check in §4.4 shows int8 regression you consider
  material, switch the default dtype to float16 by changing one constant — the
  format and migration already support it.

### 4.2 Codec changes (`lib/embedding/float32-conversion.ts`)

- Add `quantizedToFloat32(blob): Float32Array` (dispatch on header; handles int8
  and f16) and `float32ToQuantized(embedding, dtype=INT8): Buffer`.
- Introduce a module constant `EMBEDDING_STORAGE_DTYPE` (default `int8`).
- **Read alias:** make `blobToFloat32` / `blobToEmbedding` header-aware — try
  new-format decode, fall back to the existing raw-Float32 interpretation. This
  single change makes both backend read sites (`backend.ts` ~380/~425)
  transparently handle old and new blobs with no edit there (but add a test that
  exercises both).
- **Write alias:** point `embeddingToBlob` / `float32ToBlob` (used by
  `documentToRow`) at `float32ToQuantized(…, EMBEDDING_STORAGE_DTYPE)` so all new
  writes are quantized. Keep the old raw encoder available as
  `float32ToBlobRaw` for the round-trip tests and any explicit float32 needs.
- Keep `parseLegacyEmbeddingText` untouched (JSON-text legacy path).

### 4.3 Migration: `quantize-embeddings-v1`

`migrations/scripts/quantize-embeddings.ts`, registered in `index.ts`,
`dependsOn: ['sqlite-initial-schema-v1', 'normalize-vector-storage-v1' (or the
current embedding-storage migration id)]`, `introducedInVersion: <next>`.

- **`shouldRun()`:** true on SQLite when any target table has a row whose
  `embedding` blob is still legacy Float32. Cheapest reliable check: sample — read
  a bounded number of non-null embeddings per table and return true if any is not
  new-format. (Migration state via `recordCompletedMigration` prevents re-runs;
  the sample check guards re-entry if interrupted.)
- **`run()`:** for each of `memories`, `conversation_chunks` (non-null embeddings
  only), `vector_entries`: stream rows in batches (`SELECT COUNT(*)` upfront for
  progress), decode each blob via the header-aware reader, re-encode with
  `float32ToQuantized`, `UPDATE … SET embedding=? WHERE id=?`. Skip rows already
  new-format (idempotent). Call `reportProgress(...)` every iteration (throttled)
  with a running `totalScanned` across all three tables. Model the batched loop on
  `normalize-vector-storage.ts`.
- **`PRETTY_LABELS` entry** in `lib/startup/prettify.ts`, house voice, present-
  continuous, about the user's data — e.g. *"Compacting the memory-vaults so they
  take up less room on the shelf…"* (adjust to match sibling labels' tone).
- Update `docs/developer/DDL.md`: note the `embedding` BLOB columns now hold the
  self-describing quantized format (document the layout, reference this codec).

### 4.4 Quality / recall validation (required before merge)

- Codec unit tests: round-trip a batch of real-scale unit vectors; assert
  per-element error ≤ `scale`, and mean cosine similarity between original and
  dequantized ≥ 0.999 (int8) / ≥ 0.9999 (f16).
- Retrieval check: on a copy of a real DB (or a representative fixture), run a set
  of queries against memories + chunks before and after quantization; assert
  top-k overlap stays within an agreed tolerance (e.g. top-10 overlap ≥ 0.95).
  Log the measured deltas in the PR description.

### 4.5 `vector_entries` — quantize now, eliminate later (optional)

`vector_entries` (98 MB) duplicates `memories.embedding` by design (memory-gate
near-dup index). Quantization alone takes it to ~25 MB and is included above. A
**follow-up** could eliminate it entirely by having the memory-gate read
`memories.embedding` directly; that touches
`lib/database/repositories/vector-indices.repository.ts` and the memory-gate
scoring path and is out of scope for this spec. Note it as a tracked follow-up.

---

## 5. Compaction (every step)

After each step's sweep/migration has run and freed pages, reclaim file bytes:

```
# stop the server (the command refuses while the instance holds the lock)
npx quilltap db optimize Friday      # VACUUM + ANALYZE + PRAGMA optimize
```

The scheduled sweep NULLs/deletes continuously but does not VACUUM (VACUUM needs
an exclusive lock and rewrites the file). Document `db optimize` as the periodic
manual reclamation step; do not attempt to VACUUM from inside the running server.

---

## 6. Cross-cutting requirements

- **Help docs:** add/adjust `help/*.md` for (a) the new retention setting and its
  effect, and (b) the cold-search behavior contract (§3.3). Include `url`
  frontmatter with `?tab=chat` deep-link and a matching `help_navigate(...)`
  "In-Chat Navigation" section (per CLAUDE.md).
- **Changelog:** user-facing entries for the retention setting and the storage
  compaction; keep implementation detail out of user copy.
- **House voice** for all user-visible strings (settings labels, help, migration
  loading-screen label).
- **DDL.md** updated for Step 3 (blob format note); Steps 1–2 change no schema.
- **Commit skill** will block a migration lacking `PRETTY_LABELS` or
  `reportProgress` — satisfy both in Step 3.
- **Backup before Step 3:** take a physical backup (see `backups/` and CLI.md)
  before running `quantize-embeddings-v1`. Step 3 is one-way — recovering exact
  Float32 requires re-embedding from source text.

## 7. Suggested PR sequence

1. **PR-1 (Step 1a):** `dataRetention` setting (schema + instance-settings
   accessors + API + chat-tab UI + help + changelog). No behavior change yet.
2. **PR-2 (Step 1b):** `collapse-stale-chat-caches` module + sweep wiring + tests.
   Ship, let a sweep run, then `db optimize` and measure.
3. **PR-3 (Step 2):** `clearEmbeddingsForChat` + cold-tier sweep step +
   re-embed-on-open (job + debounce) + manual re-index + help + tests.
4. **PR-4 (Step 3):** codec (self-describing quantized format, header-aware
   read, quantized write) + `quantize-embeddings-v1` migration + PRETTY_LABELS +
   DDL + recall validation. Backup, migrate, `db optimize`, measure.
5. **PR-5 (optional follow-up):** eliminate `vector_entries` duplication.

## 8. Expected outcome

- After PR-2 + PR-3 (+ `db optimize`): most of the `chats` cache bloat and a large
  share of `conversation_chunks` and the discardable `chat_messages` columns are
  gone on cold chats — plausibly ~837 MB → ~450–550 MB, every conversation still
  readable and re-extractable.
- After PR-4: resident embeddings ~4× smaller (~335 MB of vectors → ~85 MB),
  pushing the file well below that.

## 9. Non-goals / invariants

- Never modify `chat_messages.content`, `opaqueContent`, `attachments`,
  `contextSummary`, memories' text, or `thoughtSignature`.
- Never run cache-collapse or cold-tiering on a chat that is not `isStale`.
- Keep quantization confined to the codec + migration; no search/scoring changes.
- All new tunables are **global** (`instance_settings`), never per-chat.
