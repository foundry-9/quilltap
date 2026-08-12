# Bug 17 — oversize conversation chunks can never embed

| | |
|---|---|
| **Status** | Fixed in v4 (2026-08-06) |
| **Found** | 2026-08-06 |
| **Fixed** | 2026-08-06 |
| **Severity** | Medium |
| **Who it bites** | any long-history instance |
| **Provenance** | Faithful |
| **Fix site** | `lib/scriptorium/markdown-renderer.ts` — `enforceChunkBudget` / `splitInterchange` sub-chunk an over-budget interchange; `lib/startup/reconcile-conversation-rendering.ts` arm (C) re-renders the existing oversize cohort once |
| **v5 status** | **Owed** (Faithful) — v5 inherits the sub-chunking; the chunk-shape change moves the oracle significantly |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-08-06)** — the Scriptorium renderer
(`lib/scriptorium/markdown-renderer.ts`) now splits any interchange whose
rendered text exceeds a per-chunk char budget into several sequential in-context
chunks (`enforceChunkBudget` / `splitInterchange`), and the boot reconcile
(`lib/startup/reconcile-conversation-rendering.ts`) re-renders the existing
oversize cohort once via a new arm (C). v5 obligation flagged loudly below — the
chunk-shape change moves the oracle **significantly**; v5 inherits the
sub-chunking and its landing owes a same-round mirror.

**Severity: Medium.** 515 conversation chunks on the Friday copy are permanently
unembeddable and re-attempted every boot.

### Root cause

The renderer has no interchange sub-chunking, so a long interchange can produce a
single chunk of 34k–117k chars. That is under v5's 131,072-char transport cap but
over the model's context (`text-embedding-3-large` ≈ 8,192 tokens ≈ ~31k chars),
so the embed fails deterministically and the chunk is marked FAILED — and stays
unsearchable. (Distinct from the ~9,098 chunks cold-tiered *by design* and the 43
empty/over-cap chunks both apps correctly exclude.)

### The fix

Renderer-side interchange sub-chunking, so a long interchange embeds as several
in-context chunks. v4-side; v5 inherits it.

### Decisions taken while fixing

- **Char budget: `CHUNK_CHAR_BUDGET = 24,000` chars** (exported from
  `lib/scriptorium/markdown-renderer.ts`). A deliberately conservative proxy for
  ~6k tokens against the ~8,192-token model context (~31k chars at ~4 chars/tok),
  leaving headroom for denser prose. Not a per-model token count — a single
  named char constant with a comment tying it to the 8,192-token limit.

- **Boundary scheme:** split at **message boundaries first** — whole message
  blocks are packed greedily into sub-chunks up to the budget. Only when a
  *single* message block alone exceeds the budget is that block split within, at
  natural boundaries in preference order **paragraph (`\n\n`) → sentence
  (`. `) → any whitespace → hard char cut** (the last only for a pathological
  single token; never silently over budget). Concatenating the pieces reproduces
  the message exactly.

- **Chunk identity / ordering:** each emitted chunk gets its own **sequential
  `interchangeIndex`** (a chunk ordinal, not the interchange ordinal), so the
  `(chatId, interchangeIndex)` chunk key stays unique and `ORDER BY
  interchangeIndex` still yields render order. In the common case (no interchange
  over budget) each interchange is exactly one chunk and the chunk ordinal equals
  the old interchange ordinal, so **output is byte-identical** to the previous
  renderer — the oracle surface for normal history is untouched. `messageIds`
  ride per sub-chunk (a message split across pieces repeats its id);
  `participantNames` are the sub-chunk's own speakers. The `## Interchange N`
  header keeps the interchange ordinal on the first sub-chunk; continuation
  sub-chunks are labelled `(continued k)`. The metadata header stays on chunk 0
  even when interchange 0 is itself split.

- **Embedding preservation on re-key:** `ConversationChunksRepository.upsert`
  now **NULLs a preserved embedding when a chunk's content changes** (and no new
  embedding is supplied). Splitting a formerly-oversize interchange shifts every
  downstream chunk onto new content at an existing index; without this, those
  rows would keep the previous occupant's stale vector. Content-identical
  re-renders (the normal case) still preserve the embedding, so no spurious
  re-embed.

- **Healing the existing cohort — one-shot startup reconcile (option 2).**
  `reconcile-conversation-rendering.ts` gains **arm (C)**: a chat holding an
  un-embedded chunk **over `CHUNK_CHAR_BUDGET` but within `EMBEDDING_MAX_CHARS`**
  is re-rendered once (which now sub-chunks it). FAILED status is *not* excluded
  here — these are exactly the chunks arm (B) skips. It is **self-limiting** (a
  re-rendered chat has no over-budget chunk left, so it stops matching) and reuses
  the existing **stale-chat gate** (Bug 6) in the enqueue loop, so a cold-tiered
  chat is left for its reopen/next-played heal rather than resurrected at boot.
  The >131,072-char / empty cohort (the 43 both apps correctly exclude) is left
  untouched by arm (C) — it stays out of the transport cap window. Verified: the
  cohort re-renders once, then the next boot finds nothing to do.
