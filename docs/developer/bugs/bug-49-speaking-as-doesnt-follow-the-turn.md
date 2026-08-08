# Bug 49 — the speaking-as seat does not follow the current user-driven turn

| | |
|---|---|
| **Status** | **OPEN** |
| **Severity** | Low–Medium (confusing; on an impersonated seat's own turn you default to the wrong character) |
| **Found** | 2026-08-08 |
| **Who it bites** | anyone impersonating a character in a multi-character chat, when the rotation reaches the impersonated seat's turn |
| **Provenance** | Faithful — v5 dogfood walk (the impersonation Part B pass) |
| **Defect site** | `app/salon/[id]/hooks/useImpersonation.ts` — `activeTypingParticipantId` is set only by the impersonate/stop/select handlers and the chat-sync effect (`:37`); nothing reconciles it with the current turn |
| **v5 status** | Faithful in v5 (`salon-conversation.ts` `activeSpeakerId` = the persistent speaking-as selection, with no turn coupling). Recorded on the v5 side as `dogfood-findings.md` (the Part B walk); absorb when v4 fixes it |
| **Index** | [bugs.md](../bugs.md) |

---

**OPEN.** Surfaced 2026-08-08 on the v5 dogfood walk. v4 shares the code and the
behaviour. The **sibling of [Bug 48](bug-48-impersonate-doesnt-take-the-turn.md)** —
both are facets of the turn ↔ speaking-as decoupling for impersonated seats.

### Symptom

In a multi-character chat you are impersonating Lorian, and at some point you are
speaking as your own character, Charlie (the composer cue reads *"Speaking as
Charlie"*). The rotation comes round to **Lorian's** turn — the banner reads
*"Lorian's turn — type as them, or skip …"* — but the speaking-as seat **stays on
Charlie.** On the impersonated character's *own* turn, the composer defaults you
to the wrong character; a message typed now goes to Charlie, not Lorian, unless
you first switch the Speaking-As selector back to Lorian by hand.

The natural expectation: when the current turn is a seat you are driving, the
composer should default to speaking *as that seat* — Lorian's turn → speak as
Lorian; Charlie's turn → speak as Charlie.

### Root cause

`activeTypingParticipantId` (who you speak as) and `nextSpeakerId` (whose turn it
is) are independent. Impersonation makes **more than one** seat user-driven
(your own Charlie plus the impersonated Lorian), so on any given user turn the two
can disagree. Nothing reconciles them: `setActiveTypingParticipantId` is called
only by the impersonate / stop / set-active-speaker handlers and the chat-sync
effect (`useImpersonation.ts:37`, syncing from `chat.activeTypingParticipantId`).
There is no effect that, when the turn lands on a user-driven seat, defaults the
speaking-as to that seat. So the last-set value (Charlie) persists across a turn
that is actually Lorian's.

### Why it survived

Same niche as Bugs 45/46/48: it only appears with an impersonated seat *and* a
second user-driven seat *and* the rotation reaching the impersonated one while
you happen to be speaking as the other. The Speaking-As selector does let you fix
it by hand (Bug 46b / the v5 dogfood #77 fix), so it reads as a rough edge rather
than a hard failure.

### The fix

A design decision for v4. The expected behaviour is that when the current turn is
a user-driven seat, the composer defaults the speaking-as to **that** seat, so on
Lorian's turn you are speaking as Lorian without a manual switch. Points to
settle (they overlap with Bug 48 — the two are best designed together):

- **Default vs. override.** Auto-follow the turn only when the human has not made
  an explicit contrary choice this turn, or always? A hard override would fight a
  deliberate out-of-turn choice.
- **Which seats.** Follow for any user-driven seat (owner or impersonated), so
  Charlie's turn → Charlie and Lorian's turn → Lorian.
- **Persistence.** Whether the follow updates `activeTypingParticipantId` on the
  record (persisted) or is a per-turn presentation default.

Whichever way v4 goes, the v5 port mirrors it in a drift catch-up.

### Verification

In a multi-character chat, impersonate a character, then switch the Speaking-As
selector to your own character. Let the rotation reach the impersonated
character's turn. Confirm the composer defaults to speaking as the impersonated
character (not your own), and a typed message is attributed to it, in turn.

### v5 coordination

v5 reproduces this faithfully: `activeSpeakerId`
(`apps/web/src/app/screens/salon/salon-conversation.ts`) resolves the persistent
speaking-as selection (`activeSpeakerOverride ?? activeTypingLocal ??
chat.activeTypingParticipantId`) with no coupling to the turn query. When v4
teaches the speaking-as to follow the user-driven turn, v5 absorbs it in a drift
catch-up (alongside Bug 48).
