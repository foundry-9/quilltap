# Bug 4 — import cannot read its own export of a blob over 3 MB

| | |
|---|---|
| **Status** | Fixed in v4 (2026-07-26) |
| **Found** | 2026-07-26 |
| **Fixed** | 2026-07-26 |
| **Severity** | High |
| **Who it bites** | any instance with a store blob > 3 MB |
| **Fix size (as estimated)** | 1 line |
| **Fix site** | `lib/import/quilltap-import-stream.ts:284` |
| **v5 status** | Converged — both readers wait for every chunk |
| **Index** | [bugs.md](../../bugs.md) |

---

**Severity: High.** Bites any instance with a document-store blob larger than
the 3 MB chunk size.

### Symptom

Importing a `.qtap` export fails outright with:

```
doc_mount_blob_chunk received without preceding doc_mount_blob
```

The export that produced it was written by v4 itself, and reports no error.
Worse than the visible failure: the blob has already been **silently truncated**
before the throw.

### Root cause

`lib/import/quilltap-import-stream.ts:257` allocates the chunk accumulator as a
**sparse** array:

```ts
received: new Array(blobRec.data.chunkCount),
```

and `:284` decides the blob is complete with:

```ts
const allReceived = accum.received.every((v) => typeof v === 'string');
```

`Array.prototype.every` **skips holes**. On a sparse array it returns `true`
immediately — the moment the *first* chunk lands, whatever `chunkCount` says.
v4 then joins what it has (holes render as `''`), pushes the truncated blob, and
**deletes the accumulator**. Chunk 2 arrives with no accumulator and throws.

The writer chunks at `BLOB_CHUNK_BYTES = 3 MB`, so a blob at or under 3 MB is a
single chunk and behaves correctly. Over 3 MB, v4 cannot re-read its own output.

The sharpest detail: v4 **already has** an end-of-stream truncation check with
its own error message (`:318`). The sparse `every` is precisely what made that
code unreachable.

### Why it survived

Sparse-array hole-skipping is a genuine JavaScript trap — `every` on
`new Array(3)` returning `true` surprises most readers. And the guard that
should have caught it was rendered dead by the same bug.

### The fix

One line at `:284`:

```ts
const allReceived =
  accum.received.filter((v) => typeof v === 'string').length === accum.chunkCount;
```

`filter` also skips holes, but counting the survivors against `chunkCount` is
the test that was intended. `accum.chunkCount` must be the value carried on the
accumulator, not `received.length`.

With this in place, a genuinely short stream now reaches the truncation error at
`:318` — v4's own message, finally reachable.

### Verification

- Export an instance holding a document-store blob **larger than 3 MB**
  (a modest PDF or image will do), then import it into a fresh instance and
  confirm the blob arrives byte-identical. Check the sha256, not just the size.
- Truncate an NDJSON export mid-blob and confirm the import fails with the
  truncation message at `:318` rather than the "without preceding" throw.
- Note for anyone touching the chunk size: chunks are base64-encoded
  **separately** and the reader rejoins the *encoded* strings, so only the last
  chunk may carry padding. `BLOB_CHUNK_BYTES` must stay a multiple of 3.

### Note on the format

This is a **reader** fix. The writer is untouched and its bytes do not change,
so archives stay compatible in both directions. v5 already reads a strict
superset of what v4 reads, having taken this fix on its own side.
