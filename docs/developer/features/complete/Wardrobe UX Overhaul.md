# Wardrobe UX Overhaul

**Status:** Spec for handoff to Claude Code.
**Target:** 4.4.x (mostly mechanical) with one Phase-2 carve-out called out below.
**Predecessor:** [[Wardrobe Items As Arrays]] (data model — already shipped in 4.4-dev).

The 4.4-dev wardrobe dialog ships powerful capabilities — global access, composite items, layered slots, fitting room composition, ad-hoc avatar generation — but the UX makes the user negotiate with the data model rather than the other way round. This spec rewrites every wardrobe-touching surface to fit the actual workflows.

---

## 1. Scope and ground rules

### In scope

- `components/wardrobe/wardrobe-control-dialog.tsx` — the global dialog.
- `components/wardrobe/wardrobe-item-row.tsx` — left-column rows.
- `components/wardrobe/equipped-slot-row.tsx` — right-column slot rows.
- `components/wardrobe/wardrobe-item-editor.tsx` — create / edit form.
- `components/wardrobe/outfit-selector.tsx` — chat-start surface.
- `components/wardrobe/import-from-image-modal.tsx` — light pass.
- New: `components/wardrobe/equipped-bundle-card.tsx`.
- Character edit page (`app/aurora/[id]/edit/page.tsx`): add a Wardrobe tab.
- Removal of confirmed-dead components (see §3.7).
- `app/salon/[id]/page.tsx`: dialog-launch wiring (default character resolution).
- `app/salon/new/.../NewChatModal.tsx` (and useNewChat hook): outfit-selector integration.

### Settled (do not change)

- Wardrobe data model — `EquippedSlots` is `UUID[]` per slot, `WardrobeItem.componentItemIds` defines composites, `OutfitPreset` is gone for good.
- LLM tool API split — `wardrobe_set_outfit` (composite-only, `wear`/`remove`) and `wardrobe_change_item` (atomic, `equip`/`add_to_slot`/`remove_from_slot`/`clear_slot`).
- Aurora wardrobe-announcement pipeline (`enqueueWardrobeOutfitAnnouncement`, the writer at `lib/services/aurora-notifications/writer.ts`).
- Image-generation backends — `regenerate-avatar` chat action and `/api/v1/wardrobe/preview-avatar` route.
- Tailwind + `qt-*` semantic class system.
- `WardrobeDialogProvider` mounted once at the layout level.
- The `?action=equip` API including the new `mode: 'set_all'`.

### Explicit non-goals

- **No per-item images.** The cost of generating a thumbnail per wardrobe item via the image API is not worth the visual benefit for now. All representation stays text + slot-color chips.
- No outfit-level memory or recall.
- No multi-character composites (a composite still belongs to one character or is shared via the archetype path).

---

## 2. Architectural decisions (load-bearing)

These six decisions are the spine of the redesign. Any §3 change that contradicts one of these defers to the §2 decision.

### 2.1 Right column: rename to "Live outfit" and "Outfit Builder," with new semantics

The current `Wearing now` / `Fitting room` tab pair has two problems: the labels don't describe the workflows, and the workflows have *different commit semantics* the user has to infer from the labels. The fix:

**Live outfit** (in-chat only). What the character is currently wearing in this chat. Edits commit immediately. This is `Wearing now` renamed and unchanged in semantics.

**Outfit Builder** (always available; default tab when out of chat). A staging surface for *constructing a new wardrobe item* — typically a composite outfit. The primary action is **Save as outfit**: that opens the editor pre-populated with the staged items as components, prompting only for a title (and optional description / appropriateness). The result is a new composite wardrobe item the user can equip later, share, mark default, etc.

Three secondary actions, in order of prominence:

- **Try on** (in-chat only) — atomic `mode: 'set_all'` apply. Replaces the existing `Wear this` button. This is the path for "compose, then commit."
- **Generate avatar preview** — current `Generate avatar` behavior, moved into this tab. In-chat regenerates the chat avatar; out-of-chat produces a downloadable preview.
- **Reset to worn / Reset to defaults / Clear all** — kept as a single dropdown menu (`Reset…`) rather than three siblings, because three same-shape buttons next to a primary `Save as outfit` is a discoverability problem.

Note that this does *not* remove the "compose then commit" workflow Charlie likes about the Fitting Room — `Try on` covers it. What it adds is the missing primary use case: "I want to bottle this outfit so I can re-equip it next week."

**Implementation:**
- Tab labels: `Live outfit` and `Outfit Builder`. The in-chat indicator next to the dialog header (`In chat — equip controls active`) is dropped; tab presence already encodes that.
- Right-column footer per tab — see §3.1.4 and §3.1.5.
- `Save as outfit` opens `WardrobeItemEditor` in a new mode, see §3.4 and §2.3.

### 2.2 Composite-as-bundle in equipped views

When a composite covers multiple slots, render it once as a bundle card above the slot rows, not once per slot it occupies. This applies to both Live outfit and Outfit Builder.

A bundle card shows:

- The composite's title.
- Slot-coverage chips (the slots it occupies in this snapshot, color-coded to match `qt-badge-wardrobe-*`).
- **Take off bundle** — removes the composite UUID from every slot it occupies. In Live outfit, this is `mode: 'set_all'` with a snapshot that has the composite filtered out of every covered slot; in Outfit Builder, it mutates the staged `fittingSlots` directly.
- **Break apart** — replaces the composite UUID in each occupied slot with the resolved leaf component IDs that cover that slot. Visually identical state, but no longer bundle-locked. In Live outfit, `mode: 'set_all'` with the substituted snapshot.
  > **Superseded in 4.8.2.** Wearing a bundle now dissolves it in the same gesture (`lib/wardrobe/dissolve-bundles.ts`), so a composite id no longer reaches equipped state and no bundle card is produced. The card and this button survive only for outfits equipped before that change.

A composite that covers exactly one slot still renders inside the slot row (as a chip with `· bundle` indicator), not as a separate card — bundle cards only appear when the bundle is doing real work across slots.

Layered leaves continue to render in slot rows beneath the bundle cards. A scenario where a composite occupies TOP/BOTTOM/FOOTWEAR/ACCESSORIES and a separate leaf is layered into TOP renders as: bundle card for the composite, plus a single TOP slot row containing only the layered leaf. (The TOP slot row in Live outfit is editable; the leaf there is independent of the bundle.)

**Implementation:**
- New component `components/wardrobe/equipped-bundle-card.tsx`.
- Helper `lib/wardrobe/group-equipped.ts` exporting `groupEquippedSlots(slots, items)` → `{ bundles: Array<{ compositeId, occupiedSlots, allOccupied: boolean }>, slotRemainders: EquippedSlots }`. A composite enters `bundles` when it occupies ≥ 2 slots; the slots it occupies are removed from `slotRemainders` only when those slots have no other items in them. Slots that have *both* a bundle's composite and a layered leaf remain in `slotRemainders` with the leaf only (the bundle still gets the slot-coverage chip on its card).
- `WardrobeControlDialogInner` consumes the helper to render bundle cards then slot rows, in both Live outfit and Outfit Builder branches.
- `EquippedSlotRow` no longer needs to render a `× composite` chip — composites visible in slot rows are always single-slot, in which case the existing chip with the `· bundle` note is fine.

### 2.3 Editor: explicit Single garment / Outfit bundle toggle

Implicit composite conversion (the form silently changing mode when a component is added) goes away. The editor opens with a segmented control at the top:

- **Single garment** (default) — the leaf form. Types are user-set checkboxes; the Composes section is hidden.
- **Outfit bundle** — types auto-compute from components and become read-only display. The Composes section is the dominant body element.

Switching from Single garment → Outfit bundle preserves any types the user picked but disables further editing of them; subsequent component additions/removals will recompute. Switching Outfit bundle → Single garment with components present prompts a confirmation: "*This will discard the components. Keep types as they are now or reset?*" with two buttons. Switching with zero components is silent.

This supports the `Save as outfit` flow from Outfit Builder (§2.1) cleanly: that flow opens the editor in Outfit bundle mode with `componentItemIds` pre-populated from the staged `fittingSlots` and the title field focused.

### 2.4 Retire `WardrobeItemList` and `WardrobeItemCard`; add a Wardrobe tab to the character edit page

`components/wardrobe/wardrobe-item-card.tsx` and `components/wardrobe/wardrobe-item-list.tsx` are no longer mounted anywhere in the live UI; they were superseded by the dialog. The barrel `components/wardrobe/index.ts` still exports them, and the character edit page (`app/aurora/[id]/edit/page.tsx`) currently has no wardrobe surface at all — meaning to manage Friday's wardrobe you have to go to Salon → click Wardrobe on her participant card, or use the sidebar wardrobe icon.

Two changes:

1. Delete `components/wardrobe/wardrobe-item-card.tsx`, `components/wardrobe/wardrobe-item-list.tsx`, and `components/wardrobe/import-from-image-modal.tsx` if Knip confirms these are unused after change 2 lands. Remove their exports from the barrel. **PAUSE AND REPORT** before deleting any of these — Claude Code should run `npx knip` first and report which of the three are confirmed dead, so we don't break a hidden caller.

2. Add a `Wardrobe` tab to the character view page (`app/aurora/[id]/view/page.tsx`) and the edit page (`app/aurora/[id]/edit/page.tsx`). Clicking it opens the global dialog scoped to this character (`useWardrobeDialog().open({ characterId })`) — no separate component, just a tab that triggers the dialog. The Import-from-image flow re-attaches as a button inside the dialog's left column (see §3.6).

### 2.5 Outfit Selector at chat start: replace "Choose Outfit" with embedded Outfit Builder

The current `Choose Outfit` mode in `outfit-selector.tsx` renders a long flat checkbox list per slot — for any character with more than ten or so items, this is unusable. Replace it with the Outfit Builder slot-row component from the dialog, embedded inline.

The radio set becomes:

- **Same as last conversation** (continuation only)
- **Use defaults**
- **Compose outfit** — replaces `Choose Outfit`; reveals the embedded Outfit Builder
- **Let character choose**
- **None** (with the "starts undressed" hint)

When `Compose outfit` is selected, the embedded Outfit Builder occupies the area below the radios, seeded from defaults. The `Save as outfit` button is hidden in this embedded variant — at chat start the user is not creating a new wardrobe item, just picking starting slots — so the only persistence path is the chat-creation form's overall submit.

The slot-row component family must accept a `mode: 'live' | 'staged' | 'embedded-staged'` prop where `embedded-staged` differs from `staged` only in hiding the bundle-card `Take off / Break apart` actions (since at chat start there's no live state to manipulate, only a target snapshot to set).

### 2.6 Default character resolution when launching from sidebar in chat

The sidebar wardrobe icon, when invoked from `/salon/<id>`, currently picks up the chat ID but defaults the character selector alphabetically (Amy before Friday). This is a bug. The default character should be:

1. The user's last-acted-on character in this chat (most recent ASSISTANT message attribution where `controlledBy !== 'user'`), then
2. The first non-user-controlled CHARACTER participant in chat order, then
3. The alphabetical first (current behavior, kept as final fallback).

When invoked from a participant card, the default is that participant. When invoked outside a chat, the alphabetical first stays.

**Implementation:** Threading needs `chatId` + access to the chat's participants and recent message attribution. The `WardrobeDialogProvider`'s `open({ chatId })` call can resolve this via an additional async pass, or the call site (sidebar button in `app/salon/[id]/...`) can compute it before invoking `open({ characterId, chatId })`. Prefer the call-site approach to keep the provider thin.

---

## 3. Component-by-component changes

Each subsection follows: *Current behavior / Problem / Proposed change / Implementation notes*.

### 3.1 `wardrobe-control-dialog.tsx`

#### 3.1.1 Header strip

**Current:** `Character: [select]    In chat — equip controls active` text.
**Problem:** The "equip controls active" hint is technical jargon without context, and lives in the header where it is far from the equip controls themselves. The header strip is also under-used.
**Proposed:** Drop the hint text. Move the chat-context indicator to a small chip next to the right-column tab labels (e.g., `Live outfit · Friday in this chat`). Add the character's avatar (small, 24×24) inside the select trigger so the user has stronger orientation when the wardrobe spans many characters.
**Implementation:** Render a custom select trigger that includes the avatar; the underlying `<select>` stays for keyboard semantics (or convert to a popover-based combobox if the qt-* component library has one — check `components/ui/`).

#### 3.1.2 Left column header and filter chips

**Current:** `Wardrobe` heading with `+ New Item` button on the right; filter chips `All | Top | Bottom | Footwear | Accessories | Composites` wrapping to two rows.
**Problem:** The chips wrap because there are too many of them on narrow widths; "Composites" is a *kind* filter living next to *slot* filters; "+ New Item" placement is inconsistent with the right-column primary actions.
**Proposed:**
- Replace filter chips with two rows: a search input with a magnifier icon (filters titles in real time), and a slot-toggle row (`All / Top / Bottom / Footwear / Accessories`).
- Add an `Items / Outfits` segmented control above the slot toggles — `Items` shows leaves, `Outfits` shows composites only, default `Items`. This separates the "kind" axis from the "slot" axis.
- Move `+ New Item` to the bottom-right of the left column as a sticky button (so it remains reachable without scrolling).
- Add `Import from image` next to `+ New Item`.
**Implementation:** Search input wires to a `titleFilter` state in `WardrobeControlDialogInner`. The kind segmented control stores `kind: 'items' | 'outfits'` in state. `filteredItems` becomes a function of `(items, slot, kind, titleFilter)`. Sticky button uses `position: sticky; bottom: 0` inside the column's overflow container.

#### 3.1.3 Right column tab labels

**Current:** `Wearing now | Fitting room`.
**Proposed:** `Live outfit | Outfit Builder`. See §2.1.
**Implementation:** String change in the tab buttons. State variable `rightTab: 'wearing' | 'fitting'` renames to `rightTab: 'live' | 'builder'` for clarity.

#### 3.1.4 Live outfit panel

**Current:** Helper text *"What this character is actually wearing in this chat. Edits here persist immediately."* Four slot rows. Composites duplicated across slots.
**Proposed:**
- Helper text replaced by a one-line caption above the rows: *Edits commit immediately.* Single sentence.
- Bundle cards for composites occupying ≥ 2 slots (§2.2).
- Slot rows for slots not fully occupied by a bundle.
- No primary action button; the modal's Done button is sufficient.

#### 3.1.5 Outfit Builder panel

**Current:** Helper text *"A virtual outfit just for the avatar generator — no equip API calls, nothing committed to the chat. Edit freely, then either click Generate avatar below or, in chat, hit Wear this to commit the composition."* Four slot rows. Action row `Wear this | Reset to worn | Reset to defaults | Clear all`. Avatar generation pane below.
**Proposed:**
- Helper text replaced by: *Compose an outfit. Save it as a reusable bundle, try it on, or generate a preview avatar.* Single sentence.
- Bundle cards + slot rows per §2.2.
- Action row: **Save as outfit** (primary) | **Try on** (secondary, in-chat only) | **Reset…** (dropdown: Reset to worn — in-chat only / Reset to defaults / Clear all).
- Avatar generation pane below the action row, visually de-emphasized (it's a side feature now, not the framing).

#### 3.1.6 Avatar generation pane

**Current:** Image model select + Generate / Preview button + helper paragraph + preview thumbnail (out-of-chat).
**Problem:** Mostly fine. Helper text is encyclopedic. The download/discard pair on the preview is awkward.
**Proposed:**
- Helper text shortened to one line: in-chat *Replaces this chat's avatar with the staged outfit.* / out-of-chat *Generates a one-off preview. Download to keep.*
- Move `Image model` select label inline with the select rather than above it.
- Replace `Discard` with an X on the thumbnail itself; keep `Download` as a primary inline button.

#### 3.1.7 Modal-level keyboard, focus, sticky header

**Current:** Pressing Escape inside an inline slot picker closes the entire dialog. The editor's sticky header overlaps content when scrolled.
**Problem:** Both are bugs.
**Proposed:**
- The slot picker dropdown becomes a proper Radix Popover (or whatever the qt-* equivalent is — check `components/ui/`). Popover Escape closes the popover, not the parent modal.
- The editor's sticky header gets an opaque background matching `qt-bg-default` plus a bottom border at `qt-border-default`. It already declares `sticky top-0`, so the missing element is just the background and border so content doesn't bleed through.

#### 3.1.8 Done button

**Current:** Single `Done` button in the footer.
**Proposed:** Keep. The footer is otherwise empty, which is fine — busy footers compete with right-column action buttons.

### 3.2 `wardrobe-item-row.tsx`

**Current:** One line per item with the title (truncated heavily), inline `· composite` / `· shared` notes, slot type chips, isDefault star, and four action buttons (`Wear`, `+ Layer`, `Edit`, `Delete`). For composites, a `▶`/`▼` expander reveals nested component rows. Button labels rename to `Try on` / `+ Add` based on right-tab.

**Problems:**

- Title truncation has no recovery (no tooltip, no expand).
- Four buttons per row is visually heavy; `Delete` next to `Edit` is a destructive-action-too-close-to-frequent-action problem.
- Button label renaming based on tab is clever in code, confusing in use.
- Star toggle for `isDefault` is opaque without hover.

**Proposed:**

- Title gets `max-width: full; min-width: 0; word-break: break-word` and is allowed to wrap to two lines. Truncation only kicks in beyond two lines, and a hover tooltip shows the full title.
- Action surface collapses to two visible buttons plus a kebab menu: **[Try on / Wear]** (primary, label depends on tab), **[+]** (single-icon button that adds to the item's primary slot if it has exactly one type, or opens a slot-picker popover if it covers multiple slots), and a `⋮` kebab menu containing `Edit`, `Delete`, and `Toggle default`.
- The `⋮` kebab menu replaces both the inline `Edit`/`Delete` buttons and the star — every secondary action lives in one well-known place. The kebab is on the far right; no destructive actions sit adjacent to the primary equip button.
- The current item's default state shows in the title row as a subtle `· default` note (not a star), with the star moved into the kebab as `★ Mark as default outfit item` / `☆ Unmark as default`. The visual encoding becomes a textual note.
- Per-tab button label: keep `Try on` for Outfit Builder and `Wear` for Live outfit, but make this the *only* label change between the two — no more `+ Layer` / `+ Add` rename. The single-icon `[+]` button is the same affordance in both tabs, with a tooltip describing what it does in context.

**Implementation:** The kebab menu uses whatever popover/menu primitive exists in `components/ui/` (or Radix `DropdownMenu`). The `+` icon's behavior — direct-add when single-typed, picker when multi-typed — needs a small popover for the multi-typed case showing the slots the item can occupy.

### 3.3 `equipped-slot-row.tsx`

**Current:** Slot label + `+`/`Clear` buttons; chips for each item with × removers; popover picker on `+` click with a search input and item list.

**Problems:**

- The slot picker uses `mousedown` outside-click + Escape detection that conflicts with the parent modal's Escape (see §3.1.7).
- Composite chips are full-row (one per slot) when they should be roll-ups via a bundle card (§2.2).
- Chip layout doesn't differentiate visually between leaf items and composites within a slot, making layered coexistence (a leaf layered with a multi-slot composite) hard to read.

**Proposed:**

- Slot picker becomes a proper popover (§3.1.7).
- Composite chips are removed from slot rows when the composite is shown as a bundle above; only leaf chips remain in slot rows.
- A composite whose `types.length === 1` (covers exactly one slot) still renders inside the slot row, with a `· bundle` note distinguishing it from leaves.
- Slot label is sentence-case (`Top`, `Bottom`, `Footwear`, `Accessories`) instead of UPPERCASE; the slot-color chip carries the visual weight.
- Empty state changes from `— empty —` to a quieter `Empty` italic.

### 3.4 `wardrobe-item-editor.tsx`

#### 3.4.1 Single garment / Outfit bundle toggle

**Proposed:** Segmented control at the top of the form (under the dialog title, above Title). See §2.3 for behavior.

#### 3.4.2 Validation timing

**Current:** `Select at least one type` appears in red before any user interaction.
**Proposed:** Validation messages appear only after the form has been submitted at least once or after the field has been focused-and-blurred. Implement via a `submitAttempted` state plus per-field `touched` tracking.

#### 3.4.3 Title placeholder

**Current:** `e.g., Silk Evening Gown, Steel-Toed Boots, Pearl Necklace`.
**Problem:** Reads as a list of three items.
**Proposed:**
- Single garment mode: `e.g., Charcoal Sweater`.
- Outfit bundle mode: `e.g., Working Outfit, Sunday Best`.

#### 3.4.4 Field placement

**Current order:** Title → Types → Composes (always visible) → Appropriateness → Description → Default → Shared.
**Proposed order:**
- Single garment: Title → Types → Default + Shared (side by side as a compact row) → Appropriateness → Description.
- Outfit bundle: Title → Composes (with type display showing what auto-computes) → Default + Shared → Appropriateness → Description.
- The two checkboxes for Default and Shared are moved up so the user sees them on the first screen, not after scrolling through Description.

#### 3.4.5 Composes UI

**Current:** Search input + flat scrollable checkbox list of every candidate. Selected components shown as removable chips above the search.
**Proposed:**
- Group candidates by primary slot (or by `top, bottom, footwear, accessories, multi` for items covering multiple slots) with collapsible group headers.
- Search filters across all groups.
- Selected-components chip area gets a clearer label: `Currently in this outfit:` rather than nothing.
- The "Eligible candidates" panel respects character ownership: own items first, archetypes second, with a small `(shared)` chip on archetypes (existing behavior, mostly clear, but the chip styling should be more visible).

#### 3.4.6 Sticky header

**Current:** Sticky header overlaps content when scrolled (text is transparent).
**Proposed:** Add `qt-bg-default` background and a `border-b qt-border-default` to the sticky header. Trivial fix.

#### 3.4.7 Save-as-outfit entry

**Proposed:** When invoked from Outfit Builder's `Save as outfit` button, the editor opens with:
- Mode: `Outfit bundle`.
- `componentItemIds` pre-populated from staged slots (deduped across slots — a composite already in the staged outfit becomes a sub-component reference).
- Title field auto-focused with placeholder `e.g., Working Outfit`.
- Description and Appropriateness empty.
- Default + Shared at their default values (off / off).

The user has the option to save with just a title — the rest is optional.

### 3.5 `outfit-selector.tsx` (chat-start surface)

**Current:** Per-character collapsible card with radios `Use Defaults | Choose Outfit | Let Character Choose | None` (plus `Same as last conversation` in continuation mode). `Choose Outfit` reveals nested per-slot multi-select checkbox lists.

**Problems:**

- `Choose Outfit` is a flat list per slot; for any character with more than ~10 items per slot, the list becomes unwieldy.
- No visual indication of composite vs leaf in the candidate lists.
- No preview of the staged outfit.
- Mode names are inconsistent — `Use Defaults` is a verb; `Choose Outfit` is a verb-noun; `Let Character Choose` is an instruction; `None` is a noun.

**Proposed:**

- Mode names normalized: `Use defaults`, `Compose outfit`, `Let character choose`, `Start undressed`. Continuation: `Same as last conversation` stays.
- `Compose outfit` reveals an embedded Outfit Builder (§2.5) rather than the flat checkbox list.
- The embedded Outfit Builder shares slot-row components with the dialog (`equipped-slot-row.tsx`) but with `mode: 'embedded-staged'` (no Try on, no Save as outfit, no Reset dropdown — just slot rows + bundle cards).
- Description text under each radio:
  - `Use defaults` — *Items marked default in their wardrobe.*
  - `Compose outfit` — *Pick the starting outfit slot by slot.*
  - `Let character choose` — kept; *The character picks based on the scenario.*
  - `Start undressed` — kept; *Character will start undressed.*

**Implementation:** Significant refactor; the embedded Outfit Builder needs the same `useWardrobe` hook and `groupEquippedSlots` helper as the dialog. Either factor out an `<OutfitComposer>` component used by both surfaces, or have the dialog re-mount its right column with `mode: 'embedded-staged'` props.

### 3.6 `import-from-image-modal.tsx`

**Current:** Three-state modal — Upload / Analyzing / Review. Reasonable shape; not part of the dialog.

**Problem:** It's not reachable from the dialog; only from the (now-dead) `WardrobeItemList`. Once the dead components are removed, this modal becomes orphaned unless re-attached.

**Proposed:**

- Re-attach: add `Import from image` next to `+ New Item` in the dialog's left column (§3.1.2).
- Light copy pass:
  - `Guidance Notes (optional)` → `Hints for the AI (optional)`.
  - Placeholder: `Anything specific to focus on or avoid? e.g., "the woman on the left", "ignore the background", "this is a medieval setting"`.
  - Re-analyze button: keep label, OK as-is.
- Default the `selected` flag to `true` for all proposed items (current behavior is fine).
- After import, the dialog's left column refreshes (`loadItems`) so the new items appear without a manual reload.

### 3.7 Dead-component removal

**PAUSE AND REPORT.** Run `npx knip` after §3.5 lands. Report which of these are confirmed unused:

- `components/wardrobe/wardrobe-item-card.tsx`
- `components/wardrobe/wardrobe-item-list.tsx`

Then remove the unused ones, drop their barrel exports, and update `docs/developer/DEAD-CODE-REPORT.md`. Do **not** remove `import-from-image-modal.tsx`; it's re-attached per §3.6.

### 3.8 Character edit / view page integration

**Proposed:** Add a `Wardrobe` tab to:

- `app/aurora/[id]/view/page.tsx` (between `Tags` and `Default Settings`).
- `app/aurora/[id]/edit/page.tsx` (between `System Prompts` and `Appearance`).

Clicking the tab calls `useWardrobeDialog().open({ characterId: <this character's id> })` rather than rendering inline. The tab itself shows a button or a tab-pane with a single button: `Open wardrobe for [Character Name]`. Out of chat, the dialog opens with no chat context — Live outfit tab is hidden (existing behavior in the dialog) and Outfit Builder is the only tab.

---

## 4. Copy / micro-changes

Concentrated here for easy reference. Format is *current → proposed*.

### Dialog header

- `In chat — equip controls active` → drop entirely (replaced by tab indicator).

### Left column

- `Wardrobe` heading → keep.
- `+ New Item` → keep label, move position.
- Filter chip `All` → keep.
- Filter chip `Composites` → drop, replaced by Items/Outfits segmented control.

### Right column tabs

- `Wearing now` → `Live outfit`.
- `Fitting room` → `Outfit Builder`.

### Live outfit panel helper

- *"What this character is actually wearing in this chat. Edits here persist immediately."* → *Edits commit immediately.*

### Outfit Builder panel helper

- *"A virtual outfit just for the avatar generator — no equip API calls, nothing committed to the chat. Edit freely, then either click Generate avatar below or, in chat, hit Wear this to commit the composition."* → *Compose an outfit. Save it as a reusable bundle, try it on, or preview an avatar.*

### Outfit Builder action labels

- `Wear this` → `Try on`.
- `Reset to worn` / `Reset to defaults` / `Clear all` → collapsed under `Reset…` dropdown.
- New primary: `Save as outfit`.

### Avatar pane helper

- In-chat *"In-chat regeneration replaces Friday's avatar in this chat using the outfit shown above. The chat's default model is not changed."* → *Replaces this chat's avatar with the staged outfit.*
- Out-of-chat *"Generates a one-off preview against the character's defaults. Nothing is saved to the character's avatar — download the file to keep it."* → *Generates a one-off preview. Download to keep.*

### Item row labels

- `Wear` (Live tab) / `Try on` (Builder tab) → keep.
- `+ Layer` / `+ Add` → both replaced by single `[+]` icon button (tooltip: *Layer onto this slot* in Live, *Add to this slot* in Builder).
- `Edit` / `Delete` → moved into kebab menu.
- `★`/`☆` star → moved into kebab as text labels.

### Slot row labels

- `TOP` / `BOTTOM` / `FOOTWEAR` / `ACCESSORIES` → `Top` / `Bottom` / `Footwear` / `Accessories` (sentence case).
- `— empty —` → `Empty`.
- `Clear` button title → keep.

### Editor

- `Title *` placeholder → see §3.4.3.
- `Type(s) *` → kept as label, with sub-label `(auto from components)` only in Outfit bundle mode.
- `Composes` heading → `Components` (clearer; `Composes` reads as a verb).
- `Composes` description → *Pick the items this outfit bundles together.*
- `Leaf item` / `Composite of N` badges → replaced by the segmented-control state (the form's mode is the source of truth, no badge needed).
- `Appropriateness` → kept; sub-text *Tags for when this item is appropriate to wear* → *When is this appropriate to wear? e.g., formal, casual, intimate, combat.*
- `Description (Markdown)` → keep.
- `Default outfit item` checkbox label → `Part of this character's default outfit`.
- `Shared item (available to all characters)` → `Available to all characters` (the leading "Shared item" was redundant).

### Outfit Selector

- `Starting Outfit` heading → keep.
- `Use Defaults` → `Use defaults`.
- `Choose Outfit` → `Compose outfit`.
- `Let Character Choose` description → *The character picks based on the scenario.*
- `None` → `Start undressed`.
- `Same as last conversation` → keep.

### Import from image

- `Guidance Notes (optional)` → `Hints for the AI (optional)`.
- Placeholder per §3.6.

### Confirmation prompts

- Delete confirmation `Delete "[title]"? This cannot be undone.` → keep.
- Reset to worn (in Builder) — currently no confirmation. Add: when the staged outfit differs from worn, prompt *Discard your composition and start from what's currently worn?*. When they're identical or staged is empty, no prompt.
- Reset to defaults — same shape: prompt only when there's staged work to lose.

---

## 5. Open questions

These are intentional under-specifications. Claude Code should not invent answers; either ask for clarification or use the listed default.

1. **Save-as-outfit naming:** when staged slots include a composite and several layered leaves, what does "Save as outfit" produce — a composite of (the composite + the leaves), or a flattened composite of (leaves of the composite + the layered leaves)? **Default:** preserve the composite reference. The new outfit's `componentItemIds` includes the existing composite UUID + the layered-leaf UUIDs. The server's union-of-types computation handles the slot coverage correctly. Cycle detection in `WardrobeRepository.create` already guards pathological cases.

2. **Bundle break-apart with multi-slot leaves:** if a composite contains a multi-slot leaf (rare but possible), `Break apart` should put that leaf into all slots it covers. **Default:** yes; the leaf's `types` array drives slot placement.

3. **Wardrobe tab on character view page (read-only role):** the view page is a read-only surface, but the wardrobe dialog allows editing. Should clicking Wardrobe on the view page open a read-only variant of the dialog? **Default:** no — the dialog is the editing surface, and there's no read-only variant. The view page tab just opens the regular dialog. Users who want to view-but-not-edit can simply not click anything.

4. **Outfit Selector's `Compose outfit` mode out of continuation:** when there's no source chat, what does the embedded Builder seed from? **Default:** the character's defaults. The user can clear and rebuild from scratch.

5. **Sidebar wardrobe icon when not in chat:** does the dialog default to the most-recently-edited character (across all sessions)? **Default:** no — alphabetical first. We can add MRU later if it becomes a friction point.

---

## 6. Out of scope

- Per-item images / thumbnails. Not paying the API cost.
- Outfit-level memory (e.g., the LLM remembers Friday's `Working Outfit — Composed` and self-equips it during a similar future scene).
- Drag-and-drop for layering or composing. The picker + click model is fine.
- Shared / archetype outfits *with* shared components, where the components themselves are shared archetypes. Currently allowed by the data model; not specifically improved here.
- Wardrobe history / undo. The data model supports `archivedAt` for items; that pattern doesn't extend to slot states.
- Mobile-specific layout. The dialog should remain functional on narrow widths but will not be re-laid-out for mobile in this pass.

---

## 7. Implementation order and Claude Code handoff notes

Implement in the following order. Each numbered step is a coherent commit-sized unit. **PAUSE AND REPORT** marks operations that shouldn't proceed without explicit confirmation.

1. **§3.1.7 sticky header + popover Escape fixes.** Cheapest wins, no behavior change beyond bug fixes. Ship first to verify the pipeline is healthy.
2. **§3.4 editor changes** (Single garment / Outfit bundle toggle, validation timing, title placeholder, field placement, sticky header background). Keep the editor's existing API; the toggle is internal state.
3. **§2.2 + §3.3 composite-as-bundle rendering.** New `equipped-bundle-card.tsx`, new `lib/wardrobe/group-equipped.ts`, slot-row rendering refactor. Test with Friday's `Working Outfit — Composed` and Amy's `Office Writing Outfit — Composed`.
4. **§3.2 wardrobe-item-row.tsx changes.** Two-button + kebab; tooltip on truncated titles; star → kebab. Carry-over: rename callback labels in `WardrobeControlDialogInner`.
5. **§3.1 dialog left/right column reframes.** Tab labels, helper text, action button restructure (`Save as outfit`, `Try on`, `Reset…` dropdown). The `Save as outfit` button initially opens the editor with no pre-population — pre-population lands in step 7.
6. **§2.6 default-character resolution.** Plumb chat ID through `WardrobeDialogProvider.open()` and resolve the character at the call site in `app/salon/[id]/...`.
7. **§3.4.7 save-as-outfit pre-population.** Wire the Outfit Builder's primary button to open the editor in `Outfit bundle` mode with `componentItemIds` from staged slots.
8. **§3.5 + §2.5 Outfit Selector refactor.** This is the biggest change because of the embedded Builder. Factor `<OutfitComposer>` out of `WardrobeControlDialogInner` first; both surfaces consume it.
9. **§3.8 Wardrobe tab on character view + edit pages.** Lightweight wiring.
10. **§3.6 Import-from-image re-attachment.** Add the button to the dialog's left column; light copy pass.
11. **§3.7 dead-component removal.** **PAUSE AND REPORT** — run Knip, list confirmed-dead, get sign-off, then delete and update the dead-code report.

### Risk callouts

- **Step 3 (composite-as-bundle):** the helper's grouping logic is the riskiest piece. Recommend writing unit tests first against fixtures derived from `groupEquippedSlots` before wiring it into the renderer. Edge cases: composite occupying one slot only (shouldn't be a bundle); composite with archived components (still expandable); composite whose components include another composite (cycle-tolerant up to the existing depth cap of 4).
- **Step 8 (Outfit Selector refactor):** the existing `useSWR<{ wardrobeItems: WardrobeItem[] }>` fetch in `outfit-selector.tsx` should be unified with the dialog's own item-loading code (which loads personal + archetypes). Pull both into a hook `useCharacterWardrobeItems(characterId)` and use it in both surfaces.
- **Step 11 (dead-component removal):** non-reversible. Confirm Knip output before deleting.

### Files Claude Code is expected to touch

```
components/wardrobe/wardrobe-control-dialog.tsx          (heavy)
components/wardrobe/wardrobe-item-row.tsx                (heavy)
components/wardrobe/equipped-slot-row.tsx                (medium)
components/wardrobe/wardrobe-item-editor.tsx             (heavy)
components/wardrobe/outfit-selector.tsx                  (heavy)
components/wardrobe/import-from-image-modal.tsx          (light)
components/wardrobe/equipped-bundle-card.tsx             (NEW)
components/wardrobe/index.ts                             (barrel)
lib/wardrobe/group-equipped.ts                           (NEW)
lib/hooks/use-character-wardrobe-items.ts                (NEW)
app/aurora/[id]/view/page.tsx                            (medium — add tab)
app/aurora/[id]/edit/page.tsx                            (medium — add tab)
app/salon/[id]/page.tsx                                  (light — default char)
app/salon/new/.../NewChatModal.tsx                       (light — selector wiring)
docs/developer/DEAD-CODE-REPORT.md                       (light — after step 11)
```

### Tests Claude Code should add or update

- `__tests__/unit/lib/wardrobe/group-equipped.test.ts` — new; covers single-slot composite (not a bundle), multi-slot composite (bundle), composite + layered leaf in same slot, composite covering all four slots, two composites occupying disjoint slot sets.
- `__tests__/unit/components/wardrobe/wardrobe-item-editor.test.tsx` (if it exists) — extended for the segmented-control toggle behavior, including the keep-or-reset prompt on Outfit bundle → Single garment with components present.
- The existing `__tests__/unit/app/api/v1/chats/[id]/actions/outfit.test.ts` should not need changes; the `?action=equip` API is unchanged. Verify after step 3.

### Acceptance criteria (operator-visible)

- A composite that covers four slots renders as one bundle card, not four duplicate chips.
- "Take off bundle" removes the composite from every covered slot in one action.
- A wardrobe item title that doesn't fit the row wraps to two lines or shows a hover tooltip.
- The editor opens with a `Single garment / Outfit bundle` segmented control at the top.
- The right-column tabs read `Live outfit | Outfit Builder`.
- The Outfit Builder's primary button is `Save as outfit`.
- Pressing Escape inside an inline picker closes only the picker.
- Sidebar wardrobe icon launched from `/salon/<id>` defaults to the most recently active character in that chat, not alphabetical first.
- The character view and edit pages have a `Wardrobe` tab that opens the dialog scoped to that character.
- The chat-start `Compose outfit` mode shows an embedded Outfit Builder, not a flat checkbox list.

---

## Design notes (intentional choices, not gaps)

- **Bundle cards exist only when a composite occupies ≥ 2 slots.** Single-slot composites stay inline because rendering a card for a one-slot bundle adds visual weight without information.
- **Save as outfit reuses the editor in bundle mode.** Could have been a lightweight "name your outfit" prompt; using the full editor lets the user enrich the new outfit's metadata (description, appropriateness, default flag) in one pass.
- **The kebab menu absorbs `isDefault`.** The star was a faster surface but its meaning was opaque; explicit text in the kebab beats an icon nobody knows.
- **`Try on` retains a place in Outfit Builder** rather than collapsing into Live outfit. Charlie's stated mental model is "compose, then commit"; making the commit explicit (and named differently from the live-edit path) keeps the staging-vs-live distinction visible without splitting them across tabs with different commit semantics.
- **No drag-and-drop.** Adds complexity (touch support, accessibility), provides marginal benefit over the picker model.
- **The chat-start embedded Builder hides Save as outfit.** The user is selecting starting state, not creating a reusable bundle. Saving as a bundle from chat creation is a future feature if it comes up.
