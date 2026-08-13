# Composer Emoji — Layer 2.0e Spec

**Status:** ✅ **COMPLETE — shipped 2026-08-13.** Every gate item met; see [Completion gate](#completion-gate) for what was verified how, and for the two defects the live walk caught that this spec did not anticipate.
**Scope:** quilltap-server (renderer + one settings boolean + its migration). No shell changes. No API route.
**Phase:** 2.0e of the composer series. Layer 1 ([spellcheck](../composer-spellcheck.md)) and Layer 1.5 ([text replacement](../composer-text-replacement.md)) have shipped in code — note that both of those specs still carry `Status: Proposal / Not Implemented` in their own headers and neither has been moved to `complete/`; trust the code, not their status lines.
This lands the typeahead shell that [Layer 2](../composer-typeahead.md) (`@`/`#`/`/`) needs, and proves it on the cheapest possible consumer.

> **Portability mandate.** This feature must be implementable in **quilltap-v5** (Rust core + Angular 21 SPA, ProseMirror editor) without redesign. v4 uses **Lexical**; v5 uses **ProseMirror**. Nothing below may depend on React, Lexical, SWR/TanStack, or any server round-trip. See [Portability contract](#portability-contract) — read it before writing a line of code.

## Summary

Let a writer insert an emoji by *searching for its name*. Two surfaces, one engine:

1. **Inline typeahead** — type `:` followed by at least two characters (`:smi`) anywhere in the composer or Document Mode editor; a popover lists matching emoji; Enter/click inserts the character. Typing a closing `:` on an exact shortcode match (`:smile:`) commits it without touching the menu.
2. **Toolbar picker** — a button in the formatting toolbar opens the same search over a browsable grid, with a Recents row.

Both read one static JSON dataset and one **pure search function**. There is no server involvement, no new table, no new API route.

## Goals

- Find an emoji by name or keyword without leaving the keyboard.
- Work identically in the Salon ChatComposer and the Document Mode rich editor (the surface pair Layers 1 and 1.5 already established).
- Insert the literal Unicode character into the document — **not** a shortcode, not a node, not an image. The message that reaches the LLM, the database, and every export contains plain UTF‑8.
- Ship a reusable typeahead shell that Layer 2's `@`/`#`/`/` plugins consume unchanged.
- Cost nothing on instances that never use it (dataset is lazily loaded on first `:` or first picker open).

## Non-goals

- **Custom / uploaded emoji.** Unicode only. Custom emoji would mean storage, an ID scheme, and a rendering path — a different feature.
- **A `DecoratorNode` / custom ProseMirror node.** The inserted value is a plain text character. This is the single most important decision in the spec: it keeps markdown round-trip, export, search, embeddings, and the LLM wire untouched, and it is why the v5 port is trivial.
- **Emoji rendering substitution** (Twemoji/JoyPixels image sprites). The platform font renders it.
- **Skin-tone variants** in v1. See [Deferred](#deferred).
- **Replacing shortcodes in already-sent messages.** No retro-active `:smile:` → 🙂 pass over history.
- **Source-mode textareas.** Same exclusion, same reason, as Layers 1 and 1.5: a Markdown-syntax surface is the wrong place for magic.
- **A server-side emoji index.** The dataset is small enough to search in the client in well under a millisecond.

## Known state (verified 2026-08-13)

- **No emoji handling exists in either composer.** No picker, no `:shortcode:` expansion, no emoji dataset dependency. Emoji appear only as opaque user-supplied strings in tag/group/project style fields (`lib/schemas/common.types.ts`, `lib/tags/styles.ts`, `components/tags/tag-badge.tsx`) and as hardcoded glyphs on tool chips.
- **No `LexicalTypeaheadMenuPlugin` usage anywhere**, and no `DecoratorNode` subclasses. Greenfield — as [composer-typeahead.md:33-34](../composer-typeahead.md) recorded on 2026-05-22 and still true.
- **`@lexical/react` is already a dependency** (`package.json`), and `LexicalTypeaheadMenuPlugin` ships inside it. Confirm the subpath resolves before starting; no new dependency should be needed.
- **The formatting toolbar is text-labelled, not icon-labelled.** `MARKDOWN_FORMATS` entries in [lib/chat/annotations.ts:42-54](../../../../lib/chat/annotations.ts) carry `label` strings (`'B'`, `'I'`, `'• …'`, `'“'`), and `FormattingToolbar.tsx:461` renders the literal string `'CODE'`. **An emoji button therefore needs no icon-registry work** — its label is a glyph.
- **⚠ The formatting toolbar only renders in composition / document-editing mode.** [ChatComposer.tsx:320-342](../../../../app/salon/[id]/components/ChatComposer.tsx):
  ```jsx
  {documentEditingMode && lexicalEditor && (
    <FormattingToolbar ... />
  )}
  ```
  A toolbar-only entry point would be **unreachable while chatting normally**. This is precisely why the spec ships the `:` typeahead as the primary surface and the button as the secondary one. Do not "solve" this by rendering the toolbar in plain chat mode — that is a separate UX decision with its own layout consequences.
- **Existing anchored-popover precedents, and they disagree with each other.** [components/chat/RngDropdown.tsx](../../../../components/chat/RngDropdown.tsx) is the closest *composer-anchored* popover and uses [hooks/useClickOutside.ts](../../../../hooks/useClickOutside.ts) (`:11`, `:79`) — but its panel is raw Tailwind plus `qt-card`, **not** `qt-popover`. The `.qt-popover` / `.qt-dropdown` / `.qt-dropdown-item` classes ([app/styles/qt-components/_surfaces.css:925-960](../../../../app/styles/qt-components/_surfaces.css)) have exactly two consumers: [components/ui/DeleteConfirmPopover.tsx](../../../../components/ui/DeleteConfirmPopover.tsx) and [components/scenarios/ScenarioRow.tsx](../../../../components/scenarios/ScenarioRow.tsx). **Take the dismissal behaviour from `RngDropdown` and the surface classes from `DeleteConfirmPopover`** — do not assume one file gives you both.
- **Markdown round-trip is safe for astral characters.** `DEFAULT_PRESERVED_MARKDOWN_CHARS` is `['*','_','`','~']` ([MarkdownBridgePlugin.tsx:127](../../../../components/chat/lexical/plugins/MarkdownBridgePlugin.tsx)); Lexical's export escape set is the same four; the import `unescapeText` only strips ASCII-punctuation escapes. Emoji are plain `TextNode` content and survive `serialize(parse(x))` byte-identically. **No new round-trip vectors are required** — but see [4.4](#44-round-trip-guard) for the one cheap guard worth adding.

## Portability contract

Everything below is split into three tiers. **The tier a file lands in is not negotiable** — it is what makes the v5 port mechanical.

| Tier | What | v4 | v5 |
| --- | --- | --- | --- |
| **A — Data** | The emoji dataset, a generated JSON asset | `public/emoji/emoji-index.v1.json` | byte-identical copy at `apps/web/public/emoji/emoji-index.v1.json` |
| **B — Pure logic** | Search, ranking, trigger detection, recents — framework-free TypeScript, no imports outside the stdlib | `lib/emoji/*.ts` | near-verbatim copy under `apps/web/src/app/editor/emoji/` |
| **C — Adapter** | The ~120 lines that know about Lexical / ProseMirror / React / Angular | `components/chat/lexical/plugins/EmojiTypeaheadPlugin.tsx`, `EmojiPickerPopover.tsx` | ProseMirror plugin + Angular component, rewritten |

**Rules.**

1. **Tier B files import nothing.** No `react`, no `lexical`, no `@tanstack/*`, no `next/*`. Enforce it with an ESLint `no-restricted-imports` override scoped to `lib/emoji/**` (see [4.5](#45-lint-guard)). If a Tier B file needs a DOM type, it is in the wrong tier.
2. **Tier B is 100 % of the decisions.** Which emoji match, in what order, where the trigger starts and ends, what the recents list becomes after a pick. The adapter only asks questions and applies answers.
3. **Tier B ships with a JSON corpus** (`lib/emoji/__fixtures__/emoji-search-vectors.json`) of `{ query, limit, expectedIds }` rows. v5 copies the corpus and asserts the same outputs — a **tier‑1 exact differential family** in v5's harness, earned for free. Treat the corpus the way v5 treats `markdown-round-trip.spec.ts`: *fix the port, not the vectors.*
4. **The dataset is versioned in its filename** (`emoji-index.v1.json`). A dataset regeneration that changes results is a `v2` file plus a corpus regeneration, never an in-place edit — otherwise the two apps silently disagree.

### v5 landing notes (informative, not binding)

- **Tier C, typeahead:** a ProseMirror plugin with `handleTextInput` + a `Decoration` for the active query range, or simply a plugin-state-driven Angular overlay anchored via `view.coordsAtPos()`. Register it in `buildPlugins()` in `apps/web/src/app/editor/rich-editor.ts` (the documented single chokepoint; plugin order there is load-bearing — place emoji **above** `textReplacementPlugin`, see [Interaction with Layer 1.5](#interaction-with-layer-15)).
- **Tier C, toolbar:** add an `'emoji'` arm to the `FormatAction` union in `apps/web/src/app/editor/formatting-toolbar.ts:9-18`, an entry in `MARKDOWN_BUTTONS` (`:28-40`), and — because the action inserts text rather than toggling a mark — an arm in `commandFor()` in `apps/web/src/app/editor/markdown-field.ts:263-288` plus `applySourceFormat` in `source-transforms.ts:141` **only if** the picker is enabled in source mode (v1: it is not).
- **v5 gutter capacity:** `apps/web/src/app/chat/chat-composer.ts:82-87` carries an explicit ⚠ eleven-wide warning. This feature adds **no gutter button** — the entry point is the formatting toolbar and the `:` trigger. Keep it that way.
- **No Rust changes at all.** No dispatch verb, no `CoreRequest`/`CoreResponse` variant, no `api/types.rs` edit, no differential-harness route family. If the implementation finds itself opening `crates/`, something has gone wrong.

## Architecture

### The dataset (Tier A)

A generated, committed JSON asset. One row per base emoji:

```jsonc
{
  "version": 1,
  "generatedAt": "2026-08-13",
  "source": "emojibase-data 16.x (CLDR annotations, github shortcode preset)",
  "emoji": [
    {
      "c": "😄",                                  // the character
      "n": "grinning face with smiling eyes",     // CLDR label, lowercased
      "s": ["smile"],                             // shortcodes, no colons
      "k": ["happy", "joy", "laugh", "grin"],     // CLDR keywords, lowercased
      "g": "smileys-emotion",                     // group slug
      "o": 3                                      // display order within group (Unicode's own)
    }
  ]
}
```

Notes:

- **Single-character keys** are deliberate: the file is ~1,900 rows and the difference between long and short keys is roughly 180 KB of shipped asset. It is data, not code; legibility lives in the generator and the TypeScript interface.
- **Generated, not hand-authored.** Add `scripts/generate-emoji-index.ts`, run by an npm script `generate:emoji-index`, reading `emojibase-data` as a **devDependency** (it must not reach the runtime bundle). The generator's output is committed; CI does not regenerate. This mirrors how `_icons.css` is generated-and-committed by [scripts/generate-icon-css.ts](../../../../scripts/generate-icon-css.ts).
- **Filter at generation time** to the fully-qualified base set: skip skin-tone variants, skip component code points (`🏻`, `🏼`, …), skip regional-indicator pairs beyond the flag group if the flag group is included at all. Target ≈1,900 entries / ≈250 KB minified / ≈70 KB gzipped.
- **Served from `public/`, fetched lazily.** The first `:` trigger or first picker open issues `fetch('/emoji/emoji-index.v1.json')`, caches the parsed result in a module-level singleton, and resolves every subsequent caller from memory. It must **never** be imported statically — that would put a quarter-megabyte in the main bundle for a feature most sessions never touch.
- **Failure is silent and non-blocking.** If the fetch fails, the typeahead never opens and the toolbar button shows an inline "Couldn't load emoji" state. Typing is never impeded. Log once at warn level; do not retry on every keystroke (one retry, then a 60-second cooldown).

### The search function (Tier B)

`lib/emoji/search.ts`:

```ts
export interface EmojiEntry {
  char: string;
  name: string;
  shortcodes: string[];
  keywords: string[];
  group: string;
  order: number;
}

export interface EmojiIndex {
  version: number;
  entries: EmojiEntry[];
  /** Built once at load: shortcode -> entry, for exact `:name:` commits. */
  byShortcode: Map<string, EmojiEntry>;
}

export function buildIndex(raw: unknown): EmojiIndex;

/** Pure. Deterministic. No I/O. The single source of match order. */
export function searchEmoji(index: EmojiIndex, query: string, limit: number): EmojiEntry[];
```

**Ranking.** Deterministic, total, and documented — because the corpus pins it:

1. Exact shortcode equality (`smile` → `:smile:`).
2. Shortcode prefix match.
3. Name prefix match (`grinning` → "grinning face…").
4. Word-start match inside the name (`face` matches "grinning **face**…").
5. Keyword exact match.
6. Keyword prefix match.
7. Name substring match.

Ties inside a bucket break by `(group order, entry order)` — i.e. Unicode's own presentation order — never by insertion order or `Array.sort` instability. **Use a stable sort and say so in a comment**; v5's Rust-adjacent reviewers will look for it, and v4's own port history is littered with sort-stability bugs (see the v5 `P4.14` non-validating stable merge sort lane).

`query` is lowercased and trimmed by the function itself; `-` and `_` are normalised to a single space on both sides of the comparison, so `:thumbs_up`, `:thumbs-up` and `:thumbs up` all land.

**Empty query** returns the first `limit` entries in group order — that is what the picker's initial grid shows.

### The trigger detector (Tier B)

`lib/emoji/trigger.ts`:

```ts
export interface EmojiTriggerMatch {
  /** Offset of the ':' within the supplied text. */
  start: number;
  /** Offset one past the last query character. */
  end: number;
  /** The query text, colon excluded. */
  query: string;
  /** True when the user typed the closing ':' — commit an exact match immediately. */
  closed: boolean;
}

/** `textBefore` is the text of the current block up to the cursor. */
export function findEmojiTrigger(textBefore: string): EmojiTriggerMatch | null;
```

Rules, all of them pinned by fixtures:

- The `:` must be at the start of the block or immediately preceded by whitespace or one of `([{"'“‘—–`. This is what stops `http://`, `10:30`, `a:b`, and every Windows path from opening a menu.
- The query is `[a-z0-9_+-]` only, case-insensitively; the first disallowed character closes the match. **Space is disallowed** — `: ` cancels. (This deliberately forbids searching multi-word names from the inline trigger; that is the picker's job. It is the difference between a menu that opens when you want it and one that opens when you type a time.)
- Minimum query length **2** before the menu opens. `:` and `:a` are inert. Rationale: `:)` and `:-)` must never open a menu, and one-character queries match half the set.
- Maximum query length **32**; beyond that the match is abandoned (a runaway trigger from pasted text should not hold a menu open).
- If the character after the query is `:`, set `closed: true`.

### Recents (Tier B logic, Tier C storage)

`lib/emoji/recents.ts` exports pure list arithmetic:

```ts
export const RECENTS_LIMIT = 24;
export function pushRecent(current: string[], char: string): string[];   // move-to-front, dedupe, cap
export function parseRecents(raw: string | null): string[];              // tolerant of junk, never throws
export function serializeRecents(list: string[]): string;
```

Storage is `localStorage`, key **`quilltap.emoji.recents.v1`** — the same literal key in both apps, so a user moving between v4 and v5 on the same origin keeps their list. The adapter owns the `localStorage` calls; the logic above owns the list.

> **Why not a server setting?** Recents are high-frequency, low-value, single-device state. A settings round-trip per emoji pick would be absurd, and a `chat_settings` column would ride every backup and export for no benefit. `localStorage` is correct here and matches how v5 already persists workspace-tab state.

### Insertion semantics

On commit — by Enter, by click, or by the closing `:` on an exact shortcode match:

1. Delete the trigger range (`start`..`end`, plus the closing `:` when `closed`).
2. Insert the emoji character.
3. Insert **no** trailing space. (Layer 2's chips insert one because a chip is a word; an emoji is punctuation-adjacent and writers frequently want `word😄` or `😄😄`. Diverging from `insertWithTrailingSpace()` here is deliberate — note it in the shell's doc comment so the next reader does not "fix" it.)
4. Leave the caret immediately after the inserted character.
5. Do the whole thing inside a **single** history entry (Lexical: `editor.update(fn, { tag: 'emoji-insert' })`) so one Cmd/Ctrl+Z removes the emoji and restores the literal `:smi` the user typed — matching the Layer 1.5 undo contract.

Escape / dismissal: `Escape` closes the menu and leaves the literal text alone; so does clicking outside, moving the caret out of the trigger range, or typing a disallowed character.

### Interaction with Layer 1.5

Both features hook keystrokes. Their trigger sets **do not overlap** — text replacement fires on ` `, NBSP, tab, and `. , ; : ! ? )`; emoji fires on `:` only as an *opener* and on the query characters.

The one genuine collision is `:` itself, which is a text-replacement word-boundary trigger. Resolution:

- Register `EmojiTypeaheadPlugin` at **`COMMAND_PRIORITY_NORMAL`**, above `TextReplacementPlugin`'s `COMMAND_PRIORITY_LOW` ([TextReplacementPlugin.tsx:173](../../../../components/chat/lexical/plugins/TextReplacementPlugin.tsx)).
- Emoji only swallows the keystroke (`return true`) when it *commits* an insertion. Opening the menu returns `false`, so a `:` typed after a replaceable word still lets text replacement fire and still opens the menu on the resulting text. That is the behaviour a writer expects; pin it with the test in [4.3](#43-plugin-tests).

In v5, the same ordering is expressed by placing the emoji plugin **before** `textReplacementPlugin` in `buildPlugins()` (`rich-editor.ts:224-280`) — ProseMirror runs `handleTextInput`/`handleKeyDown` props in plugin-array order.

## Phase 1 — Dataset and generator

### 1.1 Generator

`scripts/generate-emoji-index.ts`:

- Add `emojibase-data` to **devDependencies only**.
- Read the English CLDR annotation set plus the `github` shortcode preset.
- Filter to base emoji (drop skin-tone and component variants); keep `group` and `order` from the source so display order is Unicode's, not ours.
- Lowercase `name`, `keywords`, and `shortcodes` at generation time so the search function never has to.
- Emit `public/emoji/emoji-index.v1.json`, minified, with a stable key order so regenerations produce clean diffs.
- Add `"generate:emoji-index": "tsx scripts/generate-emoji-index.ts"` to `package.json` scripts, next to the icon-CSS script.

### 1.2 Asset

Commit `public/emoji/emoji-index.v1.json`. Record its provenance (source package + version + Unicode version) in the file's own `source` field **and** in a one-paragraph note in this spec's Completion gate section when the work lands.

**Do not** add it to any bundler `include`. It is fetched, never imported.

## Phase 2 — Tier B logic

### 2.1 Files

- `lib/emoji/types.ts` — `EmojiEntry`, `EmojiIndex`, `EmojiTriggerMatch`.
- `lib/emoji/search.ts` — `buildIndex`, `searchEmoji`.
- `lib/emoji/trigger.ts` — `findEmojiTrigger`.
- `lib/emoji/recents.ts` — `pushRecent`, `parseRecents`, `serializeRecents`, `RECENTS_LIMIT`.
- `lib/emoji/load.ts` — the lazy fetch singleton. **Tier B/C boundary case:** it touches `fetch`, so keep it thin (fetch, `buildIndex`, cache, cooldown) and keep no decisions in it.
- `lib/emoji/fixtures/emoji-search-vectors.json` — the shared corpus.
- `lib/emoji/fixtures/emoji-trigger-vectors.json` — the shared corpus.

> **Deliberate deviation from repo convention.** Existing fixtures live under `__tests__/fixtures/` and `__tests__/unit/lib/fixtures/`. These sit beside the engine instead, because **v5 copies `lib/emoji/` as a directory** and the corpus must travel with the code it pins. Note the deviation in the directory's own README or a header comment so the next reader knows it was chosen, not missed.

### 2.2 Corpus shape

```jsonc
// emoji-search-vectors.json
{
  "datasetVersion": 1,
  "cases": [
    { "query": "smile",     "limit": 8, "expect": ["😄", "😊", "🙂"] },
    { "query": "thumbs_up", "limit": 8, "expect": ["👍"] },
    { "query": "THUMBS UP", "limit": 8, "expect": ["👍"] },
    { "query": "",          "limit": 3, "expect": ["😀", "😃", "😄"] }
  ]
}
```

```jsonc
// emoji-trigger-vectors.json
{
  "cases": [
    { "text": "hello :smi",        "expect": { "start": 6, "end": 10, "query": "smi", "closed": false } },
    { "text": "hello :smile:",     "expect": { "start": 6, "end": 12, "query": "smile", "closed": true } },
    { "text": "http://",           "expect": null },
    { "text": "meet at 10:30",     "expect": null },
    { "text": ":)",                "expect": null },
    { "text": ":a",                "expect": null },
    { "text": "(:smi",             "expect": { "start": 1, "end": 5, "query": "smi", "closed": false } }
  ]
}
```

`expect` lists a **prefix** of the result for search (assert `expect` equals `result.slice(0, expect.length)`), and the **whole** match object for triggers. Every entry carries the invariant it exists to protect; the URL, clock-time and `:)` rows are the ones that will actually save someone.

### 2.3 Unit tests

`lib/emoji/__tests__/search.test.ts`, `trigger.test.ts`, `recents.test.ts`. Drive them from the corpora, plus:

- Ranking-bucket ordering is exactly the documented seven-step order.
- Sort stability: two entries tying on every criterion come back in `(group order, entry order)`.
- `buildIndex` on a malformed payload throws a typed error rather than producing a half-built index.
- `parseRecents(null)`, `parseRecents('{')`, `parseRecents('[1,2]')` all return `[]`.
- `pushRecent` dedupes, moves to front, and caps at `RECENTS_LIMIT`.

## Phase 3 — Tier C adapters

### 3.1 Typeahead shell (shared with Layer 2)

Build the shell [composer-typeahead.md](../composer-typeahead.md) Phase 1 already specified, and build it **here**, because emoji is its cheapest consumer:

- `components/chat/lexical/typeahead/useTypeaheadShell.tsx`
- `components/chat/lexical/typeahead/MenuPortal.tsx`
- `components/chat/lexical/typeahead/types.ts`

Two deltas from that spec, both to be written back into it when this lands:

1. `insertWithTrailingSpace()` gains a sibling `insertWithoutTrailingSpace()`, or a boolean option. Emoji uses the no-space path.
2. The shell must accept a **precomputed trigger match** rather than owning trigger detection, so Tier B keeps that decision. `LexicalTypeaheadMenuPlugin`'s trigger function becomes a thin `(text) => findEmojiTrigger(text)` adapter returning its `QueryMatch` shape.

### 3.2 `EmojiTypeaheadPlugin.tsx`

`components/chat/lexical/plugins/EmojiTypeaheadPlugin.tsx`. Follows the established plugin shape (`useLexicalComposerContext`, `editor.registerCommand` inside `useEffect`, return the disposer) — see [TextReplacementPlugin.tsx](../../../../components/chat/lexical/plugins/TextReplacementPlugin.tsx) for the closest precedent.

Bail conditions, in order — **these mirror Layer 1.5's exactly and must not drift from it**:

1. Feature disabled (see [3.5](#35-settings)).
2. `editor.isComposing()` — IME.
3. Selection is not a collapsed `RangeSelection`.
4. Cursor is inside a code block. The idiom is at [FormattingCommandPlugin.tsx:223-225](../../../../components/chat/lexical/plugins/FormattingCommandPlugin.tsx) — **copy it including the `$isElementNode` narrowing**, which is easy to drop and load-bearing:
   ```ts
   const block = anchorNode.getTopLevelElement()
   if (!block || !$isElementNode(block) || $isCodeNode(block)) return false
   ```
5. Cursor is inside inline code: `anchorNode.hasFormat('code')`. **Note:** `TextReplacementPlugin` performs neither check 4 nor check 5, so text replacements currently fire inside code. That is a latent Layer 1.5 defect and its own bug — file it per [CLAUDE.md → Filing bugs](../../../../CLAUDE.md), taking the next unused number from the [Status table](../../bugs.md#status) at the time you file (62 is taken), and fix it in the same change; the two plugins sharing one `isInCodeContext(selection)` helper is the right shape.
6. Index not yet loaded — kick off the lazy load and return `false`.

Menu rendering: each row shows the glyph, the CLDR name, and the primary `:shortcode:` in muted text. Cap at 10 visible rows with keyboard scroll. Empty state: "No emoji found".

### 3.3 `EmojiPickerPopover.tsx`

`components/chat/EmojiPickerPopover.tsx`. An anchored popover modelled on [RngDropdown.tsx](../../../../components/chat/RngDropdown.tsx) — `useClickOutside`, `.qt-popover` surface classes, Escape to close, focus trapped to the search field on open.

Contents: a search input (auto-focused), a Recents row when non-empty, and a grid grouped by `group` with sticky group headers. Selecting inserts through the same Tier B/insertion path as the typeahead so the two surfaces cannot diverge.

### 3.4 Toolbar button

In [components/chat/FormattingToolbar.tsx](../../../../components/chat/FormattingToolbar.tsx), add a button in its own section after the RP delimiter section and before the source toggle. Label: the glyph `☺` (or 🙂 — pick one, state it in the code, and use the identical label in v5). Tooltip: "Insert emoji (or type `:` and a name)".

The button is a **hand-written `<button>`, not a `MARKDOWN_FORMATS` entry** — `MARKDOWN_FORMATS` describes prefix/suffix wrapping, which this is not. Follow the outdent/indent/CODE precedent at `FormattingToolbar.tsx:431-462`.

Because the toolbar is composition-mode-only, the button is a convenience, not the feature. Say so in the tooltip and in the help doc.

### 3.5 Settings

One boolean on chat settings, mirroring `composerSpellcheck` exactly:

```ts
/** Whether the `:` emoji typeahead fires in the Salon composer and Document Mode editor (default: true) */
composerEmoji: z.boolean().default(true),
```

Plumb through:

- [lib/schemas/settings.types.ts](../../../../lib/schemas/settings.types.ts) — alongside `composerSpellcheck` (:585) and `textReplacementsEnabled` (:587).
- [lib/database/repositories/chat-settings.repository.ts](../../../../lib/database/repositories/chat-settings.repository.ts) — default in `updateForUser`'s `defaultSettings`.
- [app/api/v1/settings/chat/route.ts](../../../../app/api/v1/settings/chat/route.ts) — param, PUT destructure, positional pass-through. Copy the `composerSpellcheck` lines verbatim.
- [components/settings/chat-settings/types.ts](../../../../components/settings/chat-settings/types.ts), [hooks/useChatSettings.ts:565-580](../../../../components/settings/chat-settings/hooks/useChatSettings.ts) (the `handleComposerSpellcheckChange` pattern).
- Migration `migrations/scripts/add-composer-emoji-field.ts`: `ALTER TABLE "chat_settings" ADD COLUMN "composerEmoji" INTEGER DEFAULT 1`. **Copy [add-composer-spellcheck-field.ts:52](../../../../migrations/scripts/add-composer-spellcheck-field.ts) — it is the same statement for the sibling column.** Note the naming convention: **no migration in this repo is date-prefixed**; all 179 use `add-<thing>-field.ts` / `add-<thing>-v1.ts`. Per [CLAUDE.md → Writing migrations](../../../../CLAUDE.md), add a `PRETTY_LABELS` entry in [lib/startup/prettify.ts](../../../../lib/startup/prettify.ts) in the steampunk-Wodehouse voice — *"Cataloguing the little faces."* No loop, so no `reportProgress`. Register in `migrations/scripts/index.ts`. Update [docs/developer/DDL.md](../../DDL.md).

The toolbar button is **not** gated by this flag — the flag governs the automatic `:` trigger, which is the part that can surprise. An explicit button press is never a surprise.

UI: a single toggle inside the existing Composer card on the Chat tab ([ChatTabContent.tsx:83-89](../../../../components/settings/tabs/ChatTabContent.tsx)), beneath spellcheck. Label **"Emoji shortcuts"**; helper *"Type `:` and at least two letters to search emoji by name. The toolbar's emoji button works either way."*

That card's `sectionId` is **`composer-spellcheck`** (`ChatTabContent.tsx:83`) — a historical name, and the only anchor that will actually deep-link. Do not invent `section=composer`; either use the existing id or rename it and update every `?section=` reference to it in one pass.

### 3.6 Mount points

- [LexicalComposerWrapper.tsx](../../../../components/chat/lexical/LexicalComposerWrapper.tsx) — add `<EmojiTypeaheadPlugin />` to the plugin stack (:124-159), **above** `<TextReplacementPlugin />` (:157).
- [DocumentPane.tsx](../../../../app/salon/[id]/components/DocumentPane.tsx) — same, inside `DocumentEditorPlugins`.
- **Not** [components/markdown-editor/MarkdownLexicalEditor.tsx](../../../../components/markdown-editor/MarkdownLexicalEditor.tsx) in v1 — its plugin list (`:85-105`) is also missing `TextReplacementPlugin`, and closing that gap is a separate, deliberate decision rather than a rider on this one.

## Phase 4 — Styles, guards, docs

### 4.1 `qt-*` classes

New classes in [app/styles/qt-components/](../../../../app/styles/qt-components/):

| Class | File | Purpose |
| --- | --- | --- |
| `.qt-typeahead-menu` | `_surfaces.css` | the popover surface |
| `.qt-typeahead-option` / `-active` | `_surfaces.css` | rows |
| `.qt-typeahead-empty` | `_surfaces.css` | empty state |
| `.qt-emoji-picker` / `-search` / `-grid` / `-group-header` / `-cell` / `-recents` | `_chat.css` | the picker |
| `.qt-formatting-button-emoji` | `_chat.css` | the toolbar button variant, following `-bold` (:1461) etc. |

> **⚠ Mandatory, and it gates the commit.** Per [CLAUDE.md → Themes](../../../../CLAUDE.md), *every* `qt-*` change must be mirrored into [packages/theme-storybook/src/css/qt-components.css](../../../../packages/theme-storybook/src/css/qt-components.css) in the **same change**, de-Tailwinded to plain CSS, faithfully including quirks. Then bump the package's patch version and **stop and ask the human to `npm publish`** — the publish gates the commit. Add a Storybook story for the picker and menu in `packages/theme-storybook/src/stories/components/Chat.tsx`. Also consider `packages/create-quilltap-theme` and the six bundled themes in `themes/bundled/`.

### 4.2 Accessibility

`role="listbox"` on the menu, `role="option"` + `aria-selected` on rows, `aria-activedescendant` on the composer's contenteditable while the menu is open. The picker grid gets `role="grid"` with arrow-key navigation. Each cell's accessible name is the CLDR label — that string is in the dataset precisely so screen readers get it.

### 4.3 Plugin tests

`__tests__/unit/components/chat/lexical/plugins/EmojiTypeaheadPlugin.test.tsx` — **note the location**: existing Lexical plugin tests live under `__tests__/unit/…` (see `MarkdownBridgePlugin.test.ts` there), not in a colocated `__tests__/` directory. Jest's `testMatch` would find either, but put it beside its sibling.

⚠ **There is no `TextReplacementPlugin` test in the repo at all**, so "mirror Layer 1.5's tests" has nothing to mirror. Writing one as part of this change is strongly encouraged — the two plugins share bail conditions and an undo contract, and neither is currently pinned.

Cases:

- `:smi` opens the menu; Enter inserts `😄`; no trailing space.
- `:smile:` commits without the menu being touched.
- `:` alone and `:a` do not open the menu.
- `:)` does not open the menu.
- `http://` and `10:30` do not open the menu.
- One Cmd-Z restores the literal `:smi`.
- IME composition suppresses the plugin.
- Inside a code block and inside inline code, nothing fires.
- `composerEmoji = false` suppresses the trigger but the picker still inserts.
- A `:` typed after a text-replacement trigger word fires the replacement **and** opens the menu (the [Layer 1.5 interaction](#interaction-with-layer-15) contract).
- Dataset fetch failure: typing `:smi` is inert, no throw, one warn log.

### 4.4 Round-trip guard

Emoji need no new markdown escaping, but add a vector asserting an astral character — and one inside a bold run — survives `serialize(parse(x))` byte-identically. This is the assertion that catches a future escape-set change.

⚠ **v4 has no general idempotency table** analogous to v5's `markdown-round-trip.spec.ts` `IDEMPOTENT`. The nearest homes are `__tests__/unit/components/chat/lexical/markdown-list-roundtrip.test.ts` (list-specific) and `__tests__/unit/components/chat/lexical/plugins/MarkdownBridgePlugin.test.ts`. Add the vectors to the latter, or build the general table — but budget for it rather than assuming a two-line change. In v5 the equivalent is a one-row addition to the existing `IDEMPOTENT` table.

### 4.5 Lint guard

Add to `eslint.config.mjs` (flat config via `defineConfig`; there is also a local `eslint-quilltap-plugin.js`) an override scoped to `lib/emoji/**`:

```js
'no-restricted-imports': ['error', { patterns: ['react', 'react-*', 'next/*', 'lexical', '@lexical/*', '@tanstack/*'] }]
```

⚠ `no-restricted-imports` is **not used anywhere in the repo today**, so there is no in-repo precedent to copy and the base ESLint rule (not the `@typescript-eslint` variant) is what the `patterns` shape above binds to. Verify the override actually fires by adding a `react` import to a Tier B file and confirming `npm run lint` fails.

This is what mechanically enforces the [Portability contract](#portability-contract). Without it, Tier B rots within two changes.

### 4.6 Help docs

Per CLAUDE.md, all user-visible changes go in `help/*.md`. Add an Emoji section to [help/chat-settings.md](../../../../help/chat-settings.md), beside the existing Composer/spellcheck section (`:42-58`) and Text Replacement section (`:96-116`), covering: the `:` trigger and its two-character minimum, the closing-colon shortcut, the toolbar button and its composition-mode caveat, that the inserted value is a plain character (so it works in exports and in anything reading the message), and where the toggle lives.

⚠ **Do not touch that file's frontmatter.** `help/chat-settings.md:2` declares `url: /settings?tab=chat` with the single matching `help_navigate(url: "/settings?tab=chat")` at `:599`, and CLAUDE.md requires the two to agree. Adding a `&section=` to the frontmatter would break every other section in the file. If a section-scoped deep link is wanted, the repo's convention is a **separate** help file (`help/answer-confirmation.md`, `help/custom-tools.md`, `help/data-retention.md`) with its own `url` and its own `help_navigate` — pick one route, not half of each.

Voice: steampunk + Roaring 20s + Wodehouse + Lemony Snicket.

### 4.7 Changelog

Top entry in [docs/CHANGELOG.md](../../../CHANGELOG.md), terse plain American English (the one place the steampunk voice does not apply):

```
- Composer emoji: type `:` plus at least two letters to search emoji by name and insert one, in both the Salon composer and Document Mode. A button in the formatting toolbar opens a searchable picker with recents. Inserted emoji are plain Unicode characters, so exports, search, and the LLM see ordinary text. Toggle on the Chat settings tab under Composer; default on.
```

## Verification

### Type checks

`npx tsc` at the repo root (per CLAUDE.md — **not** `npm run build`).

### Manual matrix

| Scenario | Expected |
| --- | --- |
| `:smi` in the composer | menu opens, 😄 near the top |
| Enter on a menu row | emoji inserted, no trailing space, caret after it |
| `:smile:` typed in full | commits on the closing colon, menu never needed |
| `:` then Escape | menu closes, literal `:` remains |
| `:)` | no menu |
| `Meeting at 10:30` | no menu |
| `https://example.com` | no menu |
| Cmd-Z after an insert | back to `:smi` |
| Same in Document Mode rich editor | identical behaviour |
| Source-mode textarea | nothing fires |
| Inside a fenced code block | nothing fires |
| Inside `` `inline code` `` | nothing fires |
| Toolbar button in composition mode | picker opens, search works, pick inserts |
| Pick three emoji, reopen picker | Recents row shows them most-recent-first |
| Toggle "Emoji shortcuts" off | `:` trigger inert; toolbar picker still works |
| Send a message containing an emoji | plain character in the DB row and in the LLM request (check the LLM Inspector) |
| Export and re-import the instance | emoji survive byte-identically |
| Offline / blocked asset | typing `:smi` is inert; no console error storm; one warn |
| IME active | no menu, no interference |

### Automated

Everything in [2.3](#23-unit-tests) and [4.3](#43-plugin-tests), plus the round-trip vector from [4.4](#44-round-trip-guard).

## Deferred

- **Skin tones.** Adds a `defaultSkinTone` setting, a dataset column, and a long-press/hover affordance on the picker cells. Worth doing; not worth blocking on.
- **`MarkdownLexicalEditor` (character-sheet and memory fields).** Deliberately excluded, along with Layer 1.5's identical gap. Close both at once, or neither.
- **Frequency-weighted ranking** (promote what the user actually picks). Would make `searchEmoji` impure or force a weights argument through the corpus. If wanted, pass an optional `weights: Map<string, number>` as a **parameter** so the function stays pure and the corpus keeps working with an empty map.
- **Custom emoji.** Its own feature.
- **Layer 2 proper** (`@`/`#`/`/`) — this spec hands it a built-and-proven shell; see [composer-typeahead.md](../composer-typeahead.md).

## File-touch summary

**New (Tier A/B — copied near-verbatim into v5):**
- `scripts/generate-emoji-index.ts`
- `public/emoji/emoji-index.v1.json`
- `lib/emoji/types.ts`, `search.ts`, `trigger.ts`, `recents.ts`, `load.ts`
- `lib/emoji/fixtures/emoji-search-vectors.json`, `emoji-trigger-vectors.json`
- `lib/emoji/__tests__/search.test.ts`, `trigger.test.ts`, `recents.test.ts`

**New (Tier C — rewritten in v5):**
- `components/chat/lexical/typeahead/useTypeaheadShell.tsx`, `MenuPortal.tsx`, `types.ts`
- `components/chat/lexical/plugins/EmojiTypeaheadPlugin.tsx`
- `components/chat/EmojiPickerPopover.tsx`
- `__tests__/unit/components/chat/lexical/plugins/EmojiTypeaheadPlugin.test.tsx`
- `__tests__/unit/components/chat/lexical/plugins/TextReplacementPlugin.test.tsx` — the missing Layer 1.5 coverage
- `migrations/scripts/add-composer-emoji-field.ts`

**Modified:**
- `package.json` — `emojibase-data` devDependency, `generate:emoji-index` script (runner is `tsx`, matching every other script)
- `eslint.config.mjs` — the `lib/emoji/**` import restriction
- `migrations/scripts/index.ts`, `lib/startup/prettify.ts`, `docs/developer/DDL.md`
- `lib/schemas/settings.types.ts`, `lib/database/repositories/chat-settings.repository.ts`, `app/api/v1/settings/chat/route.ts`
- `components/settings/chat-settings/types.ts`, `hooks/useChatSettings.ts`, the Composer card on the Chat tab
- `components/chat/FormattingToolbar.tsx` — the emoji button
- `components/chat/lexical/LexicalComposerWrapper.tsx`, `app/salon/[id]/components/DocumentPane.tsx` — mount the plugin
- `components/chat/lexical/plugins/TextReplacementPlugin.tsx` — extract and share `isInCodeContext()` (and thereby fix the latent code-context defect; **file the bug first**, taking the next unused number from the [Status table](../../bugs.md#status) — 62 is taken — with a two-or-three-word dashed slug per CLAUDE.md)
- `app/styles/qt-components/_surfaces.css`, `_chat.css`
- `packages/theme-storybook/src/css/qt-components.css` + `src/stories/components/Chat.tsx` + package version bump (**publish gates the commit**)
- `help/chat-settings.md`, `docs/CHANGELOG.md`
- `docs/developer/features/composer-typeahead.md` — record that Phase 1's shell shipped here

**No quilltap-shell changes. No `packages/quilltap` (CLI) changes. No provider, tool, or context-builder changes.**

## Completion gate

Do not move this spec to `docs/developer/features/complete/` until every entry in the file-touch summary is written, the manual matrix has been walked on a running instance, the theme-storybook mirror is published, and the [Portability contract](#portability-contract) still holds — specifically, until `lib/emoji/**` imports nothing outside the standard library and the two corpora are committed. A v5 port that has to re-derive the ranking order means this spec failed at its actual job.

### Status of the gate (2026-08-13)

| Gate item | State |
| --- | --- |
| File-touch summary written | ✅ every entry, plus the extras noted below |
| `lib/emoji/**` imports nothing | ✅ enforced by `eslint.config.mjs`; verified to fail on a planted `react` import |
| Both corpora committed | ✅ `lib/emoji/fixtures/` — 10 search vectors, 17 trigger vectors |
| Automated coverage green | ✅ 93 Tier B + 22 plugin + 19 `TextReplacementPlugin` + 12 idempotency |
| theme-storybook mirror **published** | ✅ `@quilltap/theme-storybook` **1.0.58** on npm |
| Manual matrix walked on a running instance | ⚠️ **mostly** — see below |

#### Manual matrix — walked 2026-08-13 on an isolated scratch instance (port 3102, own data dir)

Verified live in the Salon composer: menu opens on `:smi` with 😄 first; Enter inserts **and does
not send the message**; click inserts; `:smile:` commits on the closing colon; the inserted value is
a lone astral codepoint with **no** trailing space; one Cmd-Z removes it; recents persist
most-recent-first under `quilltap.emoji.recents.v1`; `10:30`, `https://ex.com/`, `:)` and
`C:\Users` open nothing and leave the text untouched; the dataset is fetched **once**, on the first
`:`, and not at all before it; the toolbar `☺` button opens the picker with a working search, a
Recents row, sticky group headers and a scrolling grid, and a pick inserts at the cursor; the
"Emoji shortcuts" toggle renders in the Composer card and the migration's column round-trips
through `/api/v1/settings/chat`.

**Not** walked in the browser: the code-block / inline-code bails, IME, the dataset-failure state,
`composerEmoji = off`, and Document Mode. Each is covered by
`EmojiTypeaheadPlugin.test.tsx` against a **real** Lexical editor and the real dataset, and the
code-context and glued-run guards were each confirmed load-bearing by reverting them and watching
the suite go red. Note also that this browser harness dispatches special keys with an **empty**
`event.key`, which Lexical ignores — Enter and Home had to be driven by an explicit
`KeyboardEvent` to exercise the real handler chain at all. Worth knowing before trusting a
"pressing Enter did nothing" observation from it.

#### Two defects the live walk caught that the spec did not anticipate

Both are in the shell, so **Layer 2 inherits the fixes**:

1. **The menu opened downward and was clipped by the viewport, every time.** The Salon composer
   sits at the BOTTOM of the window, so "below the caret" is always off-screen there. `MenuPortal`
   now measures and flips, writing `data-placement="above" | "below"` (and `data-align` for the
   horizontal equivalent) straight to the DOM in a layout effect — not through state, since the row
   list changes on every keystroke and that would cost a render pass per character.
2. **Enter never reached the menu.** `KeyboardPlugin` registers `KEY_ENTER_COMMAND` at
   `COMMAND_PRIORITY_HIGH` to send the message, so the menu's own Enter handler at `NORMAL` never
   fired — keyboard selection silently sent the draft instead of inserting an emoji. The typeahead
   now passes `commandPriority={COMMAND_PRIORITY_CRITICAL}`, which is safe because those handlers
   are mounted only while the menu is open. **Any Layer 2 typeahead needs the same.** The separate
   closing-colon `KEY_DOWN` handler stays at `NORMAL`, where it must be to sit above
   `TextReplacementPlugin`'s `LOW`.

### Dataset provenance

`public/emoji/emoji-index.v1.json` — **1,914 entries**, 231 KB raw / **53 KB gzipped**, generated
2026-08-13 by `scripts/generate-emoji-index.ts` (`npm run generate:emoji-index`) from
**`emojibase-data` 17.0.0**, English CLDR annotation set plus the **github** shortcode preset
(**Unicode 17.0**). The spec anticipated emojibase 16.x; 17.0.0 was current and is what shipped.
Filtered to the fully-qualified base set: skin-tone variants are already nested under `skins` in
the source and never reach the top level, the 9 `component` modifiers are dropped, and the 26
bare regional-indicator letters (which carry no `group`) are dropped with them — the flag group
itself is kept in full. Keywords are deduped against the name and shortcodes at generation time.

Two additions to the documented dataset shape, both load-bearing:

- a top-level **`groups`** array (slug → display order by array index), because the ranking's
  documented `(group order, entry order)` tie-break needs the group's order and the picker needs
  its headers. Without it the comparator would have to fall back on insertion order, which is
  exactly what the spec forbids.
- `EmojiIndex` carries a **`normalized`** projection built once by `buildIndex`, so the
  per-keystroke path never re-normalizes 1,914 rows.

### One deviation from the spec text, recorded deliberately

The spec's illustrative corpus row expects `searchEmoji(index, 'smile', 8)` to begin
`["😄", "😊", "🙂"]`. The **documented seven-step ranking** yields `["😄", "😃", "😺"]` instead,
because 😃 (`:smiley:`) and 😺 (`:smile_cat:`) are **shortcode-prefix** matches — bucket 2 — while
😊 and 🙂 reach `smile` only as a **keyword**, bucket 5. The numbered ranking is the normative
rule and the corpus pins it, so the implementation follows the ranking and the committed vector
records the real order. 😄, the exact-shortcode match and the emoji anyone typing `:smile` wants,
is first either way. If the intent was in fact to rank keyword hits above shortcode prefixes,
that is a ranking change (steps 2 and 5 swap) plus a corpus regeneration — not a bug fix.

### Extras beyond the file-touch summary

- `lib/emoji/README.md` — records the deliberate fixtures-beside-code deviation.
- `components/chat/emoji/insert-emoji.ts` + `recents-storage.ts` — the storage/insertion adapter,
  so both surfaces commit through one path and cannot diverge.
- `components/chat/lexical/utils/code-context.ts` — `$isInCodeContext`, shared with
  `TextReplacementPlugin` (bug 63).
- `components/settings/chat-settings/ComposerEmojiSettings.tsx` — the toggle, in the existing
  Composer card (`sectionId` left as the historical `composer-spellcheck`, per §3.5).
- `__tests__/helpers/lexicalPluginHarness.tsx` — real-editor harness for composer plugins.
  ⚠ It documents a genuine trap: `jest.setup.ts` assigns `global.fetch` directly, which
  **replaces jest-fetch-mock's function**, so `fetchMock.mockResponse(...)` is a silent no-op in
  this repo. Stub `global.fetch` yourself.
- `__tests__/unit/components/chat/lexical/markdown-roundtrip-idempotency.test.ts` — §4.4 asked for
  vectors in `MarkdownBridgePlugin.test.ts` *or* a general table; the general table was built, as
  the direct analogue of v5's `IDEMPOTENT`. Astral characters, ZWJ sequences, variation selectors
  and regional-indicator flags all survive `serialize(parse(x))` byte-identically.
- `$isGluedToPreviousRun` in the plugin — Lexical hands `triggerFn` the text of the **anchor text
  node**, not the block, so a trigger at offset 0 can still be glued to a preceding inline run
  (`**bold**:smi`). The adapter checks the previous sibling using Tier B's exported
  `isTriggerOpenerContext`, rather than re-deriving the rule.
