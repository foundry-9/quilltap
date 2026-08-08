# Bug 7 — embedding outcomes never land: the mark methods no-op without a row nobody creates

| | |
|---|---|
| **Status** | Fixed in v4 (2026-07-28) |
| **Found** | 2026-07-28 |
| **Fixed** | 2026-07-28 |
| **Severity** | High |
| **Who it bites** | every instance — no `EMBEDDED`/`FAILED` outcome has landed since the enqueue-time upserts were removed; on the measured instance, 76 active chats re-render and re-fail on every restart |
| **Fix size (as estimated)** | ~60 lines |
| **Fix site** | `lib/database/repositories/embedding-status.repository.ts` — `markAsEmbedded`/`markAsFailed` upsert (required `userId`); `lib/background-jobs/handlers/embedding-generate.ts` — `job.userId` threaded at all 13 call sites; `lib/startup/reconcile-conversation-rendering.ts` — condition (B) excludes chunks FAILED for the current default profile |
| **v5 status** | Inherit the fixed semantics — the status store's mark chokepoint must upsert, and the reconcile carries the per-profile FAILED exclusion from day one; see the entry's note |
| **Index** | [bugs.md](../../bugs.md) |

---

**Severity: High.** Every `EMBEDDED` and `FAILED` outcome reported by the
embedding pipeline has been silently dropped since the enqueue-time status
upserts were removed, and the boot reconcile re-attempts the same
permanently-unembeddable chunks forever because the `FAILED` marks it would
gate on never exist. Added and fixed 2026-07-28.

### Symptom

The first post-Bug-6 boot of the live Friday instance (2026-07-28T10:59Z)
logged 156 `Permanent embedding error — marked failed, skipping retry` lines
from the `EMBEDDING_GENERATE` handler after OpenAI rejected >8,192-token
conversation chunks — yet `embedding_status` held **zero** FAILED rows, for
any entity type. `EMBEDDED` for `CONVERSATION_CHUNK` sat frozen at 3,586
across ~67k completed jobs. The chunk embedding BLOB writes from the very same
handler, buffered in the very same child write batch, landed normally.

The initial suspicion was the job child's write-buffering pipeline dropping or
misclassifying the `embeddingStatus.*` writes — the `docMountFileLinks`
family had failed that way before. That was wrong: the proxy classifies both
methods as writes, the parent replays them, and the partition commits.

### Root cause

`markAsEmbedded` and `markAsFailed`
(`lib/database/repositories/embedding-status.repository.ts`) were
find-then-update: look up the row for `(entityType, entityId, profileId)`,
and **return `null` when it is missing** — no write, no log, no error.

Three removals over time made "missing" the universal case:

1. `scheduleEmbedding` — which upserted a PENDING row before enqueueing —
   was deleted as dead code (2026-05-27, correctly: it had no callers).
2. The reindex handler's per-entity `upsertByEntity` loop became a
   batch-insert of bare jobs (4.3.0); it now only flips *existing* rows
   via `markAllPendingByProfileId`.
3. The live chunker (`conversation-render.ts`) enqueues `EMBEDDING_GENERATE`
   with no status row at all.

On the Friday copy the kill shot is visible in one query: **every one of the
18,811 surviving `embedding_status` rows references a profileId that no longer
exists.** The current default profile has zero rows, so every single mark call
— embedded or failed, chunk or memory or help doc — resolved to
`findByEntity → null → return null`. 7,771 of 11,357 chunks have no status row
under any profile.

Consequence downstream: Bug 6's fix left condition (B) of the reconcile
guarded only by `LENGTH(content) BETWEEN 1 AND 131072`. A chunk can sit under
that 128 KiB transport cap and still exceed the model's token context
(>8,192 tokens ≈ ~31k chars for `text-embedding-3-large`); 554 such chunks
exist on Friday, 76 active chats carry them, and each boot re-rendered those
chats and re-attempted the embeds, failing identically every time — with no
FAILED row ever landing to break the cycle.

### Why it survived

The methods' contract *looks* like an upsert ("mark entity as failed") but
isn't, and the null return is indistinguishable from success at every call
site — the handler awaits it and moves on. The job COMPLETES (permanent
errors are deliberately swallowed so they don't retry to DEAD), so the job
table shows green. Bug 6's own diagnosis was partially misled by this bug: it
ruled the oversize-cap hypothesis dead partly on "zero FAILED
`embedding_status` rows for chunks" — evidence this bug manufactures. And the
child-write-pipeline priors (the `docMountFileLinks` misclassification, the
Float32Array IPC mangling) made the buffering layer the obvious suspect, when
it was innocent: the write replayed perfectly and then no-oped inside the
repository.

### The fix

- `markAsEmbedded` / `markAsFailed` now **upsert**: update the existing row
  when there is one, create it otherwise. Both take a required `userId` (the
  schema requires one to mint a row); the `EMBEDDING_GENERATE` handler
  (`lib/background-jobs/handlers/embedding-generate.ts`) passes `job.userId`
  at all 13 call sites. No IPC or classification change — the buffered write
  carries the same method name with one more argument.
- With FAILED rows landing, `SELECT_INCOMPLETE_CHATS` in
  `lib/startup/reconcile-conversation-rendering.ts` condition (B) gains a
  `NOT EXISTS` over `embedding_status` rows with `status = 'FAILED'` for the
  profile a re-embed would actually use (default, else first — the same
  selection the render handler makes; covered by
  `idx_embedding_status_entityType_entityId`). No resolvable profile → a
  sentinel is bound that matches nothing and behavior is unchanged.
- The stale rows pointing at deleted profiles are left in place: they match
  no current-profile lookup, so they are inert, and the new upsert mints
  correct rows beside them as jobs complete.

### Verification

- Unit: `__tests__/unit/lib/database/repositories/embedding-status-mark-upsert.test.ts`
  — create-when-missing for both methods, update-when-present, and the
  different-profile-row case that masked the live failure. Three new cases in
  `__tests__/unit/lib/startup/reconcile-conversation-rendering.test.ts` — the
  FAILED exclusion is present in the scan SQL, the no-profile sentinel bind,
  and exclusion-disabled when profile resolution throws.
- Against the Friday copy (read-only SQL): the new scan runs on the real
  schema (671 incomplete pre-gate, matching Bug 6's number), and simulating
  landed FAILED rows for the >31k-char chunks drops the incomplete set to
  596 — the 75 chats whose only "recoverable" chunks are permanently
  unembeddable stop re-rendering; the token-cap tail then belongs entirely to
  the sub-chunking follow-up.
- On a live instance: after one boot's embed attempts,
  `SELECT status, COUNT(*) FROM embedding_status WHERE entityType =
  'CONVERSATION_CHUNK' GROUP BY 1` shows FAILED rows for the oversize cohort
  and a moving EMBEDDED count; the boot after that, those chats leave the
  reconcile's incomplete set.

### Note for the v5 side

This is oracle-moving `lib/` behaviour: `embedding_status` goes from
write-only-in-theory to actually tracking outcomes, and the reconcile's
incomplete-chat set shrinks by the permanently-FAILED cohort. The files
changed are `lib/database/repositories/embedding-status.repository.ts`,
`lib/background-jobs/handlers/embedding-generate.ts`, and
`lib/startup/reconcile-conversation-rendering.ts`. A ported status store must
be an upsert at the mark chokepoint (not a create-at-enqueue plus
update-at-completion pair — that shape is exactly what drifted apart here),
and a ported reconcile must carry the per-profile FAILED exclusion from day
one. The true fix for the oversize chunks themselves remains renderer-side
sub-chunking (tracked separately).
