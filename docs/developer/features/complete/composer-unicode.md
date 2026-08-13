# Composer Unicode — Layer 2.0u Spec

**Status:** ✅ **COMPLETE — shipped 2026-08-13.** See [What actually shipped](#what-actually-shipped) for the four places the implementation departs from the text below, each with its reason.
**Scope:** quilltap-server (renderer only + one settings boolean + its migration). No shell changes. No API route.
**Phase:** 2.0u of the composer series. **Amends [composer-emoji](composer-emoji.md)** (shipped 2026-08-13) by generalizing its engine; see [What this does to the emoji code](#what-this-does-to-the-emoji-code).

> **Portability mandate.** Same as its sibling: v4 is Lexical, v5 is Angular/ProseMirror. All decisions live in a pure, import-free engine with a committed corpus. This spec's main claim is that **the engine already shipped** — Unicode is a second dataset profile over it, not a second implementation.

## Summary

Type `\to` and get `→`. Type `\phi` and get `φ`. Type `\rightwards arrow` in the picker, or `→` anywhere, and get the same character.

A `\`-triggered typeahead and a picker over a curated 3,481-character Unicode set, riding the exact search, ranking, recents, insertion and menu machinery the emoji feature already ships. The dataset is **38 KB gzipped** — smaller than the emoji index's 51 KB — and lazily fetched, so an instance that never presses `\` never pays for it.

## Measurements this spec is built on

Taken 2026-08-13 against the shipped code and Python's Unicode tables.

| | Chars | Raw | Gzipped |
|---|---|---|---|
| Emoji index (shipped) | 1,914 | 226 KB | 51 KB |
| **Curated Unicode, 26 blocks** | **3,481** | **277 KB** | **38 KB** |
| …plus Mathematical Alphanumeric | 4,477 | 365 KB | 47 KB |
| Everything non-CJK/Hangul (rejected) | ~40,000 | — | ~400 KB |

Unicode names compress ~7:1 against emoji keyword lists' ~4:1, which is why nearly twice the characters costs less wire.

**Ranking, simulated through the shipped `bucketFor` + `comparePresentation`:**

```
'arrow'            103 hits  ->  ← ↑ → ↓ ↔ ↕
'phi'                3 hits  ->  Φ φ ϕ
'rightwards arrow'  14 hits  ->  → first
'double dagger'      1 hit   ->  ‡
'right arrow'        5 hits  ->  → ABSENT          <- the gap
'greek phi'          1 hit   ->  ϕ but not φ       <- the gap
```

Two conclusions drive the whole design:

1. **The shipped ranking is already correct for Unicode.** The tie-break `(groupOrder, order)` — block order, then code point — floats ← ↑ → ↓ to the top of 103 "arrow" matches, because Unicode's own block layout puts the common characters first. Nothing about the ranking needs re-thinking. Do not "improve" it.
2. **The one real gap is non-adjacent query words.** `bucketFor` tests the query against the whole name (`startsWith`, `includes`) and against each word (`startsWith`), so it never matches `right arrow` → `rightwards arrow` or `greek phi` → `greek small letter phi`. Unicode's taxonomy interpolates words (`GREEK SMALL LETTER PHI`) in a way emoji shortcodes never do, so this bites Unicode and essentially never bit emoji.

## Goals

- Insert a Unicode character by LaTeX name (`\to`), by description (`\rightwards arrow`), or by code point (`→`).
- Reuse the emoji feature's engine, shell, picker, insertion and undo contract — one implementation, two profiles.
- Ship a Unicode dataset **smaller than the emoji one**, lazily fetched.
- Leave the emoji feature's behaviour byte-identical. Its committed corpus must stay green without edits.
- Give v5 **one** engine to port rather than two near-duplicates.

## Non-goals

- **The full Unicode repertoire.** ~155,000 characters, of which ~110,000 are algorithmically-named CJK ideographs and Hangul syllables that no name search can usefully rank. See [The dataset](#the-dataset).
- **Combining marks as standalone insertions.** A lone U+0301 in a composer is a trap. Excluded from the dataset.
- **A LaTeX *renderer*.** KaTeX already does that. This inserts a literal character; the two must not be confused — see [the math hazard](#the-math-hazard-read-this-one).
- **Font fallback or glyph-availability checking.** If the platform can't render ⨌, it shows tofu. Same contract as emoji.
- **Re-ranking.** The shipped ranking is correct; measurement above.
- **Source-mode textareas**, character-sheet fields, paste. Same exclusions as Layers 1, 1.5 and 2.0e.

## What this does to the emoji code

**Generalize, don't duplicate — and do it now, before v5 ports either.** The emoji Tier B is already 80% generic; the parts that aren't are two named things.

| Shipped file | Verdict |
|---|---|
| `lib/emoji/recents.ts` | Generic already. Only `RECENTS_STORAGE_KEY` is emoji-specific. |
| `lib/emoji/load.ts` | Generic modulo `EMOJI_INDEX_URL` and the module-level singleton — becomes a factory keyed by profile. |
| `lib/emoji/search.ts` | `normalizeQuery`, `buildIndex`, `bucketFor`, `comparePresentation`, `searchEmoji` all generic **once `shortcodes` is renamed `aliases`**. |
| `lib/emoji/types.ts` | Generic after the same rename; `EmojiIndexError` → `CharIndexError`. |
| `lib/emoji/trigger.ts` | **Genuinely emoji-shaped.** Hardcodes `:`, the closing-`:` rule, and the `[a-z0-9_+-]` alphabet. Needs a config object. |
| `components/chat/lexical/typeahead/*` | Already the shared shell. Free. |
| `components/chat/emoji/insert-emoji.ts` | Generic. Moves up a directory. |
| `EmojiTypeaheadPlugin.tsx` | Five import sites + one settings key + `isTriggerOpenerContext`. Parameterize and instantiate twice. |
| `EmojiPickerPopover.tsx` | Group labels and grid are emoji-shaped; extract the inner search+grid, keep two thin wrappers. |

### The refactor

Rename `lib/emoji/` → **`lib/char-insert/`**, with a `profiles/` subdirectory:

```
lib/char-insert/
  types.ts          CharEntry, CharIndex, TriggerMatch, TriggerConfig, CharIndexError
  search.ts         normalizeQuery, buildIndex, searchChars, findByAlias   (+ the new bucket)
  trigger.ts        findTrigger(textBefore, config), isTriggerOpenerContext
  load.ts           createIndexLoader(profile) -> { load, getLoaded, isUnavailable, resetForTests }
  recents.ts        pushRecent, parseRecents, serializeRecents, RECENTS_LIMIT
  profiles/emoji.ts    EMOJI_PROFILE   (trigger ':', url, storage key, group labels)
  profiles/unicode.ts  UNICODE_PROFILE (trigger '\', url, storage key, block labels)
  fixtures/         emoji-search-vectors.json, emoji-trigger-vectors.json,
                    unicode-search-vectors.json, unicode-trigger-vectors.json
```

The ESLint `no-restricted-imports` override moves from `lib/emoji/**` to `lib/char-insert/**`. `lib/emoji/README.md` moves and is rewritten to describe two profiles.

**Field rename:** `EmojiEntry.shortcodes` → `CharEntry.aliases`. The dataset's short key stays `"s"`, so **`public/emoji/emoji-index.v1.json` does not change and does not need regenerating**. Only the TypeScript field name moves.

### The one additive change to `searchChars`

Add a multi-token bucket, appended as the **last** matching bucket:

```ts
const Bucket = {
  AliasExact: 0, AliasPrefix: 1, NamePrefix: 2, NameWordStart: 3,
  KeywordExact: 4, KeywordPrefix: 5, NameSubstring: 6,
  NameAllWords: 7,   // NEW — every query token prefix-matches a distinct name word
  NoMatch: 8,        // was 7
} as const;
```

`NameAllWords`: split the normalized query on spaces; if there is more than one token, match when every token is a `startsWith` prefix of some *distinct* name word (greedy left-to-right assignment is sufficient and deterministic — document that, and pin it with a corpus row where two query tokens could claim the same name word).

**This is provably additive and cannot move emoji results.** `bucketFor` returns the *best* bucket an entry reaches. The new bucket is worse than every existing one, so an entry already matching keeps its bucket, and only entries that previously returned `NoMatch` can newly appear. The shipped `emoji-search-vectors.json` therefore stays green **unedited** — which is the assertion to make first, before writing the Unicode profile, because it is the one that proves the refactor was safe.

After it: `right arrow` → →, `greek phi` → φ, `double vertical` → ‖.

## The dataset

`public/unicode/unicode-index.v1.json`, generated and committed, same shape as the emoji index — `{version, groups, entries}` with `{c, n, s, k, g, o}` rows, so `buildIndex` reads both without a branch.

**26 blocks, 3,481 characters:**

Latin-1 Supplement · Latin Extended-A · Latin Extended-B · IPA Extensions · Spacing Modifier Letters · Greek and Coptic · Cyrillic · General Punctuation · Superscripts and Subscripts · Currency Symbols · Letterlike Symbols · Number Forms · Arrows · Mathematical Operators · Miscellaneous Technical · Box Drawing · Block Elements · Geometric Shapes · Miscellaneous Symbols · Dingbats · Misc Math Symbols-A · Supplemental Arrows-A · Supplemental Arrows-B · Misc Math Symbols-B · Supplemental Math Operators · Misc Symbols and Arrows

**`g` is the block slug and `o` is the code point**, so `comparePresentation`'s `(groupOrder, order)` reproduces Unicode's own order exactly — the property the measurement above shows is doing the ranking work. Block order in `groups` is code-point order.

**Excluded, each for a stated reason:**

- **CJK ideographs, Hangul syllables, Tangut, Nushu, Egyptian Hieroglyphs** (~110,000) — algorithmic names (`CJK UNIFIED IDEOGRAPH-4E00`); a name search cannot rank them and an IME does this job properly.
- **Historic scripts** (Linear B, Cuneiform, Gothic, Old Italic…) — would crowd real results for a use case that wants a file, not a typeahead.
- **Combining marks** — a standalone combining character in a composer is a bug generator.
- **Private Use, surrogates, unassigned, control characters** — nothing to insert.
- **Emoji-presentation characters already in the emoji index** — dedupe at generation time against `emoji-index.v1.json` so `\` and `:` do not both offer ☂. Where a character exists in both with different presentation (text vs emoji), **the emoji index wins and the Unicode row is dropped**; record the count in the generator's output so a future Unicode revision's churn is visible.
- **Mathematical Alphanumeric Symbols** (𝔞 𝕒 𝓪) — ~1,000 entries whose names are near-identical (`MATHEMATICAL FRAKTUR SMALL A`…), adding noise to every `\a…` query for a rarely-wanted family. Deferred, not refused; adding it later is a `v2` dataset and a corpus regeneration.

### Aliases: the LaTeX table

`s` (aliases) carries **LaTeX / Julia names without the backslash**: `to`, `rightarrow`, `phi`, `Phi`, `Rightarrow`, `leq`, `in`, `infty`. This is the vocabulary a technical writer already has, and it is what makes `AliasExact` — bucket 0 — do the work that a description search cannot.

Source: the standard LaTeX-to-Unicode table Julia and VS Code both use (~2,000 entries). Vendor it as a **devDependency or a committed source file** consumed by the generator; it must not reach the runtime bundle.

> ### ⚠ Aliases are case-sensitive. The shipped engine is not.
>
> `\phi` is φ (U+03C6) and `\Phi` is Φ (U+03A6). Likewise `\gamma`/`\Gamma`, `\delta`/`\Delta`, `\sigma`/`\Sigma`, `\omega`/`\Omega`. But `normalizeQuery` lowercases everything, so the shipped engine **cannot tell them apart**.
>
> This is the single most important correctness point in the spec. The fix: `CharIndex` gains a second map, `byAliasExactCase: Map<string, CharEntry>`, built from the raw (un-normalized) alias strings. `findByAlias(index, query, { caseSensitive })` consults it first when the profile asks; the normalized `byAlias` map remains the fallback so `\PHI` and `\Phi` both still find something. Emoji passes `caseSensitive: false` and is unaffected.
>
> Pin it with corpus rows for all six Greek pairs above. A port that lowercases here produces the wrong Greek letter silently, which is exactly the class of bug the corpus exists to catch.

### `U+XXXX` direct entry

`\uXXXX` and `\u{XXXXX}` resolve by code point with **no table lookup**, so any character is reachable including those the curation dropped. Handled in the trigger/commit path, not the index: if the query matches `/^u\+?([0-9a-f]{4,6})$/i`, the entry is synthesized from `String.fromCodePoint`. Guard the range (`<= 0x10FFFF`, not a surrogate) and show the character with its name if the index knows it, or bare if not.

## The trigger

`TriggerConfig` parameterizes what `findEmojiTrigger` hardcodes:

```ts
export interface TriggerConfig {
  opener: string;                 // ':' | '\\'
  queryPattern: RegExp;           // per-profile query alphabet
  minQueryLength: number;
  maxQueryLength: number;
  closer: string | null;          // ':' for emoji; null for unicode
  commitOnTrailingSpace: boolean; // false for emoji; true for unicode
}
```

Unicode: `opener: '\\'`, `queryPattern: /[A-Za-z0-9+{}]/`, `minQueryLength: 2`, `closer: null`, `commitOnTrailingSpace: true`.

**`commitOnTrailingSpace`** is the `\to ` → `→ ` path — the parallel to emoji's closing colon. Commit only on an **exact alias match**; anything else leaves the literal text alone and closes the menu.

### Why `\` does not collide with markdown escapes

Markdown escapes are `\` followed by ASCII **punctuation** (`\*`, `\_`, `\[`). A backslash followed by a **letter** is never an escape — it is literal. Requiring `[A-Za-z]` as the first query character (which `minQueryLength: 2` plus the pattern already implies for every real alias) means the trigger and markdown escaping occupy disjoint syntax. State this in the trigger's doc comment; it is not obvious and someone will worry about it.

### The math hazard (read this one)

Quilltap ships KaTeX. `$$\phi$$` is LaTeX that KaTeX renders — substituting φ into the source would **break the math**, and a `\` typeahead firing inside math is the most likely way this feature annoys the person who most wants it.

**Bail when the cursor is inside a math span in the current block.**

Do not assume only `$$` counts. `REMARK_MATH_OPTIONS` sets `singleDollarTextMath: false` ([lib/markdown/math.ts:31](../../../../lib/markdown/math.ts)), **but** `normalizeMathDelimiters` (`math.ts:84-196`) promotes single-`$` spans and rewrites `\(…\)` / `\[…\]` into `$$` form before parsing. So single-dollar spans *are* math by the time it matters. Read `math.ts` and mirror its span detection rather than re-deriving it — a `isInsideMathSpan(textBefore)` helper in Tier B, pinned by corpus rows for `$$\ph`, `$\ph`, `\(\ph`, and the negative case `costs $5 and \ph`.

This is Tier B logic (pure string work), not an adapter concern.

## Tier C

- **`CharTypeaheadPlugin.tsx`** — `EmojiTypeaheadPlugin.tsx` generalized to take a profile. Its five Tier B call sites (`:47-49`, `:159`, `:166`, `:188`, `:269-273`), the `composerEmoji` settings read at `:132`, and the opener-context check at `:118` all become profile-driven. Mounted **twice** in [LexicalComposerWrapper.tsx](../../../../components/chat/lexical/LexicalComposerWrapper.tsx) and [DocumentPane.tsx](../../../../app/salon/[id]/components/DocumentPane.tsx), once per profile, both above `<TextReplacementPlugin />`.
- **Bail conditions** are the shipped ones plus `isInsideMathSpan`. The `isInCodeContext()` extraction the emoji spec called for covers `\` too.
- **Picker.** Extract `EmojiPickerPopover`'s search field + sectioned grid into a shared inner component taking `{profile, index, onPick}`; `EmojiPickerPopover` and a new `UnicodePickerPopover` become thin wrappers supplying group labels. Unicode sections are blocks, in block order.
- **Toolbar button.** A second button beside emoji's, label `Ω` (a glyph, no icon-registry work — `FormattingToolbar` buttons are text-labelled). Tooltip: *"Insert a symbol (or type `\` and a name)"*. Same composition-mode caveat as emoji's.
- **Settings.** One boolean `composerUnicode`, default `true`, plumbed exactly as `composerEmoji` was; migration `migrations/scripts/add-composer-unicode-field.ts` (**not** date-prefixed — no migration in this repo is), `PRETTY_LABELS` entry (*"Teaching the machine its Greek."*), `migrations/scripts/index.ts`, [DDL.md](../../DDL.md). Toggle sits in the Composer card beneath Emoji shortcuts (`sectionId` is `composer-spellcheck`, a historical name). The toolbar button is not gated by it, same rule as emoji.
- **Recents** key: `quilltap.unicode.recents.v1`.

## Verification

**The refactor is proven before the feature exists:** rename and generalize, add the `NameAllWords` bucket, then run the **unedited** `emoji-search-vectors.json` and `emoji-trigger-vectors.json`. Green means the generalization was behaviour-neutral. Do this as its own commit.

Then, Unicode:

| Scenario | Expected |
|---|---|
| `\to` | menu shows →, Enter inserts it |
| `\to ` (trailing space) | commits → plus the space, menu never needed |
| `\phi` / `\Phi` | φ / Φ — **the case-sensitivity test** |
| `\gamma` / `\Gamma` | γ / Γ |
| `\right arrow` (picker) | → present (the `NameAllWords` bucket) |
| `\greek phi` (picker) | φ present |
| `→` / `\u{1D538}` | → / 𝔸, no table lookup |
| `\arrow` | ← ↑ → ↓ first |
| `\` alone, `\a` | inert |
| `\*` `\_` `\[` | markdown escapes, no menu |
| `$$\phi$$`, `$\phi$`, `\(\phi\)` | **no menu** — math is preserved |
| `costs $5 and \ph` | menu opens (not math) |
| Inside a code block / inline code | nothing fires |
| Cmd-Z after insert | back to the literal `\to` |
| `:smile` still works, unchanged | the refactor regression |
| A character in both datasets (☂) | offered by `:` only |
| Toggle `composerUnicode` off | `\` inert; toolbar picker still works |
| Send / export / re-import | plain characters throughout |
| Offline / blocked asset | `\to` inert, one warn, no error storm |

Unit tests: the two new corpora, plus `isInsideMathSpan`, the `U+` parser's range guards, and `NameAllWords`' distinct-word assignment. Plugin tests mirror the emoji suite with the profile swapped.

## File-touch summary

**Refactor (its own commit, emoji corpus green unedited):**
- `lib/emoji/**` → `lib/char-insert/**` (`git mv`), `shortcodes` → `aliases`, `EmojiIndexError` → `CharIndexError`, `load.ts` → loader factory, `trigger.ts` → `TriggerConfig`, `search.ts` + `NameAllWords` + `byAliasExactCase`
- `lib/char-insert/profiles/emoji.ts` — new
- `eslint.config.mjs` — move the import restriction to `lib/char-insert/**`
- `components/chat/emoji/insert-emoji.ts` → `components/chat/char-insert/insert-char.ts`
- `EmojiTypeaheadPlugin.tsx` → `CharTypeaheadPlugin.tsx`, profile-driven
- `EmojiPickerPopover.tsx` — extract the shared inner search+grid
- [complete/composer-emoji.md](composer-emoji.md) — amend: record the generalization and the new file locations

**New:**
- `scripts/generate-unicode-index.ts` + `"generate:unicode-index": "tsx …"` (every existing script uses `tsx`)
- `public/unicode/unicode-index.v1.json`
- the vendored LaTeX alias table (devDependency or committed source)
- `lib/char-insert/profiles/unicode.ts`
- `lib/char-insert/math-span.ts` (+ its corpus)
- `lib/char-insert/fixtures/unicode-{search,trigger}-vectors.json`
- `components/chat/UnicodePickerPopover.tsx`
- `__tests__/unit/components/chat/lexical/plugins/CharTypeaheadPlugin.test.tsx`
- `migrations/scripts/add-composer-unicode-field.ts`

**Modified:** `migrations/scripts/index.ts`, `lib/startup/prettify.ts`, `docs/developer/DDL.md`, `lib/schemas/settings.types.ts`, `lib/database/repositories/chat-settings.repository.ts`, `app/api/v1/settings/chat/route.ts`, `components/settings/chat-settings/{types.ts,hooks/useChatSettings.ts}` + the Composer card, `FormattingToolbar.tsx`, `LexicalComposerWrapper.tsx`, `DocumentPane.tsx`, `app/styles/qt-components/_chat.css` (+ **the theme-storybook mirror, whose `npm publish` gates the commit**, if any `qt-*` class changes), `help/chat-settings.md` (a Unicode section beside the Emoji one — **do not touch that file's frontmatter**), `docs/CHANGELOG.md`.

**No quilltap-shell, CLI, provider, tool, or context-builder changes. No Rust changes in v5 — this is SPA-only there.**

## Changelog entry

```
- Composer Unicode: type `\` plus a LaTeX name (`\to`, `\phi`), a description (`\right arrow`), or a code point (`→`) to insert a Unicode character, in both the Salon composer and Document Mode. A toolbar button opens a searchable picker with recents. 3,481 characters across 26 blocks, lazily loaded. Nothing fires inside math spans, so `$$\phi$$` stays LaTeX. Toggle on the Chat settings tab under Composer; default on.
- Internal: the emoji search engine is now a shared character-insertion engine with emoji and Unicode as dataset profiles. Emoji behaviour is unchanged.
```

## Completion gate

Not `complete/` until: the emoji corpora pass **unedited** after the refactor; the Greek case-sensitivity rows and the math-span rows are committed and green; the dataset's emoji-dedupe count is recorded in the generator output; and `lib/char-insert/**` still imports nothing. A v5 port that has to write a second search engine means the refactor half of this spec failed at its actual job.

| Gate item | Status |
|---|---|
| Emoji corpora pass **unedited** after the refactor | ✅ `emoji-{search,trigger}-vectors.json` are byte-identical; `lib/char-insert/__tests__/{search,trigger}.test.ts` green |
| Greek case-sensitivity rows committed and green | ✅ six pairs (`phi`, `gamma`, `delta`, `sigma`, `omega`, `theta`) in `unicode.test.ts`, plus a row asserting the case-INsensitive path collapses them — the regression itself |
| Math-span rows committed and green | ✅ 11 rows in `unicode-trigger-vectors.json` → `mathCases`, plus four plugin-level rows |
| Emoji-dedupe count in the generator output | ✅ `dropped 165 already offered by the emoji picker` |
| `lib/char-insert/**` imports nothing | ✅ the ESLint override moved with the directory |
| `public/emoji/emoji-index.v1.json` unchanged | ✅ byte-identical |

---

## What actually shipped

Four departures from the text above. Each is recorded rather than quietly absorbed.

### 1. The LaTeX alias table is KaTeX's, not Julia's

The spec called for "the standard LaTeX-to-Unicode table Julia and VS Code both use (~2,000 entries)", vendored as a devDependency or a committed file. The generator reads **KaTeX's own symbol table** (`node_modules/katex/src/symbols.ts`) instead, at generation time only.

Three reasons, in order of weight: KaTeX is already a pinned dependency of this repo, so there is no new dependency and no network fetch; it is **the table Quilltap's own math renderer uses**, so `\to` in the composer inserts precisely what `$$\to$$` would have rendered; and the gap is smaller than the entry counts suggest — the ~490 KaTeX commands that carry a single-character replacement are nearly all of the ~2,000 that this feature could have used, the remainder being commands with no character to insert.

**445 aliases across 386 characters.** The generator throws if ten anchor commands (`\to`, `\leq`, `\in`, `\infty`, `\Rightarrow`, `\phi`, `\Phi`, `\Omega`, `\ddagger`, `\rightarrow`) stop resolving to the expected code point, so a KaTeX bump that moves the vocabulary fails loudly rather than shipping a thinner dataset.

One deliberate override of KaTeX, in `GREEK_OVERRIDES`: KaTeX maps `\phi` to U+03D5 because that is the glyph its math fonts draw. This feature inserts a *character into prose*, where `\phi` means GREEK SMALL LETTER PHI (U+03C6). The `\var…` forms take the variant letters. The spec's own `\phi` → φ requirement is what this implements.

### 2. Unicode names are vendored, from Python

There is no small npm package carrying Unicode character names — the ones that exist carry all ~155,000. `scripts/vendor/refresh-unicode-names.py` dumps `HEX;NAME;CATEGORY;BLOCK` for the 26 curated blocks from Python's built-in `unicodedata` (the same table this spec's measurements were taken against), and `scripts/vendor/unicode-names.txt` is committed as a generator input. (`scripts/vendor/`, not `scripts/data/`: `.gitignore` carries a bare `data/` rule for instance data directories, which would have silently swallowed the table.) That file decides which **blocks** exist; every other curation decision lives in the TypeScript generator where it can be reviewed beside the code that applies it. The generator asserts every block it sees has a label in `UNICODE_BLOCK_LABELS`, so the two lists cannot drift.

### 3. The dataset is 3,282 characters, not 3,481 — and still smaller than the emoji index

| | Chars | Raw | Gzipped |
|---|---|---|---|
| Emoji index (shipped) | 1,914 | 226 KB | 51.4 KB |
| **Unicode, 26 blocks, as shipped** | **3,282** | **309 KB** | **40.1 KB** |

3,482 named code points in the 26 blocks, minus 35 dropped by general category (combining marks, format characters, line/paragraph separators — `Zs` spaces are KEPT, since NO-BREAK SPACE and EM SPACE are things writers reach for), minus 165 already offered by the emoji picker. The spec's headline claim — a bigger dataset costing less wire than the emoji one — holds with room to spare.

### 4. `\arrow` does not put ← ↑ → ↓ first, and the ranking was left alone anyway

The spec's simulation predicted `'arrow'` → ← ↑ → ↓ over 103 hits. Against the shipped dataset the query has 402 hits and returns ⤶ ⤷ ˂ ˃ ˄ ˅ first, with ← at index 11 and → at 13.

The reason is the shipped ranking working exactly as documented: `NamePrefix` (bucket 2) outranks `NameWordStart` (bucket 3), so ARROW POINTING DOWNWARDS THEN CURVING LEFTWARDS — whose *name begins with* "arrow" — precedes RIGHTWARDS ARROW, where "arrow" merely begins a word. The MODIFIER LETTER … ARROWHEAD characters then win the bucket-3 tie on block order.

**The ranking was not touched**, because this spec's own instruction is not to touch it, and because the alternative is re-ordering buckets that the emoji corpus pins. The prediction was a simulation artefact; the rule it was simulating is the rule that shipped. `\rightarrow`, `\to`, `\leftarrow` and `\right arrow` all reach the plain arrows directly, which is how anyone hunting for one actually asks.

Relatedly, the spec's `\right arrow` row is met **as written** — it is scoped to the picker, and → appears at index 11 of the picker's 64 results. It is not in the typeahead's 10-row menu, and cannot be: `NameAllWords` is deliberately the last bucket.

### Smaller notes

- **`TriggerConfig` grew two fields the spec did not list.** `lowercaseQuery` (emoji `true`, Unicode `false`) — without it the trigger would hand back `phi` for `\Phi` and the case-sensitive alias map would have nothing to work with. `queryStartPattern` (`/[A-Za-z]/` for Unicode) — the spec *states* the markdown-escape argument depends on a letter leading the query, but `[A-Za-z0-9+{}]` alone would have let `\{ab` through, `{` being escapable ASCII punctuation.
- **`commitOnTrailingSpace: boolean` became a `CommitKeyConfig` object.** Emoji's closing `:` and Unicode's trailing space are the same mechanism with different punctuation, so they are one code path parameterized by `{key, probeSuffix, requireClosed, insertSuffix, mayTriggerLoad}` rather than two branches. `mayTriggerLoad: false` on the Unicode profile is load-bearing: the commit key is the **space bar**, and fetching a 300 KB asset the first time anyone types a sentence would defeat lazy loading entirely.
- **Two more profile flags:** `codePointQueries` and `bailInsideMath`, both false for emoji. Both would otherwise have changed shipped emoji behaviour — the first by adding menu results, the second by suppressing `:` inside `$$…$$` for no benefit.
- **`buildIndex` accepts both row keys.** The Unicode dataset uses `entries` as the spec says; the emoji dataset's array is called `emoji` and its bytes are frozen, so both are read. No branch reaches any consumer.
- **`U+XXXX` resolution lives in `search.ts`** (`findByCodePoint`) rather than in the trigger/commit path, so the picker's search field gets it for free. It is still arithmetic with no table lookup; the index is consulted only to *name* a character it happens to know.
- **No CSS changed.** The Unicode picker reuses the `qt-emoji-picker*` class family, so the theme-storybook mirror and its `npm publish` gate do not apply.
- **The `Ω` button sits in its own toolbar section** beside `☺`, so each popover anchors under its own button.
