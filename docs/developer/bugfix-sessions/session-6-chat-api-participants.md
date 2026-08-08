# Session 6 — Chat API state & participants (Bugs 22, 23, 24, 25, 27, 36, 37)

Seven bugs, one neighbourhood: chat GET projections, participant updates,
impersonation, and two dead client affordances. Heavy file overlap
(`app/api/v1/chats/[id]/handlers/*`, `ChatModals.tsx`, `SalonView.tsx`), which
is why they share a session. If the session runs long, the clean split point
is after Bug 25 (projections + impersonation first; 27/36/37 later).

Read the standing rules in [README.md](README.md). Full root causes:
`../bugs.md` → Bugs 22–25, 27, 36, 37. **All seven are Faithful** — no
tripwires; every fix owes a same-round v5 mirror. Bug 27 touches
differential-verified turn resolution: flag it loudest.

⚠️ These are Salon-adjacent client files — if the user is mid-chat in the dev
server, ask before editing (HMR discards typed input).

---

## Bug 22 — chat GET omits four controlled-select fields

**Severity: Medium.**

The GET projection (`app/api/v1/chats/[id]/handlers/get.ts` ~`:528`–`:568`)
omits `timelineMode` (Story's Clock), `alertCharactersOfLanternImages`,
`showThinking`, and `answerConfirmationOverride`, though
`app/salon/[id]/types.ts:253`–`:262` declares all four. Saves land; the
selects snap back to defaults and a reload never shows the truth.

**Fix:** add the four fields to the projection. Then verify each select
round-trips (save → reload → value shown). Check the TanStack Query cache
paths involved use `queryKeys.*` factories if any invalidation is touched.

---

## Bug 23 — a `controlledBy` patch returns early, skipping the identity recompile

**Severity: Medium.**

`handleParticipantUpdate` re-reads the chat and **returns** inside the
`controlledBy !== undefined` block (`helpers.ts:196`–`:199`), so the
status/`isActive` back-compat sync and `compileAllIdentityStacks(finalChat)`
below never run for such patches.

**Fix:** restructure so a `controlledBy` patch falls through to the shared
tail (sync + recompile) instead of returning early. Make sure the re-read
chat, not a stale copy, feeds the recompile. v5 pins the current behaviour as
`update_controlled_by_with_status_early_return` — that ruling gets re-ruled
when this lands (name it in the report).

---

## Bug 24 — `remove-participant` returns a stale chat

**Severity: Low.**

The impersonation clean-up `repos.chats.update` runs **after** `result.chat`
is captured, so the response still lists the removed participant in
`impersonatingParticipantIds`.

**Fix:** capture/return the chat from after the cleanup update (or re-read).
v5 diffs this as `remove_impersonating_promotes`.

---

## Bug 25 — "stop impersonating" is unreachable from v4's own client

**Severity: Medium.**

The client sends `DELETE ?action=stop-impersonate` (`useImpersonation.ts:94`,
`:121`); the action is registered only on the **POST** map
(`handlers/post.ts:129`), and the DELETE handler hard-rejects unknown actions
(`handlers/delete.ts:32`–`:35`).

**Fix:** register the action on the DELETE map (smaller blast radius than
changing the client; DELETE is also the semantically right verb). Keep the
POST registration if anything else could call it — check before removing.
After Bug 24's fix, verify the stop-impersonate response is also fresh.

---

## Bug 27 — "Speak as an AI character" is a dead affordance

**Severity: Medium.** ⚠️ Turn-resolution logic — differential-verified; v5
ports it faithfully and is explicitly waiting for the v4 decision.

"Speak as" is offered on **any** non-user participant
(`ParticipantCard.tsx:600`), but `findActiveUserParticipant`
(`turn-manager/utils.ts:99`–`:107`) honours `activeTypingParticipantId` only
when that participant is user-controlled — so the badge flips and the next
message still lands as the operator's own character. (The "You" badge at
`ParticipantCard.tsx:358` is also shown when impersonating.)

**Decide first, then implement.** Impersonation already exists as the
sanctioned mechanism for "operator speaks as an AI character" (Bugs 24/25 are
its plumbing). So:

1. **Investigate** whether the "Speak as" menu item was meant to be the
   impersonation entry point that never got wired (check `useImpersonation`'s
   start path and what the card's other menu items do).
2. **Preferred fix if the investigation supports it:** wire "Speak as" on a
   non-user participant to the start-impersonate flow, so attribution is
   honoured through the existing impersonation machinery. Fix the "You" badge
   so it reflects reality.
3. **Fallback (minimal correct fix):** restrict the affordance to participants
   attribution can honour (user-controlled ones), removing the dead option.
4. Record whichever call you make in `bugs.md`; if genuinely ambiguous
   after the investigation, stop and ask the user rather than guessing.

---

## Bug 36 — the "tools disabled by profile" warning box is dead code

**Severity: Low.**

`ChatModals.tsx` renders the warning when a participant profile has
`allowToolUse === false`, but `getConnectionProfile`
(`lib/services/chat-enrichment.service.ts:354`–`:379`) projects only
`{ id, name, provider, modelName, apiKey }` — the condition is always
`undefined === false`.

**Fix:** add `allowToolUse` to the enrichment projection so the box starts
working (v5 keeps a gated box + input ready for exactly this — do not delete
the box). Verify a chat whose profile forbids tools now shows it.

---

## Bug 37 — `AllLLMPauseModal` is unreachable; the pause is silent

**Severity: Low.**

The all-LLM pause fires and writes `isPaused`, but
`setAllLLMPauseModalOpen(true)` appears nowhere, and
`allLLMPauseTurnCount` / `isPaused` are not in the chat-GET projection — the
client is never told, so the room just stops.

**Fix:** make the modal reachable rather than deleting it (it exists, is
wired, and computes `nextPauseAt`):

1. Add `isPaused` and `allLLMPauseTurnCount` to the chat GET projection
   (same projection as Bug 22 — do them together).
2. Open the modal when the client learns the pause happened: on chat load with
   `isPaused` true, and live when the pause fires mid-session (check what the
   turn SSE stream already carries before inventing a new event — prefer an
   existing signal; the Salon's SSE transport itself is out of bounds for
   refactoring).

---

## Definition of done

- [ ] All seven fixes with regression tests failing pre-fix (route-handler
      tests for 22–25/36/37; a turn-attribution test for 27)
- [ ] Manual Salon pass: four selects round-trip (22); controlledBy change
      recompiles identities (23); stop-impersonate works end to end (24+25);
      "Speak as" does what the decision says (27); warning box and pause
      modal appear when provoked (36, 37)
- [ ] `npx tsc`, `npm run lint`, full `npm run test:unit` green
- [ ] Help docs checked for impersonation / pause / chat-settings pages —
      update where behaviour now matches the docs again or is newly visible
- [ ] `docs/CHANGELOG.md` entries; `bugs.md` Status rows flipped, with
      the Bug 27 decision recorded
- [ ] Final report: all seven are Faithful — same-round v5 mirrors owed;
      Bug 23's v5 ruling `update_controlled_by_with_status_early_return` and
      Bug 27's `chat_cast_routes_equivalence` coverage named explicitly
