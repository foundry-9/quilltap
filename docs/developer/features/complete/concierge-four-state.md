# The Concierge — Four-State Per-Chat Control

**Status:** Implemented (4.9-dev, 2026-08-30)
**Scope:** quilltap-server (sidebar UI + API + danger-content services); no shell impact
**Supersedes:** the tri-state control shipped in 4.6 (`Safe` / `Flagged` / `Off-duty`)

## Summary

Replace the per-chat Concierge tri-state with a four-state control that separates
two things the current design conflates: **who decided** (the Concierge's
classifier, or the operator) and **which route the chat takes** (the ordinary
providers, or the uncensored ones).

The current three states occupy three corners of a 2×2. The missing corner —
*operator asserts the chat is spicy, without invoking the classification
apparatus* — is the one users actually reach for, and today there is no way to
express it. `Off-duty` looks like it should be that corner and is in fact its
opposite: it forces `mode: 'OFF'` and drops the uncensored profile IDs entirely,
so an Off-duty chat gets **concealed** prompts on the **default** image profile.

|  | Classifier running (**Concierge decides**) | Classifier off (**you decide**) |
|---|---|---|
| **Ordinary route** | **Monitored** — green | **Vouched Safe** — neutral |
| **Uncensored route** | **Flagged** — red | **Uncensored** — blue |

Rows are the route. Columns are the provenance. The classifier can move a chat
between `Monitored` and `Flagged`; only the operator can put a chat in the right
column, and nothing moves it out.

## Naming and provenance

The single hardest problem here is that `Monitored` and `Vouched Safe` both sound
benign, and the difference between them — whether anyone is watching — is not in
either word. Three mechanisms carry it, and all three are needed:

1. **`<optgroup>` in the select.** Native HTML, no new components, and it makes
   the provenance *structural* instead of asking the labels to carry it alone:

   ```
   The Concierge decides
     Monitored
     Flagged
   You decide
     Vouched Safe
     Uncensored
   ```

2. **"Vouched" in the label.** `Vouched Safe` reads as a person's act in a way
   `Safe` and `Cleared` do not — "cleared" is what a security checkpoint does,
   which is exactly the automatic-verdict reading we are trying to avoid. It also
   preserves the user's mental model ("this chat is safe") while adding the actor.

3. **Helper text that names the actor.** The existing control already renders
   per-state helper text; all four strings should say who made the call.

`Uncensored` stays blunt on purpose. It is the one state with a real, mechanical,
risky consequence (it routes to `uncensoredImageProfileId` / the
`isDangerousCompatible` scan), and the setting it activates is literally named
"uncensored" throughout the codebase. Let the helper text carry the house voice;
the label should carry the warning.

### Rejected alternatives

- **Keeping `Safe` as the label for the operator-benign state.** Recycling the
  word is survivable; recycling the *wire value* is not (see below), and having
  the label and the wire value disagree is worse than either.
- **`Unchaperoned` for `Uncensored`.** Better voice, and it pairs beautifully with
  the Concierge conceit — but it obscures the mechanical consequence at exactly
  the moment the user needs to understand it.
- **`Cleared` / `Vouched` (bare).** `Cleared` reads as automatic. Bare `Vouched`
  reads oddly as a standalone select option.

## Goals

- A four-state per-chat Concierge control whose labels and colors make both the
  route and the provenance legible without reading the docs.
- An operator-asserted uncensored path that skips classification entirely — no
  per-message scan, no per-image-prompt scan, no announcements, no danger styling
  — while still taking every uncensored route the Flagged state takes.
- No state's meaning silently changes for an existing chat.
- No wire value or stored value is ever reused with a new meaning.

## Non-goals

- Changing the global Concierge modes (`OFF` / `DETECT_ONLY` / `AUTO_ROUTE`).
- Project-level or character-level Concierge overrides. The resolver has a
  documented seam for a Global → Project → Chat cascade; this spec does not use it.
- Changing what "dangerous" means to the classifier, or its thresholds.
- Per-state selection of *which* uncensored profile to use. All uncensored states
  continue to use the single globally-configured pair.

## Known State (verified 2026-08-30)

### The two stored fields

Danger lives in `chats.isDangerousChat` (the classification label) and
`chats.conciergeOverride` (`NULL` | `'OFF'`), added by
[add-chat-concierge-override.ts](../../../../migrations/scripts/add-chat-concierge-override.ts).
[chat-override.ts](../../../../lib/services/dangerous-content/chat-override.ts) is the
documented single source of truth for reading them together, exposing
`isConciergeOffDuty` (:46), `getConciergeState` (:57), and `isChatActiveDangerous` (:69).

### What `Off-duty` currently does

`resolveDangerousContentSettings`
([resolver.service.ts:69](../../../../lib/services/dangerous-content/resolver.service.ts))
returns the flat constant `OFF_DUTY_DANGEROUS_CONTENT_SETTINGS` (:44) for an
off-duty chat: `mode: 'OFF'`, `threshold: 1.0`, all three scans `false`, badges
off. **The constant carries no `uncensoredImageProfileId` or
`uncensoredTextProfileId`** — this is why Off-duty cannot reach an uncensored
profile even in principle, and it is the specific bug this spec's fourth state
exists to fix.

Every uncensored route is gated on `mode === 'AUTO_ROUTE'`:
`resolveProviderForDangerousContent` ([:93](../../../../lib/services/dangerous-content/provider-routing.service.ts)),
`resolveImageProviderForDangerousContent` (:215), and the post-hoc
`resolveUncensoredImageProfileForReroute` (:393). Off-duty fails all three.

Separately, prompt *candour* is gated on the chat being actively dangerous, not on
the mode: `uncensoredImageTarget = isDangerousChat && hasUncensoredImageProvider`
([story-background.ts:232](../../../../lib/background-jobs/handlers/story-background.ts)),
which selects `STORY_BACKGROUND_CANDID_INTIMACY` over
`STORY_BACKGROUND_CONCEALED_INTIMACY` in
[image-scene-tasks.ts:325](../../../../lib/memory/cheap-llm-tasks/image-scene-tasks.ts).

### Raw-field reads that adding a value will break

Two classifier gates compare the raw column to `'OFF'` rather than going through
the helper. Adding `'UNCENSORED'` without touching them means an Uncensored chat
still gets classified and can auto-flip to Flagged:

- [chat-danger-classification.ts:55](../../../../lib/background-jobs/handlers/chat-danger-classification.ts) — `if (chat.conciergeOverride === 'OFF')` bail-at-entry.
- [scheduled-danger-scan.ts:136](../../../../lib/background-jobs/scheduled-danger-scan.ts) — `if (chat.conciergeOverride === 'OFF') return false` in the enumeration filter.

The Salon header badge at
[SalonView.tsx:1082](<../../../../app/salon/[id]/SalonView.tsx>) also reads both raw
fields directly, and renders **both** Off-duty and Flagged with the same red
`qt-danger-badge`.

### `isChatActiveDangerous` is overloaded

~20 call sites, doing two different jobs that currently coincide and will not
after this change:

**Route decisions (should follow the uncensored path — must return true for `Uncensored`):**
`story-background.ts:225`, `image-generation-handler.ts:909`,
`memory-extraction.ts:151`, `carina-memory-extraction.ts:136`,
`memory-regenerate-all.ts:60`, `scene-state-tracking.ts:70`, `title-update.ts:108`,
`context-summary.ts:346`, `pre-compute.service.ts:243`,
`message-finalizer.service.ts:260,264,514,576`, `orchestrator.service.ts:1152`,
`danger-orchestrator.service.ts:65`, `llm-consult.ts:94`,
`chats/[id]/actions/memories.ts:240`.

**Display decisions (should paint danger styling — must return false for `Uncensored`):**
`SalonView.tsx:1474` (message-avatar danger styling),
`ChatSidebar.tsx:847` (`ParticipantCard` danger ring).

### Wire and schema contracts

- API: `conciergeState: z.enum(['safe', 'flagged', 'off'])`
  ([schemas.ts:124](<../../../../app/api/v1/chats/[id]/schemas.ts>)).
- Export: `"conciergeOverride": { "enum": ["OFF", null] }`
  ([qtap-export.schema.json:657](../../../../public/schemas/qtap-export.schema.json)).
- DDL: [DDL.md:500](../../DDL.md).
- Transitions chokepoint: [manual-flip.ts](../../../../lib/services/dangerous-content/manual-flip.ts),
  which also posts one of four announcement kinds via
  [concierge-notifications/writer.ts:172](../../../../lib/services/concierge-notifications/writer.ts).

### Available styling primitives

- `qt-text-success` / `qt-text-danger` / `qt-text-info` and the matching
  `qt-bg-*` / `qt-border-*` families all exist in
  [_utilities.css](../../../../app/styles/qt-components/_utilities.css).
- `qt-text-muted` exists in [_content.css:1156](../../../../app/styles/qt-components/_content.css).
- `qt-danger-badge` ([_chat.css:2827](../../../../app/styles/qt-components/_chat.css))
  is already built as `color-mix()` over a single CSS var, so a four-color badge
  family is a parameterization, not four new rules.
- Registered icons relevant here: `eye`, `eye-off`, `alert-triangle`,
  `check-circle`, `shield`, `ban`, `zap`
  ([icon-registry.ts](../../../../components/ui/icons/icon-registry.ts)).

## Design

### 1. Storage

`chats.conciergeOverride` gains a third value. No data migration — every existing
row keeps its exact current meaning.

| State | `conciergeOverride` | `isDangerousChat` |
|---|---|---|
| Monitored | `NULL` | `false` |
| Flagged | `NULL` | `true` |
| Vouched Safe | `'OFF'` | preserved |
| Uncensored | `'UNCENSORED'` | preserved |

`'OFF'` is retained as the stored value for `Vouched Safe` precisely so no stored
value changes meaning. The label changed; the storage did not.

A migration is still required to widen the column's documented domain, update
[DDL.md](../../DDL.md), and update the export schema enum to
`["OFF", "UNCENSORED", null]`. Per the migration rules it needs a `PRETTY_LABELS`
entry in [prettify.ts](../../../../lib/startup/prettify.ts); it touches no rows, so
no `reportProgress` loop is needed.

### 2. Wire contract

Replace the enum wholesale rather than extending it. **No value keeps its
spelling with a different meaning.**

```ts
conciergeState: z.enum(['monitored', 'flagged', 'vouched', 'uncensored'])
```

| Old wire value | New wire value | Meaning changed? |
|---|---|---|
| `'safe'` | `'monitored'` | no — renamed |
| `'flagged'` | `'flagged'` | no |
| `'off'` | `'vouched'` | no — renamed |
| — | `'uncensored'` | new |

`'flagged'` is the only value that survives verbatim, and it means exactly what it
meant before. Accept the three old values for one release as deprecated aliases if
any external caller is suspected; otherwise drop them, as the only caller is the
sidebar.

### 3. `ConciergeState` and the predicate split

`ConciergeState` becomes `'monitored' | 'flagged' | 'vouched' | 'uncensored'`, and
[chat-override.ts](../../../../lib/services/dangerous-content/chat-override.ts) grows
two purpose-named predicates to replace the single overloaded one:

```ts
/** Should this chat take the Concierge's uncensored routes right now? */
export function shouldUseUncensoredRoute(chat: ChatLike | null | undefined): boolean {
  const s = getConciergeState(chat)
  return s === 'flagged' || s === 'uncensored'
}

/** Should the UI paint this chat with danger styling? */
export function shouldShowDangerStyling(chat: ChatLike | null | undefined): boolean {
  return getConciergeState(chat) === 'flagged'
}

/** Is the classifier allowed to run on this chat at all? */
export function isClassifierOnDuty(chat: ChatLike | null | undefined): boolean {
  const s = getConciergeState(chat)
  return s === 'monitored' || s === 'flagged'
}
```

`isChatActiveDangerous` is **deleted**, not re-pointed. Leaving it in place with a
new meaning invites exactly the silent-drop failure the module's own doc comment
warns about; every call site should be forced to state which question it is asking.
Its ~20 call sites split per the inventory in Known State above.

`isConciergeOffDuty` is likewise deleted in favour of `isClassifierOnDuty`, which
correctly covers both operator states.

### 4. Resolved settings

`resolveDangerousContentSettings` gains a fourth source,
`'chat-uncensored'`, and — critically — the Uncensored settings **cannot be a flat
constant** the way `OFF_DUTY_DANGEROUS_CONTENT_SETTINGS` is, because they must
carry the globally-configured uncensored profile IDs through:

```ts
if (chat && getConciergeState(chat) === 'uncensored') {
  const global = globalSettings?.dangerousContentSettings ?? DEFAULT_DANGEROUS_CONTENT_SETTINGS
  return {
    settings: {
      ...global,                    // carries uncensoredImageProfileId / uncensoredTextProfileId
      mode: 'AUTO_ROUTE',           // the operator has already returned the verdict
      threshold: 1.0,               // nothing left to classify
      scanTextChat: false,
      scanImagePrompts: false,
      scanImageGeneration: false,
      showWarningBadges: false,
    },
    source: 'chat-uncensored',
  }
}
```

This forces `AUTO_ROUTE` **regardless of the global mode**, which is deliberate and
is the whole point of the state: the operator asking for uncensored routing on one
chat should not first have to flip a global switch. Note the asymmetry with
`Flagged`, which continues to obey the global mode — a Flagged chat under a global
`DETECT_ONLY` still does not reroute.

`OFF_DUTY_DANGEROUS_CONTENT_SETTINGS` is renamed
`VOUCHED_SAFE_DANGEROUS_CONTENT_SETTINGS` with its contents unchanged, and the
source string `'chat-off-duty'` becomes `'chat-vouched'`.

### 5. UI

**Control** ([ChatSidebar.tsx:1136](../../../../components/chat/ChatSidebar.tsx)) —
optgroups as described above, with per-state helper text naming the actor:

| State | Helper text |
|---|---|
| Monitored | "The Concierge keeps watch, and will flip the switch himself if the conversation calls for it." |
| Flagged | "The Concierge has this chat down as dangerous, and routes it through the uncensored providers." |
| Vouched Safe | "You have vouched for this chat. The Concierge stops watching; the ordinary providers still apply, and may still refuse." |
| Uncensored | "You have sent the Concierge away and opened the uncensored door yourself. Nothing is scanned, nothing is softened — the risk is yours." |

**Colors and icons** — the badge family parameterizes `qt-danger-badge` over its
CSS var. Icons give a third, redundant channel for the red/green pair, which is the
standard colorblind hazard:

| State | Token | Icon | Rationale |
|---|---|---|---|
| Monitored | `--color-success` | `eye` | he's watching |
| Flagged | `--color-destructive` | `alert-triangle` | unchanged from today |
| Vouched Safe | `--color-muted-foreground` | `check-circle` | no colour = the Concierge isn't in the room |
| Uncensored | `--color-info` | `eye-off` | the eye you closed yourself |

`eye` ↔ `eye-off` is a deliberate pun on the provenance axis; `alert-triangle` ↔
`check-circle` are the two verdicts. (`zap` is a reasonable alternative for
Uncensored if `eye-off` reads too much like "hidden".)

**Badge** ([SalonView.tsx:1082](<../../../../app/salon/[id]/SalonView.tsx>)) — rewrite to
derive from `getConciergeState` rather than the two raw fields, and render **no
badge for `Monitored`**. Monitored is the default; a green pill on every chat is
noise. The header pill should mean "something other than the default is set."

### 6. Transitions

[manual-flip.ts](../../../../lib/services/dangerous-content/manual-flip.ts) gains a
fourth case. `Uncensored` preserves `isDangerousChat` exactly as `'OFF'` does, so
returning to `Monitored` re-enters the classifier cleanly:

```ts
case 'uncensored': {
  await repos.chats.update(chatId, { conciergeOverride: 'UNCENSORED' })
  await postConciergeManualAnnouncement({ chatId, kind: 'manual-uncensored' })
  break
}
```

The `'monitored'` case keeps the existing behaviour of clearing classifier
metadata so the scheduled scan re-evaluates.

Announcement kinds ([writer.ts:172](../../../../lib/services/concierge-notifications/writer.ts))
gain `'manual-uncensored'`; `'manual-off-duty'` / `'manual-on-duty'` are renamed
`'manual-vouched'` / `'manual-resumed'`. The four→six kinds need both
`buildManualContent` and `buildManualOpaqueContent` branches, per the staff-voicing
split.

## Implementation phases

1. **Predicates.** Add the three new predicates; delete `isChatActiveDangerous` and
   `isConciergeOffDuty`; fix the ~20 call sites per the inventory. Fix the two raw
   `=== 'OFF'` classifier gates. Types-only change in behaviour — no state exists
   yet that makes them diverge, so this lands green.
2. **Storage + wire.** Migration, DDL, export schema, `ConciergeState` union, API
   enum, `manual-flip` fourth case, announcement kinds.
3. **Resolver.** `'chat-uncensored'` source and the spread-based settings; rename
   the off-duty constant and source string.
4. **UI.** Optgroups, labels, helper text, badge family, icons, `SalonView` badge
   rewrite.
5. **Docs.** `help/dangerous-content.md` (all four states, with the 2×2), CHANGELOG,
   and a release-notes entry.

Phase 1 is the one that carries risk and is worth landing on its own.

## Testing

- **Unit — `chat-override`:** the full 4-state truth table across both stored
  fields, including `conciergeOverride: 'UNCENSORED'` with `isDangerousChat` both
  true and false (the preserved label must not leak into either predicate).
- **Unit — `resolver`:** `'chat-uncensored'` carries `uncensoredImageProfileId`
  through from global; forces `AUTO_ROUTE` under a global `OFF`; leaves all scans
  false. Extend the existing suite at
  `__tests__/unit/lib/services/dangerous-content/resolver.test.ts`.
- **Unit — `manual-flip`:** all 12 ordered transitions, asserting the stored pair
  and the announcement kind. Extend `manual-flip.test.ts`.
- **Regression — the bug that started this:** an `Uncensored` chat must produce
  `uncensoredImageTarget === true` in `story-background.ts`, i.e. candid intimacy
  guidance and a reroute to the configured uncensored image profile, with **zero**
  classification calls.
- **Regression — display split:** an `Uncensored` chat must not paint danger
  styling on message avatars or participant cards.
- **`scripts/concierge-tristate-test.sh`** covers the CT-1/CT-2 acceptance checks
  against a live instance and needs extending to four states (and renaming).

## Open questions

1. **Should `Uncensored` force `AUTO_ROUTE` against a global `OFF`?** This spec says
   yes — a per-chat operator decision should not require a global change. The
   counter-argument is that a global `OFF` reads as "I want none of this
   machinery," and a per-chat state overriding it is surprising. If we reverse
   this, `Uncensored` under a global `OFF` degrades to `Vouched Safe`-with-candid-
   prompts, which is a strange enough state that the control should probably
   disable the option and say why.
2. **Should `Vouched Safe` suppress the danger badge on list-view cards?** 4.6
   deliberately kept `ChatCard` / `RecentChatItem` showing the preserved label on
   off-duty chats, on the grounds that they surface the *label*, not the live
   action state. With four states and a colour system that distinguishes them, that
   rationale weakens.
3. **Does `Uncensored` need its own audit trail?** `Flagged` records
   `dangerClassifiedAt` and a score. An operator assertion records nothing but the
   announcement bubble. A `conciergeSetAt` timestamp may be worth adding while the
   migration is open.
