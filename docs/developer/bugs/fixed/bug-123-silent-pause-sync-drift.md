# Bug 123 — a paused chat goes quiet without saying so, and the Salon cannot tell it is paused

| | |
|---|---|
| **Status** | Fixed in v4 (2026-09-05) |
| **Found** | 2026-09-05 |
| **Fixed** | 2026-09-05 |
| **Severity** | **Medium** (nothing errors and nothing is lost — the room simply stops answering: every message draws exactly one reply, nudges still work, the Skip button comes and goes, and the sidebar's Pause button reads *Pause* throughout. It presents as a mood, not a fault, and the only cure was a page reload the user had no reason to try) |
| **Who it bites** | any multi-character chat the server pauses twice without the client seeing an *unpaused* fetch in between — in practice, a provider that fails the same way on two chained turns a few minutes apart, which is exactly how a flaky provider fails |
| **Provenance** | Live (Friday, chat `51d2281d` *The Telling at the Table*, 2026-09-06 00:59 and 01:03 UTC). Reported by the user as "I can't get more than one message out of anybody… like it's paused, but it doesn't claim to be. And for more than half of my turns, the skip button isn't showing up" |
| **Fix site** | `app/salon/[id]/hooks/useChatControls.ts` (reconcile on every fetch; `setPauseState` updates the fetched chat) + `lib/services/chat-message/turn-orchestrator.service.ts` (the paused early-return announces itself; `paused` on every chain-complete) + `app/salon/[id]/hooks/useSSEStreaming.ts` (the pause is told to the user) + `app/salon/[id]/SalonView.tsx` and `hooks/useTurnManagement.ts` (Skip is offered for whatever seat the human can type as) |
| **v5 status** | **Applies.** Any port that keeps a server-side pause flag and mirrors it into a client that reacts only to *transitions* of the fetched value inherits the drift exactly; any port whose chain guard returns without an event inherits the silence. Port the two rules — reconcile on every fetch, never stop a chain without saying why — rather than v4's pre-fix shape |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-09-05).** Three changes, one per layer. The Salon now
reconciles its pause flag with the server's on every fetch (and the local toggle
updates the fetched chat object too, so the two can never disagree between
fetches). The turn chain never stops on a paused chat silently: the early-return
emits the same `paused` chain-complete a mid-chain pause does, every
chain-complete now carries a `paused` flag, and the client toasts a pause it did
not cause itself (an all-LLM room keeps its modal instead). And the Skip button
is offered whenever the composer will take words as a seat — the user's own
character or one they are impersonating — not only when the rotation has
formally landed on it; skipping lifts a pause first, the way a nudge does.

### Symptom

At 00:59:16 UTC a chained turn for Laura failed: her NanoGPT GLM 5.3 Flash
profile errored, both understudies returned empty, and the fallback chain was
exhausted. The chain-error handler paused the chat as its safety stop. The
client learned of it (the chain-complete triggered a refetch), the sidebar
button read *Resume*, and at 00:59:28 the user pressed it.

At 01:03:42 the same thing happened again, one turn into the next chain. This
time the sidebar kept reading *Pause*. From then until the user gave up at
02:30, every message they sent drew exactly one reply, after which the room fell
silent. Nudging a character produced one more turn, then silence again. The
Skip banner above the composer appeared on roughly a third of turns and was
absent on the rest. Nothing in the UI said the chat was paused. The log for the
hour contains not one `[TurnOrchestrator]` line for the chat.

### Root cause

Three defects stacked.

**1. The client's pause sync only fires on a transition of the fetched value.**
`useChatControls.ts:159`:

```ts
useEffect(() => {
  if (chat?.isPaused !== undefined) setIsPaused(chat.isPaused)
}, [chat?.isPaused, setIsPaused])
```

and the Resume button's `setPauseState` flipped the local flag and persisted it
but never touched the fetched `chat` object. So after 00:59:28 the client held
`isPaused = false` locally while `chat.isPaused` still read `true` from the
00:59:16 refetch. The next turn (Friday's, 01:03:32) was a "nothing to add"
pass, and the skipped-turn branch of the done handler does not refetch. When the
01:03:42 error re-paused the chat and the chain-complete *did* refetch, the
fetched value went `true → true`. No transition, no effect, and the local flag
stayed `false` — forever, because every later refetch returned `true` as well.
Every subsequent nudge and Skip therefore ran with a client that believed the
chat was live, so none of them sent the unpause the nudge path performs when it
*knows* the chat is paused; the log shows no chat PUT for the chat after 01:04.

**2. The chain guard returns on a paused chat without an event or a log line.**
`turn-orchestrator.service.ts:322`:

```ts
if (!initialResult.isMultiCharacter || (!initialResult.hasContent && !initialResult.skipped) || initialResult.isPaused) {
  return
}
```

A mid-chain pause decision emits `chainComplete { reason: 'paused' }`; the
initial-turn guard emits nothing. So a user message on a paused chat produced one
reply and a closed stream, the client's turn state was never refreshed, and there
was nothing in the log to find.

**3. The Skip banner is keyed on whose turn the *client* thinks it is.**
`SalonView.tsx` showed the banner only when `turnSelectionResult.nextSpeakerId`
resolved to a user-driven seat. That value is recomputed from history after each
reply; with four LLM seats and one human seat it lands on the human's seat only
sometimes. When it lands on an LLM seat the banner is hidden — and, with the chat
paused, that LLM never speaks either. The user saw the button vanish on exactly
the turns where nothing was going to happen. (`handleSkipUserTurn` also refused
any seat whose durable `controlledBy` was not `'user'`, so an impersonated seat
could never be skipped from the client even though the server's `skipUserTurn`
accepts one.)

### Why it survived

Bug 37 fixed the *first* silent pause — the all-LLM threshold that wrote
`isPaused` and told nobody — by projecting the flag and adding a modal opener
keyed on `chat.isPaused`. That fix, and the sync effect beside it, both assumed
the fetched value would *change* whenever the server's did. It does, unless the
client changed its own copy in between; nothing tested a pause → local resume →
server re-pause sequence. The chain-error pause was added later as a safety stop
and reused the same flag without reusing bug 37's announcement. And the early
return at the top of `executeTurnChain` predates the chain-complete event; it
was never given one because for a long time nothing observable depended on it.

### The fix

- **`useChatControls.ts`** — the sync effect keys on `chat` (replaced wholesale
  by every fetch) rather than `chat?.isPaused`, so each fetch reconciles; a
  same-value set is a no-op for React. `setPauseState` also writes the new
  value into the fetched chat via `setChat`, so the two can never disagree
  between fetches.
- **`turn-orchestrator.service.ts`** — the paused early-return logs, persists a
  null turn participant, and emits `chainComplete { reason: 'paused', paused:
  true }`, ordered *after* the `singleTurn` check so the autonomous runner's
  lifecycle is untouched. Every chain-complete carries `paused` (true for a
  `paused` decision and for the chain-error safety stop, false for an
  empty-response stop), because `reason: 'error'` alone cannot say whether the
  chat was paused.
- **`useSSEStreaming.ts`** — `announceChainPause` toasts a `paused` stop the
  user did not cause (a ref mirrors `isPaused` so the check is not a stale
  closure), with error-specific wording when a turn failed; suppressed in an
  all-LLM room, where the bug 37 modal explains the stop.
- **`SalonView.tsx` / `useTurnManagement.ts`** — the banner is keyed on the seat
  the composer will attribute a typed message to (`findActiveUserParticipant`,
  honouring the impersonation overlay), and its wording says whether it is
  formally that seat's turn. `handleSkipUserTurn` reads `isUserDrivenSeat`
  rather than the bare column, lifts a pause first as `handleNudge` does, and
  does not hand the floor to another seat the human drives. The must-speak
  guard is unchanged and still the only thing that withholds the button.

### How to verify

Unit: `turn-orchestrator.test.ts` — *announces a paused stop when the INITIAL
result is paused*, *flags a mid-chain paused decision as paused*, *does not flag
an empty-response error stop as paused*, and the chain-error case now asserts
`paused: true`. `useTurnManagement.test.ts` — the new `handleSkipUserTurn`
block (user-owned seat, impersonated seat, refused LLM seat, unpause ordering).
`useChatControls.pause-sync.test.tsx` — the exact drift: fetched paused → local
Resume → fetched paused again re-syncs.

Live: in a multi-character chat, press Pause, send a message. One reply, then a
toast saying the chat is paused and the sidebar reads *Resume*. Point a
character at a profile that fails; when its chained turn errors, the same toast
with the failure wording, and *Resume* — press it and the next message chains.
Impersonate a character: the Skip banner is present whenever the composer is,
worded for whose turn it is, and Skip hands the floor to an LLM seat.
