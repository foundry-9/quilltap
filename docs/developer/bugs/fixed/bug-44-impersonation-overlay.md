# Bug 44 — Bug 27's fix chose the wrong mechanism: impersonation mutates `controlledBy` instead of overlaying it

| | |
|---|---|
| **Status** | Fixed in v4 (2026-08-07, v4-first) |
| **Found** | 2026-08-06 |
| **Fixed** | 2026-08-07 |
| **Severity** | Medium |
| **Who it bites** | anyone impersonating a seat — an abandoned session leaves the seat permanently user-controlled |
| **Provenance** | Human ruling (v5 finding #39, re-ruled) — v4-first |
| **Fix site** | `actions/participants.ts` — both writes + recompiles removed; shared `isUserDrivenSeat` in `lib/chat/turn-manager/utils.ts` consulted at attribution (`findActiveUserParticipant`, `findUserParticipantName`, `resolveUserIdentity`) + who-responds (`selectNextSpeaker`, `resolveRespondingParticipant` filter, `turn-orchestrator` pause, `turn.ts` skip); owner-seat readers keep the column; tests + API.md rewritten |
| **v5 status** | **v4-FIRST (inverse direction)** — v5 still mirrors the SHIPPED flips; absorbs this as a drift re-port (`salon_mutations` / `chat_cast_routes` / turn-chain families move; impersonation e2e re-gestures — Stop button returns to the card) |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED (2026-08-07, v4-first).** The mutate-and-restore mechanism is
replaced by the ruled overlay. `handleImpersonate`/`handleStopImpersonate`
(`app/api/v1/chats/[id]/actions/participants.ts`) no longer write
`controlledBy` or recompile identity stacks — `addImpersonation` /
`removeImpersonation` alone are the state change. A shared
`isUserDrivenSeat(participant, impersonatingParticipantIds)`
(`lib/chat/turn-manager/utils.ts`) is consulted at the two gates:
attribution (`findActiveUserParticipant`, `findUserParticipantName`,
`resolveUserIdentity`) and who-responds (`selectNextSpeaker` /
`buildResult`, the `llmCandidates` filter in `resolveRespondingParticipant`,
the `turn-orchestrator` pause, and `turn.ts`'s `skipUserTurn` gate). The
owner-seat readers (`findUserParticipant` / `userParticipantId`,
`isAllLLMChat`) deliberately keep reading the column, which heals the
hidden-Stop-button hole with no client change. The stop flow's
`newConnectionProfileId` arm is now a plain profile reassignment.
Regression tests rewritten to the overlay semantics
(`participants-impersonation.test.ts`, `turn-manager.test.ts`); API.md and
the CHANGELOG updated; transition data left alone per the ruling.

**Original ruling (OPEN. Ruled 2026-08-06, human, at the v5 port's
finding-#39 re-ruling): the overlay design stands; the mutate-and-restore
mechanism Bug 27's fix shipped is a mistake and is to be corrected here,
v4-first.** Bug 27's
DEFECT was real and stays fixed — "Speak as" must be honoured — but the
mechanism that fixed it (write `controlledBy:'user'` on impersonate,
write `'llm'` back on a profile-less stop) is the wrong one. Ruling
record: the v5 repo's `docs/developer/porting/status-log.md` → "Ruling —
the #39 impersonation mechanism"; the design it re-affirms is v5's
dogfood finding #39 (2026-07-29): *impersonation is a BEHAVIOR change,
not a state change — do not mutate the participant's `controlledBy` or
`connectionProfileId`.*

**Severity: Medium** — a design regression with one measured UX
casualty and a persisted-state-corruption class.

### What is wrong with the shipped mechanism, exactly

1. **It encodes a temporary mode by rewriting durable state.**
   `controlledBy` is seat OWNERSHIP — who this participant belongs to,
   durable across sessions. Impersonation is a temporary mode the chat
   already persists separately (`chats.impersonatingParticipantIds` +
   `activeTypingParticipantId`). Writing the mode into the ownership
   column forces a RESTORE arm, and restore arms have failure modes the
   overlay simply does not have:
   - a stop that never comes (browser closed, session abandoned
     mid-impersonation) leaves the seat **permanently user-controlled**
     — silent persisted corruption indistinguishable from a deliberate
     setting, discoverable only when the character mysteriously stops
     answering;
   - the profile-picking stop arm rewrites `connectionProfileId` too, so
     "hand it back" can land the seat on a **different profile** than it
     had before the impersonation ever started.
2. **Two sources of truth that can now disagree.** The same fact ("this
   seat is being spoken for by the human") lives in BOTH
   `impersonatingParticipantIds` and `controlledBy`. Any partial write,
   crash between the two updates, or future code path that touches one
   without the other mints a contradictory state neither reader expects.
3. **A measured UX casualty (2026-08-06, the v5 unification's e2e
   re-gesture).** The flip makes the impersonated character the chat's
   first present user-controlled participant in solo-shaped casts, so
   `findUserParticipant` (`lib/chat/turn-manager/utils.ts:73-80`)
   resolves the USER SEAT to *her*, and `ParticipantCard`'s
   `!isUserParticipant` gate (`components/chat/ParticipantCard.tsx:600`)
   hides the card's own Speak/Stop button — **stop-impersonate becomes
   unreachable from the card** in that shape, in both apps. The stop
   still works by verb, which is exactly the tell that the UI state
   model and the persisted state model have come apart.
4. **Collateral churn on every flip.** Because the seat itself moves,
   both actions must recompile every identity stack
   (`{{user}}`/`{{persona}}` shift for everyone), and every
   `userParticipantId`-derived feature — `isAllLLM`, the all-LLM pause
   opener, next-speaker resolution — changes meaning mid-conversation.
   Under the overlay none of that state moves, so none of it recomputes.

### What Bug 27 got right (keep all of it)

The defect diagnosis, the DELETE registration (Bug 25), the client
flow, and the requirement that attribution and turn-taking genuinely
honour the impersonated seat. The overlay preserves every one of those
outcomes; only the mechanism changes.

### The fix (the ruled overlay design)

1. **`handleImpersonate`** (`app/api/v1/chats/[id]/actions/
   participants.ts:61`): remove the `updateParticipant({controlledBy:
   'user'})` write and the `compileAllIdentityStacks` call (`:69-77`).
   `addImpersonation` alone is the state change.
2. **`handleStopImpersonate`**: remove the profile-less else-arm's
   `{controlledBy:'llm'}` write (`:120-131`) and its recompile
   (`:133-141`). `removeImpersonation` alone is the state change —
   there is nothing to restore, because nothing was disturbed. The
   profile-picking stop arm is now a SEPARATE concern (a deliberate
   seat reassignment, not part of stopping an impersonation): keep the
   dialog if the product wants it, but route it through the ordinary
   participant-update path so its semantics are the explicit ones.
3. **Widen the two gates** the #39 design names, so impersonation is
   honoured WITHOUT the column moving:
   - **message attribution** — `findActiveUserParticipant`
     (`lib/chat/turn-manager/utils.ts:99-107`): honour
     `activeTypingParticipantId` when that participant is
     `controlledBy === 'user'` **or** is in
     `impersonatingParticipantIds`;
   - **who-responds resolution** — the turn manager treats a
     participant in `impersonatingParticipantIds` as a user turn
     (excluded from LLM auto-response) regardless of `controlledBy`.
   Then audit the remaining `controlledBy === 'user'` readers and sort
   each by what it MEANS: "who owns this seat" keeps reading the column
   (`findUserParticipant` / `userParticipantId` — that stability is
   what heals the hidden-Stop-button hole with zero client changes);
   "who is typing right now" consults the overlay.
4. **Rewrite the Bug-27 regression tests to the overlay semantics** —
   `participants-impersonation.test.ts` (currently asserts the flips;
   should assert `controlledBy` UNCHANGED through impersonate → stop)
   and `turn-manager.test.ts:337-351` ("honours a formerly-LLM
   character once impersonation flips it to user-controlled" → once
   impersonation OVERLAYS it).
5. **Docs**: rewrite the `docs/developer/API.md` lines Bug 27's commit
   added ("Starting impersonation also flips the participant to
   `controlledBy: 'user'` …"); this entry and Bug 27's carry the
   correction.
6. **Transition** (the shipped window's residue): seats flipped by the
   old mechanism while an impersonation was ACTIVE at upgrade time stay
   `controlledBy:'user'` after the change (the overlay stop restores
   nothing). Already-stopped impersonations left no residue (the old
   stop arm restored them). Recommended disposition: **leave the data
   alone** and note it in the release notes — the exposure window is
   days old, and a one-time repair keyed on `id ∈
   impersonatingParticipantIds ∧ controlledBy === 'user'` cannot
   distinguish a legacy flip from a genuinely user-controlled seat that
   is currently impersonated, so a "repair" can corrupt the case it
   cannot see. The participant editor already fixes a stuck seat in one
   click.

### v5 coordination (the oracle note — sequencing is BINDING)

This change lands on differential-verified core turn resolution, so it
is **v4-first by design** (the inverse of the usual Faithful mirror
direction): v5 currently mirrors the SHIPPED flips exactly (its
P4.D53), and its `salon_mutations_equivalence` diffs the impersonate /
stop response bodies **plus the `chats` table dump** — participants
JSON and `compiledIdentityStacks` included — so this fix will move
`salon_mutations`, `chat_cast_routes`, and the turn-chain families the
moment it lands. Land it between v5 rounds and tell the port; v5
absorbs it as an ordinary drift re-port (its impersonation e2e beat
re-gestures back — the Stop button returns to the card). The multi-turn
"speak as" feature itself (v5 finding #39) remains post-5.0 and builds
on this corrected foundation.
