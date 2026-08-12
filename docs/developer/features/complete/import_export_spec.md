---
title: Import / Export — Coverage, Embedding Payload, and New Types (Implementation Spec)
audience: Claude Code (quilltap-server)
status: implemented (all five phases landed 2026-08-05)
scope: the `.qtap` entity export/import surface, plus the backup/restore archive
supersedes: import_export_update.md (which stays as the problem statement / measurements)
---

# Import / Export — Implementation Spec

## 0. Purpose and provenance

This spec turns [import_export_update.md](./import_export_update.md) into an
actionable plan. Read that document first for the problem statement, the
measurements (791 MB export, 99.7% embeddings), and the correctness argument
(§2d there: same-dimensionality/different-model vector mixing is caught by
*nothing*). This document assumes those findings and specifies the changes.

The update doc's §5 open questions have been answered by the human:

| Question | Decision |
|---|---|
| Q1 — export `providerModels`? | **Yes**, as one of five new types (§3 below), documented as a regenerable cache. |
| Q2 — export `instanceSettings`? | **Yes**, as a distinct "move my setup" export type (§3.5). |
| Q3 — re-embed after import: explicit or next-boot? | **Explicit**: targeted `EMBEDDING_GENERATE` enqueue per imported memory (§1.3). |
| Q4 — smaller-backup option? | **Yes**, opt-in compact backup (§5). Full fidelity stays the default. |

Work lands in five phases. Phase 1 first — it is the smallest diff with the
largest effect, and it makes every later round-trip test megabytes instead of
gigabytes. Phases 4 and 5 are independent and can land any time.

Every phase moves the v5-port oracle; the port mirrors these surfaces
faithfully and re-ports after each phase lands (update doc §4). Landing Phase 1
first also demotes the v5 streaming-import order (`p4.35-streaming-qtap-import.md`)
from urgent to hygiene.

---

## 1. Phase 1 — embeddings out of exports

### 1.1 Writer: stop emitting `embedding`

The NDJSON writer emits 20 record kinds; exactly **one** carries an embedding:
`memory`, yielded whole at two sites in `lib/export/ndjson-writer.ts`:

- line ~189 — inside `streamCharacters`, guarded by `includeMemories`
- line ~302 — inside `streamChats`, filtered by `chatId`

Both currently do `yield { kind: 'memory', data: memory }` with the full
`Memory` object, whose `embedding` is a hydrated `Float32Array`
(`lib/schemas/memory.types.ts:73-84`). `JSON.stringify` of a typed array
produces an index-keyed *object* — ~29.6 KB per memory.

**Change:** strip the field at both sites before yielding:

```ts
const { embedding: _embedding, ...memoryData } = memory;
yield { kind: 'memory', data: memoryData };
```

Adjust `QtapMemoryRecord` (`lib/export/types.ts:479-481`) so the record type is
`Omit<Memory, 'embedding'>` (or equivalent), making re-introduction a type
error.

> ⚠ **Name trap (repeated from the update doc).** `doc_mount_blob_chunk`
> (`ndjson-writer.ts:594`) is *not* an embedding chunk — it is the 3 MB base64
> splitting of binary blob content, and it must not be touched. The embedding
> table is `doc_mount_chunks`, which the exporter never reads.

### 1.2 Reader: drop embeddings arriving from older archives — **must not be skipped**

Existing `.qtap` files in the wild carry embeddings, and importing them is
exactly the §2d hazard: `importMemories` spreads the record whole into
`repos.memories.create` (`lib/import/quilltap-import/import-entities.ts:435-443`),
so a foreign instance's vectors land in a corpus governed by a different
embedding standard, with no error if the dimensionality happens to match.

**Change (two layers, belt and suspenders):**

1. **Stream reassembler** — in the `memory` case of the record switch in
   `lib/import/quilltap-import-stream.ts` (~lines 99-310), delete `embedding`
   from the collected record.
2. **Importer** — in `importMemories`, explicitly exclude `embedding` from the
   spread alongside `id`/`createdAt`/`updatedAt`. This also covers the legacy
   monolithic-JSON path, which does not pass through the reassembler.

Note the boot repair `lib/startup/repair-text-embeddings.ts` would otherwise
"helpfully" convert a JSON-string embedding written to the DB into a valid
blob — i.e. the bad vector would be *preserved*, not discarded. Dropping at
import time is the only correct point.

Do **not** route imports through `createMemoryWithGate`
(`lib/memory/memory-service.ts:359`): its gate can silently skip near-duplicates,
reinforce existing rows instead of inserting, or lose rows entirely when the
embedding provider is down. Imports keep using the raw repo path.

### 1.3 Importer: enqueue targeted re-embedding

A memory inserted without an embedding is NULL in the DB (the column is
nullable; `migrations/scripts/sqlite-initial-schema.ts:285`) and today
**nothing in the import path re-embeds it** — only the next boot's
`reconcile-embedding-dimensions` sweep would, so the user's semantic search is
silently broken until a restart.

**Change:**

- `importMemories` (`import-entities.ts:387`) collects the ids of the memories
  it creates and returns them (extend its return type; today it returns a
  count).
- At the end of `executeImport` (`lib/import/quilltap-import/execute.ts`),
  after `reconcileRelationships`, resolve the default embedding profile and
  enqueue one `EMBEDDING_GENERATE` job per imported memory via
  `enqueueEmbeddingGenerate` (`lib/background-jobs/queue-service.ts:913`),
  payload `{ entityType: 'MEMORY', entityId, characterId, profileId }`. This
  mirrors the existing backfill sweeper
  (`app/api/v1/memories/route.ts`, `?action=backfill-embeddings`, ~line 891),
  which is the pattern to copy — including its per-entity dedup, which the
  enqueue helper already provides.
- If there is no default embedding profile, or it is the builtin TF-IDF
  profile, log a warning and add an import warning ("memories imported without
  embeddings; they will be indexed when an embedding profile is configured").
  The boot reconcile remains the backstop — it already sweeps
  NULL-embedding memories (`lib/startup/reconcile-embedding-dimensions.ts:219-227`).
- Fire debug logs on the enqueue path per the logging convention.

Preferred over enqueueing one `EMBEDDING_REINDEX_ALL`: that job walks every
character's entire memory table plus conversation chunks, help docs, and mount
chunks — far too heavy for an import of a handful of memories.

### 1.4 Expected result

The measured Friday `characters` export drops from **791 MB to roughly
2.5 MB** (~300×). All later phases' round-trip tests get cheap.

---

## 2. Phase 2 — coverage of the existing ten types

The writer already supports all ten `ExportEntityType` members
(`lib/export/types.ts:31-41`) — `streamGroups` (`ndjson-writer.ts:435`) and
`streamDocumentStores` (`:485`) exist, and both dispatch switches
(`resolveExportIds` at `:623`, `streamExportRecords` at `:664`) have all ten
cases. Only two layers above it gate the missing types:

### 2.1 `handleExportEntities` — add the two missing cases

`app/api/v1/system/tools/route.ts`, switch at ~line 456 (eight cases today,
`default: badRequest`). Add:

- `groups` — `repos.groups.findAll()` → `{ id, name }` entities.
- `document-stores` — **`globalRepos.docMountPoints.findAll()`** → `{ id, name }`.
  Document stores are instance-scoped, not user-scoped; do not reach for
  `repos.*` here (mirror `resolveExportIds`, `ndjson-writer.ts:653`).

### 2.2 The picker — offer all ten

`components/tools/import-export/steps/ExportTypeStep.tsx:11-20`
(`EXPORTABLE_TYPES`) lists seven; add `projects`, `groups`,
`document-stores`. Labels already exist for all ten in `ENTITY_TYPE_LABELS`
(`components/tools/import-export/types.ts:41-52`).

If any type is ever deliberately hidden from the picker again, **say so in a
code comment at the exclusion site**. Silence is what produced this bug.

### 2.3 Import-order fix: document stores before group links

`executeImport` (`lib/import/quilltap-import/execute.ts`) imports document
stores **last** (step 9), but step 7c creates group↔store links
(`repos.groupDocMountLinks.link(...)`, ~line 276) that resolve against mount
points which may not exist yet in a mixed archive. Fix by either:

- moving `importDocumentStores` before the group-link step (it has no
  dependency on chats/memories; it needs `idMaps` for project links, so it must
  still follow `importProjects`), **or**
- deferring group↔store link creation into `reconcileRelationships`.

Prefer the reorder; it keeps link creation in one place. Either way, remap the
link's mount-point id through `idMaps.mountPoints` (populated by
`importDocumentStores`).

### 2.4 Round-trip sanity per type

For each of the ten types: export from a populated instance → import into an
empty instance → compare entity counts and spot-check fields. `document-stores`
gets priority — its importer
(`lib/import/quilltap-import/import-document-stores.ts`) has only ever been
exercised against hand-made archives, never a real producer's output. Automate
what is practical in the round-trip suite (§7); do the rest once by hand
against a copy of Friday.

---

## 3. Phase 3 — five new export types

New members of `ExportEntityType`: `files`, `prompt-templates`,
`provider-models`, `plugin-configs`, `instance-settings`.

### 3.0 The touch-list (applies to every new type)

Records that are parsed but not wired evaporate silently, so treat this as a
checklist, not guidance:

| Layer | File | What |
|---|---|---|
| Type union + counts + record types | `lib/export/types.ts` | `ExportEntityType`, `QuilltapExportCounts` key, `Qtap*Record` interface, `QtapRecord` union |
| Writer | `lib/export/ndjson-writer.ts` | `stream*` generator, `resolveExportIds` case, `streamExportRecords` case |
| Stream reassembler | `lib/import/quilltap-import-stream.ts` | record `switch` case, `CollectedArrays` field, `buildExportDataForType` case (the `default:` there **throws** on unknown export types) |
| Import types | `lib/import/quilltap-import/types.ts` | `AnyExportData` field (+ id-map field if remapped) |
| Importer | `lib/import/quilltap-import/` | new module, wired into `execute.ts` in dependency order |
| Wizard labels | `components/tools/import-export/types.ts:41` | `ENTITY_TYPE_LABELS` entry (a missing entry is a compile error — good) |
| Picker | `components/tools/import-export/steps/ExportTypeStep.tsx` | `EXPORTABLE_TYPES` entry |
| Entity lister | `app/api/v1/system/tools/route.ts` | `handleExportEntities` case |
| JSON schema | `public/schemas/qtap-export.schema.json` | new `exportType` branch (see §6.1) |

Importers honor the wizard's existing conflict strategy (skip / overwrite /
duplicate) wherever a natural key exists, and every new backend path fires
debug logs.

### 3.1 `files` — the general file library (files + folders)

- **Records:** `folder` (from `globalRepos.folders.findByUserId(userId)`),
  `file` (metadata from `repos.files.findAll()`), and the bytes as
  `file_blob` + `file_blob_chunk` — modeled directly on the existing
  `doc_mount_blob` / `doc_mount_blob_chunk` pair (`ndjson-writer.ts:569-599`):
  a header record carrying `chunkCount` + metadata, then base64 chunks of
  `BLOB_CHUNK_BYTES = 3 * 1024 * 1024` (**must stay a multiple of 3** so
  base64 chunks concatenate — see the comment at `ndjson-writer.ts:34-41`).
  Bytes come from `fileStorageManager.downloadFile(file)`
  (`lib/file-storage/manager.ts:378-409`), which already branches between
  mount-blob and local-backend storage. A file whose bytes fail to download is
  warned and its metadata exported with a flag, mirroring backup's
  skip-and-warn.
- **Exclusions:** `category === 'BACKUP'` and `folderPath === '/backups'`,
  exactly as backup does (`lib/backup/backup-service.ts:188-190`).
- **`storageKey` is instance-specific** — commonly
  `mount-blob:<mountPointId>:<blobId>`
  (`lib/file-storage/project-store-bridge.ts:31`), pointing into *this*
  instance's mount-index DB. **Never transfer it verbatim.** Export it only as
  provenance; the importer discards it.
- **Import:** create folders first (parents before children, as
  `importDocumentStores` sorts by path length), then re-upload each file's
  bytes through the same bridges restore uses
  (`lib/backup/restore/restore.ts:396-464`): `fileStorageManager.uploadFile`
  when the file is project-bound (remap `projectId` through `idMaps`),
  `writeUserUploadToMountStore` otherwise — and record the **post-bridge**
  mime/size, since bridges transcode bitmaps to WebP. Remap `linkedTo`
  references through `idMaps` where the target entity was part of the same
  import; drop links whose targets are absent, with a warning.

### 3.2 `prompt-templates`

Mirror the `roleplay-templates` precedent exactly:

- **Export:** `globalRepos.promptTemplates.findByUserId(userId)` filtered
  `!isBuiltIn` (cf. `resolveExportIds`'s roleplay filter,
  `ndjson-writer.ts:645-648`). Built-ins are seeded from `prompts/` and never
  travel.
- **Import:** `globalRepos.promptTemplates.create({ ...data, userId })` with
  `id`/`userId`/`createdAt`/`updatedAt` stripped; name-based dedup per the
  conflict strategy (restore's equivalent is `restore.ts:197-211`).

### 3.3 `provider-models`

- **Export:** `globalRepos.providerModels.findAll()` (instance-global, no user
  filter).
- **Import:** `upsertModel` per row with `id`/timestamps stripped, matching
  restore (`restore.ts:229-241`). No id preservation, no remapping.
- **Document in code and help:** this table is a **regenerable catalogue
  cache** — it is populated by live provider refetch
  (`app/api/v1/models/route.ts:100-141`) and an import is merely a convenience
  for offline/air-gapped instances. Exportable by decision, but the comment
  should say a refetch supersedes it.

### 3.4 `plugin-configs` — security-sensitive

`PluginConfig.config` is an untyped `Record<string, unknown>`
(`lib/schemas/plugin-config.types.ts:22-44`) and plugin manifests declare
`password`-type config fields (`lib/schemas/plugin-manifest.ts:227`) that are
stored **plaintext**. A local backup containing them is acceptable; a portable
`.qtap` is not.

- **Export (redaction is mandatory):** for each config, resolve the plugin's
  manifest config schema; drop every key whose declared type is `password`,
  and emit a `_redactedKeys: string[]` breadcrumb on the record. If the
  manifest is unavailable (plugin not installed on the exporting instance —
  shouldn't happen, but), **drop the whole `config`** and note it in
  `_redactedKeys: ['*']`; never guess. This is the same philosophy as
  connection profiles, where `sanitizeProfile` strips `apiKeyId` and
  substitutes `_apiKeyLabel` (`ndjson-writer.ts:66-86`) and the importer
  hard-forces `apiKeyId: null`
  (`lib/import/quilltap-import/import-profiles.ts`, header comment).
- **Import:** `upsertForUserPlugin(userId, pluginName, config)` — note the
  repo **merges** into any existing config
  (`lib/database/repositories/plugin-config.repository.ts:151-163`), which is
  the desired behavior here: redacted keys simply don't overwrite whatever
  secret the receiving instance already has. Preserve `enabled` (the restore
  path currently drops it, `restore.ts:292-308` — fix that in passing, it is
  a one-liner on the same call).
- Surface `_redactedKeys` in the import preview so the user knows which
  secrets they must re-enter.

### 3.5 `instance-settings` — the "move my setup" type

Distinct in kind from entity exports: it moves configuration, not content.

- **Export:** dump the `instance_settings` key/value table via the
  `dumpInstanceSettings` pattern (`lib/backup/backup-service.ts:92-104`),
  **excluding**:
  - the three mount-point pointer keys — `lanternBackgroundsMountPointId`,
    `userUploadsMountPointId`, `generalMountPointId` — instance-local UUIDs
    into *this* instance's mount-index DB (the same set restore has to remap:
    `MOUNT_POINT_SETTING_KEYS`, `lib/backup/restore/uuid-remap.ts:61-65`);
  - `lastMaintenanceSweepAt` (instance-local timing state);
  - the version-guard key (`lib/startup/version-guard.ts:28`).

  Keep the exclusion list as a named constant next to the known-keys list in
  `lib/instance-settings/index.ts` so a future setting is a conscious
  include/exclude decision.
- **Import:** upsert by key (`writeSetting`,
  `lib/instance-settings/index.ts:71`), overwriting the receiving instance's
  values — that is the point of "move my setup".

### 3.6 Format compatibility

The NDJSON envelope stays `version: 1`. Older importers **warn and skip**
unknown record kinds (`quilltap-import-stream.ts:307`) but **throw** on an
unknown `manifest.exportType` (`buildExportDataForType`, `:404-445` default
branch). So an old build can't consume a new-type archive — acceptable, and the
error message is already clear. State this in the code comment where the new
types are added.

---

## 4. Phase 4 — restore runs the embedding reconcile

`restore()` (`lib/backup/restore/restore.ts:36`) currently ends after applying
instance settings (`:765-783`) with no reindex or reconcile of any kind; a
restored corpus is only repaired by the *next boot's*
`reconcile-embedding-dimensions`. Fine for in-place restore; wrong for
`new-account` mode or a restore into an instance whose default embedding
profile differs from the archive's.

**Change:** at the very end of `restore()`, after instance settings and before
returning the summary, call `reconcileEmbeddingDimensions()`
(`lib/startup/reconcile-embedding-dimensions.ts`). It takes no arguments, never
throws (catches into a null result), resolves the default profile itself, and
dedupes its own `EMBEDDING_REINDEX_ALL` enqueue — so in the normal conforming
case it is a cheap no-op. Record its result (or `skippedReason`) in the restore
summary/warnings and the debug log.

---

## 5. Phase 5 — compact backup (opt-in)

Backups deliberately keep embeddings and that stays the default (update doc
§3: a backup restores the *same* instance, so its vectors are valid on
arrival, and re-embedding costs real money/time exactly when the user is
recovering). Compact is an option for users for whom archive size is the
constraint.

- **`createBackup`** (`lib/backup/backup-service.ts:548`) gains
  `options?: { compact?: boolean }`. When `compact`:
  - skip writing `conversation-chunks.json`, `vector-entries.json`,
    `vector-index-metas.json`, `tfidf-vocabularies.json`,
    `embedding-status.json`, and `doc-mount-chunks.json`;
  - null `embedding` on each row of `memories.json` (and `help-docs` if the
    backup carries them with embeddings);
  - record `compact: true` in the backup manifest
    (`BackupManifest`, `lib/backup/types.ts`).
  - `llmLogs` handling is **unchanged** — compact is about embeddings, not
    logs (the existing 10k cap stays).
- **Restore** detects `manifest.compact` and, instead of relying on Phase 4's
  reconcile (which deliberately ignores NULL conversation/mount chunks),
  enqueues one `EMBEDDING_REINDEX_ALL` — its fan-out
  (`lib/background-jobs/handlers/embedding-reindex.ts:234-255`) regenerates
  NULL-embedding memories, conversation chunks, help docs, and mount chunks.
  Missing chunk *rows* (as opposed to NULL embeddings) are rebuilt by the
  normal indexing machinery as chats are touched; state this plainly in the
  restore summary ("search will warm back up as re-indexing completes").
- **Plumbing:** `POST /api/v1/system/backup`
  (`app/api/v1/system/backup/route.ts`) already receives a JSON body and
  ignores it — parse `{ compact?: boolean }` from it. UI: a checkbox in
  `components/tools/backup-dialog.tsx` ("Compact backup — smaller archive;
  search re-indexes after restore"), default off.

---

## 6. Cross-cutting obligations

### 6.1 Schemas

`public/schemas/qtap-export.schema.json` describes only the **legacy
monolithic** `{manifest, data}` format (a ten-branch `allOf` on
`manifest.exportType`). Obligations:

- add the five new `exportType` branches to the legacy schema (the legacy
  *reader* still exists, so the schema must stay truthful for it);
- the schema does **not** describe the NDJSON stream at all — no
  `__envelope__`, no record kinds. Add a companion
  `qtap-export-ndjson.schema.json` describing the envelope, footer, and
  per-kind record shapes (including the new kinds), and link both from the
  export docs. Do not silently leave the gap; it is how drift happens.

No DDL changes are expected (no new tables; `instance_settings` already
exists), so `docs/developer/DDL.md` should not need edits — verify rather than
assume.

### 6.2 Documentation

- `docs/CHANGELOG.md` entries per phase (plain American English).
- Help docs (`help/*.md`, with `url` frontmatter and matching In-Chat
  Navigation `help_navigate` call) for every user-visible change: the three
  newly-offered picker types, the five new types, the compact-backup
  checkbox, and the post-import "memories will re-index" behavior.
- `docs/developer/API.md` for the `handleExportEntities` additions.
- When all phases land, move `import_export_update.md` and this spec to
  `docs/developer/features/complete/`.

### 6.3 Test plan

Extend `__tests__/unit/lib/export/ndjson-roundtrip.test.ts` (today a single
annotations/chat-docs case) plus the import suites:

1. **Memory round-trip (Phase 1):** export a character with memories; assert
   no `embedding` key appears anywhere in the archive text; import; assert
   memories arrive with NULL embedding and one `EMBEDDING_GENERATE` per memory
   is enqueued (mock the queue).
2. **Legacy-archive defense (Phase 1):** feed a hand-built archive whose
   memory records carry both array-form and index-keyed-object embeddings;
   assert both are dropped, never written.
3. **Groups and document-stores round-trips (Phase 2),** including a mixed
   archive exercising the group↔store link ordering fix.
4. **One round-trip per new type (Phase 3);** for `files`, a multi-chunk blob
   (>3 MB) exercising base64 reassembly; for `plugin-configs`, assert
   password-typed keys are absent and `_redactedKeys` is populated; for
   `instance-settings`, assert the mount-point keys are excluded.
5. **Compact backup (Phase 5):** manifest flag set, skipped collections absent
   from the zip, restore enqueues `EMBEDDING_REINDEX_ALL`.
6. **Restore reconcile (Phase 4):** `restore()` invokes the reconcile once
   (mock it); result lands in the summary.

Suites touching the real SQLite binding need the `@jest-environment node`
docblock. Verification commands: `npx tsc`, `npm run lint`, full
`npm run test:unit` (`--findRelatedTests` is broken in this repo).

### 6.4 Out of scope (deliberate)

- `llmLogs` remain unexportable — diagnostic, enormous, full of raw prompts.
- Derived tables (`conversationChunks`, `vectorIndexMetas`, `vectorEntries`,
  `tfidfVocabularies`, `embeddingStatus`) remain export-invisible forever.
- `number[]` embedding encoding in exports: moot — the field is gone. The rule
  survives only as: *if* an embedding field ever returns to any export record,
  it must be `number[]` (match backup's `encodeEmbedding`), never a serialized
  typed array.
