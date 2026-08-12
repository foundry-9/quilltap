# Bug 46 — impersonation and the composer turn banner don't reconcile; you can't tell who you're speaking as

| | |
|---|---|
| **Status** | Fixed in v4 (2026-08-07, v4-first design call: option (b) + new cue) |
| **Found** | 2026-08-07 |
| **Fixed** | 2026-08-07 |
| **Severity** | Low–Medium (confusing; you can post as the wrong character) |
| **Who it bites** | anyone impersonating a seat in a multi-character chat |
| **Provenance** | Faithful — v5 dogfood walk (finding #72) |
| **Fix site** | banner `app/salon/[id]/SalonView.tsx` now gates on `isUserDrivenSeat` (announces impersonated seats' own turns + Skip); new `app/salon/[id]/components/SpeakingAsAvatar.tsx` persistent "speaking as" cue left of the composer (bright when typable, dim while a reply is in flight) |
| **v5 status** | **Owed** (Faithful, v4-first) — light the banner via the overlay (the divergence v5 reverted), add the composer cue; retire `dogfood-findings.md` #72 |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-08-07).** Two changes, per the human's design call (option
(b) plus a new always-on cue):

1. **The turn banner is now overlay-aware.** `app/salon/[id]/SalonView.tsx`
   gates the user-turn banner on the shared
   `isUserDrivenSeat(participant, impersonatingParticipantIds)` helper instead of
   the bare `controlledBy !== 'user'` check, so when the rotation lands on an
   impersonated seat the banner announces *its* turn and offers Skip — the
   behaviour `help/chat-turn-manager.md` already described.
2. **A persistent "speaking as" avatar** (`app/salon/[id]/components/SpeakingAsAvatar.tsx`,
   rendered by `ChatComposer` via a new `speakingAs` prop) sits inside the
   composer, directly left of the action-button cluster and standing the full
   height of the composer row (hidden on the narrowest viewports). It is resolved
   via `findActiveUserParticipant` so it always names the seat a typed message
   will be attributed to, and renders bright when the human may type, dimming to
   near-dark while a reply is in flight — the on-screen cue whose absence (the
   `SpeakerSelector` hides below two controlled characters) was the core
   complaint.

v5 obligation: this is a v4-first design decision the port now mirrors — light
the banner for impersonated seats via the overlay (the divergence v5 briefly
took then reverted), add the composer-side cue, and retire the
`dogfood-findings.md` #72 faithful-repro note. Related to (but distinct from)
Bug 45. **Severity: Low–Medium (confusing; you can post as the wrong character).**

Original ruling below.

**OPEN.** Surfaced 2026-08-07 on a v5 dogfood walk of the Bug 44 overlay; v4
shares the code and the behaviour. Related to (but distinct from) Bug 45.
**Severity: Low–Medium (confusing; you can post as the wrong character).**

### Symptom

While impersonating a character X, the composer-area "user turn" banner announces
a **different** seat's turn — your usual user seat Y, whom the rotation actually
selected — while a message you type is attributed to **X**. You read "Y's turn,"
type expecting Y, and it comes out as X. There is no on-screen cue that you are
locked into speaking as X. (When it is X's *own* turn, the banner announces
nothing at all — see the related facet below — so you again can't tell it is your
turn to type as X, or Skip it.)

### Root cause

Two decoupled mechanisms:

- **The turn banner** (`app/salon/[id]/SalonView.tsx:1388-1396`) announces the turn
  only for a genuine user-controlled seat: `next.controlledBy !== 'user'` over the
  **non-overlaid** `participantData`. Bug 44's overlay leaves an impersonated seat
  at `controlledBy: 'llm'`, so the banner never announces an impersonated seat's
  turn, and it announces the genuine user seat's turn when the rotation lands
  there.
- **Message attribution** follows `activeTypingParticipantId` (who you are
  "speaking as"), which impersonation set to X (`handleImpersonate` →
  `chat.activeTypingParticipantId || participantId`). So on Y's turn, with
  `activeTypingParticipantId === X`, the message is attributed to X.

The two never reconcile, and the only widget that shows who you're speaking as —
the `SpeakerSelector` — renders solely when `controlledCharacters.length >= 2`
(`SalonView.tsx:1374`), so with a single genuine user seat plus impersonation
there is no "speaking as X" cue on screen at all.

### Related facet

Because the banner keys on the raw `controlledBy`, an impersonated seat's **own**
turn is never announced and offers no Skip in the composer either. (The v5 port
briefly "fixed" this by consulting the overlay in its banner, then reverted it as
a unilateral divergence — v4 is the reference and does not show it, so the port
must not either until v4 decides to.)

### Why it survived

Impersonation is a niche path, and the one cue that would disambiguate
(`SpeakerSelector`) is hidden in the common single-user-seat case.

### The fix

A design decision for v4. Options: (a) reflect who you are actually speaking as in
the banner and reconcile it with the turn; (b) announce the impersonated seat's
own turn (and offer Skip) via the overlay; and/or (c) scope impersonation's active
speaking seat to the impersonated seat's own turn, so a genuine user seat's turn is
not silently hijacked to the impersonated character. Whichever v4 picks, the v5
port mirrors it in a drift catch-up.

### Verification

Impersonate a character while your usual user seat is also present; when the
rotation lands on the usual seat, confirm the UI makes unmistakable which character
your typed message will be attributed to.
