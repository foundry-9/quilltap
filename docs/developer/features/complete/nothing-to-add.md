# "Nothing to add" turn-skipping in multi-character Salon chats

All paths relative to `/Users/csebold/source/quilltap-server`.

## Context

In multi-character Salon chats, every selected speaker currently *must* produce a reply, which forces filler when a character genuinely has nothing to contribute. This feature gives every LLM character — on every turn except the very first character turn of the chat — a per-turn prompt option to pass by replying with a sentinel. A pass is announced by the Host ("{name} has nothing to add"), and the rotation continues to the next speaker. The prompt also warns a character who has been directly addressed since they last spoke that they should answer rather than pass.

User-confirmed decisions:
- Skip-exempt turn = **the very first character turn of the whole chat** only.
- **Per-chat setting, default ON** (`turnSkippingEnabled`, NULL/true = on).
- **Autonomous rooms included**; a skip consumes a turn from the run budget (already true — `runTurnsConsumed` increments unconditionally per job).
- **Stall guard**: when every other active character has passed since the last substantive message, the next speaker is forced to speak (skip option withheld). Same rule powers the user-driven case: if a user-driven character was the last real speaker and the rotation returns to them because everyone else passed, the Salon Skip button is disabled and `skipUserTurn` is rejected server-side.

## Key code facts (verified)

- Turn algorithm: `lib/chat/turn-manager/selection.ts` — `selectNextSpeaker` excludes `lastSpeakerId` in **both** the normal pick (line 70) and the cycle wrap (lines 86–88). `calculateTurnStateFromHistory` (`lib/chat/turn-manager/state.ts:53-64`) derives `lastSpeakerId` from the most recent non-whisper USER/ASSISTANT message with a `participantId`. **Consequence:** if passes didn't advance `lastSpeakerId`, the last substantive speaker would be permanently unpickable while others ping-pong passes — so Host turn-pass records must advance the derived `lastSpeakerId`.
- Live chain: `lib/services/chat-message/turn-orchestrator.service.ts` — `executeTurnChain` has **two** stop gates that treat no-content as terminal: entry (line 298) and in-loop (line 364). Both must admit a `skipped: true` result and continue.
- Reply branch point: `lib/services/chat-message/orchestrator.service.ts:1408` — non-empty `fullResponse` → `finalizeMessageResponse`, else empty-response branch (nothing persisted, SSE `done` with `emptyResponse: true`). Sentinel detection goes immediately before this gate, after `flushPendingWardrobeAnnouncements` (line 1406).
- Host messages: `lib/services/host-notifications/writer.ts` `postHostMessage(chatId, content, opaqueContent, kindLabel, hostEvent)` (~line 212); `systemKind` is a **free string** (no enum/export-schema change); `hostEvent: {participantId?}` validates and persists (chat_messages.hostEvent). `systemSender` stays `'host'` — no avatar/schema/column work.
- Prompt injection: `lib/chat/context-manager.ts` `buildContext`; `trailingContextSections` (~lines 2028–2047) **only fires when `newUserMessage` exists** — chained/continue turns have none, so the instruction must alternatively be pushed as a trailing `role: 'user'` context message (off-scene/timestamp pattern, ~lines 1741–1779). Nothing persisted.
- Client: `app/salon/[id]/hooks/useSSEStreaming.ts` appends non-empty `fullContent` as a bubble in **four** handlers (send-path `onDone` ~676 / `onIntermediateDone` ~733; continue-path ~879 / ~905) — each needs a `data.skipped` guard or the sentinel becomes a phantom bubble. `hostEvent` is currently **not** projected to the client (`app/api/v1/chats/[id]/handlers/get.ts` ~416) and must be added for the client-side Skip-button guard.
- Autonomous path reuses the same `handleSendMessage` (`lib/background-jobs/handlers/autonomous-room-turn.ts`, `singleTurn: true`, one turn per job); next-speaker selection happens in the next job after buffered writes flush — no read-your-writes hazard. `drainStream` ignores new SSE events.
- Nudge vs chain vs autonomous turns are currently indistinguishable server-side (`continueMode: true` + `respondingParticipantId`) — an explicit `nudge` flag must be threaded; queue-popped chain selections need a `selectionReason` threaded into `processChainedMessage`.

## Design

- **Sentinel:** the literal line `[NOTHING TO ADD]`. Detection on raw `streamingState.fullResponse` (before the finalizer): normalize (`normalizeContentBlockFormat`), strip own-name prefix (`stripCharacterNamePrefix`), trim; first non-empty line — shedding wrapping `* _ ~ " ' \`` and trailing punctuation, case-insensitive, brackets optional — must equal `NOTHING TO ADD` with nothing but whitespace after. Sentinel + trailing prose = **not** a skip (strip the line, keep the prose). Sentinel when skip wasn't offered: bare → route to existing empty-response branch; with prose → strip and continue. Host announcement text never contains the sentinel, so history can't teach it.
- **Skip record = Host message** (`systemSender: 'host'`, `systemKind: 'turn-pass'`, `hostEvent: {participantId}`). No new state columns; derivable from history on server, client, and job child.
- **Turn-state effects of a pass:** advances derived `lastSpeakerId` (via `calculateTurnStateFromHistory` recognizing turn-pass records) and enters `spokenThisCycleParticipantIds` via an explicit `computeSpokenThisCycleAfterSkip` write (`lib/chat/turn-manager/state.ts:186`; the addMessage hook ignores Host messages because `participantId` is null).
- **One uniform must-speak rule:** responder must speak when every other active CHARACTER participant has a turn-pass record since the last substantive message. Covers the user-driven 4a case (vacuous truth in 2-party), the LLM stall guard, and terminates every topology in ≤ ~2N skip turns. Additional withhold reasons: `feature-disabled`, `first-character-turn`, `summoned` (nudge/queue — the user explicitly summoned that voice), `already-skipped` (since last substantive message; cuts double-skip spam).
- **`skipUserTurn` also posts a Host turn-pass record** so human passes feed the same stall guard (behavior change; documented). When the feature toggle is off, the guard never blocks the human — `feature-disabled` only suppresses the LLM prompt option.
- **Setting:** nullable chat column `turnSkippingEnabled` (NULL/true = on), cloned end-to-end from the `coreWhisperEnabled` plumbing.

## Implementation steps

### 1. Setting plumbing: `turnSkippingEnabled`
- `lib/schemas/chat.types.ts`: add `turnSkippingEnabled: z.boolean().nullable().optional()` to both `ChatMetadataSchema` (~877) and `ChatMetadataBaseSchema` (~1131); doc comment "NULL = enabled".
- New migration `migrations/scripts/add-turn-skipping-field.ts` (model: `add-core-whisper-fields.ts`): `ALTER TABLE "chats" ADD COLUMN "turnSkippingEnabled" INTEGER DEFAULT NULL`; register in `migrations/scripts/index.ts`; `PRETTY_LABELS` entry in `lib/startup/prettify.ts` (steampunk voice). No collection loop → no `reportProgress`.
- `docs/developer/DDL.md`: add the column (near coreWhisperEnabled, ~507).
- `public/schemas/qtap-export.schema.json`: add `turnSkippingEnabled` to chats properties (~407). Export/import spread chat fields generically — schema + Zod suffices.
- `app/api/v1/chats/[id]/schemas.ts` (~21): add to update schema. `handlers/get.ts` (~536): project it.
- Client: `app/salon/[id]/types.ts` chat type; `app/salon/[id]/hooks/useChatControls.ts` (state + PATCH handler, mirror coreWhisperEnabled blocks ~64–118/230–248); toggle in `components/chat/ChatSidebar.tsx` near the Core-whisper control (~1222–1320; render NULL as ON); wire props in `SalonView.tsx` (~1717).

### 2. Shared pure logic — new `lib/chat/turn-manager/skip-signal.ts` (client-safe, no repo imports)
- `NOTHING_TO_ADD_SENTINEL`, `TURN_PASS_SYSTEM_KIND = 'turn-pass'`.
- `isTurnPassMessage(m)` — host + kind + `hostEvent?.participantId`.
- `detectSkipSentinel(response, characterName?, aliases?) → { skip: true } | { skip: false; cleaned?: string }` (policy above; reuse `normalizeContentBlockFormat` + `stripCharacterNamePrefix` from `@/lib/llm/message-formatter`).
- `findSkippedSinceLastSubstantive(events) → Set<string>` — backward walk collecting turn-pass participantIds until the first substantive message (same predicate as `calculateTurnStateFromHistory`).
- `isFirstCharacterTurn(events)` — no ASSISTANT message with non-null `participantId` exists (greetings count as turns; Staff messages have null participantId).
- `computeSkipEligibility({events, participants, respondingParticipantId, respondingCharacter, summoned?, turnSkippingEnabled}) → { offerSkip, mustSpeakReason: 'feature-disabled'|'first-character-turn'|'summoned'|'already-skipped'|'all-others-skipped'|null, recentlyAddressed }`. "All others" = every other active CHARACTER participant (LLM and user-controlled); vacuous truth intentionally forbids skipping with no other participants.
- `recentlyAddressed`: visible conversational turns (reuse `isVisibleConversationalTurn` notion, `lib/chat/context/core-whisper-trigger.ts:60-72`) after the responder's last own non-whisper ASSISTANT message, capped at 10; hit = `findMentionedCharacterIds(corpus, [respondingCharacter])` (`lib/chat/context/mentioned-characters.ts`) non-empty, or a whisper targeting the responder.
- **Modify `lib/chat/turn-manager/state.ts`** `calculateTurnStateFromHistory` backward walk: before the role check, `if (isTurnPassMessage(msg)) { lastSpeakerId = msg.hostEvent.participantId; break }` — a pass occupies the floor position (stall prevention). Export new symbols from `lib/chat/turn-manager/index.ts`.

### 3. Host announcement — `lib/services/host-notifications/writer.ts`
- `buildTurnPassContent(name)` (steampunk, sentinel-free): "The Host inclines his head as ${name} waves the turn graciously by — nothing to add for the moment, it seems. The floor passes on."
- `buildUserTurnPassContent(name)`: "The Host observes ${name} declining the floor with a courteous wave; the turn passes on."
- `buildTurnPassOpaqueContent(name)` (neutral): "${name} has nothing to add right now. The conversation moves on."
- `postHostTurnPassAnnouncement({chatId, characterName, participantId, source: 'llm'|'user'})` → delegates to `postHostMessage(chatId, content, opaqueContent, 'turn-pass', { participantId })`; returns the MessageEvent; errors swallowed (existing contract).

### 4. Prompt injection (ephemeral, per-turn)
- `lib/services/chat-message/context-builder.service.ts`: add `turnSkip?: { offerSkip, recentlyAddressed, characterName }` to `BuildMessageContextOptions`; pass to `buildContext`.
- `lib/chat/context-manager.ts`: add `turnSkip` to `BuildContextOptions`; helper `buildTurnSkipInstruction(characterName, recentlyAddressed)`:

  ```
  [Turn note from the Salon — not spoken by any character]
  You are not obliged to speak this turn. If — and only if — you genuinely have
  nothing substantive to add to the conversation right now, reply with exactly
  this single line and nothing else:

  [NOTHING TO ADD]

  The floor will then pass to someone else and the scene continues without you
  this turn. Do not use it to be coy or mysterious — a brief in-character
  remark is always better than an empty pass. If you have anything worth
  saying, write your reply as normal and ignore this note entirely.
  ```
  plus, when `recentlyAddressed`: "One caution: ${characterName} appears to have been addressed or mentioned since you last spoke. If someone has spoken to you and you have not yet answered them, you should answer rather than pass."
- Emission gated on `options.turnSkip?.offerSkip`: if `newUserMessage` exists → append to `trailingContextSections` (~2037); else push trailing `{ role: 'user', content: instruction }` after the newUserMessage block (~2047). Not persisted.

### 5. Orchestrator — eligibility + sentinel handling (`lib/services/chat-message/orchestrator.service.ts`)
- `SendMessageOptions` (`types.ts:78`): add `nudge?: boolean` and `chainSelectionReason?: 'queue' | 'algorithm'`. `continueMessageSchema` (~156): add `nudge`. Thread `nudge: true` from the client nudge path (`useTurnManagement` → `triggerContinueMode` in `useSSEStreaming.ts:851-860`).
- In `processMessage` after `existingMessages` loads (~479): compute `computeSkipEligibility` once (only when `isMultiCharacter` and responder is LLM-controlled; `summoned = nudge || chainSelectionReason === 'queue'`; `turnSkippingEnabled: chat.turnSkippingEnabled !== false`); debug-log the decision; pass `turnSkip` into `buildMessageContext` (~961).
- **Sentinel branch** immediately before line 1408: `detectSkipSentinel(fullResponse, character.name, character.aliases)`. If skip and `offerSkip` and no tool messages → skip path; if cleaned prose exists → replace `fullResponse` and fall through; else force the empty-response branch. If tools ran, the tool-save branch wins (turn had effects; log a warning).
- **Skip path** (`handleTurnSkip` helper): post the Host announcement; re-read chat, write `spokenThisCycleParticipantIds` via `computeSpokenThisCycleAfterSkip` in one `repos.chats.update`; SSE: new `encodeHostAnnouncementEvent` (clone of `encodeCarinaAnswerEvent`, `streaming.service.ts:709`, payload key `hostAnnouncement`) + `done` extended with `skipped: true, skippedParticipantId, messageId: null`; return `{ isMultiCharacter, hasContent: false, skipped: true, skippedParticipantId, messageId: null, userParticipantId, isPaused }`.
- `ProcessMessageResult` (`types.ts:274`): add `skipped?`, `skippedParticipantId?`.

### 6. Chain continuation (`lib/services/chat-message/turn-orchestrator.service.ts`)
- Entry gate (298): admit `initialResult.skipped` (`!hasContent && !skipped` → return).
- `ChainDecision`: add `selectionReason: 'queue' | 'algorithm'` (queue-pop at ~134–150); thread into `processChainedMessage({..., chainSelectionReason})` (widen option type; orchestrator wrapper at `orchestrator.service.ts:187-201` forwards).
- In-loop gate (364): `if (!chainResult.hasContent && !chainResult.skipped)` stop; a skipped turn falls through to the next `decideNextTurn` iteration. Extend `encodeTurnCompleteEvent` payload with `skipped`.
- No selection-math change — fresh `calculateTurnStateFromHistory` now sees the turn-pass record.
- Optional pre-existing fix: exclude `systemSender != null` rows from the all-LLM pause counter (~108–113) so Host notes don't inflate it.

### 7. `skipUserTurn` — Host record + must-speak guard
- `app/api/v1/chats/[id]/actions/turn.ts` (case at ~88): compute `computeSkipEligibility` for the requesting user-controlled participant; if `mustSpeakReason === 'all-others-skipped'` → `badRequest("Everyone else has passed — it falls to <name> to say something.")`. Only that reason blocks a human. On success, `postHostTurnPassAnnouncement({source: 'user'})` before the existing turn-state persistence (in-memory `lastSpeakerId` override at ~115 stays, now consistent).
- Client `SalonView.tsx` user-turn banner (~1384–1405): same eligibility via the shared function (messages now carry `hostEvent`); when must-speak, hide the Skip button and adjust banner copy. `useTurnManagement.handleSkipUserTurn` (~218) already surfaces `badRequest` via toast.

### 8. Client SSE + payload
- `handlers/get.ts` (~416): project `hostEvent: event.hostEvent || null`. `app/salon/[id]/types.ts`: add `hostEvent` to `Message`, `turnSkippingEnabled` to the chat type.
- `useSSEStreaming.ts`: `SSEEvent` gains `skipped?`, `skippedParticipantId?`, `hostAnnouncement?`; generic reader handles `hostAnnouncement` like `carinaAnswer` (deduped insert) via a new callback wired at both call sites; **all four** done/intermediate-done handlers (~676, ~733, ~879, ~905) get `if (data.skipped)` guards that reset streaming content and do not append `fullContent` or toast (send-path `onDone` keeps waiting for a possible chained `turnStart`).
- `app/salon/[id]/components/system-message-labels.ts`: `KIND_DISPLAY_OVERRIDES['turn-pass'] = 'nothing to add'`; `IMPORTANCE_TABLE.host['turn-pass'] = 'low'`.

### 9. Autonomous rooms — verify-only
- Skip-path writes (Host message + cycle column) go through the job-child repo proxy and flush at job end; `singleTurn` means next selection reads flushed state in the next job. Budget already counts every job as a turn. Stall guard bounds all-skip loops to ~2N turns. `drainStream` ignores new SSE events.

### 10. Tests (global `jest`, bare mock factories; all pure/mocked, no SQLCipher)
- `skip-signal` unit tests: `detectSkipSentinel` (exact line, wrapped `**…**`/quotes, own-name prefix, sentinel+prose → cleaned, mid-reply not a skip, lowercase/no-bracket, empty); `computeSkipEligibility` (first-turn incl. greeting, summoned, already-skipped, all-others-skipped 3-party trace incl. wrap, 2-party user-driven vacuous-truth trace, feature-disabled, recentlyAddressed by name/alias/targeted whisper/negative-after-spoke); `calculateTurnStateFromHistory` turn-pass advances `lastSpeakerId`, whispers/other Host kinds still ignored.
- Turn-orchestrator: chain continues on `{hasContent:false, skipped:true}` at both gates; still stops on plain empty.
- Orchestrator skip path (mock repos): Host message posted, cycle column written, `done` carries `skipped:true`, result shape.
- Writer: content builders sentinel-free. `turn.ts`: guard rejects/allows correctly, announcement posted.

### 11. Docs
- `docs/CHANGELOG.md` (plain English): per-chat "turn skipping" option (default on); characters may pass with a Host note; Skip button now posts a Host note and is refused when everyone else has passed; applies to autonomous rooms (a pass consumes a turn).
- Help (steampunk voice, `url` frontmatter + In-Chat Navigation section): new `help/turn-skipping.md`; cross-references in `help/chat-turn-manager.md`, `help/chat-multi-character.md`, `help/autonomous-rooms.md`, chat-settings help for the toggle. Check `.claude/commands/update-documentation.md`.

## Edge cases (decided)
- Nudge/queue: no skip option. Continue button (algorithm-picked): offered.
- Regenerate-swipe: no `turnSkip` passed → no instruction/handling; note in code comment.
- Whisper-targeted responder: counts as `recentlyAddressed`; skip still offered (prompt clause pushes them to answer).
- Tools ran then sentinel: tool-save branch wins.
- Deleted Host note: guards recompute from remaining history — harmless.
- Single-character / non-multi chats: `isMultiCharacter` false → inert.
- Momentary streaming flash of the sentinel in the bubble is accepted (cleared on the skipped `done` event).

## Verification
1. Fresh 3-LLM chat: first character turn's context has no turn note (LLM logs); subsequent chained turns do.
2. Force a skip (character system prompt "always reply exactly `[NOTHING TO ADD]`"): Host note appears live, no character bubble persists, chain continues, `spokenThisCycleParticipantIds` includes the skipper (`npx quilltap` inspect).
3. Two consecutive skips → third character's context omits the skip option and they speak.
4. User-driven + 2 LLM: user speaks, both LLMs skip → banner shows must-speak copy, Skip button hidden, direct `skipUserTurn` POST returns 400.
5. Toggle off in sidebar → no turn note anywhere; Skip button behaves as before.
6. Autonomous room with small `budgetMaxTurns`: skips increment `runTurnsConsumed`; no all-skip loop; run ends on budget.
7. Mention a character by name, let another speak, then select the mentioned one → their note includes the recently-addressed caution.
8. Nudge an always-skip character → no skip option; bare sentinel routes to the empty-response toast.
9. `.qtap` export/import round-trips `turnSkippingEnabled` + turn-pass messages; `npx tsc` clean; targeted jest suites green.