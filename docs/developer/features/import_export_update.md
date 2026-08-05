---
title: Import / Export — Coverage and Embedding Payload (Update Spec)
audience: Claude Code (quilltap-server)
status: proposed
scope: the `.qtap` entity export/import surface, plus the backup/restore archive
---

# Import / Export — Coverage and Embedding Payload

## 0. Purpose

Three problems in the import/export surface, found while dogfooding a copy of
Friday through the v5 port on 2026-08-04. All three are **v4-side**: the port
mirrors v4 faithfully in every case below, so the fix belongs here and the port
follows.

1. **Coverage.** Several entity kinds can be *imported* but never *exported*.
2. **Payload.** An entity export is ~99.7% embeddings — derived data that is
   also *wrong* on the receiving instance.
3. **Backup.** Asked to verify that backup/restore excludes embeddings. It does
   not, deliberately, and this spec argues that is correct — with two caveats.

Every claim below is cited to a file, and the measurements are from the real
Friday instance, not estimated.

---

## 1. Problem A — the export surface is narrower than the import surface

Export capability is stratified across three layers that disagree with each
other:

| Layer | Types | Source |
|---|---|---|
| The wizard's picker | **7** | `components/tools/import-export/steps/ExportTypeStep.tsx:12-20` |
| `handleExportEntities` (the picker's entity list) | **8** | `app/api/v1/system/tools/route.ts:440` — eight `case`s, then `default: badRequest('Unknown entity type')` |
| `ExportEntityType` + the writer + `previewExport` | **10** | `lib/export/types.ts:31`; `lib/export/ndjson-writer.ts` |

The importer, meanwhile, runs **eleven** entity families
(`lib/import/quilltap-import/execute.ts`): tags, connection profiles, image
profiles, embedding profiles, roleplay templates, projects, groups, characters,
chats, memories, document stores.

So today:

- **`document-stores`** — a full importer exists
  (`lib/import/quilltap-import/import-document-stores.ts`) and the writer can
  emit it, but the picker never offers it and `handleExportEntities` refuses it.
  **It can be consumed and not produced.**
- **`groups`** — same shape: writer yes, picker no, `handleExportEntities` no.
- **`projects`** — `handleExportEntities` handles it; the picker does not offer
  it.

### 1a. Deliverables

- Offer all ten types in `ExportTypeStep`, or state in the code why a type is
  deliberately hidden. Silence is what produced this.
- Add the two missing `case`s to `handleExportEntities` so the picker can list
  groups and document stores.
- Sanity-check the round trip per type: export → import into an empty instance →
  compare. `document-stores` in particular has never had a producer, so its
  importer has only ever been exercised against hand-made archives.

### 1b. The "other" list — what has no export path at all

Derived by subtracting the ten export types from `BackupData`'s ~35 collections
(`lib/backup/types.ts`). Grouped by what should happen, not by table:

**Probably wanted, currently impossible:**

| Collection | Note |
|---|---|
| `files` + `folders` | The general file library. Bytes live on disk; the rows are here. |
| `promptTemplates` | User-authored. |
| `providerModels` | Arguably regenerable by refetching a provider catalogue. |
| `pluginConfigs` | User-authored configuration. |
| `instanceSettings` | Appearance, aesthetics, quick-hide, content width, etc. |

**Deliberately not, and should stay that way:**

- `llmLogs` — diagnostic, enormous, and full of raw prompts. Not portable data.

**Derived — must never be exported (see §2):** `conversationChunks`,
`vectorIndexMetas`, `vectorEntries`, `tfidfVocabularies`, `embeddingStatus`.

**Already covered as riders of their parent entity** (no standalone type
needed): `wardrobeItems`, `characterPluginData`, `conversationAnnotations`,
`chatDocuments`, `memories`.

---

## 2. Problem B — an entity export is 99.7% embeddings

### 2a. The measurement

A `characters` export of Friday, taken 2026-08-04, is **791 MB**. By record
kind:

| kind | records | MB |
|---|---:|---:|
| `memory` | 29,030 | **789.6** |
| `character` | 38 | 0.7 |
| `wardrobe_item` | 400 | 0.3 |
| `__envelope__` / `__footer__` | 2 | ~0 |

Per memory: ~29.6 KB, of which the `embedding` field is **29,602 bytes** — 
everything else in the record totals under 400 bytes.

### 2b. Why it is so large

`MemorySchema.embedding` normalises every stored form to a `Float32Array`
(`lib/schemas/memory.types.ts:73-84`). `JSON.stringify` of a typed array does
**not** produce an array — it produces an object keyed by index:

```json
"embedding": {"0":0.0231,"1":-0.0117, … ,"1023":0.0044}
```

That is 1024 float literals *plus* 1024 quoted numeric keys. The backup path
already avoids this (`encodeEmbedding`, `lib/backup/backup-service.ts:53`,
returns `number[]`), so the two writers disagree on the encoding of the same
data. Converting the export to `number[]` would save roughly 6 KB per memory —
worth doing, but it is not the fix, because the field should not be there at
all.

### 2c. Where embeddings enter the export — a small surface

The writer emits 20 record kinds and only **one** carries an embedding:
`memory` (`ndjson-writer.ts:189` and `:302`). There is no `conversation_chunk`
kind, no `doc_mount_chunk` kind, and no `vector_entry` kind — those tables are
already export-invisible.

> ⚠ **Name trap.** `doc_mount_blob_chunk` is *not* an embedding chunk. It is the
> 3 MB base64 splitting of a binary blob (`ndjson-writer.ts:588`). The embedding
> table is `doc_mount_chunks`, which the exporter never touches. Do not "fix"
> the wrong one.

So excluding embeddings from exports is a change at one field in one record
kind, plus the reader and importer changes in §2e.

### 2d. This is a correctness problem, not only a size problem

v4 states the rule itself, in `lib/startup/reconcile-embedding-dimensions.ts`:

> *"There is exactly one embedding standard per instance: the vectors the
> default embedding profile produces."*

An imported memory violates that. `importMemories` spreads the record whole —
`await repos.memories.create({ ...memoryData, … })`
(`lib/import/quilltap-import/import-entities.ts:435-443`) — so the memory
arrives carrying **the source instance's** vector, computed by whatever model
that instance had configured, and lands in a corpus governed by a different
standard.

There are two failure modes, and the dangerous one is the quiet one:

- **Different dimensionality** — caught. `VectorStore.addVector` throws on a
  mismatch (`lib/embedding/vector-store.ts:215-219`), and the boot pass counts
  and repairs non-conforming rows.
- **Same dimensionality, different model** — **not caught by anything.** The
  boot reconcile detects conformance by *width* (format-aware SQL on the blob
  header); two 1024-d models produce vectors of identical shape and
  incompatible meaning. The corpus silently mixes two vector spaces, and
  semantic search degrades with no error, no warning, and no way for the user to
  discover it.

Since the vectors are regenerable from `content`, shipping them buys nothing and
risks exactly this.

### 2e. Deliverables

- **Writer:** omit `embedding` from the `memory` record. (If the field is kept
  for any reason, encode it as `number[]` for consistency with the backup path.)
- **Reader:** *drop* any `embedding` an older archive carries rather than trust
  it. Existing `.qtap` files in the wild have them, and importing them is the
  §2d hazard. This is the one change that must not be skipped.
- **Importer:** ensure a memory that arrives without an embedding is queued for
  one. Confirm the existing `EMBEDDING_GENERATE` path picks up rows with a NULL
  embedding after import — if the boot reconcile is the only thing that would,
  say so and decide whether an explicit enqueue at the end of import is wanted
  (the user should not have to restart the app to get working search).
- **Expected result:** this archive goes from 791 MB to roughly **2.5 MB**
  (~300×). Item §1's coverage work also gets much cheaper to test.

---

## 3. Problem C — backup/restore does **not** exclude embeddings, and probably should not

Asked to verify. The answer is unambiguous: the backup carries embeddings in
**all four** embedding-bearing collections, on purpose.

| Collection | Where | Encoding |
|---|---|---|
| `memories` | inline on the row | `Float32Array` via the schema |
| `conversationChunks` | `backup-service.ts` | `encodeEmbedding(...)` → `number[]` |
| `vectorEntries` | `backup-service.ts` | `Array.from(entry.embedding)` |
| `docMountChunks` | `backup-service.ts` | `encodeEmbedding(...)` → `number[]` |

And the rationale is stated twice in the source:

> *"Chunks include the embedding so the restored instance does not have to
> re-embed an entire chat history."*

> *"Without these the restored instance would have to re-embed every memory;
> with them, search keeps working immediately."*

**That reasoning is sound, and it is sound for a reason that does not transfer
to export.** A backup restores *this instance* — same embedding standard, so the
vectors are valid on arrival. An export moves entities to *another* instance,
where they are not. The two artifacts have different contracts, and the right
answer differs accordingly:

- **Backup: keep them.** Re-embedding a whole instance costs real money on a
  paid embedding provider and real time on a local one, precisely at the moment
  the user is recovering from a problem.
- **Export: drop them** (§2).

### 3a. Two caveats worth closing while here

1. **Restore triggers no re-embed of any kind.** `lib/backup/restore-service.ts`
   and `lib/backup/restore/**` contain no reindex or reconcile call, so a
   restored corpus is only ever repaired by the *next boot's*
   `reconcile-embedding-dimensions`. For an in-place restore that is fine. For
   `new-account` mode, or a restore into an instance whose default embedding
   profile differs from the archive's, the corpus is non-conforming until
   something restarts the app. Consider running the reconcile at the end of
   restore.
2. **Size.** Embeddings dominate the archive here too — on Friday the DB-side
   figures are `conversation_chunks` ~134 MB, `memories` ~103 MB,
   `vector_entries` ~98 MB (`db-size-reduction-spec.md` §0), and the archive
   inflates them further by storing floats as JSON text. If backup size becomes
   a complaint, the fix is an *option* ("smaller backup, re-embeds on restore"),
   not a default change.

---

## 4. Sequencing, and what this does to the v5 port

The v5 port mirrors all three surfaces faithfully, so **each of these changes
moves the oracle** and the port re-ports afterwards. That argues for landing
them as one coherent change rather than trickling.

Suggested order:

1. **§2 (embeddings out of exports)** — smallest diff, largest effect, and it
   makes everything else cheaper to test. Do the reader-side drop in the same
   change as the writer-side omission.
2. **§1 (coverage)** — the picker and `handleExportEntities`, then the per-type
   round-trip checks against archives that are now megabytes instead of
   gigabytes.
3. **§3a (restore reconcile)** — independent; can land any time.

One note for the port side: v5 has an order (`p4.35-streaming-qtap-import.md`)
to make the import read from a stream, written because a 791 MB archive is held
in memory several times over. **If §2 lands first, that order drops from urgent
to hygiene** — a ~2.5 MB archive does not strain anything. Landing §2 first is
worth it for that alone.

---

## 5. Open questions for the human

1. Should `providerModels` be exportable, or is refetching from the provider the
   intended path?
2. Should an export ever carry `instanceSettings`? It makes an export
   "move my setup", which is a different product idea from "move these
   characters" — possibly a separate export type rather than a rider.
3. After importing memories without embeddings, should the import enqueue the
   embedding work explicitly, or is waiting for the next boot's reconcile
   acceptable? (Recommend explicit: the user's search is broken until then, and
   nothing on screen says why.)
4. Is a smaller-backup option wanted (§3a.2), or is backup fidelity absolute?
