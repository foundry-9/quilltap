# Bug 54 — rehydrate refuses any character who shared a content row with another vault

| | |
|---|---|
| **Status** | **FIXED in v4** |
| **Found** | 2026-08-10 |
| **Fixed** | 2026-08-10 |
| **Severity** | High (rehydration is unreachable for any character archived out of a multi-character chat — which is most of them; no data loss, but the archive is one-way until fixed) |
| **Who it bites** | anyone rehydrating a character who ever appeared in a group chat, or whose vault held an image or document byte-identical to one in another vault |
| **Provenance** | Faithful — found by dogfooding on the Friday instance the same day the archive feature merged: a real `Rehydrate` on "Ulugh Beg" refused |
| **Defect site** | `lib/import/quilltap-import/execute.ts` — the `document store file` and `document store blob` skip classifiers in `preflightPreserveIds` |
| **Fix site** | same two classifiers |
| **v5 status** | Owed (Faithful) — v5's port of the preserveIds preflight carries the same classifier |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-08-10).** Both content-addressed kinds now settle
membership by content hash: an existing row whose `sha256` equals the hash the
bundle carries for that id is dedup, not a collision, so the preflight lets it
through and the writer reuses the row. A same-id/different-bytes row is a real
clash and still refuses atomically. The link-in-target-vault test remains as a
fallback for rows the bundle carries no hash for. Regression tests:
[`__tests__/unit/lib/import/quilltap-import-service.test.ts`](../../../../__tests__/unit/lib/import/quilltap-import-service.test.ts)
("accepts a content row whose surviving links all live in other vaults" and
"still refuses a content row carrying different bytes at the same id").

## Symptom

Archive a character who has been in a chat with anyone else, then press
Rehydrate. The restore refuses; the character stays archived. The API returns
the import's failure detail and the log carries one warning:

```
warn  Preserve IDs preflight failed
      Preserve IDs collision for document store file f955ea3c-21d2-4f2c-9d79-f14eecbaf937
```

On the Friday instance that id was the conversation summary
`Conversation Summaries/The Blue-White Ultimatum.md` (markdown, 3671 bytes),
and seven live characters — Friday, Amy, Charlie, al-Kashi, al-Rumi, Ali
Qushji, al-Latif — still linked that exact row.

## Root cause

`doc_mount_files` is content-addressed: one row per distinct byte sequence,
one `doc_mount_file_links` row per vault holding it. A conversation summary
written into every participant's vault is therefore **one** content row with
one link per participant.

Archiving prunes the target's `Conversation Summaries/` links through
`deleteWithGC`, which garbage-collects the content row only when no links
remain. With co-participants still linking it, the row survives — holding only
links that live *outside* the archived character's vault.

The rehydrate preflight asked the wrong question of that row. Its skip
classifier was:

```ts
skippable: async (id) => fileLinkedInTargetVault(id),
```

— "does this row have a link inside the target vault?" For content the target
legitimately owned and the prune legitimately removed, the answer is no. The
preflight read that as "this id lives somewhere else" and refused the whole
import atomically.

The refusal was also stricter than the writer it guards.
`linkDocumentContent` (and `linkBlobContent`) find-or-create the content row
**by sha256** and honor the caller's `fileId` only in the insert branch:

```ts
let fileRow = db.prepare(`SELECT ... FROM doc_mount_files WHERE sha256 = ?`).get(input.contentSha256);
if (!fileRow) { const id = input.fileId ?? randomUUID(); /* INSERT */ }
```

So had the preflight allowed it, the import would have deduped onto the
existing row, ignored the carried id, and simply recreated the character's
link — precisely the right outcome.

## Why it survived

The unit tests configured the whole keep-set to collide *inside* the target
vault (`configureFullKeepSetCollision` points `findByFileId` at `vault-A`),
which is the shape of a re-run after a partial restore. Nothing exercised the
ordinary shape: a row shared with a vault that is not the target. Live
testing before this used single-character chats, where no summary is shared
and the archive/rehydrate round trip is clean.

The `preserveIdsSkips` set is also consulted per **link** id, never per
content id ([`import-document-stores.ts:264`](../../../../lib/import/quilltap-import/import-document-stores.ts)),
so nothing downstream distinguished the two cases and the fault stayed in the
preflight alone.

## The fix

For both content-addressed kinds, compare hashes:

- Build `carriedContentSha` (fileId → `contentSha256`/`sha256`) and
  `carriedBlobSha` (blobId → `sha256`) from the bundle's document and blob
  records, which already carry those fields.
- `document store file` is skippable when the live row's `sha256` equals the
  carried hash, falling back to `fileLinkedInTargetVault` otherwise.
- `document store blob` is skippable when the live blob row's `sha256` equals
  the carried hash, falling back to the link test on its `fileId`.

Because `skippable` is consulted only in `skip-if-present` mode, the ordinary
import wizard's `refuse-on-collision` behavior is untouched.

Rehydrate also gained a failure log naming the operation
(`lib/characters/archive-service.ts`): the importer's own warning names only
the import module, so a failed rehydrate previously left no log line that
grepping for "rehydrate" would find — which is what made this take digging.

## Verification

Archive a character who appears in a multi-character chat with at least one
conversation summary, then rehydrate. The restore completes; the summary comes
back into the character's vault as a fresh link at its original link id,
pointing at the content row the co-participants never stopped sharing. Confirm
the co-participants' own links are undisturbed, and that a second rehydrate of
the same character is still refused (the tombstone is cleared).

## v5 coordination

v5's preflight port carries the same link-membership classifier and so
reproduces the refusal. It inherits this fix as a drift catch-up, with a
fixture whose bundle carries a content row shared with a non-target vault.
