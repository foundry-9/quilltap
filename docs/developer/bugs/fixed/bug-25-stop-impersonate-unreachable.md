# Bug 25 — "stop impersonating" is unreachable from v4's own client

| | |
|---|---|
| **Status** | Fixed in v4 (2026-08-06) |
| **Found** | 2026-08-06 |
| **Fixed** | 2026-08-06 |
| **Severity** | Medium |
| **Who it bites** | anyone trying to end an impersonation |
| **Provenance** | Faithful (v5 correct) |
| **Fix site** | `app/api/v1/chats/[id]/handlers/delete.ts` — register `stop-impersonate` on DELETE; removed the stale POST registration |
| **v5 status** | Converged — v5 already models it correctly |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-08-06)** — the `stop-impersonate` action is now registered on
the **DELETE** map (`handlers/delete.ts`), matching the verb the client already
sends; the stale **POST** registration was removed (nothing else called it).
Pinned by `handlers/delete.test.ts`. v5 already models it correctly — nothing to
change there.

**Severity: Medium.** v5 already models it correctly — nothing to change there;
this is purely a v4-side defect.

### Root cause

The client sends `DELETE ?action=stop-impersonate`
(`useImpersonation.ts:94`, `:121`), but the action is registered only on the
**POST** map (`handlers/post.ts:129`), and the DELETE handler hard-rejects
unknown actions (`handlers/delete.ts:32`–`35`). So pressing "stop impersonating"
never reaches the server.

### The fix

Register the action on the DELETE map (or move the client to POST).
