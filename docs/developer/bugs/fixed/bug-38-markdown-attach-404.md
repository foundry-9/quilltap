# Bug 38 — the library picker lists markdown documents that 404 on attach

| | |
|---|---|
| **Status** | Fixed in v4 (2026-08-06) |
| **Found** | 2026-08-06 |
| **Fixed** | 2026-08-06 |
| **Severity** | Low |
| **Who it bites** | attaching a native-text store document |
| **Provenance** | Faithful |
| **Fix site** | `app/api/v1/chats/[id]/files/route.ts` + `lib/chat-files-v2.ts` — serve native-text documents (no blob) as text attachments; `nativeTextAttachmentMime` in `lib/mount-index/path-utils.ts` |
| **v5 status** | **Owed** (Faithful) — mirror the document-serving attach path |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-08-06)** — took the preferred path: `handleAttachMountFile`
(`app/api/v1/chats/[id]/files/route.ts`) now serves a native-text document when
no blob exists, and the LLM-side resolver `loadMountFileAsAttachment`
(`lib/chat-files-v2.ts`) loads the document text as a text `FileAttachment`, so
an attached `.md`/`.txt`/`.json` document actually reaches the model. The chat
file-list GET was taught the same fallback. Clean-mime helper
`nativeTextAttachmentMime` in `lib/mount-index/path-utils.ts`. v5 obligation
(**Faithful**): mirror the document-serving attach path in the same round.

**Severity: Low.** Affects both apps.

### Root cause

A `.md`/`.txt`/`.json` PUT into a database store takes the native-text
**document** branch (`lib/mount-index/store-file.ts:202`, `writeDatabaseDocument`
— no `doc_mount_blobs` row), but `handleAttachMountFile` requires a **blob**
(`app/api/v1/files/route.ts:271`–`279`, `notFound('Mount-point file blob')`). So
the picker's browse panel shows the document and attaching it fails with
"Mount-point file blob not found".

### The fix

Filter native-text documents out of the picker's store browse, or teach
attach-mount-file to hand the Librarian a document (it has `extractedText`).
