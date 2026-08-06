# Session 4 — Embedding & memory data (Bugs 14, 17, 26)

Three fixes around the embedding/memory pipeline: export bloat from serialized
vectors, renderer-side sub-chunking for oversize interchanges, and a
memory-link clobber in the extraction fold. Bug 17 is the design-heavy one —
budget most of the session for it.

Read the standing rules in [README.md](README.md). Full root causes:
`../found-bugs.md` → Bugs 14, 17, 26. Background for 17: the fixes for Bugs 6
and 7 (Status table) — the reconcile now skips stale chats and excludes
FAILED-for-profile chunks; 17 is the *remaining* cohort those fixes correctly
stopped retrying but cannot heal.

---

## Bug 14 — an entity export is 99.7% regenerable embeddings

**Severity: High. Provenance: Faithful.**

`MemorySchema.embedding` validates to a `Float32Array`, and `JSON.stringify`
of a typed array emits a 1024-key object (`{"0":…,"1":…}`) — ~29.6 KB per
memory. The real characters `.qtap` is 789.6 MB, effectively all of it
embeddings. Embeddings are derived data: the importer's reconcile already
schedules a re-embed, and both apps carry `EMBEDDING_GENERATE` + a boot
reconcile.

**Fix:** omit the `embedding` field from **entity exports** (`.qtap`).
Backup & Restore keeps its own policy — do not touch it. On the import side,
confirm a memory arriving without `embedding` imports cleanly and gets
re-embedded by the existing reconcile path (it should; test it). Update
`public/schemas/qtap-export.schema.json` if it declares the field as required
or documents its shape. Note: embedding **blobs** in the DB are int8
self-describing (`0xEB`) since 4.8 — irrelevant to the JSON export, but don't
confuse the two while in here.

**Expected result:** the measured archive shrinks ~300× (789.6 MB → ~2.5 MB).

**Verification:** export a character with memories → no `embedding` keys in
the NDJSON; import into a fresh instance → memories present, re-embed jobs
enqueued. Regression test on the serializer.
**v5:** faithful (reproduces the bloat); v4-first because omitting the field
moves the oracle — same-round mirror owed.

---

## Bug 17 — oversize conversation chunks can never embed

**Severity: Medium. Provenance: Faithful.** The long-standing sub-chunking
follow-up (515 permanently-unembeddable chunks on the Friday copy).

### What happens

The conversation renderer has no interchange sub-chunking: a long interchange
becomes a single chunk of 34k–117k chars — under the 131,072-char transport
cap but far over the model context (`text-embedding-3-large` ≈ 8,192 tokens ≈
~31k chars). The embed fails deterministically; since Bug 7's fix the chunk is
correctly marked FAILED and excluded from boot retries, but it stays
**unsearchable forever**.

### The fix (renderer-side)

1. In the conversation render pipeline (the chunker that emits
   `conversation_chunks`), split any interchange whose rendered text exceeds a
   size budget into several sequential chunks, each safely inside model
   context. Use a conservative char budget (e.g. ~24k chars ≈ ~6k tokens) as a
   named constant with a comment tying it to the 8,192-token limit; do not try
   to token-count per model.
2. Split at natural boundaries (message boundaries first, then paragraph/
   sentence) — never mid-word. Each sub-chunk must independently carry
   whatever metadata (chat id, interchange index/ordering) recall and
   citations rely on; check how chunk ordering is consumed by episodic recall
   before choosing the scheme.
3. **Healing the existing 515:** the FAILED marks from Bug 7 keep the boot
   reconcile away from these chats. Decide and document one of:
   - re-render is triggered naturally the next time the chat gets a played
     message (cheapest; stale chats stay unsearchable until touched), or
   - a one-shot startup reconcile pass that re-renders chats holding
     FAILED-oversize chunks (must be idempotent and must respect the stale-chat
     gate from Bug 6's fix — do not resurrect the cold-tier pendulum).
   The second is better if it stays small; the Bug 6/7 machinery
   (`isStale`, per-profile FAILED exclusion) is the guardrail — reuse it.

### Verification

- Unit tests on the chunker: an interchange over budget yields N chunks all
  under budget, order preserved, metadata intact; an interchange under budget
  is unchanged (byte-identical output — this protects the oracle surface for
  normal history).
- Integration: render a chat with a giant interchange, run the embedding
  handler, confirm every chunk embeds (no FAILED marks).
- If the one-shot heal is built: reconcile logs show the oversize cohort
  re-rendered once, and the next boot shows nothing to do.

**v5:** faithful — v5 inherits the sub-chunking; the chunk-shape change moves
the oracle significantly, so flag this one loudly for the between-rounds
landing.

---

## Bug 26 — `INSERT_RELATED` clobbers the related-memory links it just wrote

**Severity: Medium. Provenance: Faithful.**

On an `INSERT_RELATED` memory action, the gate links related memories, then
the fold pass's `relatedMemoryIds` union starts from `[]` and overwrites those
links — because the gate returns the memory as it was **before**
`linkRelatedMemories` ran (its own comment claims the opposite). Every other
action reads the persisted row and is fine.

**Fix:** in `lib/memory/memory-gate.ts` (the `createMemoryWithGate` /
`runMemoryGate` chokepoint), make the gate return the **post-link** row on
`INSERT_RELATED` (or have the fold pass re-read the persisted row before
unioning). Fix the lying comment. Stay inside the gate chokepoint — never
touch `repos.memories` link fields directly from the fold.

**Verification:** unit test: `INSERT_RELATED` with related memories → after
the fold pass, `relatedMemoryIds` still contains the gate's links (plus any
fold additions). Fails pre-fix. Remember memory-gate tests may need the
real-binding Jest conventions (node environment docblock, absolute-path
`better-sqlite3` require) if they touch the real repos.
**v5:** faithful — same-round mirror owed.

---

## Definition of done

- [ ] Three fixes with regression tests failing pre-fix
- [ ] Bug 17's char budget, boundary scheme, and healing decision written into
      `found-bugs.md` ("decisions taken while fixing")
- [ ] `public/schemas/qtap-export.schema.json` updated if needed (Bug 14)
- [ ] `npx tsc`, `npm run lint`, full `npm run test:unit` green
- [ ] `docs/CHANGELOG.md` entries; `found-bugs.md` Status rows flipped
- [ ] Final report: all three are Faithful — v5 mirrors owed in the same
      round, with Bug 17 flagged as a large oracle move
