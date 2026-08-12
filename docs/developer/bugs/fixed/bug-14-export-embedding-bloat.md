# Bug 14 — an entity export is 99.7% regenerable embeddings

| | |
|---|---|
| **Status** | Fixed in v4 (2026-08-06) |
| **Found** | 2026-08-06 |
| **Fixed** | 2026-08-06 |
| **Severity** | High |
| **Who it bites** | anyone exporting a character with memories |
| **Provenance** | Faithful |
| **Fix site** | `lib/export/ndjson-writer.ts` — `stripEmbedding` drops the `embedding` off every exported memory; `public/schemas/qtap-export.schema.json` documents the absence and the importer drops embeddings from older archives |
| **v5 status** | **Owed** (Faithful) — v5 reproduced the bloat; omitting the field moves the oracle, so the mirror is due the same round |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-08-06)** — `stripEmbedding` in
`lib/export/ndjson-writer.ts` drops the `embedding` off every exported memory
before it is serialised (commit `7189a968`, which landed before this bug was
catalogued). `public/schemas/qtap-export.schema.json` documents the field as
deliberately absent and the importer drops any embedding arriving from older
archives. Pinned by `ndjson-roundtrip.test.ts` ("never writes an embedding, in
any form" + "drops embeddings arriving from older archives"). v5 obligation:
the same-round mirror is owed — v5 reproduced the bloat faithfully, and omitting
the field moves the oracle.

**Severity: High** in practice — the real characters `.qtap` is **789.6 MB**, of
which 789.6 MB is memory embeddings (29,030 records at ~29.6 KB each, the
`embedding` field 29,602 bytes of that).

### Root cause

`MemorySchema.embedding` (`lib/schemas/memory.types.ts:73`–`84`) validates to a
`Float32Array`, and `JSON.stringify` of a typed array emits a **1024-key JSON
object** (`{"0":…,"1":…}`), not an array. Every exported memory carries its full
vector, serialised in the most verbose form possible.

The embeddings are **derived data**: both apps carry an `EMBEDDING_GENERATE`
worker and a boot reconcile that refill them from memory text, and the importer's
reconcile already schedules a re-embed. So the export ships ~789 MB of data it can
regenerate for free.

### The fix

Omit embeddings from entity exports (Backup & Restore may keep its own policy).
Shrinks the archive roughly 300× (789.6 MB → ~2.5 MB). v5 reproduces the bloat
faithfully today; this is a v4-first change because omitting the field moves the
oracle.
