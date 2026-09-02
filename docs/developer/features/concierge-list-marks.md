# Concierge Marks on Chat Lists

**Status:** Planned (4.9-dev, 2026-09-02)
**Scope:** quilltap-server — homepage Recent Chats (primary), Quick-hide's
"Dangerous Chats" filter, Salon header badge and sidebar (shared copy), `ChatCard`
lists (same mark); no schema change, no shell impact
**Builds on:** [concierge-four-state.md](complete/concierge-four-state.md) — this
resolves its open question 2 ("Should Vouched Safe suppress the danger badge on
list-view cards?")

## Summary

The homepage's Recent Chats list marks a chat with a small red asterisk when its
stored `isDangerousChat` label is true
([RecentChatItem.tsx:72](../../../components/homepage/RecentChatItem.tsx)), and
Quick-hide's "Dangerous Chats" toggle hides on the same raw label at four sites.
Both predate the four-state Concierge control and are wrong in two directions:

- **They read the raw label.** A chat the operator has *vouched safe* keeps its
  label underneath (by design — the label is preserved as the classifier's
  verdict), so a vouched chat still wears the red asterisk and still hides. An
  *uncensored* chat, which takes every spicy route, wears nothing and never hides.
  `chat-override.ts` says in its header that nothing outside it should read the
  raw fields; these are the last UI places that do.
- **The mark carries one bit of meaning.** The Salon header already distinguishes
  three non-default states by colour — red Flagged, grey Vouched Safe, blue
  Uncensored — and the list gives no hint which one applies.

The change:

1. Derive the mark from `getConciergeState`, show an asterisk for **every state
   other than Monitored**, colour it with the same three tones the header pill
   uses, and explain it with a Quilltap-drawn tooltip
   ([`components/ui/Tooltip.tsx`](../../../components/ui/Tooltip.tsx)) — the
   native `title` widget is unreliable under the Electron shell, which is why the
   Salon's message buttons already moved off it.
2. Make "Dangerous Chats" hide the chats that **take the uncensored route** —
   Flagged (the Concierge's verdict) and Uncensored (the operator's) — and stop
   hiding vouched chats that merely carry an old label.
3. Put a derived `conciergeState` on the list payloads so no list reads the raw
   pair again.

|  | Concierge decides | operator decides |
|---|---|---|
| **ordinary route** | Monitored — *no mark*, never hidden | Vouched Safe — **grey** `*`, never hidden |
| **uncensored route** | Flagged — **red** `*`, hidden by the toggle | Uncensored — **blue** `*`, hidden by the toggle |

Monitored renders nothing, matching the header rule: a mark means "something other
than the default is in force." The hide rule is the bottom row of the table.

## Decision of record: `isDangerousChat` stays the classifier's label

Considered and rejected: redefining `chats.isDangerousChat` to mean "takes the
uncensored route, by either provenance." The reasons, so nobody re-litigates it:

- **The concept already exists, derived.** `shouldUseUncensoredRoute(chat)` is
  exactly "uncensored by choice or by the Concierge's determination." Storing the
  same answer in a column makes a second source of truth that drifts the first time
  a writer sets `conciergeOverride` and forgets the label.
- **The column is tri-state and owned by the classifier.** `null` = never scanned,
  `false` = scanned and found safe, `true` = scanned and found dangerous. The
  scheduled scan ([scheduled-danger-scan.ts:138](../../../lib/background-jobs/scheduled-danger-scan.ts))
  and the classification handler use `null`-vs-`false` plus
  `dangerClassifiedAtMessageCount` to decide what to re-scan. An operator-written
  `true` would corrupt that freshness logic.
- **It is one of the two inputs to the 2×2.** With the override known, the label
  is what separates Monitored from Flagged. Remove its meaning and the derivation
  has nothing to derive from.
- **It is a stored and exported value.** The four-state commit deliberately reused
  no stored or wire value with a new meaning; this would be exactly that, and every
  `.qtap` export in the wild carries the old meaning.

What made the column *feel* useless is that lists read it raw. The fix is on the
wire, not in storage: list payloads carry a derived `conciergeState` (below), and
the raw pair stays inside the enrichment service and the sanctioned writers.

## Design

### One presentation table for the four states

Today the four states are described in three places with three different sets of
words: the header badge's `title` strings in
[SalonView.tsx:1082–1118](<../../../app/salon/[id]/SalonView.tsx>), the sidebar's
helper text and icon map in
[ChatSidebar.tsx:1128–1144](../../../components/chat/ChatSidebar.tsx), and the
list asterisk's `"Flagged as dangerous"`. Adding a fourth consumer by copy-paste is
how the copy drifts.

Add **`lib/services/dangerous-content/concierge-state-presentation.ts`** beside
`chat-override.ts` (both client-safe — type-only imports). It is the single source
for everything a UI needs to *show* a state; `chat-override.ts` remains the single
source for *deriving* one.

```ts
export type ConciergeTone = 'danger' | 'muted' | 'info' | 'success'

export interface ConciergeStatePresentation {
  /** Short label — badge text, aria-label, tooltip title. */
  label: string                 // 'Monitored' | 'Flagged' | 'Vouched Safe' | 'Uncensored'
  icon: IconName                // 'eye' | 'alert-triangle' | 'check-circle' | 'eye-off'
  tone: ConciergeTone           // success | danger | muted | info
  /** The sidebar's helper sentence — the full "what this means", Quilltap voice. */
  detail: string
  /** Where to change it; appended to tooltips outside the sidebar. */
  hint: string                  // "Change it from the Salon sidebar's Chat section."
}

export const CONCIERGE_STATE_PRESENTATION: Record<ConciergeState, ConciergeStatePresentation>

/** Tone → class suffix shared by the badge and mark families ('' for danger). */
export function conciergeToneSuffix(tone: ConciergeTone): '' | '-muted' | '-info' | '-success'

/**
 * Everything a tooltip needs, in order: title, detail, optional category line
 * (Flagged only, when `dangerCategories` is non-empty), hint.
 */
export function describeConciergeState(
  state: ConciergeState,
  dangerCategories?: string[],
): { title: string; detail: string; categories: string[] | null; hint: string }
```

The four `detail` strings are the existing sidebar helper sentences, moved verbatim
(they are already the most complete statement of each state and already in voice):

- **Monitored** — "The Concierge keeps watch, and will flip the switch himself if the conversation calls for it."
- **Flagged** — "The Concierge has this chat down as dangerous, and routes it through the uncensored providers."
- **Vouched Safe** — "You have vouched for this chat. The Concierge stops watching; the ordinary providers still apply, and may still refuse."
- **Uncensored** — "You have sent the Concierge away and opened the uncensored door yourself. Nothing is scanned, nothing is softened — the risk is yours."

Flagged tooltips append `Categories: NSFW, Violence` when the chat carries
`dangerCategories`, as the header badge's title does today.

### The route question, answerable from a state alone

`shouldUseUncensoredRoute(chat)` takes a chat-like and derives the state first.
Lists that already hold a `conciergeState` need the same truth table without a
fake chat. Add to `chat-override.ts`:

```ts
/** The bottom row of the 2×2: Flagged and Uncensored. */
export function conciergeStateUsesUncensoredRoute(state: ConciergeState): boolean {
  return state === 'flagged' || state === 'uncensored'
}
```

and make `shouldUseUncensoredRoute` a one-line delegate to it, so there is still
exactly one place that says which states are on the uncensored row. Extend the
existing truth-table test in
`__tests__/unit/lib/services/dangerous-content/chat-override.test.ts`.

### `conciergeState` on the wire

The list shapes stop carrying the raw pair and carry the derived state instead:

- **`EnrichedChatSummary`** ([chat-enrichment.service.ts:207](../../../lib/services/chat-enrichment.service.ts))
  gains `conciergeState: ConciergeState` (computed once with `getConciergeState`
  at the same spot that currently copies `isDangerousChat` / `conciergeOverride`,
  line 602) and `dangerCategories: string[]` (from the chat row, `[]` default).
  Drop `isDangerousChat` and `conciergeOverride` from the summary once no
  consumer reads them — the list route's `hasDangerous` at
  [chats/route.ts:898](../../../app/api/v1/chats/route.ts) is the one server-side
  reader, and it moves to `conciergeStateUsesUncensoredRoute` (see Quick-hide below).
- **`RecentChat`** ([types.ts](../../../components/homepage/types.ts)):
  `isDangerousChat` → `conciergeState: ConciergeState`, plus `dangerCategories?: string[]`.
  `getHomeData` ([home-data.service.ts:67](../../../lib/services/home-data.service.ts))
  passes both through. The `/api/v1/system/home` route serialises whatever the
  service returns; no route change.
- **`ChatCardData`** and the two transforms in
  [lib/chat-utils.ts](../../../lib/chat-utils.ts) (`SalonChatShape`,
  `CharacterChatShape`): same substitution. The Salon list is fed by the
  enrichment service and gets the field for free; the character-conversations tab
  and Prospero's `ChatsSection` have their own API shapes — check each during
  implementation and add `conciergeState` to the serialiser where it is missing.

No schema, migration, DDL, export-schema, or backup change: `conciergeState` is
derived at read time, and `dangerCategories` already exists on `chats` and in the
`.qtap` export. The detail view (`app/salon/[id]/types.ts`) keeps the raw pair —
the sidebar's manual-flip control genuinely needs both.

### Quick-hide hides the uncensored row

[quick-hide-provider.tsx](../../../components/providers/quick-hide-provider.tsx):
`shouldHideChat` takes `{ characterTags?, conciergeState? }` instead of
`{ characterTags?, isDangerous? }` and hides when
`hideDangerousChats && conciergeState && conciergeStateUsesUncensoredRoute(conciergeState)`.
The four inline filters that bypass `shouldHideChat` today are rewritten to call
it, so the rule lives in one place:

- [RecentChatsSection.tsx:23](../../../components/homepage/RecentChatsSection.tsx)
- [SalonListView.tsx:105](../../../app/salon/SalonListView.tsx)
- [character-conversations-tab.tsx:51](../../../components/character/character-conversations-tab.tsx)
- [ChatsSection.tsx:69](<../../../app/prospero/[id]/components/ChatsSection.tsx>) (Prospero)

The sidebar footer's "there is something to hide" affordance
([sidebar-footer.tsx:145](../../../components/layout/left-sidebar/sidebar-footer.tsx))
reads `hasDangerousChats` from the chats list route, which computes it from the raw
label at line 898; that becomes "any chat on the uncensored row" so the toggle
appears exactly when it would hide something. The `localStorage` key and the menu
label ("Dangerous Chats") do not change — the word still fits what is hidden.

### A `ConciergeMark` component

**`components/chat/ConciergeMark.tsx`** — the asterisk. Props:
`{ conciergeState: ConciergeState; dangerCategories?: string[]; className?: string }`.
Returns `null` for Monitored; otherwise:

```tsx
<Tooltip content={<ConciergeTooltipBody {...describeConciergeState(state, dangerCategories)} />} placement="top">
  <span
    role="img"
    aria-label={`Concierge: ${label}`}
    className={`qt-concierge-mark qt-concierge-mark${conciergeToneSuffix(tone)} ${className}`}
  >
    *
  </span>
</Tooltip>
```

- **No `title`** on the span — the Tooltip component's own contract (a native
  tooltip would double up on ours).
- **Not `pinnable`.** The mark sits inside a `<Link>`; a click must keep navigating.
  `Tooltip` attaches no `onClick` when `pinnable` is false, so the click bubbles to
  the link untouched.
- **Tooltip body** uses the existing `qt-tooltip-body` / `qt-tooltip-title`
  classes ([_surfaces.css:1104](../../../app/styles/qt-components/_surfaces.css)):
  a title line (the label), the detail sentence, the optional categories line, and
  the hint in a quieter tone. `ConciergeTooltipBody` is a tiny presentational
  component exported from the same file so the header badge can reuse it.
- **Keyboard reach (decided):** the mark is not focusable — a focusable child of a
  link is worse than the gap — so keyboard users get the `aria-label` but not the
  tooltip. The sidebar's Chat section is the full-text home of the same words.

### CSS: a mark family beside the badge family

The header pill is `.qt-danger-badge` parameterised over `--qt-concierge-badge-color`
with `-muted` / `-info` modifiers
([_chat.css:2830–2846](../../../app/styles/qt-components/_chat.css)). Add a sibling
family in the same block rather than reusing badge-named modifiers on a non-badge:

```css
/* Concierge mark — the list-view asterisk. Same three tones as the badge. */
.qt-concierge-mark {
  --qt-concierge-mark-color: var(--color-destructive, #dc2626);
  @apply inline-block font-bold leading-none;
  color: var(--qt-concierge-mark-color);
}
.qt-concierge-mark-muted { --qt-concierge-mark-color: var(--color-muted-foreground, #6b7280); }
.qt-concierge-mark-info  { --qt-concierge-mark-color: var(--color-info, #2563eb); }
```

Three rules, one variable, same colour tokens as the badge so themes that retint
`--color-destructive` / `--color-info` retint both at once. Mirror the family into
[`packages/theme-storybook/src/css/qt-components.css`](../../../packages/theme-storybook/src/css/qt-components.css)
next to the badge block (de-Tailwinded), bump theme-storybook to **1.0.69**, and
**stop for the human to `npm publish`** before installing — the publish gates the
commit. `qt-concierge-mark` is a bare component class, outside the
`check-qt-classes` gate's checked families, but the gate still runs and must pass.

### Freshness

The home payload has no realtime topic (`queryKeys.home` is absent from
`lib/realtime/topic-map.ts`, deliberately). A state flipped in the Salon sidebar
reaches the home tab on re-activation via `tabActivationQueryKeys`
([tab-refetch.ts:46](../../../lib/workspace/tab-refetch.ts)), and the legacy `/`
route is server-rendered per load. That matches how the existing asterisk behaves;
**do not add a poll** (CLAUDE.md: a new polling site is a bug). If it ever needs to
be live, the right move is a `home` row in `REALTIME_TOPICS` fed from the chat
update chokepoint — out of scope here.

### Header badge and sidebar consume the same table

Once the presentation module exists, the three inline `if` blocks in `SalonView`'s
header effect collapse to one lookup, and its `title=` attributes become the same
`Tooltip` + `ConciergeTooltipBody` the mark uses. The sidebar's `conciergeHelperText`
and `conciergeStateIcon` ternaries become `CONCIERGE_STATE_PRESENTATION[state]`
reads (the sidebar keeps its `qt-text-*` icon classes — map `tone` → class there,
or add a `textClass` field; either is fine, pick one and don't duplicate).

This is the part that makes the tooltip "say exactly what they mean": the mark,
the pill, and the sidebar all speak from one table, so a copy edit lands in all
three.

### Raw-label reads: audited, one fix folded in

After this change the raw `isDangerousChat` is read outside `chat-override.ts`
only by its sanctioned owners: the classifier handler, the classification trigger,
the scheduled scan, `manual-flip`, the Almanack ledger, export/import, and the
Salon detail view (which hands both fields to the sidebar). The audit confirmed:

- **Memory extraction already takes the uncensored route for Uncensored chats.**
  Every extraction path — `memory-extraction.ts:151`, `carina-memory-extraction.ts:136`,
  `memory-regenerate-all.ts:60`, the four sites in `message-finalizer.service.ts`,
  and the orchestrator's recap fallback — passes `shouldUseUncensoredRoute(chat)`
  as its `isDangerousChat` argument. Nothing to change there. (The planning
  note that suspected otherwise had misread the trigger below.)
- **The classification trigger enqueues a doomed job for Uncensored chats.**
  `triggerChatDangerClassification`
  ([memory-trigger.service.ts:147](../../../lib/services/chat-message/memory-trigger.service.ts))
  gates on the resolver's mode and on the raw sticky label, but never asks
  `isClassifierOnDuty`. A *vouched* chat is fine by accident: the resolver
  collapses it to `mode: 'OFF'`, so the trigger bails. An *uncensored* chat
  resolves to `AUTO_ROUTE` (the resolver keeps the route open on purpose), and
  its preserved label is usually `false` or `null`, so the trigger enqueues a
  `CHAT_DANGER_CLASSIFICATION` job on every turn — from both the streaming
  finalizer and the message-edit route — which the handler then discards at its
  own `!isClassifierOnDuty` guard
  ([chat-danger-classification.ts:57](../../../lib/background-jobs/handlers/chat-danger-classification.ts)).
  Harmless to the data, wasteful in the job child. **Fix (Phase 1):** add
  `if (!isClassifierOnDuty(chat)) return` immediately after the chat lookup,
  before the resolver call, and refresh the stale "Off-duty" comment above it.
  The remaining `chat.isDangerousChat === true` sticky read stays — it is the
  classifier's own gate. Test: `__tests__/unit/services/chat-danger-trigger.test.ts`
  gains "skips without enqueueing when the operator decided" for both
  `conciergeOverride: 'OFF'` and `'UNCENSORED'`, with a `false` label.
- [MessageRow.tsx:578](<../../../app/salon/[id]/components/MessageRow.tsx>) memo
  comparison on `isDangerousChat` — harmless (it only decides re-render), noted
  for completeness.

## Behaviour changes to call out

1. **A vouched chat with a preserved dangerous label loses its red asterisk** and
   gains a grey one, **and is no longer hidden by "Dangerous Chats."** This is the
   resolution of the four-state doc's open question 2: the list surfaced the
   *label*; it now surfaces the *state*, exactly as the header does.
   `shouldShowDangerStyling` (red rings) is untouched — only the mark and the
   hide rule change.
2. **An uncensored chat gains a blue asterisk** where it had nothing, **and is now
   hidden by "Dangerous Chats."**
3. **The "hide" affordance in the sidebar footer** appears when any chat is on the
   uncensored row, rather than when any chat carries the label.
4. **Uncensored chats stop enqueueing a classification job per turn.** No visible
   change; one fewer discarded job in the child per message.

## Phases

Small enough for one branch; the phases are commit boundaries, not milestones.
Delegate 1, 2, and 6 freely — they are fully specified above.

### Phase 1 — derivation and presentation

- `conciergeStateUsesUncensoredRoute` in `chat-override.ts`; `shouldUseUncensoredRoute`
  delegates. Extend `chat-override.test.ts`.
- `isClassifierOnDuty` guard in `triggerChatDangerClassification` (see the audit
  above); extend `chat-danger-trigger.test.ts`.
- `lib/services/dangerous-content/concierge-state-presentation.ts` as specified.
- Unit test `__tests__/unit/lib/services/dangerous-content/concierge-state-presentation.test.ts`:
  full four-state table (label/icon/tone), `describeConciergeState` for each state,
  categories present only for Flagged and only when non-empty, tone suffixes.

### Phase 2 — CSS + storybook mirror

- `.qt-concierge-mark` family in `_chat.css` beside `.qt-danger-badge`.
- Faithful mirror in theme-storybook; bump to 1.0.69; `npm run build` in the
  package; **stop and ask for `npm publish`**.
- `npm run lint` (all three gates).

### Phase 3 — `conciergeState` on the wire

- `EnrichedChatSummary.conciergeState` + `dangerCategories`; `RecentChat` and
  `ChatCardData` shapes and transforms; `home-data.service.ts` pass-through.
- Character-conversations and Prospero chat-list serialisers: add `conciergeState`
  where missing.
- `hasDangerous` in `chats/route.ts` → uncensored row.
- Tests: transforms (`lib/chat-utils` tests) and the home service test if one
  exists; otherwise a focused test that `getHomeData` emits the state for each of
  the four stored combinations.

### Phase 4 — Quick-hide

- `shouldHideChat` signature change in `quick-hide-provider.tsx`; the four inline
  filters call it.
- Tests: the provider's existing tests (or new ones) assert hidden for Flagged and
  Uncensored, visible for Monitored and Vouched, and that tag hiding is unchanged.

### Phase 5 — the mark on the homepage

- `ConciergeMark` + `ConciergeTooltipBody` in `components/chat/ConciergeMark.tsx`.
- `RecentChatItem` replaces the inline span with
  `<ConciergeMark conciergeState={chat.conciergeState} dangerCategories={chat.dangerCategories} />`.
- Tests in `__tests__/unit/components/homepage/homepage-components.test.tsx`
  (`createMockRecentChat` gains the fields): no mark for Monitored; red/grey/blue
  class for the other three; `aria-label`; tooltip text appears on `pointerEnter`
  after the delay (follow the timer pattern in
  [`__tests__/unit/components/tooltip.test.tsx`](../../../__tests__/unit/components/tooltip.test.tsx));
  clicking the mark still fires the link's `onClick`; the section hides Flagged
  and Uncensored when the toggle is on.

### Phase 6 — header badge and sidebar read the table

- `SalonView` header effect: one lookup, `Tooltip` instead of `title`. The effect's
  dependency list already includes `conciergeOverride` and `dangerCategories`.
- `ChatSidebar` helper text and icon from the table. The strings move verbatim, so
  any component test asserting them keeps passing.

### Phase 7 — the same mark on chat cards

- `ChatCard.tsx:288` uses `ConciergeMark`.
- Extend the `ChatCard` tests for the four states.

### Phase 8 — docs and wrap-up

- `help/homepage.md` — Recent Chats bullets: describe the mark and its three
  colours, in voice, and that hovering explains it.
- `help/dangerous-content.md` — the paragraph at line 249 about the header pill:
  add that the same colours mark chats in Recent Chats and on chat cards, and that
  Monitored wears nothing anywhere. Its Quick-Hide Integration section: the toggle
  hides whatever takes the uncensored route, by either hand.
- `help/quick-hide.md` — "Dangerous Chats" section (line 145): same redefinition;
  a vouched chat is not hidden, an uncensored one is.
- `docs/CHANGELOG.md` under 4.9-dev, plain voice: "Changed: chat lists and
  Quick-hide follow the Concierge state, not the raw danger label," with the
  vouched/uncensored behaviour changes spelled out. A second entry, "Fixed:
  Uncensored chats enqueued a classification job every turn that the handler
  then discarded."
- Append a "Resolved" note under open question 2 in
  `concierge-four-state.md` pointing here.
- `git mv` this file to `docs/developer/features/complete/` and update
  [update-documentation](../../../.claude/commands/update-documentation.md),
  which lists feature docs individually.

## Verification

- `npx tsc`, `npm run lint`, `npx jest __tests__/unit/components/homepage __tests__/unit/components/tooltip.test.tsx __tests__/unit/lib/services/dangerous-content __tests__/unit/services/chat-danger-trigger.test.ts __tests__/unit/components/providers`.
- Visual pass on the **V4test** instance (`:3005`), never Friday: set one chat to
  each of the four states from the Salon sidebar, open the workspace home tab and
  the `/salon` list, confirm no mark / red / grey / blue, hover each for the
  tooltip, confirm a click still opens the chat, confirm the header pill and the
  mark show identical wording. Flip "Dangerous Chats" on: the red and blue chats
  vanish from the homepage, `/salon`, a character's Conversations tab, and a
  Prospero project's chat list; the grey one stays. Repeat under the Electron
  shell if one is handy — the tooltip's whole reason for existing is that surface.
- Dark theme and at least one bundled theme that retints `--color-info`
  (Madman's Box) to confirm the mark follows the badge.

## Open questions

1. **Asterisk or icon?** The ask was asterisks and the asterisk keeps the list's
   density. The state icons (`alert-triangle` / `check-circle` / `eye-off`) are in
   the presentation table if a later pass wants them on the cards, where there is
   room.
