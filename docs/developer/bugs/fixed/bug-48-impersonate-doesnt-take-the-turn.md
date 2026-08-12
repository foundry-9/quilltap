# Bug 48 — impersonating a character does not hand them the current turn

| | |
|---|---|
| **Status** | **FIXED in v4** |
| **Found** | 2026-08-08 |
| **Fixed** | 2026-08-08 |
| **Severity** | Low–Medium (confusing; you opt to speak as a character but it is still someone else's turn) |
| **Who it bites** | anyone who impersonates a character mid-conversation while a *different* seat's turn is active |
| **Provenance** | Faithful — v5 dogfood walk (the impersonation Part B pass) |
| **Defect site** | `app/api/v1/chats/[id]/actions/participants.ts` (`handleImpersonate` → `addImpersonation`) + `app/salon/[id]/hooks/useImpersonation.ts` — impersonation writes `impersonatingParticipantIds` / `activeTypingParticipantId` but never touches turn selection |
| **Fix site** | `app/salon/[id]/SalonView.tsx` (`handleImpersonateAndTakeTurn`) — moves the current turn to the newly impersonated seat |
| **v5 status** | Faithful in v5 (`api/salon.rs` `chat_impersonate` → `add_impersonation`; the turn is queried separately and unchanged). Recorded on the v5 side as `dogfood-findings.md` (the Part B walk); absorb the fix as drift |
| **Index** | [bugs.md](../bugs.md) |

---

**FIXED in v4 (2026-08-08).** Starting an impersonation now hands the current
turn to the newly impersonated seat. Rather than touch the server-side turn
persistence (a far riskier change in this already-delicate area), the fix wraps
the client's impersonation start in `SalonView.tsx`'s
`handleImpersonateAndTakeTurn`: after `handleStartImpersonation` resolves, and
**unless an LLM is mid-generation** (`streamingRef.current`), it moves the client
turn to the impersonated participant
(`setTurnSelectionResult({ nextSpeakerId, reason: 'queue', … })`). This is a
client presentation of the rotation — the same shape `turnSelectionResult`
already holds, recomputed from history once a message is sent — so the banner now
names the impersonated seat and, via the [Bug 49](bug-49-speaking-as-doesnt-follow-the-turn.md)
follow, the composer speaks as it, so a typed message lands in turn. Both entry
points (the cast card's `onImpersonate` and the all-LLM take-over) route through
the wrapper. **Design calls settled:** move the turn on impersonate *unless* an
LLM is streaming; do not persist the turn move server-side; "stop impersonating"
does not restore the displaced turn (the rotation recomputes from history on the
next message). Designed together with Bug 49. **v5 owes a drift catch-up.**

---

**Surfaced 2026-08-08** on the v5 dogfood walk of the impersonation
surface. v4 shares the code and the behaviour. **Severity: Low–Medium.**

### Symptom

You are in a multi-character chat and it is another user seat's turn — the
composer turn banner reads *"Charlie's turn — type as them, or skip …"*. You
open the cast card and impersonate an LLM character, Lorian. The speaking-as
portrait immediately flips to Lorian (you are now speaking *as* Lorian), but the
banner **keeps saying "Charlie's turn."** Opting to take over Lorian did not make
it Lorian's turn. To actually voice Lorian in turn you must wait for the rotation
to come round to Lorian; meanwhile anything you type on Charlie's turn is
attributed to Lorian, out of turn.

The natural expectation is the opposite: *"I just chose to take over Lorian, so
it should be Lorian's turn now."*

### Root cause

Impersonation and turn selection are **two decoupled mechanisms** (the same
decoupling behind Bugs 45 and 46). Impersonating a seat changes:

- **who you speak as** — `activeTypingParticipantId`, and
- **whether that seat's own turns are user-driven** — its id joins
  `impersonatingParticipantIds`, so `selectNextSpeaker` marks *its* turn as a
  user turn (`isUserDrivenSeat`).

It does **not** change **whose turn it currently is**. `handleImpersonate` →
`addImpersonation` (`app/api/v1/chats/[id]/actions/participants.ts:64`) writes
only those two fields; it never touches the turn state (`nextSpeakerId`,
`lastTurnParticipantId`, the queue). The rotation continues from exactly where it
was, so a turn that had already landed on Charlie stays Charlie's — the banner is
correct about the rotation, just not about what you meant to do.

### Why it survived

The mismatch is invisible in the common cases: impersonating when it is already
the impersonated seat's turn, or in an all-LLM room where there is no competing
user seat. It only shows when you impersonate a character while a *different*
user seat's turn is live — a niche path, and the one the Bug 45/46 work was
already circling.

### The fix

A design decision for v4. The expected behaviour is that starting an
impersonation **hands the current turn to the newly impersonated seat**: set the
active turn to that participant (a user turn it can fulfil immediately) so the
banner reads "Lorian's turn" and a typed message lands in turn. Points to settle:

- Whether to move the turn only when the current turn is a *user* seat (so an
  LLM mid-generation is not interrupted), or always.
- How this reconciles with the queue / `lastTurnParticipantId` so the rotation
  resumes sensibly after you stop impersonating.
- Whether "stop impersonating" should restore the turn it displaced.

Whichever way v4 goes, the v5 port mirrors it in a drift catch-up.

### Verification

In a multi-character chat, on another user seat's turn, impersonate an LLM
character. Confirm the turn banner now announces the impersonated character's
turn (and a typed message is attributed to it, in turn), rather than staying on
the previously selected seat.

### v5 coordination

v5 reproduces this faithfully: `chat_impersonate`
(`crates/quilltap-core/src/api/salon.rs`) calls `add_impersonation`, which writes
`impersonatingParticipantIds` + `activeTypingParticipantId` and nothing else; the
turn is queried through a separate `chatTurnAction` and is untouched by
impersonation. When v4 moves the turn on impersonate, v5 absorbs it in a drift
catch-up.
