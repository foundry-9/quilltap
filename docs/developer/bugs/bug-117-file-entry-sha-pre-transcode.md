# Bug 117 — a chat upload's FileEntry records the hash of bytes that were never stored, so every join to the document store is dead

| | |
|---|---|
| **Status** | **Open** |
| **Found** | 2026-09-02 |
| **Fixed** | — |
| **Severity** | **Medium** (nothing is lost or corrupted, and the paths that break do so by returning "not found" rather than a wrong answer — but a transcoded chat upload is permanently unreachable from its own stored bytes, so its description never reaches the search index, `describe_image`/`attach_image` cannot resolve it from a mount link, and every future consumer that joins the two tables by hash inherits the hole) |
| **Who it bites** | every chat-uploaded bitmap the bridge transcodes to WebP — in Friday, **118 of 239 uploaded images (49%)**, and **every single one** of them is a converted `image/webp` |
| **Provenance** | Live (Friday, 2026-09-02) — found while diagnosing [bug 116](bug-116-describer-answer-never-verified.md), from an `auto-describe: completed` line reporting `linksUpdated: 0` for a file that plainly had a mount link |
| **Fix site** | `lib/chat-files-v2.ts` (`uploadChatFile` / `uploadFileToProject`) |
| **v5 status** | **Applies.** Any port that hashes content for identity must fix *which* bytes the hash names — input or stored — and use the same answer on both sides of every join. The trap is that both answers are defensible and the codebase already contains both. |
| **Index** | [bugs.md](../bugs.md) |

---

### Symptom

`autoDescribeChatImageAttachment` promises, in its own module doc, to persist a
description in three places: `FileEntry.description`, every blank
`doc_mount_file_links.description`/`extractedText` for the same bytes, and the
`chunks` + embeddings that make the image findable by search.

Only the first happens. For the file that surfaced this
(`3358d097-0e09-4204-b9d2-a84fec5331e5`, Friday):

```
auto-describe: completed  fileEntryId=3358d097-…  linksUpdated:0  descriptionLength:3175
```

The link exists and is plainly the same picture:

| table | id | sha256 |
|---|---|---|
| `files` | `3358d097-…` | `2ea2d3de9e09d819…` |
| `doc_mount_files` | `05dcd4ad-…` | `9fa94a2a2aeb9e97…` |

Same path, same project, same 319,206 bytes. Hashing the stored blob gives
`9fa94a2a…`. So `files.sha256` is the hash of bytes that are **not** the bytes on
disk — it is the hash of the original PNG, before the bridge transcoded it to
WebP. `doc_mount_file_links.extractionStatus` is `'none'` and `chunkCount` is 0:
the image is invisible to search, and always was.

Across Friday's whole image library the split is exact:

| source | sha matches a `doc_mount_files` row | does not |
|---|---|---|
| `GENERATED` | **2541** | 0 |
| `UPLOADED` | 121 | **118** |

and every one of the 118 orphans carries `mimeType: image/webp` — the converted
ones. The 67 `image/png` / `image/jpeg` uploads match because they were never
converted, and the 54 matching WebP uploads arrived as WebP.

### Root cause — two sibling upload paths, opposite orderings, one of them right

`lib/images-v2.ts` transcodes **first** and hashes **second**:

```ts
// lib/images-v2.ts:106
if (mimeType.startsWith('image/') && mimeType !== 'image/svg+xml') {
  const converted = await convertToWebP(buffer, mimeType, originalFilename);
  if (converted.wasConverted) { buffer = converted.buffer; … }
}
const sha256 = sha256OfBuffer(buffer);   // :116 — hashes what will be stored
```

That is why all 2541 generated images match.

`lib/chat-files-v2.ts` hashes **first** and lets the bridge transcode
**afterwards**:

```ts
// lib/chat-files-v2.ts:136
const sha256 = sha256OfBuffer(buffer);   // hashes the *input*
…
// :342 — the bridge may transcode; it returns the stored bytes' hash
const uploaded = await fileStorageManager.uploadFile({ filename, content: buffer, … });
storageKey      = uploaded.storageKey;
storedMimeType  = uploaded.storedMimeType;
storedSize      = uploaded.sizeBytes;
//              ↑ uploaded.sha256 is right there, and is not read
…
await repos.files.create({ sha256, mimeType: storedMimeType, size: storedSize, … });
//                         ↑ the input hash, beside two stored-bytes fields
```

The instructive detail is the comment three lines above the `create`, which is
correct and which the code obeys — for two of the three fields:

> *The bridges may transcode bitmap uploads to WebP; the FileEntry must record
> the stored mimeType/size, not the input, or vision providers will be handed
> "you said JPEG, bytes are WebP" rejections.*

Somebody worked out exactly this hazard, wrote it down, and applied it to
`mimeType` and `size`. `sha256` was already computed 200 lines earlier for a
different purpose — duplicate detection against other *inputs*
(`chat-files-v2.ts:155`, `:265`) — and simply travelled down into the row. It is
the one field where "the input" and "what we stored" were never reconciled, and
`uploadFile` hands back the right value unused.

**Why the dedup half still works.** Both `findBySha256` calls in
`chat-files-v2.ts` compare an input hash to other stored input hashes, so they
are internally consistent. Nothing about re-uploading the same file is broken.
The breakage is strictly cross-domain: `files` speaks input-hash, the mount
index speaks stored-hash, and every join between them is between two different
languages.

**What that breaks.** Every site that crosses the boundary, for transcoded
uploads only:

| site | direction | consequence |
|---|---|---|
| `lib/photos/auto-describe-attachment.ts:127` | `files.sha256` → `docMountFiles` | description never reaches the link, `extractedText`, chunks or embeddings; the image is unsearchable |
| `lib/tools/handlers/doc-edit/photo-handlers.ts:497` | `link.sha256` → `files` | `describe_image` cannot resolve a mount-link uuid to its FileEntry |
| `lib/tools/handlers/doc-edit/photo-handlers.ts:436` | `link.sha256` → `files` | same, for `attach_image` |
| `lib/photos/save-image-to-album.ts:161` | `sourceLink.sha256` → `files` | a `keep_image` from a mount link cannot find its sister FileEntry |
| `lib/photos/photo-link-summary.ts:75` | given sha → `docMountFiles` | link summary reports zero linkers |

The last one is the near miss worth recording. `getPhotoLinkSummaryBySha256`
feeds the `album-or-vault-link` guard in
`lib/background-jobs/maintenance/collapse-stale-chat-assets.ts:174`, which is
what stops the stale-chat sweep from deleting an image the user deliberately
saved. A zero-linker answer there means "not saved anywhere — reap it." That
guard is **not** currently compromised, because the sweep's candidates are
filtered to `source === 'GENERATED'` and generated images take the images-v2
path, whose hash is correct. The protection survives on a filter written for an
unrelated reason. Any future widening of that candidate set to uploads would
turn this bug into deletion of kept content.

### Why it survived

**Both halves look right in isolation.** Hashing the input is the obviously
correct thing to do for duplicate detection, and that is what the hash was
originally for. Recording it on the row looks like reuse, not a category error.

**Every failure is a silent empty result.** `findBySha256` returns `[]`, its
caller reads that as "no such file", and does nothing. `linksUpdated: 0` is
logged at `info` in the same line that reports success. There is no error, no
warning, and no partial state — the same shape as bug 114's soft-failing read,
except that here nothing downstream *writes* in response, so it does not
amplify; it just quietly does less than the module says it does.

**The one visible consequence is indistinguishable from an unrelated absence.**
An uploaded image not appearing in search reads as "search does not index
images", which is a plausible product limitation and was never questioned.

### The fix

In `uploadFileToProject`, record the hash of the bytes that were actually
stored. `fileStorageManager.uploadFile` already returns it, and
`writeUserUploadToMountStore` should be checked for the same; the input hash
stays where it is for duplicate detection.

```ts
storageKey     = uploaded.storageKey;
storedMimeType = uploaded.storedMimeType;
storedSize     = uploaded.sizeBytes;
storedSha256   = uploaded.sha256;   // ← and pass this to files.create
```

The comment above `repos.files.create` should be extended to name `sha256`
alongside `mimeType` and `size`, so the next reader sees all three as one rule
rather than two plus an exception.

**Backfill.** The 118 existing rows can be repaired without touching bytes:
for each `files` row whose `storageKey` is `mount-blob:<mountPointId>:<blobId>`,
read the blob's own hash from the mount index and write it to `files.sha256`.
This is a migration (`realign-file-entry-sha256-v1`), needs a `PRETTY_LABELS`
entry, and must call `reportProgress` over the row loop. It must not touch rows
whose hash already matches, and it should log any row where the blob is missing
rather than guessing.

**Open question for the fix, not to be decided here:** whether the two hashes
should be two columns (`sha256` for stored identity, `sourceSha256` for
input-dedup) rather than one repurposed field. One column is a smaller change
and the dedup call sites are self-consistent either way; two columns make the
distinction impossible to re-confuse. The comment in `images-v2.ts` suggests one
column with a clear rule has been sufficient there for the whole life of that
path.

### How to verify

- **Unit:** upload a PNG through `uploadChatFile` with a stub bridge that
  reports a transcode; assert `files.sha256` equals the bridge's returned hash
  and *not* the input buffer's hash. Pre-fix this asserts the input hash — the
  test is the bug.
- **Unit, non-regression:** upload an already-WebP file (no transcode) and
  assert the hash is unchanged, so the 121 currently-correct rows stay correct.
- **Unit, dedup:** re-upload the same PNG twice and assert the second is still
  detected as a duplicate — the input-hash comparison at `:155`/`:265` must not
  be disturbed by the change.
- **Integration:** upload an image to a project chat, wait for auto-describe,
  and assert `linksUpdated >= 1` with a non-empty
  `doc_mount_file_links.extractedText` and `chunkCount > 0`. That is the
  end-to-end statement that the module's three destinations are all reached.
- **Live, after backfill:** the query behind the table above should return zero
  `UPLOADED` rows whose sha matches no `doc_mount_files` row.

### Related

- **Bug 116** — filed from the same incident. Different cause; this one is why
  the fabricated description in 116 at least never reached the search index.
- **Bug 114** — the same *shape* of survival: a lookup whose failure is
  indistinguishable from its empty result. 114 amplified because its callers
  answered `null` by writing; this one is quiet because its callers answer by
  doing nothing.
