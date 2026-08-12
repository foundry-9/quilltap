# Bug 15 — `reindexLinkGroupSiblings` is dead code; hard-linked siblings serve stale chunks

| | |
|---|---|
| **Status** | Fixed in v4 (2026-08-06) |
| **Found** | 2026-08-06 |
| **Fixed** | 2026-08-06 |
| **Severity** | Medium |
| **Who it bites** | anyone using hard-linked documents |
| **Provenance** | Pinned |
| **Fix site** | `lib/database/repositories/doc-mount-file-links.repository.ts` — `queryJoined` selects + maps `l.linkGroupId` |
| **v5 status** | **Owed** — retire `doc_mount_file_links_tier2_equivalence` → `CHUNK_DIVERGENCES` |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-08-06)** — `queryJoined` now selects `l.linkGroupId` and its
mapper carries it, so the joined read no longer reports `linkGroupId: undefined`
and `reindexLinkGroupSiblings` fans the chunk reindex out to every group member.
Retire the `CHUNK_DIVERGENCES` arm of `doc_mount_file_links_tier2_equivalence`
(it goes red now that v4 renders fresh sibling chunks). Fix site:
`lib/database/repositories/doc-mount-file-links.repository.ts` (`queryJoined`).

**Severity: Medium.** The commit that introduced hard-link groups claims to keep
siblings in sync; the chunk half of that sync never runs.

### Symptom

A file hard-linked into two document-store locations is edited in one. The other
location keeps serving the **previous** revision's chunks to semantic search and
to character context.

### Root cause

`reindexLinkGroupSiblings` begins with `findByMountPointAndPath(...)` and returns
early unless the row carries a `linkGroupId`. But every joined read goes through
`queryJoined`
(`lib/database/repositories/doc-mount-file-links.repository.ts`), whose `SELECT`
list ends at `l.lastModified, l.createdAt, l.updatedAt` and **never selects
`l.linkGroupId`**. So the read always yields `linkGroupId: undefined` and the
reindex returns 0. The *content* fan-out works — it runs on raw SQL inside the
write transaction (`:587`–`:598`, `:664`–`:671`) — so rows move; only the chunk
reindex is dead.

### The fix

A one-liner: add `l.linkGroupId` to `queryJoined`'s `SELECT` list (and its
mapper). v5's joined read already carries the column, so its pass runs. Pinned
both directions by `CHUNK_DIVERGENCES` in
`doc_mount_file_links_tier2_equivalence` — named paths show fresh content on v5,
stale on v4; the moment v4 adds the column, the test fails.
