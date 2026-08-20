# Commonplace Book Whisper Overhaul

**Status:** Implemented (4.7-dev)
**Owner:** Charlie
**Drafted:** 2026-06-17

A handoff spec for Claude Code. This overhauls the per-turn recall whispers the
Commonplace Book delivers to characters in the Salon. Read this whole document
before writing code; the four workstreams are independent enough to land as
separate commits but share schema and budget surfaces, so read §6 (cross-cutting
concerns) first.

---

## 0. Background — how the system works today

When a character is about to take a turn, `buildContext` in
[`lib/chat/context-manager.ts`](../../../lib/chat/context-manager.ts) assembles up
to five recall sections and hands them to the Commonplace Book, which whispers
them as a private `ASSISTANT`-role message (`systemSender: 'commonplaceBook'`,
targeted via `targetParticipantIds`). The five parts:

| Part | Source | Cadence |
|---|---|---|
| `currentState` | `formatCurrentSceneState` over `chat.sceneState` | every turn |
| `recap` | `generateMemoryRecap` (tiered memories + recent conversations) | chat-start / character-join |
| `relevant` | semantic memory search (`searchMemoriesSemantic`) | every turn |
| `interChar` | `findByCharacterAboutCharacters` (importance/recency, **non-semantic**) | every turn, multi-char |
| `knowledge` | character vault `Knowledge/` folder | every turn |

The parts are rendered twice from one `CommonplaceParts` object
([`lib/services/commonplace-notifications/writer.ts`](../../../lib/services/commonplace-notifications/writer.ts)):
`buildCommonplacePersonaWhisper` (steampunk voice, persisted to transcript/UI)
and `buildCommonplaceLLMContext` (plain second-person, fed to the LLM).

**Prerequisite already shipped:** commit `77759c08`
("feat(salon): mirror conversation summaries into character vaults") added
[`lib/file-storage/conversation-summary-vault-bridge.ts`](../../../lib/file-storage/conversation-summary-vault-bridge.ts),
which mirrors each chat's rolling context summary into every participant's vault
under `Conversation Summaries/`. Each file carries YAML frontmatter:
`conversationId` (the chat UUID), `conversationTitle`, `characters`,
`characterIds`, `messageCount`, `firstMessageAt`, `lastMessageAt`,
`summaryGeneration`, `updatedAt`. These files are chunked + embedded, so past
conversations are now semantically retrievable per-character. The commit's own
message calls this "Part A of improving the Commonplace Book retrieval system" —
this spec is Part B.

---

## 1. Workstream A — Concise clothing in `currentState`

### Problem

The clothing line a character sees is verbose. The scene-state tracking **LLM
baseline** already uses `decorateOutfitItems(..., { titleOnly: true })`, but the
**live override** in `context-manager.ts` (~lines 1169–1174) calls
`decorateOutfitItems(...)` *without* `titleOnly`, re-introducing every equipped
item's full `(description)` prose, comma-joined across all slots and layers.

### Decision

Make the cheap LLM in `updateSceneState`
([`lib/memory/cheap-llm-tasks/image-scene-tasks.ts`](../../../lib/memory/cheap-llm-tasks/image-scene-tasks.ts),
~line 591) the **owner of a concise, salience-based clothing description** — what
is visually prominent right now (outer layers may hide inner; drop per-item
trivia), not a rattle-off of every piece. Rejected the cheaper "just pass
`titleOnly: true`" trim in favor of true summarization.

### Implementation

1. **Prompt.** Extend the `updateSceneState` clothing instruction so the per-character
   `clothing` field is a concise summary. Model the constraint on the existing
   image-prompt clothing rule already in this file: **single short sentence of
   plain prose, ≤200 characters, no markdown / bullets / parentheticals.** Enforce
   the 200-char cap defensively in code after the LLM returns (truncate or
   re-request), not just in the prompt.
2. **Cache in `sceneState`.** Store the summarized clothing line **in
   `sceneState` itself**, alongside the **equipped-outfit hash** it was derived
   from. On each tracking run, if a character's current equipped-outfit hash
   matches the stored hash, reuse the cached summary instead of re-summarizing
   (the outfit only changes on a wardrobe edit). Add the field(s) to
   `SceneStateSchema` ([`lib/schemas/chat.types.ts`](../../../lib/schemas/chat.types.ts)).
3. **Live override.** Change the override in `context-manager.ts` so it only
   replaces the cached clothing line **when the wardrobe actually changed
   mid-turn** (hash mismatch), rather than always winning with raw
   `decorateOutfitItems` prose. When it does fire mid-turn, prefer summarizing
   too — do not fall back to the verbose join.

### Watch out

- `sceneState` is re-serialized through `SceneStateSchema` every tracking run, so
  the new field must round-trip. Per CLAUDE.md, a `sceneState` schema change must
  be checked against `.qtap`/SillyTavern exports,
  `public/schemas/qtap-export.schema.json`, backups, `migrations/`, and
  [`DDL.md`](../DDL.md). A migration is likely needed for existing rows (default
  the new fields; they'll repopulate on next fold/track).
- Helpers live in
  [`lib/wardrobe/outfit-description.ts`](../../../lib/wardrobe/outfit-description.ts)
  (`describeOutfit`, `decorateOutfitItems`).

---

## 2. Workstream B — Recap's "Recent Conversations" → two vault-sourced lists

### Problem

`buildRecentConversationsBlock`
([`lib/memory/memory-recap.ts`](../../../lib/memory/memory-recap.ts), line 39)
inlines `chat.contextSummary` from `findRecentSummarizedByCharacter` as static
text. The chat id is printed but not actionable, and selection is "most recent N"
with no relevance.

### Decision

Replace that sub-block (the one appended inside `generateMemoryRecap`) with **two
separate lists** drawn from the vault summary files:

- **Recent list** — recency-ordered.
- **Relevant list** — semantic retrieval over the embedded vault summaries
  against the current moment.

Each entry surfaces its `conversationId` (from frontmatter) as a UUID the
character can pass to the existing `read_conversation` tool to pull the full
transcript. `read_conversation`
([`lib/tools/read-conversation-tool.ts`](../../../lib/tools/read-conversation-tool.ts),
handler [`lib/tools/handlers/read-conversation-handler.ts`](../../../lib/tools/handlers/read-conversation-handler.ts))
already accepts an optional `conversationId` and enforces that the calling
character participates in the target chat — no tool changes needed; just make the
block tell the LLM the UUID is callable.

### Sizing

Each list scales **independently** with context size on a **3 → 10 ramp**,
keeping the existing **4K → 32K token endpoints**. Generalize the ramp in
`calculateRecentConversationsLimit` (currently 5→20 over 4K→32K) to a reusable
`rampLimit(maxContext, min, max, minTokens, maxTokens)` and call it twice with
`min=3, max=10`. Combined block is **6–20 entries before dedup**.

### Dedup

A conversation may appear in both lists. **Dedup: keep it in the relevant list,
drop it from recent.** The total may fall below 6–20 when dups occur — that is
acceptable and expected.

### Replacement, not supplement

This replaces the old recent-conversations sub-block on the **same trigger** as
today's recap: chat is new **or** a character is newly added — **not every turn**.
(Trigger is computed in
[`lib/services/chat-message/context-builder.service.ts`](../../../lib/services/chat-message/context-builder.service.ts)
~line 566 as `isInitialMessage || character-just-joined`, flowing into
`generateMemoryRecap`.)

### Cold start

A vault summary file only exists after a summary fold has run for that
conversation, so a brand-new character's recent list may be thin at first. That
is acceptable; do not synthesize summaries to fill it.

### Implementation note — vault semantic search

There is **no existing exported service** that semantically searches vault
documents (memory search via `searchMemoriesSemantic` in
[`lib/memory/memory-service.ts`](../../../lib/memory/memory-service.ts) line 612
covers *memories*, not docs). You will need to add one: embed the query via the
same `generateEmbeddingForUser` path and search the character's document/vector
store scoped to the `Conversation Summaries/` folder, returning matches with
their `conversationId` frontmatter. Keep it a single reusable function; it is
also used by Workstream D's refresh.

---

## 3. Workstream C — Inter-character memories: half importance, half relevance

### Problem

Inter-character recall (`findByCharacterAboutCharacters` in
[`lib/database/repositories/memories.repository.ts`](../../../lib/database/repositories/memories.repository.ts)
~line 743, formatted by `formatInterCharacterMemoriesForContext` in
[`lib/chat/context/memory-injector.ts`](../../../lib/chat/context/memory-injector.ts)
~line 322) ranks only by importance then recency — **no relevance to the current
turn.**

### Decision

Halve the importance/recency entries and fill the freed half with **inter-char
memories that score highly for relevance to the current chat.** Per other
character present, the block becomes ~half "most important about them" + ~half
"most relevant to right now about them."

### Implementation

1. Cut `INTER_CHAR_PER_CHARACTER_LIMIT` (context-manager.ts ~line 149) from 10 to
   ~5 for the importance/recency half.
2. Add a **second, semantic source** filtered by `aboutCharacterId`.
   `searchMemoriesSemantic` does **not** currently support an `aboutCharacterId`
   filter — add an optional `aboutCharacterId?: string` to its options and apply
   it to the result set. Call it per other-present-character to fill the relevance
   half.
3. Merge the two halves in `formatInterCharacterMemoriesForContext`. **Dedup**
   across halves (a memory pulled by importance may also score relevant) — keep
   one copy; lean toward keeping it in the relevance half.

### Watch out

The existing budget math reserves ~half the post-semantic memory budget for
inter-char and applies a 70/30 semantic-vs-inter-char **compression** split
(context-manager.ts ~lines 1226–1397). Adding a second retrieval source must not
double-count tokens; re-check the budget subtraction and the compression split
still hold once inter-char content is two-sourced.

---

## 4. Workstream D — Periodic relevance refresh on fold

### Decision

Beyond the once-per-recap injection (Workstream B), re-run **only the
relevant-conversations** search and re-inject it into the Commonplace Book
whisper **whenever a summary fold happens**, because relevance drifts as the
conversation advances. Do **not** add a new turn-counter clock; piggyback on the
fold. The recent list does not need refreshing (it barely changes turn-to-turn).

### Implementation

The fold runs in `generateContextSummary`
([`lib/chat/context-summary.ts`](../../../lib/chat/context-summary.ts) ~line 297),
which already calls `writeConversationSummaryToVaults` (~line 473) and bumps
`compactionGeneration` (~line 416). After the vault summary write, trigger a
refresh of the relevant-conversations list and post an updated Commonplace Book
whisper for the affected character(s).

**Ordering matters:** the vault summary that drives the relevance search is itself
(re)written on fold. Sequence must be **fold → write vault summary → run relevance
search → post refreshed whisper**, so the search reads the fresh summary rather
than racing it.

### Resulting cadences

1. **Once** (chat-start / character-join) — recent + relevant conversation lists.
2. **Every turn** — existing relevant-memories, `currentState`, etc.
3. **On fold** — refreshed relevant-conversations half.

**Added later (4.9-dev):** a fourth cadence for the conversation list, fired on
*retrospective* turns (the dated `retrospective-recall` mini-recap, from the
episodic-recall overhaul), and a fifth that is off by default — the instance-wide
`memoryRecall.perTurnConversationSummaries` setting, which re-runs the
relevant-conversations search on **every** turn and folds the list into the
consolidated whisper's `relevantConversations` part. It is affordable per turn
because it never embeds anything: `searchMemoriesSemantic` hands the turn's query
vector back through `captureQueryEmbedding`, and
`searchVaultConversationSummaries` takes it as `precomputedEmbedding` (the
proactive pre-search path threads its vector through `runPreContextPreCompute` →
`buildMessageContext` → `buildContext`). No vector → no list that turn, and the cadence stands down on recap turns (the recap's own list already covers them). Both
turn-scoped lists dedup against the standing fold whisper's UUIDs, and the
retrospective list additionally dedups against the per-turn one.

---

## 5. Workstream E — "Regenerate conversation summaries" button (Memory settings)

### Decision

Add a button to the Commonplace Book settings tab (`/settings?tab=memory`) that
regenerates / re-mirrors the conversation summaries into every character vault —
a backfill for the files Workstream B depends on (and for repair after the schema
or format changes).

### Implementation

- UI lives in
  [`components/settings/tabs/MemorySearchTabContent.tsx`](../../../components/settings/tabs/MemorySearchTabContent.tsx).
  Model the new card on the existing `MemoryRegenerateCard`
  ([`components/tools/memory-regenerate-card.tsx`](../../../components/tools/memory-regenerate-card.tsx)):
  a `CollapsibleCard` with an action button that POSTs to a `?action=` endpoint,
  polls a GET for in-flight status, and uses `showSuccessToast` /
  `showErrorToast` + `notifyQueueChange`.
- Add a new action endpoint under `/api/v1/` (action-dispatch pattern, e.g.
  `chats?action=regenerate-summaries` or a new `system` feature route) that
  enqueues a fan-out re-running `writeConversationSummaryToVaults` for every chat
  that has a context summary, across its participant characters. Reuse the
  bridge; do not hand-roll vault writes.
- Background-job-side: the bridge already short-circuits to the parent via
  host-RPC when `QUILLTAP_JOB_CHILD === '1'` — keep that path.

---

## 6. Cross-cutting concerns (read before coding)

- **Schema/export propagation.** Both `sceneState` (Workstream A) changes must be
  reflected per CLAUDE.md in `.qtap`/SillyTavern exports,
  `public/schemas/qtap-export.schema.json`, backups, `migrations/`, and
  [`DDL.md`](../DDL.md). Conversation-summary frontmatter already exists; no schema
  change there.
- **Migrations.** Any new `sceneState` field needs a migration with a
  steampunk-voice pretty-label in
  [`lib/startup/prettify.ts`](../../../lib/startup/prettify.ts) and
  `reportProgress` on any collection loop (see CLAUDE.md "Writing migrations").
- **Tool snapshot.** No new tool is added (reusing `read_conversation`), so the
  tool-definitions snapshot should not change — but run
  `npx jest -u lib/tools/__tests__/tool-definitions-snapshot.test.ts` if any tool
  schema is touched.
- **Whisper rendering.** New material flows through the existing
  `CommonplaceParts` → `buildCommonplacePersonaWhisper` /
  `buildCommonplaceLLMContext` pair. Keep the persona (steampunk) vs. LLM (plain
  second-person) split intact; do not leak meta-narrative into the LLM context.
- **Budget.** Workstreams B, C, and D all add retrieval volume. Verify total
  recall stays within the memory budget after each; the inter-char 70/30
  compression split and the half-budget reservation must still balance.
- **Logging.** Every touched backend path fires debug logs via the built-in
  logging system (CLAUDE.md convention).
- **TypeScript / tests / changelog.** `npx tsc` (not `npm run build`); record
  changes in `docs/CHANGELOG.md` (plain voice); document user-visible changes
  (the regenerate button) in `help/*.md` with the required `url` frontmatter and
  In-Chat Navigation section.

## 7. Suggested commit sequence

1. **A** — concise clothing (self-contained; schema + migration).
2. **Vault semantic search helper** (shared by B and D) as its own change.
3. **B** — recap two-list rework on the new helper.
4. **C** — inter-char half-relevance (adds `aboutCharacterId` to semantic search).
5. **D** — fold-triggered relevance refresh.
6. **E** — regenerate button + backfill endpoint.

Each is independently testable. Land A and E early — they unblock testing of B/D
by ensuring vault summaries exist and are clean.
