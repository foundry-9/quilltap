# Bug 50 — the sole LLM answers every human turn when you drive two seats

| | |
|---|---|
| **Status** | **FIXED in v4** |
| **Found** | 2026-08-08 |
| **Fixed** | 2026-08-08 |
| **Severity** | Medium (turn rotation is unfair; a single LLM gets half the turns) |
| **Who it bites** | anyone driving two or more seats (own character + impersonated, or two owned) in a room with exactly one LLM |
| **Provenance** | Faithful — human dogfood (a real multi-character roleplay), not the differential harness |
| **Defect site** | `lib/services/chat-message/participant-resolver.service.ts:125` (`resolveRespondingParticipant` — the first responder is drawn from an **LLM-only** candidate list, bypassing the full rotation) |
| **Fix site** | `lib/chat/turn-manager/selection.ts` (`selectNextSpeakerAfterUserMessage`) + `lib/services/chat-message/orchestrator.service.ts` (`maybePauseForUserSeatTurn`) |
| **v5 status** | Owed (Faithful) — v5 shares the two-path selection; absorb the fix as drift |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-08-08).** The first responder after a human post now honours
the same full rotation the chained turns use, and pauses for another user-driven
seat instead of forcing the sole LLM to answer. See "The fix" below. Regression
tests: four cases in
[`__tests__/unit/lib/chat/turn-manager.test.ts`](../../../../__tests__/unit/lib/chat/turn-manager.test.ts)
(`selectNextSpeakerAfterUserMessage — fair rotation with 2+ user-driven seats`).
**v5 owes a drift catch-up** (the fix moves the oracle baseline).

**Verified in Friday (2026-08-08)** on a real Charlie/Lorian(impersonated)/Kumar
room: with the fix live, the guard logs `userDrivenSeatCount: 2` and pauses for
the other user seat when the rotation lands there (Charlie→Lorian→Kumar→Lorian→
Charlie…), instead of Kumar answering every turn.

**Two supporting fixes were needed for the end-to-end behaviour**, found while
verifying this one:

- **Seat-count correctness (in this fix).** The pause guard first counted
  user-driven seats via `getActiveCharacterParticipants`, which — despite the
  name — returns **LLM seats only**, so a genuine `controlledBy: 'user'` seat was
  never counted and the guard saw `1` instead of `2` and silently bailed. It now
  filters the full roster.
- **[Bug 51](bug-51-chat-get-omits-impersonation-state.md)** (GET omitting
  `impersonatingParticipantIds` / `activeTypingParticipantId`) plus the
  once-only re-sync of the persisted speaking-as, without which the composer
  stuck on one seat and that seat "hogged" every turn even with the rotation
  correct.

---

### Symptom

In a multi-character chat where the human drives **two** seats and there is
**exactly one** LLM — the reported case: you play Charlie, impersonate Lorian, and
Kumar is the AI, all at 0.5 talkativeness — the rotation is not random. It runs

```
Charlie → Kumar → Lorian → Kumar → Charlie → Kumar → Lorian → Kumar → …
```

Kumar takes **every other turn** (half of them) while the two human seats split
the rest (a quarter each), instead of the fair third each you'd expect from a
weighted-random rotation with equal talkativeness.

### Root cause

There are **two different speaker-selection paths**, and they disagree:

1. **Chained turns** (after an LLM speaks) go through `selectNextSpeaker` over
   **all** participants — a fair weighted rotation with a no-back-to-back guard and
   a spoken-this-cycle filter. This path is correct.
2. **The first responder after the human posts** goes through
   `resolveRespondingParticipant`
   (`lib/services/chat-message/participant-resolver.service.ts:125`), which builds
   an **LLM-only** candidate list — it deliberately excludes every user-driven seat
   (both genuine `controlledBy: 'user'` seats and impersonated ones, via
   `isUserDrivenSeat`). With exactly one LLM present, that list is always
   `{Kumar}`, so **Kumar answers after every message the human types**, regardless
   of whose turn the rotation actually says it is.

So the sequence is forced, not random:

- Human posts as Charlie → first responder is LLM-only → **Kumar** (always).
- Chain continues → full rotation picks the only unspoken seat → **Lorian** →
  pauses for the human.
- Human posts as Lorian → first responder is LLM-only → **Kumar** (always).
- Chain continues → **Charlie** → pauses for the human.

The full rotation only ever governs the turns *between* Kumar's forced responses,
so the human seats can never follow one another and Kumar is sandwiched between
every pair.

### Why it survived

The LLM-only shortlist is exactly right for the overwhelmingly common shape — one
human plus one or more LLMs — where "when the human posts, an LLM answers" is the
whole point, and with a single user seat there is no *other* human seat for the
rotation to land on. The defect only appears with **two or more user-driven
seats** in the room, which needs either two genuinely user-controlled characters
or (far more commonly) one owned seat plus an impersonated one — a niche the
impersonation work (Bugs 44–49) was already circling.

### The fix

The first responder after a human post must obey the **same full rotation** the
chained turns use. When that rotation's next speaker is another seat the human
drives, the floor is theirs: persist the message and **pause for that seat** (the
client shows its turn banner) rather than forcing the LLM to speak out of turn.

- **`selectNextSpeakerAfterUserMessage`** (`lib/chat/turn-manager/selection.ts`) —
  a pure helper that projects the rotation one step past the human's just-typed
  message. The first-responder decision happens *before* the message is written to
  history, so `calculateTurnStateFromHistory` would still resolve to the poster
  (whose turn it currently is), not the seat that follows. The helper advances the
  persisted cycle exactly the way the write will (reusing
  `computeSpokenThisCycleAfterMessage`, so the projection and the eventual
  persisted state agree), sets the poster as `lastSpeakerId`, and runs
  `selectNextSpeaker` over **all** participants.
- **`maybePauseForUserSeatTurn`** (`lib/services/chat-message/orchestrator.service.ts`)
  — a guard at the top of `processMessage`, before any responder is resolved. On a
  fresh, non-whisper, non-nudge, multi-character send where the human drives 2+
  seats, it consults the helper. If the next speaker is user-driven, it saves the
  user message (which advances the persisted cycle via `addMessage`), fires any
  inline `@Name` Carina queries, persists `lastTurnParticipantId`, emits a
  `chainComplete` `user_turn` event, and returns a terminal `hasContent: false`
  result so the turn chain does not run. Otherwise it returns `null` and the normal
  generation path proceeds untouched.

**Design calls settled:** pause for the other user seat (a true fair rotation
across all seats), rather than skipping to the next LLM; the common single-user-
seat room is completely unaffected (the guard returns `null` before any DB read);
whispers, nudges, an explicit responding participant, and continue-mode turns all
bypass the guard because they name their own speaker.

### Verification

In a multi-character chat, play one character and impersonate a second, with a
single LLM present, all at equal talkativeness. Exchange several turns and confirm
the rotation is a fair weighted mix — the LLM no longer appears on every other
turn, and when the rotation lands on your other driven seat the composer pauses
with that seat's banner instead of the LLM answering.

### v5 coordination

v5 shares the two-path selection (an LLM-only first-responder shortlist plus a
full-rotation chain), so it reproduces this faithfully. When v5 absorbs the fix,
it mirrors `selectNextSpeakerAfterUserMessage` and the pause guard, and the two
sides converge.
