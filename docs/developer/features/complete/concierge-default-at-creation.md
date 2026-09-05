# The Concierge — Choosing the State on the New Chat Form

**Status:** Implemented (4.9-dev, 2026-09-02)
**Scope:** quilltap-server — New Chat form (modal and `/salon/new` page), `POST /api/v1/chats`, greeting routing; no schema change, no migration, no shell impact
**Builds on:** [concierge-four-state.md](concierge-four-state.md) (the four states and their storage) and [concierge-list-marks.md](concierge-list-marks.md) (the shared presentation table)

## Summary

A chat's Concierge state can only be set after the chat exists, from the Salon
sidebar. A user who already knows a conversation will be spicy has to create it
as Monitored, wait for the Green Room to finish, open the sidebar, and flip the
switch — by which time the opening greeting has already gone out through the
ordinary desk and may already have been refused.

Add a **The Concierge** control to the New Chat form, directly above **Starting
Scenario**, offering the same four states in the same two optgroups as the
sidebar. Send the choice as `conciergeState` on the create request. On the server,
apply it through the existing `applyConciergeFlip` chokepoint right after the
system-prompt message is written and before any staff announcement or greeting,
so the announcement bubble sits where the history says the state was set and the
greeting is generated under the chosen state. Nothing new is stored: the control
is the sidebar's control, moved earlier in time.

## Goals

- Pick the Concierge state before the first word is spoken, from both New Chat
  surfaces (the modal opened from anywhere, and the standalone `/salon/new` page).
- The chosen state is in force for the opening greeting: an Uncensored or Flagged
  chat's greeting goes to the uncensored desk first, not as a content-filter
  fallback; a Vouched Safe chat's greeting never reroutes.
- One presentation, one wire enum, one transition chokepoint. No new copy, no new
  stored value, no new announcement kind.
- A plain create request that omits the field is byte-for-byte what it is today.

## Non-goals

- A project-level or global *default* Concierge state for new chats. The resolver
  keeps its documented Global → Project → Chat seam unused; this spec adds a
  per-chat pick at creation only. (Listed under follow-ups.)
- Changing any of the four states' meaning, storage, styling, or announcements.
- Per-state selection of which uncensored profile to use.
- The SillyTavern import path (`POST /api/v1/chats?action=import`) and `.qtap`
  import, which already carry `conciergeOverride` / `isDangerousChat` verbatim.

## Known State (verified 2026-09-02)

### The four states and their single sources

- **Derivation:** `getConciergeState`
  ([chat-override.ts:70](../../../../lib/services/dangerous-content/chat-override.ts))
  over the stored pair `chats.conciergeOverride` (`NULL` | `'OFF'` | `'UNCENSORED'`)
  and `chats.isDangerousChat`. `ConciergeState` (:63) is
  `'monitored' | 'flagged' | 'vouched' | 'uncensored'` and is also the wire
  contract for the sidebar's `PUT /api/v1/chats/[id]` `conciergeState`
  ([schemas.ts:125](<../../../../app/api/v1/chats/[id]/schemas.ts>), applied at
  [helpers.ts:587](<../../../../app/api/v1/chats/[id]/helpers.ts>)).
- **Transitions:** `applyConciergeFlip(chatId, requested, chat)`
  ([manual-flip.ts:57](../../../../lib/services/dangerous-content/manual-flip.ts))
  is the one chokepoint. It writes the right pair, is a no-op when the requested
  state equals the current one, and posts one of five announcement kinds
  ([writer.ts:171](../../../../lib/services/concierge-notifications/writer.ts)):
  `manual-flagged`, `manual-safe`, `manual-vouched`, `manual-resumed`,
  `manual-uncensored`. On a fresh chat (pair `NULL`/`null`, i.e. Monitored) the
  three non-Monitored requests post `manual-flagged`, `manual-vouched`, and
  `manual-uncensored` respectively, and a Monitored request posts nothing.
- **Presentation:** `CONCIERGE_STATE_PRESENTATION`
  ([concierge-state-presentation.ts:50](../../../../lib/services/dangerous-content/concierge-state-presentation.ts))
  carries label, icon, tone, and the helper sentence for each state, plus
  `conciergeToneTextClass`. Client-safe.
- **The sidebar control** ([ChatSidebar.tsx:1127](../../../../components/chat/ChatSidebar.tsx))
  is a `qt-select` under a `qt-label`, two `<optgroup>`s ("The Concierge decides":
  Monitored, Flagged; "You decide": Vouched Safe, Uncensored), the state's icon in
  the label, and the presentation `detail` as helper text underneath.

### The New Chat form

- **Component:** [NewChatForm.tsx](../../../../components/new-chat/NewChatForm.tsx),
  rendered by both [NewChatModal.tsx:252](../../../../components/new-chat/NewChatModal.tsx)
  and [NewChatPageClient.tsx:141](../../../../app/salon/new/NewChatPageClient.tsx).
  The field order today is Play As → Roleplay Template (:505) → Image Generation
  Profile (:535) → **Starting Scenario** (:552) → free-text scenario editor → …
  The new control goes between Image Generation Profile and Starting Scenario.
- **State:** `NewChatFormState` ([types.ts:143](../../../../components/new-chat/types.ts));
  `INITIAL_STATE` at [useNewChat.ts:107](../../../../components/new-chat/hooks/useNewChat.ts).
- **Request body:** built at [useNewChat.ts:755](../../../../components/new-chat/hooks/useNewChat.ts);
  the roleplay-template field (:768) is the model for "send only when it means
  something."
- **Continuation ("change of venue"):** `SalonView` opens the modal with
  `continuationFromChatId` ([SalonView.tsx:1720](<../../../../app/salon/[id]/SalonView.tsx>));
  the modal's `initial*` props ([NewChatModal.tsx:38](../../../../components/new-chat/NewChatModal.tsx))
  and `NewChatModalOptions` ([new-chat-provider.tsx:19](../../../../components/providers/new-chat-provider.tsx))
  pre-fill image profile, avatar generation, and timestamp config from the source
  chat. The Concierge state is **not** carried over today: a venue change of an
  Uncensored chat lands Monitored, and `applyChatContinuation` does not touch the
  pair either.

### The create route

- **Schema:** `createChatSchema` ([route.ts:96](../../../../app/api/v1/chats/route.ts)).
  There is no Concierge field. `chatType` is `'salon' | 'autonomous'` only; help
  and Brahma chats (the moderation-exempt types,
  [chat.types.ts:107](../../../../lib/schemas/chat.types.ts)) are not created here.
- **Row creation:** `repos.chats.create` at [route.ts:1089](../../../../app/api/v1/chats/route.ts)
  sets neither `conciergeOverride` nor `isDangerousChat`, so every new chat is
  Monitored.
- **Message ordering.** Three paths follow the create, and each writes the
  system-prompt message first:
  - ordinary: `createInitialMessages` (:577) → `writeSystemPromptMessage` (:338)
    then `createInitialMessagesScenarioAndStaff` (:363);
  - continuation: `writeSystemPromptMessage` (:1202) → `applyChatContinuation`
    → staff with `skipFirstMessage`;
  - autonomous room (:1232): `writeSystemPromptMessage` → staff with `skipFirstMessage`
    (the first turn comes from the room procedure when a run starts).

  `createInitialMessagesScenarioAndStaff` posts the Prospero context whisper,
  per-character group whispers, the Host scenario and user-character
  announcements, then (unless skipped) the greeting.
- **Greeting routing** (`autoGenerateFirstMessage`, :599). The greeting is
  generated on the responding participant's own connection profile. Only when a
  provider **content filter** is detected does "Attempt 3" (:758) consult
  `resolveDangerousContentSettings(chatSettings)` — with **no chat argument**, so
  it sees only the global mode — and reroute through
  `resolveProviderForDangerousContent` when that mode is `AUTO_ROUTE`. Two
  consequences once a state can be chosen up front:
  - an Uncensored chat under global `OFF` would never reroute its greeting, though
    the resolver's `'chat-uncensored'` branch
    ([resolver.service.ts:78](../../../../lib/services/dangerous-content/resolver.service.ts))
    forces `AUTO_ROUTE` for exactly that case;
  - a Vouched Safe chat under global `AUTO_ROUTE` would reroute its greeting on a
    filter hit, which Vouched Safe promises never to do.
- **Green Room:** `progress.status(...)` milestones are published from the route;
  "Recalling the previous chapter…" (:1200) is the pattern.

### Tests that exist

- `__tests__/unit/app/api/v1/chats/route.roleplay-template.test.ts` — the model
  for a create-route contract test: global `jest`, bare `jest.mock` factories,
  heavy dependencies stubbed, five cases over one optional field.
- `components/new-chat/__tests__/NewChatForm.test.tsx` — renders the form with
  stubbed children; `describe` blocks per control (scenario layering, Play As,
  roleplay template picker).
- `scripts/concierge-four-state-test.sh` — live acceptance checks CT-1/CT-2
  over the PUT path.

## Design

### 1. The control

In `NewChatForm.tsx`, immediately before the Starting Scenario block, add:

```tsx
{/* The Concierge — predefine the per-chat state before the first word */}
<div>
  <label htmlFor="new-chat-concierge" className="mb-2 block text-sm qt-text-primary">
    <span className="flex items-center gap-1.5">
      The Concierge
      <Icon name={conciergePresentation.icon} className={`w-3.5 h-3.5 ${conciergeToneTextClass(conciergePresentation.tone)}`} />
    </span>
  </label>
  <select
    id="new-chat-concierge"
    value={state.conciergeState}
    onChange={(e) => handleConciergeStateChange(e.target.value as ConciergeState)}
    disabled={creating}
    className="qt-select"
  >
    <optgroup label="The Concierge decides">
      <option value="monitored">Monitored (default)</option>
      <option value="flagged">Flagged</option>
    </optgroup>
    <optgroup label="You decide">
      <option value="vouched">Vouched Safe</option>
      <option value="uncensored">Uncensored</option>
    </optgroup>
  </select>
  <p className="qt-text-xs qt-text-muted mt-1">{conciergePresentation.detail}</p>
</div>
```

where `conciergePresentation = CONCIERGE_STATE_PRESENTATION[state.conciergeState]`.
Labels, icon, tone, and helper text come from the presentation table; the
optgroup captions are the sidebar's, verbatim. The only copy this control adds is
the "(default)" suffix on Monitored, matching the Roleplay Template dropdown's
convention on the same form. The presentation `hint` ("Change it from the Salon
sidebar's Chat section.") is **not** shown here: the user is looking at the
control that changes it.

The control renders for every chat the form can create, autonomous rooms
included: an autonomous room is not moderation-exempt, and its runs take the
same routes a Salon chat does.

### 2. Client state and request body

- `NewChatFormState` gains `conciergeState: ConciergeState`; `INITIAL_STATE` sets
  `'monitored'`. Import the type from
  `@/lib/services/dangerous-content/chat-override` (types only; the module is
  client-safe and `quick-hide-provider.tsx` already imports from it).
- `handleConciergeStateChange` is a one-line `setState` merge.
- `useNewChat`'s request builder adds, beside the roleplay-template block:

  ```ts
  // Omitted when Monitored so a plain create stays byte-identical to today;
  // the server treats absence and 'monitored' the same way (no flip).
  if (state.conciergeState !== 'monitored') {
    requestBody.conciergeState = state.conciergeState
  }
  ```

- **Continuation seeding.** Add `initialConciergeState?: ConciergeState | null`
  through the same three layers as `initialImageProfileId`
  (`NewChatModalOptions` → `NewChatModal` props → `useNewChat` options), seed
  `state.conciergeState` from it when present, and have `SalonView`'s
  change-of-venue launcher pass `getConciergeState(chat)`. A spicy conversation
  that changes venue stays spicy by default; the user can still override it on
  the form. This also means the announcement bubble in the new chat says so,
  which the replayed history otherwise would not.

### 3. Wire contract

`createChatSchema` gains:

```ts
/**
 * Per-chat Concierge state to set at creation, using the same enum as the
 * sidebar's PUT `conciergeState`. Omitted or 'monitored' → the chat is created
 * Monitored exactly as today (no write, no announcement). Any other value is
 * applied through `applyConciergeFlip` after the system-prompt message and
 * before any staff announcement or greeting.
 */
conciergeState: z.enum(['monitored', 'flagged', 'vouched', 'uncensored']).optional(),
```

Spell the enum out rather than deriving it from `ConciergeState`, matching
[schemas.ts:125](<../../../../app/api/v1/chats/[id]/schemas.ts>); a mismatch fails
type-checking where the value is passed to `applyConciergeFlip`. An invalid value
is a Zod validation error (400), like every other field on this schema.

### 4. Applying the state on the server

Add one helper to `route.ts`, beside `writeSystemPromptMessage`:

```ts
/**
 * Apply a Concierge state requested at creation. Runs after the system-prompt
 * message and before any staff announcement or greeting, so the Concierge's
 * bubble is the first thing in the history after the prompt and the greeting
 * is generated under the chosen state. Monitored (or absence) is a no-op:
 * `applyConciergeFlip` compares against the fresh row and does nothing.
 */
async function applyRequestedConciergeState(
  chat: ChatMetadata,
  requested: ConciergeState | undefined,
  progress: CreationProgressEmitter,
): Promise<void> {
  if (!requested || requested === 'monitored') return;
  progress.status('Briefing the Concierge…');
  const result = await applyConciergeFlip(chat.id, requested, chat);
  logger.debug('[Chats v1] Applied Concierge state at creation', { chatId: chat.id, requested, changed: result.changed });
}
```

Call it in all three post-create paths, directly after their
`writeSystemPromptMessage` call and before anything else. For the ordinary path
that means splitting `createInitialMessages` into its two halves at the call
site (or threading the value through it); the continuation path calls it before
`applyChatContinuation`, so the bubble precedes the replayed tail.

Ordering is the point of this placement. Because `applyConciergeFlip` writes the
pair before `createInitialMessagesScenarioAndStaff` runs, the greeting path's
`repos.chats.findById(chatId)` sees the chosen state, and any later reader
(scheduled danger scan, memory extraction, story backgrounds) does too.

The route runs in the parent process, so the announcement's write is immediate,
not buffered.

### 5. Greeting routing under the chosen state

`autoGenerateFirstMessage` is a route decision and must ask the chat, not the
globe:

- Pass the fresh chat row to the resolver:
  `resolveDangerousContentSettings(chatSettings, chat)`. This alone fixes both
  consequences listed under Known State: Vouched Safe never reroutes, Uncensored
  reroutes even under global `OFF`.
- When `shouldUseUncensoredRoute(chat)` is true, resolve the uncensored provider
  **first** and generate the greeting there, falling back to the participant's
  own profile only if no uncensored profile is configured or the reroute call
  fails. The existing three-attempt ladder (with memories → without → uncensored
  on content filter) remains the path for Monitored chats.

The effect: an Uncensored chat's opening line comes from the frank desk on the
first try, which is the whole reason a user would choose the state before the
chat exists.

### 6. What is deliberately not touched

- **Storage, DDL, export schema, migrations.** The pair already admits every
  state; `.qtap` export already carries it; no column changes.
- **Announcement copy.** See the decision below.
- **`chat-enrichment`, list marks, Quick-hide.** They derive from the pair and
  pick the new chat up unchanged. A chat created Uncensored wears its blue mark
  and is hidden by "Dangerous Chats" from its first listing; the help doc says so.

## Decisions of record

**Offer all four states, Flagged included.** Flagged at creation is an
operator-asserted Flagged — exactly what the sidebar's `manual-flagged` case
already produces — and hiding it here would give the two controls different
option lists for the same enum. The helper text, shared with the sidebar, already
steers users who want "spicy without the apparatus" toward Uncensored.

**Reuse the `manual-*` announcement kinds.** Considered: three new kinds
(`opened-flagged`, `opened-vouched`, `opened-uncensored`) with creation-flavoured
copy. Rejected: six more sentences to keep in voice for a bubble whose job is to
say which state was in force from when, and the existing sentences already do
that. `applyConciergeFlip` posts them for free.

**Omit `conciergeState` from the request when Monitored.** Absence and
`'monitored'` are equivalent on the server; omitting keeps the default create
request, and every existing route test's expectations, unchanged.

**Apply after the system-prompt message, not before `chats.create`.** Writing the
pair into the create call would save a round trip but skip the announcement and
bypass the chokepoint. The history should read: system prompt, Concierge's note,
then the scene.

## Implementation phases

1. **Server.** Schema field; `applyRequestedConciergeState`; wire into the three
   paths; greeting routing per §5. Land with the route tests below. This is the
   only phase with behavioural risk and can ship alone.
2. **Client.** State field, control, request body, continuation seeding.
3. **Docs.** `help/chats.md`, `help/dangerous-content.md`, `docs/developer/API.md`,
   CHANGELOG, release notes.

## Testing

- **Route — `__tests__/unit/app/api/v1/chats/route.concierge-state.test.ts`**,
  modelled on the roleplay-template suite, mocking `applyConciergeFlip`:
  - omitted → not called, no announcement;
  - `'monitored'` → not called;
  - each of `'flagged'`, `'vouched'`, `'uncensored'` → called once with that value
    and the created chat, **after** the system-prompt `addMessage` and **before**
    any staff writer or greeting call (assert mock call order);
  - an unknown value → 400;
  - continuation path: called before `applyChatContinuation`.
- **Route — greeting routing.** With `shouldUseUncensoredRoute` true and an
  uncensored profile configured, `resolveProviderForDangerousContent` is called
  before the first `generateGreetingMessage`; with a Vouched Safe chat and a
  content-filter hit under global `AUTO_ROUTE`, no reroute happens.
- **Form — `NewChatForm.test.tsx`**, a new `describe('NewChatForm Concierge picker')`:
  renders two optgroups with the four options; Monitored is selected and suffixed
  "(default)"; helper text equals `CONCIERGE_STATE_PRESENTATION[state].detail`;
  changing the select updates `state.conciergeState`.
- **Hook — request body.** Monitored → key absent; any other → key present with
  that value. (Add a small `useNewChat` body-builder test if none exists; the
  hook has no suite today.)
- **Acceptance — `scripts/concierge-four-state-test.sh`.** Add CT-3: create a
  throwaway chat via `POST /api/v1/chats` with each non-Monitored state and assert
  the stored pair and the presence of exactly one Concierge bubble after the
  system prompt, via read-only CLI queries.

## Documentation and housekeeping

- **`help/chats.md`** (url `/salon`): a new subsection under "Starting a Chat",
  after the Roleplay Template one, in the house voice — the control, that
  Monitored is the default, that the Concierge announces the choice at the top
  of the chat, that a chat created Uncensored is hidden by Quick-hide's
  "Dangerous Chats" from the start, and that the sidebar switch still changes it
  later.
- **`help/dangerous-content.md`** ("The Per-Chat Concierge Switch"): the sentence
  "It is the only place a chat's relationship with the Concierge may be set…"
  is no longer true; amend it and point at the New Chat form.
- **`docs/developer/API.md`** (`POST /api/v1/chats`): a `conciergeState` note
  beside the `roleplayTemplateId` one.
- **`docs/CHANGELOG.md`** (4.9-dev, plain voice) and a line in the Concierge
  paragraph of `docs/releases/4.9.0.md` if this ships in 4.9.
- Version bump and lint/test/tsc via `/commit`.

## Follow-ups (out of scope)

- **Project-level default Concierge state.** The resolver's Global → Project →
  Chat seam is the natural home; the form would then pre-select the project's
  default and mark it "(default)" the way the template picker does.
- **A global "new chats start as…" setting** under Settings → Chat, for users
  whose instance is entirely one kind of thing.
