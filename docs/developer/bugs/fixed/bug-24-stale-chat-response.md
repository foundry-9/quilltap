# Bug 24 — `remove-participant` returns a stale chat

| | |
|---|---|
| **Status** | Fixed in v4 (2026-08-06) |
| **Found** | 2026-08-06 |
| **Fixed** | 2026-08-06 |
| **Severity** | Low |
| **Who it bites** | removing an impersonated participant |
| **Provenance** | Faithful |
| **Fix site** | `app/api/v1/chats/[id]/actions/participants.ts` — return the post-cleanup chat from `repos.chats.update` |
| **v5 status** | **Owed** (Faithful) — mirror; v5 `remove_impersonating_promotes` |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-08-06)** — `handleRemoveParticipantAction`
(`actions/participants.ts`) now captures the chat returned by the impersonation
clean-up `repos.chats.update` and returns that, so the response no longer lists
the removed participant in `impersonatingParticipantIds`. Pinned by
`participants-impersonation.test.ts`. v5 obligation (**Faithful**): mirror in the
same round (v5 diffs this as `remove_impersonating_promotes`).

**Severity: Low.**

### Symptom

After removing an impersonated participant, the response body still lists them in
`impersonatingParticipantIds` while the DB does not — the client shows stale
impersonation state until a refetch.

### Root cause

The impersonation clean-up `repos.chats.update` runs **after** `result.chat` is
captured, so the returned object predates the cleanup. v5 diffs this with
`remove_impersonating_promotes`.
