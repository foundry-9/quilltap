# Salon Answer Confirmation (consistency check + re-affirmation)

**Status:** implemented in v4.8 (migration `add-answer-confirmation-columns-v2`).
**Scope:** the Salon only (`chatType` normal salon chats). Explicitly NOT help chats, the Brahma Console, or Carina calls.
**Author of spec:** handed to Claude Code for implementation.

**Resolved open items (see §14):**
1. Global default **OFF**, with a **per-project** override (`ProjectPropertiesSchema.answerConfirmationOverride`, in `properties.json`) *and* a per-chat override (`chats.answerConfirmationOverride`). A project set to ON enables its chats; a chat's own override always wins. Resolution: `isAnswerConfirmationActive(chatOverride, projectOverride, globalEnabled)`.
2. Whisper source: **read-back** of the persisted `commonplaceBook` message (`findLatestCommonplaceWhisper`).
3. In-scope tools: `search`, `read_conversation`, and the `doc_*` **content**-read family (`doc_read_file`, `doc_grep`, `doc_read_heading`, `doc_read_frontmatter`, `doc_open_document`). Listings/blobs excluded.
4. Silent messages: **skipped**.
5. Re-affirmation reuses the cheap-task harness (`executeCheapLLMTask`) with a selection built from the character's own `connectionProfile`.
6. Timeouts: check 25s, re-affirmation 60s.
7. **Known gap:** the regenerate/swipe path (`regenerate-swipe.service.ts`) persists directly and is **not yet** run through confirmation; the user-driven `confirmed:null` write lands via the finalize-path guard (`isUserDrivenTurn`) as defense-in-depth, not at a separate manual-send site.

Key files: `lib/services/chat-message/answer-confirmation.service.ts` (core), wired into `message-finalizer.service.ts`; `AnswerConfirmationSettings` (global), `ModelBehaviorCard` (project), `ChatSidebar` Visibility (chat); `ConfirmationBadge` (UI); `help/answer-confirmation.md`.

---

## 1. Summary

Before a character's tool-using reply "lands" in a Salon turn, run a cheap-LLM
**consistency check**: hand the cheap LLM everything the character was told this
turn by the Commonplace Book (its last whisper) plus this turn's **read-tool**
results (search, `read_conversation`, and Scriptorium / document reads), and ask
whether the character's final answer is consistent with that information.

- **Consistent** → the original reply is persisted with metadata `confirmed: true`.
- **Not consistent** → a second pass calls **the original character model** again,
  shows it the discrepancies the cheap LLM found, and asks whether it stands by
  the answer or wants to fix it.
  - If it **stands by** the answer unchanged → persist the original with
    `confirmed: false` (plus the discrepancy notes).
  - If it **rewrites** the answer → persist the **revised** text as the shown
    reply (`confirmed: true`), keep the **original** pre-revision text in the
    message record for the logs.
- **Check errored / timed out** → persist the original unchanged with
  `confirmed: null` (a distinct "could not verify" state).

The Salon status bar shows `Confirming…` during the check and `Requesting
affirmation of questionable results…` during the re-affirmation pass. Every
checked message carries a small badge (confirmed / unconfirmed / revised /
unverified) that reveals the discrepancy notes on hover.

The confirmation runs **only when there is something to check** — i.e. the turn
had a Commonplace Book whisper AND/OR at least one in-scope read-tool result.
Plain turns with neither are skipped entirely (no cheap-LLM call, no metadata).

This feature never blocks a turn and never authors a separate Staff message; it
only annotates (and possibly rewrites) the character's own message and drives the
status bar.

---

## 2. Locked decisions (from requirements review)

| Decision | Choice |
|---|---|
| Re-affirmation model | **Original character model** (full model that authored the reply), shown the cheap-LLM discrepancy list, invited to affirm or rewrite. |
| Trigger scope | **Only when a whisper OR an in-scope read-tool result exists** this turn. |
| User-driven turns | **Never checked.** A reply authored by a user-controlled participant (impersonation) is persisted with an explicit **`confirmed: null`** — the system cannot confirm or deny whether the user went out of band for the information. Distinct from "feature off" (which writes no field at all). |
| On revision | **Keep original in the record; show the revised reply as the actual message.** The re-affirmation prompt invites a rewrite when a fix is warranted. |
| In-scope read tools | `search` (web search), `read_conversation`, and the **Scriptorium / document-read** family (`search_scriptorium` + `doc_*` reads). NOT the full read-tool set. |
| Feature gate | **Global setting + per-chat override.** (Recommended global default: **OFF** — see §9; flag to confirm.) |
| Check failure/timeout | Pass original, mark **`confirmed: null`** (unverified). |
| Metadata model | **Boolean `confirmed` + notes.** A revision counts as `confirmed: true`; discrepancy notes and the pre-revision original are stored alongside. |
| UI | **Badge on all checked messages**, transient status-bar text during processing. |
| Streaming vs. revision | **Stream the first answer live, then replace it in place if the re-affirmation rewrites it.** This is intentional — the visible swap is a transparency feature, not a glitch to hide. Do NOT withhold streaming until after the check. |

---

## 3. Data model changes

### 3.1 Message schema (`lib/schemas/chat.types.ts`)

Add to `MessageEventSchema` (alongside the other display/metadata fields, e.g.
after `reasoningSegments` / near `provider`/`modelName`):

```ts
/** Answer-confirmation result. true = consistent (or successfully revised),
 *  false = character affirmed a flagged answer unchanged, null = check could not
 *  run (error/timeout) or was not applicable. */
confirmed: z.boolean().nullable().optional(),
/** Whether the shown `content` is a re-affirmation rewrite of the original. */
confirmationRevised: z.boolean().nullable().optional(),
/** The cheap-LLM discrepancy explanation (what looked inconsistent). Surfaced on
 *  the badge hover; null when confirmed:true on the first pass or not applicable. */
confirmationNotes: z.string().nullable().optional(),
/** The character's original pre-revision text, retained for the logs when
 *  `confirmationRevised` is true. Null otherwise. */
confirmationOriginalContent: z.string().nullable().optional(),
```

> **Standing-rule follow-through (per `CLAUDE.md`).** New persisted message fields
> mean new `chat_messages` columns. This requires, in lockstep:
> 1. The four columns added to the `chat_messages` table (schema-generated
>    `CREATE TABLE` / `ensureCollection` marshaling — mirror how `reasoningContent`
>    / `dangerFlags` are handled in `lib/database/repositories/chats-messages.ops.ts`).
> 2. A **migration** in `migrations/scripts/` (+ `index.ts`) adding the columns to
>    existing DBs, with a **`PRETTY_LABELS` entry** in `lib/startup/prettify.ts`
>    in the steampunk-Wodehouse voice (e.g. *"Vetting the cast's claims against
>    the record…"*). No per-row loop is expected, so `reportProgress` is not
>    needed, but confirm.
> 3. `public/schemas/qtap-export.schema.json` updated (these fields ride in
>    `.qtap` exports/backups) and `docs/developer/DDL.md` updated.
> 4. The read/marshal path in the chat-messages ops so the fields round-trip.

These are `MessageEvent`-only fields; **no new `systemSender` value and no new
avatar** are needed — the confirmation annotates the character's own message and
never authors a Staff message.

### 3.2 Settings

**Global** (instance-wide). Add a small settings object, e.g.
`answerConfirmationSettings` on the user/settings record consumed by
`/settings?tab=chat` (the Concierge/cheap-LLM tab), shape:

```ts
{ enabled: boolean }   // global default OFF (recommended — see §9)
```

**Per-chat override.** Add a column to `chats`, mirroring the existing
`conciergeOverride` pattern:

```
answerConfirmationOverride TEXT NULL   // 'ON' | 'OFF' | NULL(=inherit global)
```

Resolution helper (new, small, unit-tested), analogous to `isChatActiveDangerous`:

```ts
// enabled when: override==='ON', OR (override is null AND global.enabled)
function isAnswerConfirmationActive(chat, globalEnabled): boolean
```

Requires its own migration + `PRETTY_LABELS` entry + DDL.md + qtap-export schema
update (the chat column) alongside 3.1's message-column migration (can be one
migration or two — implementer's call).

---

## 4. Control flow

Insert the confirmation between response-cleaning and persistence, inside
`finalizeMessageResponse` (`lib/services/chat-message/message-finalizer.service.ts`).

```
finalizeMessageResponse(...)
  ├─ normalize + strip prefix + anti-hijack truncation  → cleanedResponse   [existing, ~L87-124]
  ├─ rebase tool anchors + reasoning offsets                                 [existing, ~L126-185]
  │
  ├─ ══ NEW: answer confirmation ════════════════════════════════
  │   if isUserDrivenTurn(characterParticipant, character):
  │       confirmed = null   // deliberately unverifiable — user may have gone out of band
  │   else if isAnswerConfirmationActive(chat, globalEnabled)  AND  hasCheckableInputs(...):
  │       emit status: stage 'confirming', "Confirming…"
  │       inputs = gatherConfirmationInputs(...)   // whisper + in-scope tool results
  │       check = await runConsistencyCheck(cleanedResponse, inputs, selection, ...)   // cheap LLM
  │
  │       if check errored/timed out:
  │           confirmed = null; notes = null
  │       else if check.consistent:
  │           confirmed = true; notes = null
  │       else:
  │           emit status: stage 'affirming', "Requesting affirmation of questionable results…"
  │           reaff = await runReaffirmation(cleanedResponse, check.discrepancies, characterModel, ...)  // ORIGINAL character model
  │           if reaff errored:                     confirmed = null; notes = check.discrepancies
  │           else if reaff.revisedText present:     // character chose to fix it
  │               confirmationOriginalContent = cleanedResponse
  │               cleanedResponse = reaff.revisedText
  │               confirmed = true; revised = true; notes = check.discrepancies
  │           else:                                  // character stood by it
  │               confirmed = false; notes = check.discrepancies
  │   else:
  │       confirmed = undefined  // feature off or nothing to check → write no confirmation fields
  │   ══════════════════════════════════════════════════════════
  │
  ├─ (if revised) invalidate tool anchors + collapse reasoning  [see §7]
  ├─ whisperContext = {...}                                                   [existing, ~L187]
  ├─ saveAssistantMessage(..., cleanedResponse, ..., confirmationFields)      [existing call, ~L192 — extend]
  ├─ (if revised or confirmed!=null) emit `confirmationResult` SSE event      [see §8]
  └─ done event + memory extraction                                          [existing]
```

`hasCheckableInputs` = a whisper was found for this character this turn **or**
`toolMessages` contains ≥1 in-scope read tool (§6.2).

---

## 5. Exact integration points

| What | File · symbol | Notes |
|---|---|---|
| Insertion site | `lib/services/chat-message/message-finalizer.service.ts` → `finalizeMessageResponse` | After reasoning rebasing (~L185), before `whisperContext`/`saveAssistantMessage` (~L187-192). Operate on the local `cleanedResponse`. |
| Persist fields | same file → `saveAssistantMessage` (~L457) | Add the four confirmation params; write them into the `assistantMessage` object before `repos.chats.addMessage`. |
| Available in-scope at insertion | — | `chat`, `character` (`{id,name,aliases}`), `characterParticipant`, `toolMessages`, `controller`, `encoder`, and via the destructured `compression` object: `cheapLLMSelection`, `allProfiles`, `builtContext`; via `triggers`: `dangerSettings`, `chatSettings`. `connectionProfile` (the character's own model) is a param — needed for the re-affirmation call. |
| Cheap-LLM selection | `lib/llm/cheap-llm.ts` → `resolveUncensoredCheapLLMSelection(cheapLLMSelection, isChatActiveDangerous(chat), dangerSettings, allProfiles)` | Reuse the already-resolved `compression.cheapLLMSelection`; upgrade to the uncensored profile **iff the Concierge has flagged** this chat (`isChatActiveDangerous` from `lib/services/dangerous-content/chat-override.ts`). |
| Cheap-LLM call | `lib/memory/cheap-llm-tasks/core-execution.ts` → `executeCheapLLMTask<T>(selection, messages, userId, parseResponse, taskType='answer-confirmation', chatId, messageId, uncensoredFallback?, maxTokens, characterId)` | Same minimal-call harness Carina/memory tasks use. `parseResponse` parses the JSON verdict (§7.1). Pass `uncensoredFallback` = `{ dangerSettings, availableProfiles: allProfiles, isDangerousChat: isChatActiveDangerous(chat) }` so an empty/refused cheap response still routes uncensored. |
| Re-affirmation call | the character's own provider | Build from `connectionProfile` (character's provider/model) via the normal provider path (mirror how the main turn or Carina builds a provider + `sendMessage`). This is a **non-streaming** single call. |
| Status events | `lib/services/chat-message/streaming.service.ts` → `encodeStatusEvent(encoder, { stage, message, characterName, characterId })` + `safeEnqueue(controller, …)` | New stages `'confirming'` and `'affirming'` (§8). |
| Whisper retrieval | `lib/services/commonplace-notifications/writer.ts` (writer) + `repos.chats.getMessages` | Read the latest `systemSender==='commonplaceBook'` message targeted to this character this turn (§6.1). |
| Swipe/regenerate path | `lib/services/chat-message/regenerate-swipe.service.ts` | If regeneration has its own finalize path (it references `commonplaceBook`), apply the same confirmation there, or refactor the confirmation into a shared helper both call. **Confirm during implementation.** |

---

## 6. Assembling the check inputs (`gatherConfirmationInputs`)

### 6.1 The last Commonplace Book whisper

The Commonplace Book whisper for a turn is written (just before generation) as a
targeted ASSISTANT-role message with `systemSender: 'commonplaceBook'`, private to
the responding character (`targetParticipantIds` = that character's participant).
The relevant per-turn kind is `consolidated` (see `CommonplaceWhisperKind` /
`CommonplaceParts` in the writer). Its `content` holds the raw memory material
(current state, relevant memories, inter-character memories, knowledge).

**Retrieve:** the most-recent `commonplaceBook` message in this chat whose
`targetParticipantIds` includes `characterParticipant.id`, created within this
turn (i.e. after the triggering user/prior message). Use its `content` verbatim as
the "what the character was told to remember" block. If none exists, the whisper
input is empty (and contributes nothing to `hasCheckableInputs`).

> **Recommended** over re-deriving from `builtContext`: reading the persisted
> whisper is decoupled and already reflects exactly what the character saw.
> Alternative (if the read-back proves fiddly): thread the assembled
> `CommonplaceParts`/whisper text from the context-builder through
> `FinalizeMessageResponseOptions`. Implementer's call — flag which you chose.

### 6.2 In-scope tool results

From `toolMessages` (already present at the insertion point), keep only results
whose `toolName` is in:

```ts
const CONFIRMATION_READ_TOOLS = new Set<string>([
  'search',              // web/search — canonical case
  'read_conversation',   // prior chat history
  'search_scriptorium',  // Scriptorium search (confirm exact tool name in lib/tools/)
  'doc_read_file', 'doc_grep', 'doc_read_heading',
  'doc_read_frontmatter', 'doc_open_document',
  // (doc_list_files / doc_list_blobs / doc_read_blob: include if you want
  //  listing/binary reads to count — default: include the content reads above.)
])
```

Verify the exact tool names against `lib/tools/` and the `VAULT_READ_TOOLS` /
`ALWAYS_PRIVATE_TOOLS` sets in `tool-execution.service.ts` (the `doc_*` family and
`search`/`read_conversation` are already enumerated there). Serialize each kept
tool result compactly (tool name + arguments + result body) for the prompt; cap
total length (e.g. token/char budget) and truncate oldest-first if needed.

---

## 7. Prompts & parsing

### 7.1 Consistency check (cheap LLM)

System prompt (plain, task-framed — this is a utility call, not in-character):

> You are a consistency checker. You are given (A) reference information a
> character was working from this turn — their recalled memories and the results
> of any lookups/searches/document reads they performed — and (B) the reply they
> are about to send. Decide whether the reply is **consistent** with the reference
> information: it must not contradict it, invent facts that conflict with it, or
> misstate what the lookups returned. The reply may add in-character color, tone,
> or opinion not present in the reference — that is fine and not an inconsistency.
> Only flag genuine factual contradictions or misrepresentations of the reference.
> Respond with strict JSON: `{"consistent": boolean, "discrepancies": string}`.
> When consistent, `discrepancies` is "". When not, `discrepancies` briefly lists
> each contradiction in plain language.

User message: the assembled reference block (whisper + tool results from §6) and
the candidate reply (`cleanedResponse`). `parseResponse` extracts the JSON;
tolerate fenced/wrapped JSON. A parse failure is treated as **check errored** →
`confirmed: null`.

Guidance: low temperature (≈0), modest `maxTokens`. Wrap the whole call in a
timeout (e.g. 20–30 s); on timeout → `confirmed: null`.

### 7.2 Re-affirmation (original character model)

Only runs when the check returns `consistent:false`. Call the **character's own
model** with the normal in-character system prompt/context is **not** required —
send a compact single-shot: a brief system framing plus a user-role message that
(a) shows the **recent live conversation** (so the rewrite stays in-scene),
(b) quotes the character's drafted reply as the next thing it was about to say,
(c) lists the discrepancies the checker found, (d) states the reference facts —
explicitly labelled *background knowledge, NOT the conversation* — and (e)
instructs:

> Stay in the current scene. If you correct the reply it must still answer the
> same person about the same thing at this same moment — same addressee, tone,
> and flow — changing ONLY the details that conflict with the facts. Do NOT
> rewrite from scratch, restart the exchange, or answer some earlier/different
> conversation. If you stand by your draft exactly as written, respond with
> strict JSON `{"revise": false}`. If you correct it, respond with `{"revise":
> true, "reply": "<your corrected reply>"}` — the corrected reply replaces what
> you send, so write it in full and in your own voice.

**Why the conversation transcript matters:** without it the re-affirmation only
sees the bare draft plus the reference block — and the reference can itself quote
an *older* conversation the character read via `read_conversation`. With no anchor
to the current scene the model treats that quoted material as the live exchange
and rewrites its reply into the wrong conversation. `buildRecentConversationContext`
(in `answer-confirmation.service.ts`) supplies a compact `Name: text` transcript of
the recent real dialogue — Staff/system-sender whispers, tool bubbles, and silent
messages filtered out — so the correction lands in place. It is passed as
`conversationContext` alongside `characterName` (both optional; the pass degrades
gracefully when there is no prior dialogue).

Parse: `revise:false` → character stood by it → `confirmed:false`, keep original.
`revise:true` with non-empty `reply` → use `reply` as the new `cleanedResponse`,
set `confirmationRevised:true`, `confirmationOriginalContent` = old text,
`confirmed:true`. Parse failure / empty reply / call error → `confirmed:null`
(do not gamble on a broken rewrite), keep original, `notes` = discrepancies.

**No loop:** the re-affirmation runs at most once. A revised reply is not
re-checked (avoids unbounded round-trips).

### 7.3 Anchor / reasoning invalidation on revision

A rewrite changes the prose, so tool-call `anchorOffset`s and reasoning
`anchorOffset`s (computed against the original text) no longer map. When
`confirmationRevised` is true, mirror the existing `normalizeRewroteBody` handling:
set every `toolMessages[i].anchorOffset = undefined`, and collapse
`rebasedReasoning` to a single offset-0 block (content preserved). Tool blocks and
thinking then fall back to bottom-of-bubble rendering. (Display-only; no model
impact.)

---

## 8. SSE / status bar

Two new status stages via the existing `encodeStatusEvent` (`{status:{stage,message,characterName,characterId}}`):

- `stage: 'confirming'`, `message: 'Confirming…'` — emitted before the cheap-LLM check.
- `stage: 'affirming'`, `message: 'Requesting affirmation of questionable results…'` — emitted before the re-affirmation call.

These strings are user-facing → steampunk/Wodehouse-adjacent register is welcome
(Charlie supplied this exact wording; keep it or lightly embellish, but keep the
two states distinct).

**Revised-content reconciliation (required client change).** The original reply is
streamed to the client live, and is *intentionally* left visible until the check
resolves — if the re-affirmation rewrites it, the user sees the first answer get
replaced by the corrected one. That visible swap is a deliberate transparency
feature (the reader witnesses the correction happen), not a flicker to suppress; do
not buffer/withhold the stream to hide it. To carry the resolved state — and, on a
revision, the replacement text — emit a new terminal-ish event
**before/with `done`** carrying the resolved confirmation:

```ts
// new encoder in streaming.service.ts
encodeConfirmationResultEvent(encoder, {
  messageId, confirmed, revised, notes,
  content?  // present only when revised — the client replaces the bubble text
})
```

Client (`app/salon/[id]/hooks/useSSEStreaming.ts` + the message-rendering path):
parse `confirmationResult`; if `content` present, replace the optimistic streamed
bubble text with it; store `confirmed`/`revised`/`notes` on the message for the
badge. The existing reload/refetch of the persisted message must also carry these
fields (they're now schema/DB columns), so a page refresh shows the same state.

---

## 9. Settings, gating, defaults

- **Global toggle** in `/settings?tab=chat` (near the Concierge / cheap-LLM
  controls), backed by `answerConfirmationSettings.enabled`.
- **Per-chat override** (`chats.answerConfirmationOverride`), surfaced as a
  per-Salon control (mirror the Concierge per-chat affordance).
- **Recommended global default: OFF.** The feature adds one cheap-LLM round-trip
  (and occasionally a full character-model round-trip) after each checkable turn;
  shipping off-by-default is the safe rollout. **→ Confirm with Charlie whether he
  wants default ON.** (The requirements round selected "Global + per-chat override"
  without pinning the default value.)
- Resolution: `isAnswerConfirmationActive(chat, global)` = `override==='ON' ||
  (override==null && global.enabled)`; `'OFF'` always wins.
- The whole block is a no-op when inactive: no cheap-LLM call, no status events,
  no confirmation fields written.

---

## 10. UI — the badge

Attach a small indicator to any Salon message that carries a non-`undefined`
`confirmed` value:

| State | Derivation | Suggested affordance |
|---|---|---|
| Confirmed | `confirmed===true && !revised` | subtle "✓ confirmed" mark, no notes |
| Revised | `confirmed===true && revised` | "✎ revised" mark; hover shows `confirmationNotes` + a way to view `confirmationOriginalContent` (the pre-revision text) |
| Unconfirmed | `confirmed===false` | "! unconfirmed" mark; hover shows `confirmationNotes` (the character stood by a flagged answer) |
| Unverified | `confirmed===null` | muted "— unverified" mark; hover explains the check could not run |

Keep it unobtrusive (this is metadata, not an alarm). Wire it in the Salon message
component that already renders per-message system affordances.

---

## 11. Edge cases & interactions

- **Multi-character chains / autonomous rooms.** `finalizeMessageResponse` runs per
  character turn, so confirmation applies to each. It runs *after* the reply
  streams but *before* the turn completes — the `Confirming…` status shows between.
  A revised reply is what feeds next-speaker selection and downstream memory
  extraction (see below). Confirm the added latency is acceptable inside chains
  (it is bounded: ≤2 extra LLM calls per checkable turn, no loop).
- **Memory extraction.** Extraction happens after persistence on the *stored*
  content. On a revision, the **revised** text is the stored `content`, so memory
  is extracted from the corrected reply — correct. The original survives only in
  `confirmationOriginalContent`.
- **Continue mode / regeneration / swipes.** Apply wherever the shared finalize
  runs; refactor into a shared helper if regeneration has a separate path (§5).
- **User-driven characters (impersonation).** A reply authored by a user-controlled
  participant is never run through the check — the human may have sourced facts out
  of band, so the system can neither confirm nor deny consistency. Such messages are
  persisted with an explicit **`confirmed: null`** (and no notes / no revision),
  which is deliberately distinguishable from "feature off" (no field written).
  `isUserDrivenTurn` = the authoring participant's `controlledBy === 'user'` (also
  covers impersonation of an otherwise-LLM character; cross-check
  `chat.impersonatingParticipantIds` / the participant's `controlledBy`).
  **Path note:** a user-driven character message may be persisted through a
  different route than `saveAssistantMessage` (a manual/impersonation send rather
  than an LLM generation). Wherever that persistence happens, set `confirmed: null`
  on the message. If user-driven turns never reach `finalizeMessageResponse`, add
  the `confirmed: null` write at the impersonation/manual-send persistence site and
  keep the finalize-path guard as defense-in-depth.
- **Silent messages** (`isSilentMessage`): confirm whether to skip (a silent turn
  produces no visible reply). **Recommend: skip confirmation for silent messages.**
- **No whisper + no in-scope tools** → skipped (nothing to check), no fields written.
- **Cheap LLM unavailable / no profile** → treat as check error → `confirmed:null`.
- **Concierge flagged** (`isChatActiveDangerous(chat)`) → the check (and its
  empty-response fallback) use the **uncensored** cheap profile via
  `resolveUncensoredCheapLLMSelection`; otherwise the standard cheap profile. The
  re-affirmation always uses the character's own configured model.

---

## 12. Standing-rules checklist (from `CLAUDE.md`)

- Spelling: **"Quilltap"** everywhere; never "Quilttap".
- User-facing strings (settings labels, badge text, status text, help copy) in the
  steampunk + Roaring-20s + Wodehouse + Lemony Snicket register. `docs/CHANGELOG.md`
  entry stays terse/plain.
- **`help/*.md`:** document the new setting + the badge. New/edited help file needs
  a `url` frontmatter field (`?tab=chat` deep-link) and an "In-Chat Navigation"
  section whose `help_navigate(url: …)` matches that `url`. Update the
  `update-documentation` command's doc list if you add a help doc.
- **Migrations:** every migration needs a `PRETTY_LABELS` entry
  (`lib/startup/prettify.ts`) in-voice; add `reportProgress` only if a collection
  loop is introduced (not expected here).
- **Data/schema propagation:** `chat_messages` columns + `chats` column →
  update `public/schemas/qtap-export.schema.json`, `docs/developer/DDL.md`,
  backups, and `.qtap`/SillyTavern export paths as applicable.
- **API routes:** no new route is strictly required (settings ride the existing
  `/api/v1/settings/chat` and the per-chat override rides the chat update path).
  If a route is added, it must live under `/api/v1/` with the action-dispatch
  pattern and the standard middleware/response helpers.
- **Logging:** fire debug logs on the new backend path (check start, verdict,
  re-affirmation outcome, skip reasons), consistent with the surrounding services.
- Check types with `npx tsc` (not `npm run build`). Register any new tool-def
  snapshot only if a tool is added (none is).

---

## 13. Testing plan

- **Unit — `isAnswerConfirmationActive`:** the `'ON'`/`'OFF'`/inherit truth table.
- **Unit — input gathering:** `hasCheckableInputs` true/false; the in-scope tool
  filter keeps only `CONFIRMATION_READ_TOOLS`; whisper read-back returns the right
  message; empty-inputs → skip.
- **Unit — verdict handling:** each branch (consistent → true; inconsistent +
  stand-by → false; inconsistent + revise → true/revised with original stored;
  parse failure/timeout → null).
- **Unit — anchor/reasoning invalidation on revision.**
- **Integration (mocked cheap LLM + mocked character model):** drive
  `finalizeMessageResponse` (or the shared helper) through all four terminal
  states; assert the persisted `MessageEvent` fields and that a revision replaces
  `content` while preserving `confirmationOriginalContent`.
- **SSE:** the `confirming` / `affirming` status events fire in order; the
  `confirmationResult` event carries the right payload (and `content` only on
  revision).
- **Scope guard:** help chat / Brahma / Carina paths never invoke the check.
- **Concierge routing:** flagged chat selects the uncensored cheap profile.
- **Verification step (per repo convention):** run the message-finalizer and
  chat-messages ops test suites + `npx tsc`; snapshot-update chat-message tests if
  the schema shape changed (`npx jest -u` on the affected snapshot only).

---

## 14. Open items to confirm before/at implementation

1. **Global default ON or OFF?** (Spec assumes OFF.)
2. **Whisper source:** read-back of the persisted `commonplaceBook` message
   (recommended) vs threading the assembled whisper through `Finalize…Options`.
3. **Exact Scriptorium tool name(s)** and whether `doc_list_*` / blob reads count
   (spec includes content reads, lists optional).
4. **Silent messages:** skip confirmation (recommended) — confirm.
5. **Regeneration/swipe finalize path:** shared helper vs duplicated insertion.
6. **Timeout budget** for the cheap-LLM check and the re-affirmation call.
7. **User-driven persistence site:** confirm whether impersonation/manual character
   sends flow through `finalizeMessageResponse` or a separate route, so the explicit
   `confirmed: null` write lands in the right place (§11).
