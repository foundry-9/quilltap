# Bug 51 — chat GET omits impersonation state, so a reload shows an impersonated seat as not impersonated

| | |
|---|---|
| **Status** | **FIXED in v4** |
| **Found** | 2026-08-08 |
| **Fixed** | 2026-08-08 |
| **Severity** | Medium (reload-only; silently breaks impersonation + speaking-as until the next impersonate action) |
| **Who it bites** | anyone impersonating a character who reloads the tab, or whose session survives a server restart |
| **Provenance** | Faithful — human dogfood (surfaced while chasing Bug 50, after a mid-session dev-server restart) |
| **Defect site** | `app/api/v1/chats/[id]/handlers/get.ts` — the response `chat` object is an explicit field allowlist that includes `lastTurnParticipantId` but omits `impersonatingParticipantIds` and `activeTypingParticipantId` |
| **Fix site** | `app/api/v1/chats/[id]/handlers/get.ts` (+ the `activeTypingParticipantId` re-sync guard in `app/salon/[id]/hooks/useImpersonation.ts`) |
| **v5 status** | Owed (Faithful) — check the v5 chat serializer projects both fields |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-08-08).** The GET handler now projects
`impersonatingParticipantIds` and `activeTypingParticipantId` onto the response
`chat`, and the client's `useImpersonation` sync seeds `activeTypingParticipantId`
only once (never re-clobbering the turn-follow on later refetches). Same family
as [Bug 22](bug-22-chat-get-missing-fields.md) (GET omitting controlled fields).
**v5 owes a drift catch-up.**

### Symptom

Impersonate a character, then reload the tab (or have the dev server restart
mid-session). The impersonated seat comes back showing as **not impersonated** —
its card reverts to the plain LLM affordances and the "speaking as" selection is
lost — even though nothing was toggled off. The database still has the
impersonation set the whole time.

### Root cause

`handleGet` (`app/api/v1/chats/[id]/handlers/get.ts:536`) builds its response
`chat` from an **explicit allowlist** of fields. It projects
`lastTurnParticipantId` but never `impersonatingParticipantIds` or
`activeTypingParticipantId`. So `GET /api/v1/chats/[id]` returns a chat with no
impersonation state, and the client's `useImpersonation` sync
(`app/salon/[id]/hooks/useImpersonation.ts:29`) reads `chat.impersonatingParticipantIds`
as `undefined` — its `length > 0` guard is false, so it never restores the
overlay. It only "worked" during a session because the *impersonate action*
response (`handleImpersonate`) carries those two fields and the client sets them
in state directly; a reload or a mid-session server restart forces a fresh
`fetchChat`, which drops them.

### Why it survived

Impersonation state is normally set and read within one live session, where the
action responses keep the client in sync. The GET omission only bites on a
reload/refetch — a path exercised here only because the dev server restarted
mid-conversation while debugging Bug 50. It is the same class as Bug 22, which
found four other controlled-select fields missing from the same allowlist.

### The fix

Project both fields in the GET response:

```ts
impersonatingParticipantIds: chatMetadata.impersonatingParticipantIds ?? [],
activeTypingParticipantId: chatMetadata.activeTypingParticipantId ?? null,
```

Restoring `activeTypingParticipantId` surfaced a second, subtler issue: the
`useImpersonation` sync effect re-applied the persisted value on **every**
refetch, which clobbered the turn-follow (Bug 49) and any manual SpeakerSelector
choice — pinning the composer to whatever seat was last persisted, so one seat
appeared to "hog" every turn. The sync now seeds `activeTypingParticipantId`
**only when it is still unset** (`prev => prev ?? activeTypingId ?? null`); the
turn-follow and the set-active-speaker handler own it thereafter.

### Verification

Impersonate a character, reload the tab. Confirm the seat still shows impersonated
and the composer's "speaking as" is restored. Exchange turns and confirm the
composer follows the rotation rather than snapping back to one persisted seat.

### v5 coordination

Check that the v5 chat serializer projects `impersonatingParticipantIds` and
`activeTypingParticipantId`; if it mirrors v4's omission, it carries the same
reload bug and should absorb the fix.
