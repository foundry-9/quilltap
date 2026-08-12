# Icon inventory & canonical name contract

**Status:** Phase 1 (the `<Icon>` system), the Phase 2 sidebar pilot, **and the Phase 2b app-wide sweep are all complete.** Every icon-bearing component file has been migrated to `<Icon>`; the only inline `<svg>` left in `components/` are the genuine non-icon graphics catalogued in §4. The canonical name list below (signed off 2026-06-09, plus the 14 names the sweep surfaced — see §2.1) is the permanent public contract that `.qtap-theme` bundles target. Renaming an icon after themes ship overrides for it is a breaking change; add freely, rename with care.

Source of truth for the *implemented* set: [`components/ui/icons/icon-registry.ts`](../../components/ui/icons/icon-registry.ts) (**85 icons**). Adding/renaming an icon = edit that file, drop the default SVG in `public/images/icons/`, and run `npm run generate:icon-css`.

---

## 1. What the scan found

- **123 component files** still contain an inline `<svg>` (down from 127 — the 4 sidebar pilot files are migrated). Across them, ~**290 icon instances** collapse to ~**55 distinct canonical glyphs**.
- Nearly every icon is `stroke="currentColor"` or `fill="currentColor"` — both render correctly as a CSS mask tinted by `currentColor`, so the default set keeps today's theme-color inheritance.
- The heaviest duplicates (each currently redefined inline in many files): **close/X (~40)**, **check (~22)**, **chevron-down (~10)**, **trash (~8)**, **copy (~6)**, **search (~6)**, **external-link (~6)**, **upload/download (~10)**, **alert-triangle (~6)**. Each collapses to ONE canonical icon.

---

## 2. Canonical icon-name list (the contract)

`✓` = implemented in the registry at Phase 1. `NEW` = was proposed here and has **since been implemented** during the Phase 2b sweep — every name in the tables below now exists in `icon-registry.ts` (plus the §2.1 additions). Names lean toward **function** a theme author would recognize. Several pairs intentionally **share a default glyph** but stay distinct names so a theme can diverge them later (noted).

### General UI & actions
| Name | Status | Glyph | Consolidates (examples) |
|---|---|---|---|
| `close` | ✓ | X | ~40 inline X's (all dialog closes, tag/chip removes, clears) |
| `check` | ✓ | checkmark | optimizer/wizard/import success ticks, selection ticks |
| `check-circle` | NEW | tick in circle | success states (optimizer, plugins up-to-date, tasks empty) |
| `pencil` | ✓ | pencil | edit buttons (prompts, profile, suggestions) |
| `trash` | NEW | bin | delete actions (chat card, prompts, tasks, gallery) |
| `copy` | NEW | clipboard | copy request/response/image, copy path |
| `plus` | NEW | + | add replacement, new chat, restore upload |
| `refresh` | ✓ | circular arrows | reload (LLM logs, tasks, archive, plugins) |
| `search` | NEW | magnifier | search bars/dialogs, plugin search, conversations |
| `download` | NEW | down-arrow to tray | export, restore, report download |
| `upload` | NEW | up-arrow from tray | import, backup, drop zones |
| `cloud-upload` | NEW | cloud + arrow | import-wizard drop zone (distinct from `upload`) |
| `external-link` | NEW | box + NE arrow | repo/changelog/npm links, memory source, data dir |
| `link` | NEW | chain | chat→project link indicator |
| `send` | NEW | paper plane | help-chat composer send |
| `paperclip` | NEW | paperclip | attach file (composer) |
| `eye` | NEW | eye | preview/view, quick-hide "visible" |
| `eye-off` | NEW | eye + slash | quick-hide "hidden", hidden placeholder |
| `star` | NEW | star | set-as-default prompt |
| `bookmark` | NEW | ribbon | save image to gallery |
| `expand` | NEW | outward arrows | nav content-width → wide |
| `compress` | NEW | inward arrows | nav content-width → narrow |

### Navigation: chevrons & arrows
| Name | Status | Glyph | Notes |
|---|---|---|---|
| `chevron-down` | ✓ | ⌄ | disclosure default; **rotate via `className` (`rotate-180`)** — covers chevron-up/expand toggles. No separate `chevron-up`. |
| `chevron-right` | NEW | › | collapsed disclosure, list nav |
| `chevron-left` | NEW | ‹ | gallery prev |
| `arrow-left` | NEW | ← | optimizer/apply "back" |
| `arrow-right` | NEW | → | optimizer "next", plugin upgrade |

### Status & feedback
| Name | Status | Glyph | Notes |
|---|---|---|---|
| `info` | ✓ | i in circle | tips, notes, estimate warnings |
| `alert-triangle` | NEW | ⚠ triangle | warnings (delete-data, breaking changes, vision required) |
| `alert-circle` | NEW | ! in circle | errors (display options, LLM inspector) |
| `shield` | NEW | shield+tick | optimizer "analysis complete" |
| `clock` | NEW | clock | pending task, autonomous/scheduled |
| `calendar` | NEW | calendar grid | LLM logs, memory-dedup, card headers |

### Media & gallery
| Name | Status | Glyph | Notes |
|---|---|---|---|
| `image` | NEW | framed mountain | image placeholders/empty states, generate-image |
| `play` | NEW | ▷ | run queue, continue, autonomous run |
| `pause` | NEW | ❚❚ | pause queue/task |
| `stop` | NEW | ◻ | stop queue |
| `zoom-in` | NEW | magnifier + | gallery zoom in |
| `zoom-out` | NEW | magnifier − | gallery zoom out |

### Domain objects
| Name | Status | Glyph | Notes |
|---|---|---|---|
| `files` | ✓ | document (folded corner) | **Files** nav |
| `file` | NEW | document | generic single-doc empty states — *shares `files`' default glyph* |
| `folder` | NEW | folder | project/folder indicators |
| `folder-plus` | NEW | folder + | create project |
| `book` | NEW | open book | "Refine from Memories" |
| `profile` | ✓ | person (head+shoulders) | sidebar account |
| `user` | NEW | person | generic person (NPC, gallery avatar) — *shares `profile`'s default glyph* |
| `user-plus` | NEW | person + | create NPC |
| `megaphone` | NEW | megaphone | insert announcement (composer) |
| `mail` | NEW | envelope | compose mail (composer; the Post Office) |
| `dice` | NEW | die w/ pips | RNG dropdown (Pascal) |
| `sparkles` | NEW | sparkles | inline "generate" / AI-flavored actions |
| `wand` | NEW | magic wand | the AI Wizard (distinct from inline `sparkles`) |
| `thinking` | NEW | quill on the diagonal | the rocking "awaiting / streaming / tool running" indicator — see §6 (deliberately **not** `brand`) |

### Appearance / domain nav (already mostly in registry)
| Name | Status | Glyph |
|---|---|---|
| `projects` `characters` `scriptorium` `photos` `scenarios` `settings` `themes` `wardrobe` `help` `chat` | ✓ | sidebar set (Phase 1) |
| `sun` | NEW | sun — light mode |
| `moon` | NEW | crescent — dark mode |
| `monitor` | NEW | display — system mode |
| `brand` | ✓ | the quill (image mode, full colour) |

---

### 2.1 Added during the Phase 2b sweep (genuinely new glyphs, not renames)

The signed-off list covered the high-frequency glyphs from the initial scan. The full sweep surfaced more distinct, reusable glyphs with no canonical home. Because no theme had shipped overrides yet, these were promoted to canonical names during the sweep (additions, never renames — so the contract stays intact):

| Name | Glyph | Used for |
|---|---|---|
| `arrow-up` / `arrow-down` | full-stem arrows | sort/scroll/dropdown direction (completes the `arrow-left`/`arrow-right` family) |
| `ban` | circle with slash | silent/disabled/blocked states (participant "silent" overlay, disabled theme source, logging-off) |
| `camera` | camera body + lens | regenerate avatar, generate-image gutter button |
| `log-out` | arrow leaving a door | stop-impersonate, participant "absent" overlay, leave |
| `users` | multi-person group | empty-participants state, group references |
| `wrench` | wrench | Run Tool |
| `database` | cylinder stack | State editor / data |
| `swap` | two opposing horizontal arrows | Bulk Replace |
| `file-plus` | document with `+` | insert/library file |
| `code` | `</>` brackets | code-formatting toggle |
| `zap` | lightning bolt | "Generate" actions (distinct from `sparkles`) |
| `cpu` | chip | LLM-logs / memory-dedup / capabilities headers (system/processing) |
| `layers` | stacked planes | task-queue header |

### 2.2 Added after the contract shipped (additions only — the contract allows them)

| Name | Glyph | Added | Used for |
|---|---|---|---|
| `tag` | label/tag with eyelet | 2026-06-10 | Tags tab on Aurora character pages (surfaced while migrating the `app/`-level tab bars the Phase 2b sweep missed — that sweep batched `components/*` only) |
| `minus` | single horizontal stroke | 2026-06-10 | Counterpart to `plus`; the Salon terminal "hide pane (keep session alive)" affordance, and a general remove/collapse glyph (surfaced during the `app/*` sweep) |
| `sort` | up + down arrow pair | 2026-06-10 | Neutral "sortable column" indicator in sortable tables (the Scriptorium file table); active sort direction uses the existing `arrow-up`/`arrow-down` |

## 3. Decisions — SIGNED OFF (2026-06-09)

1. **`profile`/`user` and `file`/`files`** — ✅ **keep distinct**, each pair sharing one default SVG so a theme can diverge the two surfaces later.
2. **AI / magic** — ✅ **`sparkles`** for inline "generate"/AI-flavored actions; **distinct `wand`** for the AI Wizard.
3. **Naming taste** — ✅ recommendations adopted: `megaphone`, `expand`/`compress`, `dice`. (Flag in review if any should change before themes ship.)
4. **Drag handle** (six-dot grip, `ProfileCard.tsx`) — ✅ **excluded** (carries drag listeners; UI chrome, not a themeable glyph).
5. **Codename → function renames** (applied in the pilot, for the record): `FoundryIcon`→`settings`, `PaletteIcon`→`themes`, `ProsperoIcon`→`projects`, `ScenariosNavIcon`/`ScenariosIcon`→`scenarios`. The contract name is the function; codename noted only here.

---

## 4. NOT migrated (genuine non-icon graphics — verified end state)

The post-sweep audit (`grep -rn '<svg' components/`) returns **only** these categories — every one is a non-reusable graphic, not a themeable glyph:

- **Loading spinners** (`animate-spin`, the `M4 12a8 8 0 018-8V0…` arc) — the bulk of what remains, across dialogs/cards/steps, incl. the shared `components/tools/import-export/components/LoadingSpinner.tsx`. (Consolidating these into one shared spinner is a possible future cleanup, out of scope here.)
- **Charts / bar graphs** — `components/tools/capabilities-report-card.tsx` (document-with-bars data-viz, 2 svgs).
- **Provider badges** — `components/image-profiles/ProviderIcon.tsx` (plugin-supplied dynamic SVGs + abbreviation badges, 3 svgs).
- **Pending-state rings** — `components/characters/ai-wizard/steps/GenerationStep.tsx` plain `<circle r="10">` field-status bullets (paired with the spinner = in-progress and `check-circle` = done).
- **Chat-bubble tails** — `components/help-chat/HelpChatMessageList.tsx` (3 small triangle tails; bespoke geometric artwork).
- **Drop-zone illustration** — `components/tools/import-export/steps/ImportFileStep.tsx` (two-way transfer-arrow drop-zone art).
- **Empty-state illustration** — `components/tools/tasks-queue/index.tsx` clipboard "no tasks" art.
- **Drag handle** — `components/settings/connection-profiles/ProfileCard.tsx` six-dot grip (carries drag listeners; UI chrome, see decision 4).
*(Formerly listed here: **the animated quill**. `components/chat/QuillAnimation.tsx` has since been migrated — it renders `<Icon name="thinking">` and the motion moved out of the component's styled-jsx into `.qt-thinking-indicator` in `_chat.css`. See §6.)*

---

## 5. Migration batching (Phase 2b) — COMPLETE

All batches landed (each verified with `npx tsc` + the §4 audit; orphaned local icon components deleted, with `ScenariosIcon` kept as a thin `<Icon name="scenarios">` wrapper so its many call sites stayed untouched):

- **Pilot:** left sidebar (`collapsed-nav`, `sidebar-footer`, `sidebar-header`, `profile-menu`).
- **Batch 1:** `components/ui/*` shells (BaseModal, FloatingDialog, SlideOverPanel, CollapsibleCard) + `dashboard/*`.
- **Batch 2:** `components/chat/*`.
- **Batch 3:** `components/tools/*` + `components/settings/*`.
- **Batch 4:** `components/characters/*` + `character/*` + `wardrobe/*` + `memory/*` + `scenarios/*` + `setup-wizard/*`.
- **Batch 5:** `components/images/*` + `help-chat/*` + `profile/*` + `search/*` + `tags/*` + `homepage/*` + `terminal/*` + `state/*` + `import/*` + `quick-hide/*` + `new-chat/*` + `layout/autonomous-room-badges.tsx`.

Implementation note (cascade): `_icons.css` is imported **first** in `app/styles/qt-components/_index.css` so the `.qt-icon { width/height: 1em }` base is the weakest sizing in `@layer components` — call-site `w-*`/`h-*` utilities and any `qt-*` class that sizes an icon (e.g. `.qt-collapsible-card-chevron`) both win, so no icon is frozen at 1em.

To add an icon later: add a registry entry, author `public/images/icons/<name>.svg` (24×24, monochrome `currentColor`), run `npm run generate:icon-css`.

---

## 6. The thinking indicator (`thinking` + `.qt-thinking-indicator`)

The rocking quill shown while a reply is awaited, while tokens stream, and while a tool call is outstanding is **two independent theme hooks**, deliberately split so a theme can change one without inheriting the other:

| Hook | Kind | What a theme does with it |
|---|---|---|
| `thinking` | icon name | swap the glyph via the manifest `icons` map, like any other icon |
| `.qt-thinking-indicator` | `qt-*` class (`_chat.css`) | retune the rock via `--qt-thinking-duration` / `--qt-thinking-easing` / `--qt-thinking-origin` / `--qt-thinking-angle-rest` / `--qt-thinking-angle-lean`, or re-declare the class for a wholly different animation |

It is deliberately **not** `brand`: a theme that replaces the brand mark with a wordmark should not find that wordmark rocking back and forth in the Salon.

The default glyph is a diagonal quill (nib to the lower left), and the default motion sweeps between upright (`-45deg`) and that natural writing lean (`0deg`) — which is why the rest angle is the negative one. A theme shipping an upright glyph will want to override the two angle variables.

It pivots on the **nib**, not the centre: `--qt-thinking-origin` defaults to `12.5% 87.5%`, which is (3,21) of the glyph's 24×24 viewBox — the point that would be touching the page. That point stays fixed and the feather swings above it. The origin belongs to the *artwork*, so a theme overriding the glyph must move it to that glyph's own nib. One consequence: a quill is longer than its box is tall, so at the upright extreme the tip paints ~8px above the 48px indicator's layout box. Nothing clips it (the mask paint rides the transform) and every call site has slack, but the indicator must not be wrapped in an `overflow: hidden` container.

Because `thinking` is a `mask`-mode icon, it tints with `currentColor` — the call sites' `qt-text-secondary` and the composer's per-stage status colours all reach it. A theme override shipped as `.svg` keeps that tinting; a `.webp` override switches the icon to full-colour image mode and drops it (see `generateIconOverrideRule`).

---
