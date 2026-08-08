# Bug 6 — the reconcile and the cold-tier sweep fight, re-embedding the cold tier on every boot

| | |
|---|---|
| **Status** | Fixed in v4 (2026-07-28) |
| **Found** | 2026-07-28 |
| **Fixed** | 2026-07-28 |
| **Severity** | High |
| **Who it bites** | any long-lived instance with chats older than the stale window, on **every restart**; real money on a paid embedding profile |
| **Fix size (as estimated)** | ~25 lines |
| **Fix site** | `lib/startup/reconcile-conversation-rendering.ts` — stale chats skipped via the shared `isStale` gate; `isStale` param narrowed in `lib/background-jobs/maintenance/collapse-stale-chat-assets.ts`; follow-up: `clearEmbeddingsForChat` age guard in `lib/database/repositories/conversation-chunks.repository.ts` + `lib/background-jobs/maintenance/collapse-stale-chat-caches.ts` so reopen re-embeds survive the sweep |
| **v5 status** | Inherit the fixed semantics when the reconcile is ported — see the entry's note |
| **Index** | [bugs.md](../../bugs.md) |

---

**Severity: High.** Bites every long-lived instance on every restart, and the
bill scales with history: the whole cold tier is re-embedded through the
default profile (on Friday, OpenAI `text-embedding-3-large`) just for the next
maintenance sweep to throw the vectors away again. Added and fixed 2026-07-28.

### Symptom

On the Friday copy, `conversation_chunks` held 11,357 rows with 9,652 (85%)
`embedding IS NULL`, 9,609 of them "recoverable" by the reconcile's own
predicate, and 671 chats matched `SELECT_INCOMPLETE_CHATS` — on an instance
with a working key, a working default profile, and sibling entity types
(`doc_mount_chunks` 0 / 6,598 unembedded, `memories` 13 / 27,132) in perfect
health. No `EMBEDDING_GENERATE` job was PENDING or RUNNING; 67,727 had
COMPLETED.

The job history shows the loop directly: **8,762 chunks were embedded exactly
six times each** (a cohort of 363 sits at 32, the worst single chunk at 54),
and the last wave tells the whole story in one day — a re-embed backlog
finished at 2026-07-28 03:42 UTC, and by that morning the maintenance sweep
had stamped 9,623 chunks back to NULL.

### Root cause

Two subsystems each behave exactly as documented, and their documented
behaviours are mutually hostile:

1. **The stale-chat cache collapse**
   (`lib/background-jobs/maintenance/collapse-stale-chat-caches.ts`)
   cold-tiers every chat with no *played* message inside the retention window:
   it NULLs `chats.renderedMarkdown` and NULLs every
   `conversation_chunks.embedding` for the chat, deliberately, keeping
   `content` for keyword search. The designed recovery is on-demand: the Salon
   chat-open path (`lib/scriptorium/cold-chunk-reembed.ts`) re-embeds a cold
   chat when somebody actually visits it.

2. **The startup reconcile**
   (`lib/startup/reconcile-conversation-rendering.ts`) scans for exactly two
   signals of a half-finished pipeline: `renderedMarkdown IS NULL` with real
   messages, and chunks with `embedding IS NULL`. Both signals are precisely
   the state the sweep just manufactured on purpose. The reconcile cannot tell
   "cold-tiered" from "broken", so it enqueues a `CONVERSATION_RENDER` for
   every cold chat, each of which re-renders the Markdown and re-enqueues an
   `EMBEDDING_GENERATE` per unembedded chunk.

So the steady state is a pendulum: **boot → re-render and re-embed the entire
cold tier (paid) → daily sweep → NULL it all again → next boot.** Between
swings the instance sits at "85% unembedded with nothing queued", which is how
the dogfood pass caught it.

The DEAD-row population is historical, not part of this loop: 1,796 are June
2026 Ollama `llama-server binary not found` failures from before the profile
moved to OpenAI, plus startup orphan kills — the retry-storm class that
`isPermanentEmbeddingError` already ended. The oversize-cap hypothesis
(`EMBEDDING_MAX_CHARS` = 128 KiB chars vs the model's 8,191-token limit) is
also dead on the same evidence: zero token/context-length errors anywhere in
the job history, and zero FAILED `embedding_status` rows for chunks.

### Why it survived

Each half is locally correct and individually tested, and each one's
docstring promises the other's premise away: the sweep says cold chats are
"re-embedded on demand", the reconcile says it is "a no-op on a healthy
instance". Both were written believing NULL meant only one thing. The waste is
also silent — every job COMPLETES, nothing errors, the chat list looks fine,
and the money leaves through a metered API nobody watches per-boot. It took
measuring a real instance's NULL ratio, then noticing the per-chunk completed
job counts were *identical across thousands of chunks* (six each — six
boot/sweep cycles), to see the pendulum.

### The fix

The reconcile now consults the same staleness gate as the sweeps — `isStale`
(`lib/background-jobs/maintenance/collapse-stale-chat-assets.ts`) with the
cutoff from `resolveStaleChatDays()` — and **skips stale chats**: for them,
cold is the desired state, and healing belongs to the reopen path. A chat
whose staleness cannot be determined is also skipped, not healed — the failure
mode of skipping is "re-embedded when next visited", while the failure mode of
healing is this bug.

- `lib/startup/reconcile-conversation-rendering.ts` — the scan carries
  `chats.updatedAt` along, each candidate passes through `isStale` before
  enqueue, and the result gains a `skippedStale` counter (logged).
- `lib/background-jobs/maintenance/collapse-stale-chat-assets.ts` —
  `isStale`'s parameter narrowed to `Pick<ChatMetadata, 'id' | 'updatedAt'>`
  (the two fields it reads) so the raw-SQL scan can call it without hydrating
  full chat rows; no behaviour change.

Genuine mid-conversation gaps keep their safety net: an **active** chat with
unembedded chunks (embedder outage, killed render) is still healed at boot
exactly as before.

**Follow-up (same day):** a smaller pendulum remained on the read path. A cold
chat the user *reads* without playing a message is re-embedded on open by
`cold-chunk-reembed`, but reading never counts as activity, so the chat stays
stale and the next sweep discarded the fresh vectors — one paid re-embed per
read/sweep cycle. Fixed by giving `clearEmbeddingsForChat`
(`lib/database/repositories/conversation-chunks.repository.ts`) an optional
`olderThan` cutoff which the sweep binds to its staleness cutoff: the reopen
re-embed stamps the rows' `updatedAt`, so embeddings younger than the window
are recognized as deliberate warmth and survive. A chat read once stays
semantically searchable for a full retention window from the visit; a chat
unvisited for a window is cold-tiered as designed. No schema change — the
embedding write timestamp is the signal. Nothing else writes chunk rows on a
stale chat: renders fire only on played messages, and the boot reconcile now
skips stale chats (the main fix above).

### Verification

- Unit: `__tests__/unit/lib/startup/reconcile-conversation-rendering.test.ts`
  gains two regression tests — a stale chat in the scan result is skipped (not
  enqueued, counted in `skippedStale`), and a staleness-check failure skips
  rather than heals.
- Against the Friday copy (read-only SQL), simulating the fixed predicate:
  the same 671 incomplete chats split into **595 skipped** (stale, cold-tiered)
  and **76 still healed** (active); of the 9,608 recoverable NULL chunks,
  9,458 belong to the cold tier and stop being re-embedded at boot, 150 belong
  to active chats and still heal. Per boot that retires ~69 M chars (~17 M
  tokens, roughly $2 of `text-embedding-3-large`) of pure churn.
- On a live instance: after restart, the reconcile log line reports
  `skippedStale` ≈ the cold-tier size and `enqueued` only for active gaps;
  opening a cold chat still triggers `cold-chunk-reembed` as before.

### Note for the v5 side

This fix changes `lib/` behaviour that is measurable from job tables and chunk
state, so the oracle baseline moves (families touching
`reconcile-conversation-rendering` and the `isStale` signature). v5 should
inherit the *fixed* semantics — a ported reconcile must gate on the shared
staleness predicate from day one, or the port re-creates the pendulum with the
same wallet attached.
