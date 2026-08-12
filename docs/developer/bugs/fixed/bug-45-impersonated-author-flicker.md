# Bug 45 — an impersonated seat's message flickers to the wrong author before correcting

| | |
|---|---|
| **Status** | Fixed in v4 (2026-08-07) |
| **Found** | 2026-08-07 |
| **Fixed** | 2026-08-07 |
| **Severity** | Low (cosmetic, self-correcting) |
| **Who it bites** | anyone sending a message from an impersonated seat |
| **Provenance** | Faithful — v5 dogfood walk (finding #71) |
| **Fix site** | `app/salon/[id]/hooks/useSSEStreaming.ts` — optimistic bubble resolves its author via `findActiveUserParticipant` (overlay-aware), matching the server; `impersonatingParticipantIds` threaded from `SalonView` |
| **v5 status** | **Owed** (Faithful) — mirror the optimistic-attribution reconciliation; retire `dogfood-findings.md` #71 |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-08-07).** The optimistic user bubble now resolves its author
through `findActiveUserParticipant` — the same overlay-aware helper the server
uses — instead of the bare `activeTypingParticipantId`, so the client guess and
the persisted row agree and the bubble no longer re-attributes on refetch.
`app/salon/[id]/hooks/useSSEStreaming.ts` gained an `impersonatingParticipantIds`
param (threaded from `SalonView`) and computes `optimisticAuthor` at the send
site. v5 obligation: mirror the reconciliation on the optimistic-attribution path
(`makeTempUserMessage`) and retire the `dogfood-findings.md` #71 faithful-repro
note. **Severity: Low (cosmetic, self-correcting).**

Original ruling below.

**OPEN.** Surfaced 2026-08-07 on a v5 dogfood walk of the Bug 44 overlay; v4
shares the code and the behaviour. **Severity: Low (cosmetic, self-correcting).**

### Symptom

While impersonating a character, a message you send first renders (optimistically)
attributed to your *own* default user character, then, when the server response
lands, re-renders attributed to the character you are impersonating — a visible
authorship jump on the just-sent bubble.

### Root cause

The optimistic user bubble is attributed to the raw `activeTypingParticipantId`
(`app/salon/[id]/hooks/useSSEStreaming.ts:648` — `participantId:
activeTypingParticipantIdRef.current`). The **server's** final attribution runs
through `findActiveUserParticipant(participants, activeTypingParticipantId,
impersonatingParticipantIds)` (`lib/services/chat-message/user-identity-resolver.service.ts:47`),
which is impersonation-aware. When `activeTypingParticipantId` does not already
point at the seat the server resolves the message onto — the ordinary case,
because `handleImpersonate` only sets `activeTypingParticipantId` when it was
previously empty (`chat.activeTypingParticipantId || participantId`), so
impersonating while you already have an active user seat leaves it pointing at
the old seat — the optimistic guess and the persisted row disagree, and the
refetch corrects the bubble. The two attribution paths (client-optimistic vs
server-authoritative) are simply not reconciled for the impersonation overlay.

### Why it survived

Cosmetic and self-correcting, and only visible during impersonation when the
active typing seat differs from the seat the server attributes the message to.
The port reproduces it exactly (v5 `makeTempUserMessage` uses the same
`activeTypingParticipantId`), which is how it was noticed (v5
`dogfood-findings.md` #71).

### The fix

Reconcile the optimistic attribution with the server's resolution — attribute the
optimistic bubble to the same seat `findActiveUserParticipant` would pick
(consulting `impersonatingParticipantIds`), not the bare `activeTypingParticipantId`.
A focused repro to pin the exact divergence (which seat each path chooses, for a
given `activeTypingParticipantId` + impersonation state) should precede the fix.

### Verification

Impersonate a character while an ordinary user seat is active, send a message, and
confirm the optimistic bubble is authored by the impersonated character from the
first paint (no re-attribution on refetch).
