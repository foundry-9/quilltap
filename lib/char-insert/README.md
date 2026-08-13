# `lib/char-insert` — Tier B of the composer's character-insertion features

The whole engine behind **two** composer features: which characters match a
query and in what order, where a trigger starts and ends, whether the cursor is
inside a math span, and what a recents list becomes after a pick.

Four surfaces consume it — the `:` emoji typeahead, the `\` Unicode typeahead,
and the two toolbar pickers — so none of them can drift apart.

- Emoji (Layer 2.0e): [`composer-emoji.md`](../../docs/developer/features/complete/composer-emoji.md)
- Unicode (Layer 2.0u): [`composer-unicode.md`](../../docs/developer/features/complete/composer-unicode.md)

## One engine, two profiles

Nothing in `types.ts`, `search.ts`, `trigger.ts`, `math-span.ts`, `load.ts` or
`recents.ts` knows which dataset it is serving. Every difference lives in
`profiles/`:

| | emoji | unicode |
|---|---|---|
| opener | `:` | `\` |
| commit keystroke | closing `:` | trailing space |
| aliases | github shortcodes | LaTeX names, **case-significant** |
| code-point queries | no | `→`, `\u{1D538}` |
| bails inside math | no | yes |
| dataset | `public/emoji/emoji-index.v1.json` | `public/unicode/unicode-index.v1.json` |
| recents key | `quilltap.emoji.recents.v1` | `quilltap.unicode.recents.v1` |
| settings column | `composerEmoji` | `composerUnicode` |

Adding a third profile should be a new file in `profiles/` and two mounts. If it
is ever more than that, something has been hardcoded that should not have been.

## The rule that matters

**Nothing in this directory imports anything.** No React, no Lexical, no Next,
no TanStack, no repo helper — the standard library only. An ESLint
`no-restricted-imports` override scoped to `lib/char-insert/**` enforces it in
`eslint.config.mjs`.

That is not fastidiousness. quilltap-v5 (Rust core, Angular SPA, ProseMirror
editor) copies this directory near-verbatim; the ~150 lines that know about
Lexical and React live in `components/chat/`, get rewritten there, and nothing
else has to be re-derived. If a file here needs a DOM type, it belongs in
`components/chat/lexical/`, not here.

`load.ts` is the one boundary case: it touches `fetch`, so it stays thin —
fetch, build, cache, cool down — and holds no decisions.

## Two correctness traps, written down because they are silent

1. **Alias case.** `\phi` is φ (U+03C6) and `\Phi` is Φ (U+03A6); `normalizeQuery`
   lowercases, so the normalized alias map cannot tell them apart. `CharIndex`
   carries a second `byAliasExactCase` map, and `findByAlias(…, {caseSensitive})`
   consults it first. A port that lowercases here produces the wrong Greek letter
   and nothing complains. Six pairs are pinned in the Unicode corpus.
2. **Math spans.** Quilltap renders KaTeX. Substituting φ into `$$\phi$$` breaks
   the formula. `math-span.ts` mirrors `lib/markdown/math.ts` — read that file
   before touching this one, because single-`$` spans and `\(…\)` really are math
   by the time it matters, even though the parser has single-dollar math off.

## Why the fixtures live here and not in `__tests__/fixtures/`

Repo convention puts fixtures under `__tests__/fixtures/`. These sit in
`fixtures/`, beside the engine, **deliberately**: v5 copies `lib/char-insert/` as
a directory, and the corpora must travel with the code they pin. Treat them the
way v5 treats `markdown-round-trip.spec.ts` — when a port disagrees, *fix the
port, not the vectors.*

The emoji corpora are also the **regression proof for the 2.0u generalization**:
they are unedited from the day the emoji feature shipped, and they still pass.

## The datasets are versioned in their filenames

`public/emoji/emoji-index.v1.json` (`npm run generate:emoji-index`) and
`public/unicode/unicode-index.v1.json` (`npm run generate:unicode-index`), both
generated and committed. A regeneration that changes search results is a **`v2`
file plus a corpus regeneration**, never an in-place edit — otherwise v4 and v5
silently disagree about what `:smile` or `\to` means.
