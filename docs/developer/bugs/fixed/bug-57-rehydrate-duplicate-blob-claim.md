# Bug 57 — rehydrate refuses any vault that links the same bytes twice

| | |
|---|---|
| **Status** | **FIXED in v4** |
| **Found** | 2026-08-11 |
| **Fixed** | 2026-08-11 |
| **Severity** | Medium (High for anyone it hits: rehydrate is permanently unusable for the affected character — every attempt fails identically — and the workaround, importing the bundle as an ordinary `.qtap`, mints fresh ids and so severs the id continuity rehydration exists to preserve) |
| **Who it bites** | anyone who archives a character whose vault holds one blob linked at two or more paths — which is what an ordinary sha-deduped save produces: save the same image into the gallery twice, or link the same file into two folders of the store, and the content-addressed writer gives you two links over one blob row |
| **Provenance** | Found by the v5 port's round-2 unification wire test (`characters_action_route.rs`), whose fixture vault genuinely carries a twice-linked blob; v5 had reproduced the failure faithfully until that run |
| **Defect site** | `lib/import/quilltap-import/execute.ts:115` (`carriedBlobIds` not deduped) composing with `lib/database/repositories/doc-mount-blobs.repository.ts:439` (`listByMountPoint` joins from the links — one row per link) |
| **Fix site** | `lib/import/quilltap-import/execute.ts` — one line |
| **v5 status** | **Converged (2026-08-11)** — v5's preflight already deduped (`quilltap_import/mod.rs`) as a pinned divergence; this fix lands the same behaviour in v4, so the divergence marker retires at the next drift catch-up |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-08-11).** `carriedBlobIds` is now deduped first-occurrence
(`Array.from(new Set(...))`), mirroring `carriedFileIds` one list up, so the
export's per-link repetition of a single blob row no longer reads as a
duplicate claim and the sha-match skip classifier below it is reached as
intended. Reader-side only — bundles already written carry the duplicates and
rehydrate correctly against the fixed reader. Regression test: *"does not treat
a twice-linked blob's shared blobId as a duplicate claim"* in
[`__tests__/unit/lib/import/quilltap-import-service.test.ts`](../../../../__tests__/unit/lib/import/quilltap-import-service.test.ts),
which reproduces the collision against the pre-fix line.

## Symptom

Rehydrating an archived character fails with

```
Character <id> cannot be rehydrated: the bundle import failed: Preserve IDs
collision for document store blob <blobId> (also seen as document store blob)
```

and keeps failing identically on every retry. The character stays archived;
the bundle is intact and decrypts fine. Nothing about the vault was unusual —
the affected store simply contains one image linked at two paths.

## Root cause

Two facts compose, each harmless alone.

**1. The export emits a blob record per LINK, not per blob.** The archive
bundle is a characters export, and the export's blob leg iterates
`repos.docMountBlobs.listByMountPoint(mp.id)`
(`lib/export/ndjson-writer.ts:633`), whose SQL joins **from
`doc_mount_file_links`** into `doc_mount_blobs`
(`doc-mount-blobs.repository.ts:439–456`) — one row per link, which is where
each record's `linkId` comes from. A blob row whose content is linked twice in
the store therefore appears twice in the bundle, both records carrying the
same `blobId` (`meta.id`, `ndjson-writer.ts:654`) and the same `sha256`.

**2. The preserveIds preflight treats a repeated blob id as a collision.**
`carriedBlobIds` is collected with no dedup —

```ts
const carriedBlobIds = blobs.map((b) => b.blobId).filter(isNonEmpty);   // :115
```

— and the preflight's seen-ids loop throws on ANY repeat
(`execute.ts:275–280`), **before** the `exists`/`skippable` classifiers run.
So the sha-match skip that Bug 54 added for exactly this content-addressed
sharing (`execute.ts:262–268` — "a blob row is 1:1 with its content row,
which `linkBlobContent` resolves by sha256") is never consulted: the
within-bundle duplicate kills the import first.

The contrast is one list up, and it is the tell. `carriedFileIds` IS deduped:

```ts
// Hard-link groups share one content row, so the same fileId legitimately
// appears on several document/blob records — dedupe rather than treating
// the repeat as a duplicate claim.
const carriedFileIds = Array.from(
  new Set([...documents.map((d) => d.fileId), ...blobs.map((b) => b.fileId)].filter(isNonEmpty))
);                                                                      // :108–113
```

The blob list has the same repeat-by-construction property — the per-link
join — and never got the same treatment.

(`carriedLinkIds` is correctly NOT deduped: each emitted record carries its
own link's id, so a repeated link id genuinely is a duplicate claim.)

## Why it survived

The archive feature's own tests and the v5 port's differential fixtures all
archived characters whose vaults held at most one link per blob, so the
per-link duplication never materialized in a bundle. Bug 54's fix added the
skip classifiers that *would* sanction these rows — but sits after the
seen-ids check, so it could not save them. The failure needed a vault shaped
by real gallery use (the same image saved twice), which is exactly what the
v5 port's photos fixture models; its unification wire test hit the collision
on its first live rehydrate.

## The fix

Dedupe the carried blob ids first-occurrence, mirroring `carriedFileIds`:

```ts
const carriedBlobIds = Array.from(new Set(blobs.map((b) => b.blobId).filter(isNonEmpty)));
```

Reader-side only — the export writer's bytes are untouched, so existing
bundles (which all carry the duplicates) rehydrate correctly once the reader
is fixed. Safety argument: a repeated `blobId` within one bundle can only
come from the per-link join of a single database row, so the repeats are
identical claims (both carry the same `sha256`; `carriedBlobSha`'s last-write
is a no-op). A genuine same-id/different-bytes clash is a cross-bundle
concern and still refuses through the `exists` + `skippable` path.

## Verification

Archive a character after saving the same image into their gallery twice
(two links, one blob), then rehydrate — before the fix it throws the
collision above; after, it restores cleanly with the blob's ids preserved.
As a jest case: run the preserveIds skip-if-present import over a bundle
whose store carries one blob with two links.

## v5 coordination

v5 already ships the dedupe as a deliberate reader-side divergence (the
round-2 unification, 2026-08-11; `quilltap-core`
`services/quilltap_import/mod.rs`, with the divergence comment naming this
bug). Its live pin is `crates/quilltap-web/tests/characters_action_route.rs`
(the rehydrate leg walks a twice-linked-blob vault). When this fix lands in
v4, the divergence becomes plain convergence — the next drift catch-up
retires v5's divergence marker, and the owed differential-level
both-directions arm (P4.D65's resume list) becomes an ordinary equality.
