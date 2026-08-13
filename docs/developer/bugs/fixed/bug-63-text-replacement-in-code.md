# Bug 63 — text replacements fire inside code blocks and inline code, silently rewriting code as you type it

| | |
|---|---|
| **Status** | **FIXED in v4 (2026-08-13)** |
| **Found** | 2026-08-13 |
| **Fixed** | 2026-08-13 |
| **Severity** | Medium (silent corruption of text the user is typing, in the one place a substitution is never wanted; the user's own rules make it arbitrarily bad, and nothing signals that it happened) |
| **Who it bites** | anyone with a text-replacement rule who types a matching token inside a fenced code block or an inline `` `code` `` run in the Salon composer or Document Mode — e.g. a rule `fn → function`, or an autocorrect-style `teh → the`, applied to a variable name |
| **Provenance** | Latent since Layer 1.5 shipped. Surfaced 2026-08-13 while implementing [composer-emoji](../../features/complete/composer-emoji.md), whose spec requires the emoji typeahead to bail in code and notes that its sibling plugin does not |
| **Defect site** | `components/chat/lexical/plugins/TextReplacementPlugin.tsx:105-133` — the editor-state read that builds the candidate word checks only `$isTextNode(anchorNode)` and cursor-at-end |
| **Fix site** | new `components/chat/lexical/utils/code-context.ts` (`$isInCodeContext`), consumed by `TextReplacementPlugin.tsx` and `EmojiTypeaheadPlugin.tsx`; coverage in the new `__tests__/unit/components/chat/lexical/plugins/TextReplacementPlugin.test.tsx` |
| **v5 status** | Not yet ported — v5's `textReplacementPlugin` must carry the same guard when it lands. See [v5](#v5) |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-08-13).** The two guards the plugin never had are now a single
shared helper, `$isInCodeContext(selection)` in
`components/chat/lexical/utils/code-context.ts`, checked by
`TextReplacementPlugin` before it builds a candidate word and by the new
`EmojiTypeaheadPlugin` before it opens a menu or commits. One helper rather than
two copies is the point: the two plugins share a bail-condition list, and the
next typing aid gets it for free.

The suite that would have caught this did not exist — there was **no**
`TextReplacementPlugin` test in the repo at all. One now exists, pinning the code
guards alongside the plugin's other bail conditions and its single-undo contract.

---

## Symptom

With any text-replacement rule defined (Chat settings → Text Replacement), type
the trigger inside code and follow it with a word boundary:

````
```js
const fn = 1        →  const function = 1
```
````

Inline code does the same: `` `fn ` `` becomes `` `function ` ``. The replacement
is applied to the document, undo-able only as a separate step, and nothing
indicates a substitution took place. In a fenced block the result is code that
does not compile; in prose about code it is quietly wrong.

The window is exactly the same as everywhere else — the rule fires when the
cursor is at the end of a text node and a boundary character (` `, `.`, `,`,
`;`, `:`, `!`, `?`, `)`, tab, NBSP) is typed.

## Root cause

`TextReplacementPlugin`'s candidate-word read has four conditions, and none of
them concerns code (`:105-133`):

```ts
const selection = $getSelection()
if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null

const anchor = selection.anchor
const anchorNode = anchor.getNode()
if (!$isTextNode(anchorNode)) return null
```

`$isTextNode(anchorNode)` does not exclude code, in either of the two ways code
is represented:

1. **Fenced blocks.** The composer registers `CodeNode` and `CodeHighlightNode`
   (`LexicalComposerWrapper.tsx:178`). `CodeHighlightNode` **extends
   `TextNode`**, so every token inside a fenced block satisfies
   `$isTextNode` and the plugin proceeds exactly as it would in a paragraph.
2. **Inline code.** An inline `` `code` `` run is an ordinary `TextNode` carrying
   the `code` format bit. Nothing reads `hasFormat('code')`.

So both code surfaces fall straight through into the replacement path.

## Why it survived

- **The plugin has no tests.** Not a thin suite — *none*. Nothing pinned any bail
  condition, so nothing noticed the two that were missing.
- **The idiom exists in the same directory, and was simply not reused.**
  `FormattingCommandPlugin.tsx:223-225` already does the block check
  (`getTopLevelElement()` → `$isElementNode` narrowing → `$isCodeNode`), because
  a formatting command inside a code block is equally wrong. Layer 1.5 did not
  copy it.
- **It needs a rule to reproduce.** Text replacements ship empty; only users who
  have defined rules can see it at all, and only when they type one of their own
  triggers inside code.
- **It looks like a typo you made.** The replacement is silent and the result is
  a plausible word, so the natural reading is that you mistyped — not that the
  editor rewrote it.

## The fix

1. Extract the bail condition to `components/chat/lexical/utils/code-context.ts`
   as `$isInCodeContext(selection)`, covering **both** representations — the
   `$isCodeNode` block check (keeping the `$isElementNode` narrowing, which is
   easy to drop and load-bearing) and the `hasFormat('code')` inline check.
   The `$` prefix follows the Lexical convention used throughout these plugins:
   it must be called inside a read or update context.
2. Call it from `TextReplacementPlugin`'s candidate read, before any word is
   built.
3. Call it from `EmojiTypeaheadPlugin` for the same reason — this is checks 4 and
   5 of that plugin's documented bail list, and sharing the helper is what keeps
   the two lists from drifting.
4. Write the missing `TextReplacementPlugin` suite, pinning the code guards
   together with the conditions that were always intended (IME composition,
   collapsed selection, cursor-at-end, the disabled flag, and one-undo revert).

Conservative by design: a selection whose top-level element is absent or is not
an `ElementNode` also counts as "do not fire". We cannot prove such a position is
safe, and a typing aid that stays quiet is strictly better than one that
corrupts.

## How to verify

1. Define a rule, e.g. `fn` → `function` (Chat settings → Text Replacement).
2. In the Salon composer, open a fenced block and type `const fn ` — the text
   stays `const fn `. Before the fix it became `const function `.
3. Type `` `fn ` `` as inline code — unchanged.
4. In ordinary paragraph text, type `fn ` — it **still** becomes `function `.
   That is the regression check: the fix must not disable the feature.
5. Repeat all four in the Document Mode rich editor, which mounts the same
   plugin.
6. Emoji shares the guard: `:smi` inside a fenced block or inline code opens no
   menu, and opens one normally in prose.

## v5

v5's composer text-replacement work is not yet written against this guard. When
`textReplacementPlugin` lands in `apps/web/src/app/editor/`, it needs the
ProseMirror equivalent — a resolved-position check for a `code_block` ancestor
and for the `code` mark — factored so the emoji plugin registered above it in
`buildPlugins()` shares one predicate, exactly as v4 now does. Porting the v4
plugin without it reproduces this bug on the new stack.
