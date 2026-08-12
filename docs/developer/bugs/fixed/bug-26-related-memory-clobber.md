# Bug 26 — `INSERT_RELATED` clobbers the related-memory links it just wrote

| | |
|---|---|
| **Status** | Fixed in v4 (2026-08-06) |
| **Found** | 2026-08-06 |
| **Fixed** | 2026-08-06 |
| **Severity** | Medium |
| **Who it bites** | memory extraction that relates memories |
| **Provenance** | Faithful |
| **Fix site** | `lib/memory/memory-service.ts` — the `INSERT_RELATED` arm of `createMemoryWithGate` returns the post-link row; `lib/memory/fold-episode-pass.ts` comment corrected |
| **v5 status** | **Owed** (Faithful) — v5 reproduces the clobber |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-08-06)** — the `INSERT_RELATED` arm of
`createMemoryWithGate` (`lib/memory/memory-service.ts`) now returns the
**post-link** row (`{ ...memory, relatedMemoryIds: linkedIds }`) instead of the
stale pre-link object, and the fold-episode pass's union comment
(`lib/memory/fold-episode-pass.ts`) is corrected to name that dependency. Pinned
by `memory-service.test.ts` ("returns the POST-LINK row so relatedMemoryIds
carries the gate links"). v5 obligation: same-round mirror owed — v5 reproduces
the clobber faithfully.

**Severity: Medium.**

### Root cause

On an `INSERT_RELATED` memory action, the gate links related memories, then the
fold pass's `relatedMemoryIds` union **starts from `[]`** and overwrites those
links — because on `INSERT_RELATED` the gate returns the memory object as it was
**before** `linkRelatedMemories` ran, despite v4's own comment claiming the
opposite. Every other action reads the persisted row and is fine. v5 reproduces
faithfully.

### The fix

Have the gate return the post-link row (or have the fold pass re-read it) on
`INSERT_RELATED`.
