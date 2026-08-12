# Bug 18 — a whitespace-only help file wipes the whole `help_docs` table

| | |
|---|---|
| **Status** | Fixed in v4 (2026-08-06) |
| **Found** | 2026-08-06 |
| **Fixed** | 2026-08-06 |
| **Severity** | Medium (latent) |
| **Who it bites** | a corrupt/blank help doc on disk |
| **Provenance** | Faithful |
| **Fix site** | `lib/help/help-doc-sync.ts` — prune guard extended from "no file exists" to "no file has usable content while the table is non-empty" |
| **v5 status** | **Owed** — mirror the guard; pinned bidirectionally by `help_doc_sync_guards_equivalence` |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-08-06)** — the prune guard in `lib/help/help-doc-sync.ts`
now refuses the destructive pass when no file on disk parsed to usable content
while the table is non-empty, not only when the directory is literally empty.
v5 obligation: mirror the guard (pinned by `help_doc_sync_guards_equivalence`).

**Severity: Medium (latent).** Measured: a `help/` directory whose single `.md`
is whitespace-only produced `totalOnDisk 1`, `deleted 3`, rows left 0 — the
table wiped.

### Root cause

`syncHelpDocs` (`lib/help/help-doc-sync.ts`) guards the destructive path with
`if (files.length === 0)` (`:155`) — an empty *directory* is protected, but a
directory holding one whitespace-only file is not: `files.length` is 1, so the
sync proceeds, finds no usable content, and deletes everything already in the
table.

### The fix

Extend the guard to "no file has usable content", not "no file exists". v5
reproduces faithfully, pinned bidirectionally by
`help_doc_sync_guards_equivalence`.
