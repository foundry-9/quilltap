# Bug 27 — "Speak as an AI character" is a dead affordance

| | |
|---|---|
| **Status** | Fixed in v4 (2026-08-06; mechanism corrected by Bug 44, 2026-08-07) |
| **Found** | 2026-08-06 |
| **Fixed** | 2026-08-06 |
| **Severity** | Medium |
| **Who it bites** | multi-character chats |
| **Provenance** | Faithful |
| **Fix site** | `app/api/v1/chats/[id]/actions/participants.ts` — ~~`handleImpersonate`/`handleStopImpersonate` flip `controlledBy` (`user` ⇔ `llm`) + recompile stacks~~ **superseded**: impersonation now overlays the seat (see Bug 44); the defect stays fixed, the mechanism changed |
| **v5 status** | **Owed** (Faithful) — the v4 decision `chat_cast_routes_equivalence` was waiting for; the overlay correction re-ports with Bug 44 |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-08-06) — decision: the preferred path (wire "Speak as"
through impersonation, honoured for real).**

> **⚠ MECHANISM CORRECTION RULED (2026-08-06) — see [Bug 44](bug-44-impersonation-overlay.md).**
> The defect this entry describes stays fixed, but the mechanism below
> (flipping `controlledBy` and restoring it on stop) was ruled a mistake at
> the v5 port's finding-#39 re-ruling: impersonation is to be honoured by
> OVERLAYING the already-persisted impersonation state at the two gate
> sites, never by mutating the seat's `controlledBy`/`connectionProfileId`.
> The "intended design is `impersonate ⇔ controlledBy: 'user'`" inference
> below is the part the ruling overturns.

*Investigation.* "Speak as" was already wired to the impersonation start path
(`onImpersonate` → `POST ?action=impersonate` → `addImpersonation`), but
`addImpersonation` never flipped `controlledBy`. The connection-profile "User
(you type)" option, by contrast, goes through `handleParticipantUpdate`, which
**couples** `controlledBy: 'user'` ⇔ impersonation. And the client's
stop-impersonate flow prompts for an LLM profile to hand the character back —
which only makes sense if starting impersonation had made the character
user-controlled. So the intended design is `impersonate ⇔ controlledBy: 'user'`;
the impersonate **action** simply forgot to flip it. This was not genuinely
ambiguous, so the preferred fix was taken (no user prompt needed).

*Fix.* `handleImpersonate` now sets the participant to `controlledBy: 'user'`
(and `handleStopImpersonate` hands it back to `'llm'`), restoring that invariant.
Both recompile the identity stacks (`controlledBy` alters `{{user}}`/`{{persona}}`
for everyone). This leaves the differential-verified `findActiveUserParticipant`
**untouched** — attribution now works because the seat is genuinely
user-controlled while impersonated, and the "You"/"Speaking as" badge becomes
truthful without further change. Pinned by `participants-impersonation.test.ts`
(the action flips control) and `turn-manager.test.ts` ("honours a formerly-LLM
character once impersonation flips it to user-controlled"). v5 obligation
(**Faithful**): mirror in the same round; this is the v4 decision that
`chat_cast_routes_equivalence` was waiting for.

**Severity: Medium** — the UI offers an action it does not perform.

### Symptom

Click "Speak as &lt;AI character&gt;". The card flips to a "You" badge, but the
next message you type still lands as your existing user-controlled character.

### Root cause

"Speak as" is offered on **any** non-user participant
(`ParticipantCard.tsx:600`, `!isUserParticipant`), but attribution goes through
`findActiveUserParticipant` (`turn-manager/utils.ts:99`–`107`), which honours
`activeTypingParticipantId` **only** when that participant is
`controlledBy === 'user'`, else falls back to the first user-controlled seat. So
selecting an AI character changes the badge and nothing else. (The misleading
"You" badge is also v4 — `ParticipantCard.tsx:358` shows it for user-controlled
participants *or when impersonating*.)

### The fix

Either restrict the "Speak as" affordance to participants attribution can honour,
or extend `findActiveUserParticipant` to impersonate the chosen character. This
touches differential-verified turn resolution, so v5 ports it faithfully and
waits for the v4 decision (covered by `chat_cast_routes_equivalence`).
