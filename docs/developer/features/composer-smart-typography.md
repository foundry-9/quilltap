# Smart Typography — Layer 1.6 Spec

**Status:** Proposal / Not Implemented
**Scope:** quilltap-server (message renderer + composer plugin + one settings bag). No shell changes. No API route. One prerequisite bug fix.
**Phase:** 1.6 of the composer series — a sibling of [Layer 1.5 text replacement](composer-text-replacement.md), sharing its surfaces and its undo contract.

> **Portability mandate.** Must be implementable in **quilltap-v5** (Rust core + Angular 21 SPA) without redesign. v4 uses **Lexical** and has **two** duplicated remark pipelines; v5 uses **ProseMirror** and has **one**. Nothing below may depend on React, Lexical, or any server round-trip. See [Portability contract](#portability-contract).

## Summary

The feature is **two mechanisms, deliberately split by confidence**:

| | Mechanism | Destructive? | Rules |
| --- | --- | --- | --- |
| **Part A** | Applied at the **final rendering pass** | No — stored text is untouched | `"` → `“ ”`, `'` → `‘ ’` |
| **Part B** | Applied **as you type**, in the editor | Yes — writes real characters | `--` → `–`, `---` → `—`, `...` → `…` |

**The principle:** *unambiguous transformations get baked into the text; ambiguous, presentational ones get applied at render time where they cost nothing to be wrong about.*

Typing `--` unambiguously means "I want a dash" — the hyphen is a keyboard workaround for a character with no key, and the em dash is genuinely part of what the writer wrote. It belongs in the content.

A `"`, by contrast, might be a quotation mark, an inch mark, a roleplay delimiter, or a straight quote the writer wants left alone. Curling it is a typesetting opinion. Opinions belong in the rendering layer, where the source stays clean, the LLM sees exactly what the writer typed, and a single toggle un-does the whole thing across all of history.

## Goals

- **Part A:** quotes curl on display, in every surface the Salon message renderer serves, without altering a single stored byte.
- **Part B:** `--`, `---` and `...` become real `–`, `—`, `…` at the keystroke, in the composer and the Document Mode editor.
- One Backspace, or one Cmd/Ctrl+Z, reverts any Part B substitution.
- Part B fires nowhere it shouldn't: code blocks, inline code, IME composition, source-mode textareas, pasted text.
- Part A skips code, math, and link targets **structurally**, not by hand-written guards.
- Per-part toggles, so a writer can have real em dashes without curly quotes or the reverse.

## Non-goals

- **Dashes at render time.** Explicitly and permanently rejected — see [Why dashes are not a render-time rule](#why-dashes-are-not-a-render-time-rule). This one matters; someone will propose it.
- **Quotes at type time.** That was this spec's original design and it was replaced. The rejected version's reasoning is preserved in [Design history](#design-history) so it is not re-litigated from scratch.
- **A "clean up this message" pass.** No retro-fit over stored history, in either direction.
- **Locale quote styles** (`„…“`, `«…»`, `「…」`). Deferred; the render-time mechanism makes them cheap when wanted.
- **The wider substitution table** — fractions, arrows, `(c)`/`(tm)`, `+-` → `±`. Each is one row and each deserves its own decision.
- **Paste.** Pasted text is left exactly as pasted by Part B. Part A renders it like everything else.
- **Character-sheet and memory markdown fields** (`components/markdown-editor/MarkdownLexicalEditor.tsx`). Excluded from Part B along with Layer 1.5's identical gap; close both together or neither. They are not rendered by the message renderer, so Part A never reaches them.
- **Persisting rendered HTML.** `chat_messages.renderedHtml` exists but nothing populates it today ([get.ts:394-411](../../../app/api/v1/chats/[id]/handlers/get.ts) computes it per request). Do not start.

## Design history

Four designs were considered. Recording the rejected three matters, because each will be re-proposed.

**A. Everything on send / on save.** Normalize the markdown string once, at commit. Rejected: the writer sees their text change *after* they stopped looking, and avoiding code fences, math, and link targets means writing a second markdown parser that must agree with the real one forever.

**B. Everything as you type.** What most prose editors do. Rejected *for quotes only*, after the pipeline survey below: it makes an opinionated, contextual, irreversible change to stored bytes — bytes that go to the LLM, into embeddings, and into every export — in exchange for a purely visual benefit. Kept for dashes and ellipsis, where the change is unambiguous and is genuinely content.

**C. Both, everywhere.** Rejected: two code paths that must agree forever.

**D. Split by confidence — chosen.** Quotes at render, dashes and ellipsis at type. Three findings pushed it here:

1. **A remark plugin gets code, math, and link targets for free.** In an mdast pipeline, `code`, `inlineCode`, `math` and `inlineMath` are distinct node types and a URL is a property, not text. A text-node transform *cannot* reach them. The type-time design had to hand-write four bail conditions and get all four right forever; the render-time design gets the same guarantees structurally.
2. **The composer does not have what a type-time quote guard needs.** The original spec claimed the composer had the active roleplay template loaded "for `FormattingToolbar`". It does not — [ChatComposer.tsx:323](../../../app/salon/[id]/components/ChatComposer.tsx) passes a bare `roleplayTemplateId` string, and `FormattingToolbar` fetches the template itself in a `useEffect` at [FormattingToolbar.tsx:94-125](../../../components/chat/FormattingToolbar.tsx) — a component that only mounts in composition mode. A type-time delimiter guard therefore needed its own fetch-and-memo path. **The renderer already receives the resolved template options**, so at render time the same guard is nearly free.
3. **Non-destructive means the apostrophe problem stops being a correctness bug.** Smartypants gets `'tis` and `'80s` wrong — every implementation does. At type time that corrupts the stored text and the writer must notice and undo. At render time the source still says `'tis`; only the pixels are wrong, and one toggle fixes all of it.

## Prerequisite: fix the roleplay dialogue-pattern fallback first

✅ **DONE — [Bug 62](../bugs/fixed/bug-62-dialogue-fallback-quotes.md) landed 2026-08-13 as its own commit.** Both defaults now carry the real curly code points as `“`/`”` escapes, single quotes deliberately excluded, with fallback-path regression coverage on the server suite *and* a `bug 62` block in `components/chat/__tests__/MessageContent.test.tsx` for the streaming path. **This spec is unblocked**; the rest of this section is kept as the record of what was wrong and why it gated Part A.

⚠ It was **required, not advisory, and had to land as its own commit before Part A.** With quotes moving to render time this became *strictly* load-bearing rather than merely prudent — see [ordering](#ordering-the-load-bearing-constraint).

[lib/chat/roleplay-rendering.ts:33](../../../lib/chat/roleplay-rendering.ts) declares the fallback dialogue pattern, and the comment at `:32` claims it handles "straight and curly quotes":

```ts
{ pattern: '[""][^""]+[""]', className: 'qt-chat-dialogue' }
```

**Every one of those six characters is ASCII `0x22`** (hexdump-confirmed). The class is straight-quote-duplicated; it has never matched a curly quote. `DEFAULT_DIALOGUE_DETECTION` at `:46-50` has the identical defect — `openingChars: ['"', '"']` and `closingChars: ['"', '"']` are both plain ASCII, with the same misleading comment at `:44`.

These are the **live fallback** for every chat not on a template supplying its own patterns, consumed by [markdown-renderer.service.ts:126-127,132,169](../../../lib/services/markdown-renderer.service.ts) and [MessageContent.tsx:19,24,338,386](../../../components/chat/MessageContent.tsx). The seeded *Standard Roleplay* template **is** curly-correct ([roleplay-templates.repository.ts:55,61-62](../../../lib/database/repositories/roleplay-templates.repository.ts)), which is exactly why this has never surfaced.

**Consequence if shipped unfixed:** turning Part A on silently stops dialogue highlighting in every chat on the fallback patterns — because the typographer curls the text *before* the roleplay layer ever sees it. The feature would appear to break an unrelated one, with no error.

### The fix

1. **Verify first.** `xxd`/`hexdump` those lines. Do not trust the comment or how the glyphs render in your editor.
2. Correct both defaults to match straight *and* curly: pattern class containing `"`, U+201C, U+201D; `openingChars: ['"', '“']`, `closingChars: ['"', '”']`.
3. **Decide the single-quote question explicitly.** Recommendation: double-quote only, matching the seeded template. `'` is far more often an apostrophe than a quotation mark, and a single-quote dialogue pattern would false-positive across most English prose.
4. Add regression coverage in [`__tests__/unit/lib/services/markdown-renderer.service.test.ts`](../../../__tests__/unit/lib/services/markdown-renderer.service.test.ts) — which already has curly-quote cases at `:409-421` — asserting the **fallback** path, not just the template path. That is the gap that let this survive.
5. **The bug is filed — it is [Bug 62](../bugs/fixed/bug-62-dialogue-fallback-quotes.md)**, now fixed, with the full root-cause write-up, the hexdumps, the single-quote product decision (resolved: double-quote only), and the v5 coordination note. Read it rather than re-deriving any of this.
6. **Cross-repo — still owed.** v5 ported this verbatim *and knew it* — `quilltap-v5: apps/web/src/app/chat/render/roleplay-rendering.ts:68-69` carries the comment "v4's stored pattern is straight-quote-only — copied byte-for-byte". v4 has now converged; the mirror on the v5 side has **not** landed, and the fix moves v5's captured markdown parity corpus. That is ordinary drift, worked in the v5 repo. Details in Bug 62's [v5 section](../bugs/fixed/bug-62-dialogue-fallback-quotes.md#v5).

### Related, worth checking while you are in there

- [carina-parser.ts:39-44](../../../lib/chat/carina-parser.ts) is **already curly-safe** — its `QUOTE_PAIRS` covers `"`/`"`, `'`/`'`, `“`/`”`, `‘`/`’`. Verify it stays true; it needs no change.
- Users can declare `"` as a custom **wrap delimiter** via the roleplay-template editor (`delimiterToPrefixSuffix` / `buildWrapPattern`, [lib/chat/annotations.ts:66-79,222-252](../../../lib/chat/annotations.ts)). Handled by the [reserved-character guard](#the-reserved-character-guard), not by changing the template system.

---

# Part A — Render-time quotes

## The pipelines

**v4 has two remark/rehype pipelines and they are duplicated by convention, not shared.** Both carry "must stay in sync" comments. Both must change, identically.

| | File | Pipeline | Insertion point |
| --- | --- | --- | --- |
| Server | [lib/services/markdown-renderer.service.ts:74-97](../../../lib/services/markdown-renderer.service.ts) | `remarkParse` → `remarkGfm` → `remarkMath` → `remarkBreaks` → `remarkRehype` → `rehypeKatex` → `rehypeHighlight` → `rehypeStringify` | between `.use(remarkBreaks)` (`:86`) and `.use(remarkRehype)` (`:87`) |
| Client | [components/chat/MessageContent.tsx:492-511](../../../components/chat/MessageContent.tsx) | `react-markdown` with `remarkPlugins={[remarkGfm, [remarkMath, …], remarkBreaks]}` (`:501`) | appended to that array after `remarkBreaks` |

Both paths run in production — the server HTML for persisted messages (via `dangerouslySetInnerHTML` in `LazyMessageContent.tsx:48-55`), the client React tree for streaming. **If they disagree, a message changes appearance when it stops streaming.** The "stay in sync" comments at `markdown-renderer.service.ts:79-80,84-85` and `MessageContent.tsx:498-500` exist for exactly this reason; extend them to name the typographer.

**v5 has one.** `quilltap-v5: apps/web/src/app/chat/render/markdown-renderer.ts:199-213` is a byte-for-byte port of v4's *server* renderer; the insertion point is the exact mirror, between `remarkBreaks` (`:206`) and `remarkRehype` (`:207`).

### Why a remark plugin and not a string transform

The raw-string pre-parse chain — trim → `normalizeMathDelimiters` → `escapeMarkdownInBrackets` → `linkifyBareQtapUris` (server `:137-150`, client `:352-355`) — is the **wrong place** and will mangle things:

- **Math.** `normalizeMathDelimiters` ([lib/markdown/math.ts:187-196](../../../lib/markdown/math.ts)) runs there. A typographer alongside it would eat `\text{"x"}`, prime marks `''`, and `--` inside TeX. As a remark plugin after `remarkMath`, math is a distinct node type and is untouchable.
- **Code.** Same argument: `code` and `inlineCode` are node types, not text.
- **Link targets.** A URL is a `url` property, not a text node.

An HTML post-process step (alongside `applyRoleplayPatterns`, which already tracks `inCodeBlock` and `katexDepth` in [markdown-postprocess.ts:49,57-70,75-77](../../../lib/services/markdown-postprocess.ts)) is *also* structurally sound — but **the v4 client never produces an HTML string**, so it has no counterpart there. The remark position is the only one where the two v4 renderers can be kept honest.

### Ordering: the load-bearing constraint

Roleplay patterns are applied **after** parsing, on the HTML string (server, `markdown-renderer.service.ts:152-170`) or on React children (client, `MessageContent.tsx:167-188,297-323`). A remark plugin therefore runs **before** them, and the roleplay layer sees curled text.

Required order, and the reason each step sits where it does:

```
raw markdown
  → normalizeMathDelimiters / escapeMarkdownInBrackets / linkifyBareQtapUris   (raw string; must precede parse)
  → parse                                                                      (mdast)
  → TYPOGRAPHER                                                                (text nodes only; code/math/urls structurally excluded)
  → rehype → stringify
  → applyWrapBlockClasses / applyRoleplayPatterns / applyLineScopedClasses / applyDialogueDetection
```

Two consequences fall out, and both are already handled above:

- The dialogue patterns must be curly-aware → the [prerequisite](#prerequisite-fix-the-roleplay-dialogue-pattern-fallback-first).
- `escapeMarkdownInBrackets` runs on the raw string while `tokenizeInline` runs on curled text, so a user template declaring `"` as a wrap delimiter would have its escape pass and its match pass disagree → the [reserved-character guard](#the-reserved-character-guard).

## The plugin

Use **`remark-smartypants`** (a remark wrapper over `retext-smartypants`). Add it as a runtime dependency. Configure it to do **quotes only**:

```ts
export const SMARTYPANTS_OPTIONS = {
  quotes: true,
  ellipses: false,   // Part B owns this, at type time
  dashes: false,     // see below — never enable this
  backticks: false,  // would convert `` `` `` to curly quotes; catastrophic in a markdown app
} as const;
```

Put that constant in **[lib/markdown/math.ts](../../../lib/markdown/math.ts)'s sibling** — a new `lib/markdown/typography.ts` — and import it from both v4 pipelines, exactly as `REMARK_MATH_OPTIONS` is shared today. That is the one mechanism that keeps the duplicated pipelines from drifting apart, and it is why `REMARK_MATH_OPTIONS` exists.

**Verify the option names against the installed version's own documentation before writing them.** The four above are the retext-smartypants names as of writing; a wrapper's surface can differ, and silently ignoring an unknown key would leave dashes enabled — which is the one outcome this spec most wants to avoid.

### Why dashes are not a render-time rule

`run it with --verbose` becomes `run it with –verbose`.

Technical prose is full of long-option flags, and they are frequently written without code formatting. A render-time dash rule mangles them invisibly — the source is right, the display is wrong, and the writer cannot tell why. Part B's type-time rule does not have this problem, because a writer typing `--verbose` sees the dash appear immediately and hits Backspace once.

This is not a tuning question. **`dashes: false` at render time is permanent.**

### The reserved-character guard

The renderer already receives the resolved roleplay options (the rendering patterns and dialogue-detection config it passes to `applyRoleplayPatterns` / `applyDialogueDetection`). Collect the single characters among the template's declared wrap delimiters; if `"` or `'` is among them, **skip the typographer for that render**.

One boolean threaded into an options object that already exists. This is the guard the type-time design could not afford, and getting it cheaply is one of the three reasons Part A moved to render time.

### v5 render-cache key ⚠

`quilltap-v5: apps/web/src/app/chat/render/render-cache.ts:52-76` memoises rendered HTML on `content` + option ref-ids + `blobMountPointId`. **The typographer flag must join that key**, or toggling the setting serves stale HTML from the memo and the feature will appear not to work. v4's server render is per-request so it has no equivalent hazard, but check `LazyMessageContent.tsx:79` and `MessageRow.tsx:569`'s memo comparisons for the client path.

## Surfaces affected

Everything the Salon message renderer serves — [MessageRow.tsx:366,399](../../../app/salon/[id]/components/MessageRow.tsx), [StreamingMessage.tsx:126](../../../app/salon/[id]/components/StreamingMessage.tsx), [ThinkingBlock.tsx:56](../../../components/chat/ThinkingBlock.tsx), [HelpChatMessageList.tsx:140,162](../../../components/help-chat/HelpChatMessageList.tsx), [BrahmaConsoleMessageList.tsx:197,224](../../../components/brahma-console/BrahmaConsoleMessageList.tsx) and `BrahmaToolCall.tsx:81`. That breadth is correct and desirable — the setting is a display preference and should apply consistently.

**Not affected, and deliberately so:** Document Mode and the character-sheet/memory fields are Lexical editors, not this renderer. Several other bare-`ReactMarkdown` pipelines exist (`HelpTopicReader.tsx:244-246`, `FilePreviewText.tsx:570-572`, `capabilities-report-dialog.tsx:88-89`, the two `PreviewModal.tsx`, `GenerationStep.tsx:100`, `ExternalPromptResultDialog.tsx:78`) with no roleplay layer. **v1 leaves all of them alone.** Note the decision in the changelog so the inconsistency reads as chosen.

## What the LLM sees

**Nothing changes.** `chat_messages.content` keeps straight quotes; the prompt builder reads `content`, not rendered HTML. No prompt-cache key moves, no embedding drifts, no export byte changes, and toggling the setting has zero effect on any model's input. This is the single largest advantage of Part A over the type-time design it replaced, and it is worth stating in the help doc — writers care.

## v5 parity fixture churn ⚠

v5 pins its renderer against **51 fixtures** captured from v4's *real* renderer: `quilltap-v5: apps/web/src/app/chat/render/__fixtures__/markdown-fixtures.json`, asserted byte-exact by `markdown-renderer.spec.ts:39-44` with an anti-truncation guard at `:46-53`, regenerated by `apps/web/tooling/capture-markdown-fixtures.mts`.

**Four fixtures contain characters the typographer rewrites** — `dialogue-straight`, `mixed-line`, `math-in-dialogue`, `template-null-dialogue-detection-falls-back` (`dialogue-curly` is already curly and is unaffected). The prerequisite fix moves more. Expect the corpus to be regenerated at the new v4 baseline as an ordinary drift catch-up, and say so in the bug's v5 status row and in this spec's completion notes. `markdown-round-trip.spec.ts` is **not** affected by Part A — nothing in the editor changes.

---

# Part B — Type-time dashes and ellipsis

## Portability contract

| Tier | What | v4 | v5 |
| --- | --- | --- | --- |
| **A — Pure logic** | The rule engine. Framework-free TypeScript, importing nothing. | `lib/smart-typography/engine.ts` | near-verbatim copy at `apps/web/src/app/editor/smart-typography/engine.ts` |
| **B — Corpus** | The fixture table pinning every decision | `lib/smart-typography/fixtures/typography-vectors.json` | byte-identical copy |
| **C — Adapter** | Keystroke plumbing that knows about Lexical / ProseMirror | `components/chat/lexical/plugins/SmartTypographyPlugin.tsx` | ProseMirror plugin |

1. **Tier A imports nothing.** Enforce with a `no-restricted-imports` override in `eslint.config.mjs` scoped to `lib/smart-typography/**`. ⚠ That rule is **not used anywhere in the repo today**, so there is no precedent to copy and the base ESLint rule (not the `@typescript-eslint` variant) binds the `patterns` shape. Verify it fires by adding a `react` import to a Tier A file and confirming `npm run lint` fails.
2. **Tier A owns every decision.** If the adapter contains an `if` about dashes, it is in the wrong file.
3. **The corpus is the contract.** v5 copies it and asserts identical outputs — a **tier-1 exact differential family** in the app whose entire method is differential verification. *Fix the port, not the vectors.*
4. **No Rust changes** beyond the settings bag, which rides the existing `chatSettings` blob — one struct in `crates/quilltap-core/src/db/chat_settings.rs`, no new dispatch verb, no `api/types.rs` edit.

Fixtures sit beside the engine rather than in the repo's usual `__tests__/fixtures/` because **v5 copies the directory wholesale**. Note the deviation in a header comment.

## The engine

`lib/smart-typography/engine.ts`:

```ts
export interface SmartTypographyOptions {
  dashes: boolean;
  ellipsis: boolean;
  /** Single characters the active roleplay template claims as delimiters; never substituted. */
  reservedChars?: readonly string[];
}

export interface TypographyInput {
  /**
   * The two characters immediately preceding the insertion point.
   * Fewer than two (start of block, or a short text node) is legal and handled.
   */
  before: string;
  /** The single character the user just typed. */
  typed: string;
  options: SmartTypographyOptions;
}

export interface TypographyResult {
  /** Characters immediately before the caret to delete. Always 1 or 2. */
  deleteBefore: number;
  /** What to insert in place of the deleted run plus the typed character. */
  insert: string;
  rule: 'en-dash' | 'em-dash' | 'ellipsis';
}

/** Pure. Deterministic. No I/O, no clock, no randomness. Null when nothing applies. */
export function smartTypographyStep(input: TypographyInput): TypographyResult | null;
```

**`before` is at most two characters.** That is the whole context these three rules need, and it is what makes the adapter simple — see [the adapter](#the-adapter).

### The rules

First match wins.

| Typed | `before` ends with | Result | Rule |
| --- | --- | --- | --- |
| `-` | `-` | `deleteBefore: 1, insert: '–'` (U+2013) | `en-dash` |
| `-` | `–` | `deleteBefore: 1, insert: '—'` (U+2014) | `em-dash` |
| `.` | `..` | `deleteBefore: 2, insert: '…'` (U+2026) | `ellipsis` |
| anything else | — | `null` | — |

**Why the dash ladder works.** Three hyphens produce, in sequence: `-`, then `–` (the second consumes the first), then `—` (the third consumes the en dash). A fourth yields `—-`, which is harmless and doubles as an escape hatch. This is strictly better than a `--`/`---` lookahead, which cannot be evaluated at a keystroke without buffering.

**Gating.** `dashes: false` disables the two dash rules; `ellipsis: false` the third. `reservedChars` suppresses any rule whose *typed* character appears in it — vanishingly rare for `-` and `.`, but the parameter costs nothing and keeps the engine honest against a template that does something surprising.

**Determinism requirements**, all pinned by the corpus: no locale-sensitive operations, no `Intl`, and explicit handling of `before.length < 2`.

### Corpus

`lib/smart-typography/fixtures/typography-vectors.json`:

```jsonc
{
  "version": 1,
  "defaultOptions": { "dashes": true, "ellipsis": true },
  "cases": [
    { "before": "0-",  "typed": "-", "expect": { "deleteBefore": 1, "insert": "–", "rule": "en-dash" } },
    { "before": "0–", "typed": "-", "expect": { "deleteBefore": 1, "insert": "—", "rule": "em-dash" } },
    { "before": "0—", "typed": "-", "expect": null },
    { "before": "-",   "typed": "-", "expect": { "deleteBefore": 1, "insert": "–", "rule": "en-dash" } },
    { "before": "",    "typed": "-", "expect": null },
    { "before": "t..", "typed": ".", "expect": { "deleteBefore": 2, "insert": "…", "rule": "ellipsis" } },
    { "before": ".",   "typed": ".", "expect": null },
    { "before": "t…", "typed": ".", "expect": null },

    { "before": "0-", "typed": "-", "options": { "dashes": false, "ellipsis": true }, "expect": null },
    { "before": "t..","typed": ".", "options": { "dashes": true, "ellipsis": false }, "expect": null },
    { "before": "0-", "typed": "-", "options": { "dashes": true, "ellipsis": true, "reservedChars": ["-"] }, "expect": null },

    { "before": "ab", "typed": "x", "expect": null }
  ]
}
```

Every row exists to protect a stated invariant. The `before: ""`, `before: "."` and `before: "0—"` rows are the ones that will catch a refactor.

### Additional unit tests

- `deleteBefore` never exceeds `before.length` — the adapter trusts this; assert it.
- Both flags off → always `null`, for both trigger characters.
- `before` supplied with more than two characters behaves identically to the last two (the adapter may over-supply; the engine must not care).

## The adapter

`components/chat/lexical/plugins/SmartTypographyPlugin.tsx`. Follows [TextReplacementPlugin.tsx](../../../components/chat/lexical/plugins/TextReplacementPlugin.tsx) closely enough that a reviewer should be able to diff them.

- `editor.registerCommand(KEY_DOWN_COMMAND, handler, COMMAND_PRIORITY_NORMAL)`.
- Bail conditions, in order:
  1. The typed character is not `-` or `.` (cheapest; do it first).
  2. `smartTypographySettings` has both rules off.
  3. `editor.isComposing()` — IME.
  4. Selection is not a collapsed `RangeSelection`.
  5. Inside a code block. **Copy the idiom at [FormattingCommandPlugin.tsx:223-225](../../../components/chat/lexical/plugins/FormattingCommandPlugin.tsx) including the `$isElementNode` narrowing**, which is easy to drop and load-bearing:
     ```ts
     const block = anchorNode.getTopLevelElement()
     if (!block || !$isElementNode(block) || $isCodeNode(block)) return false
     ```
  6. Inside inline code: `anchorNode.hasFormat('code')`.
- Read `before` as the up-to-two characters preceding the caret **within the anchor text node**: `anchorNode.getTextContent().slice(Math.max(0, anchor.offset - 2), anchor.offset)`.

  > ⚠ **Do not go looking for a block-level `textBetween` helper — there isn't one.** `TextReplacementPlugin.tsx:113-114` is literally `getTextContent()` + `anchor.offset` and then hard-bails at `:119` if the caret is not at the node's end. Anchor-node-local reading is correct here and, unlike Layer 1.5, needs no end-of-node bail: two consecutive hyphens cannot land in different text nodes from typing.
- Call `smartTypographyStep({ before, typed, options })`. On `null`, return `false`.
- On a result: one `editor.update(fn, { tag: 'smart-typography' })` that deletes `deleteBefore` characters, inserts `insert`, places the caret after it, and records the Backspace-revert memo. Return `true`.
- One `[smart-typography]` debug log per substitution naming the `rule`. **Not** per keystroke — this handler runs on every key.

Mount `<SmartTypographyPlugin />` in [LexicalComposerWrapper.tsx](../../../components/chat/lexical/LexicalComposerWrapper.tsx) (plugin stack `:124-159`, above `<TextReplacementPlugin />` at `:157`) and in [DocumentPane.tsx](../../../app/salon/[id]/components/DocumentPane.tsx)'s `DocumentEditorPlugins`.

### Undo and escape

Two mechanisms, both required, both identical across the apps:

1. **One history entry.** `editor.update(fn, { tag: 'smart-typography' })` — the idiom `TextReplacementPlugin` uses at `:141,167` for exactly this reason. One Cmd/Ctrl+Z restores `--` or `...`; a second undoes the typing.
2. **Immediate-Backspace revert.** Remember the last substitution as `{ blockKey, endOffset, literal, inserted }`. On Backspace with the caret exactly at `endOffset` in `blockKey` and nothing edited since, restore `literal` and clear the memo. Any other edit, selection change, or blur clears it.

   In v5 this is nearly free if the adapter is built on ProseMirror's `inputRules` plugin — `undoInputRule`, bound to Backspace, does exactly this. **v4 must implement it by hand (~25 lines) so the two apps agree.** Do not skip it because Cmd-Z exists: Backspace is what a writer's hands actually do, and a divergence on a keystroke this common is precisely what the v5 port exists to prevent.

### Interaction with Layer 1.5 and Layer 2.0e

`.` is a word-boundary trigger for [text replacement](composer-text-replacement.md) as well.

**Ordering:** smart typography registers at `COMMAND_PRIORITY_NORMAL` (2), above `TextReplacementPlugin`'s `COMMAND_PRIORITY_LOW` (1) at `TextReplacementPlugin.tsx:173`. Lexical's `triggerCommandListeners` loops `for (let i = 4; i >= 0; i--)` (`node_modules/lexical/Lexical.dev.js:8688`), so **NORMAL runs first** — confirmed, not assumed.

Worked through, with a rule `Aris → Aristarchus the Wise` and the user typing `Aris...`:

| Keystroke | Smart typography | Text replacement | Buffer |
| --- | --- | --- | --- |
| `.` (1st) | `before` = `is`, no match → `false` | fires: replaces `Aris`, inserts `.` | `Aristarchus the Wise.` |
| `.` (2nd) | `before` = `e.`, not `..` → no match | no match (empty word) | `Aristarchus the Wise..` |
| `.` (3rd) | `before` = `..` → `…`, returns `true` | never sees it | `Aristarchus the Wise…` |

Correct in both features — which is the point of fixing the order rather than leaving it to registration accident. Assert this table step by step in the plugin tests; it is the test that fails if someone reorders.

[Layer 2.0e emoji](complete/composer-emoji.md) triggers on `:`, which is not a Part B trigger — no interaction. Registration order among the three: emoji → smart typography → text replacement. In v5, all three are plugin-array positions in `buildPlugins()` (`apps/web/src/app/editor/rich-editor.ts:224-280`, whose doc comment already says the order is load-bearing — add this pair to it).

---

# Settings

A nested bag on chat settings, following `answerConfirmationSettings` end-to-end:

```ts
export const SmartTypographySettingsSchema = z.object({
  /** Part A — curl quotes when rendering messages. Stored text is never modified. */
  displayQuotes: z.boolean().default(false),
  /** Part B — `--` and `---` become real dashes as you type. */
  dashes: z.boolean().default(true),
  /** Part B — `...` becomes an ellipsis as you type. */
  ellipsis: z.boolean().default(true),
});
```

**On the defaults.** Part B defaults **on**: it is unambiguous, it is what a writer asking for "a real em dash" wants, and it is undoable with one Backspace. Part A defaults **off** for v1 — not because it is risky (it is reversible and touches no stored byte) but because flipping it changes the appearance of the user's entire message history at once, which is startling if unrequested. Once the [prerequisite](#prerequisite-fix-the-roleplay-dialogue-pattern-fallback-first) has landed and been walked, defaulting `displayQuotes` on is a defensible follow-up; flag it as such rather than deciding it here. See [Open questions](#open-questions).

Plumb through, copying `answerConfirmationSettings` line for line:

| Layer | Reference site |
| --- | --- |
| Leaf schema | [lib/schemas/settings.types.ts:468-473](../../../lib/schemas/settings.types.ts) |
| Field on `ChatSettingsSchema` | [settings.types.ts:608-611](../../../lib/schemas/settings.types.ts) |
| Migration + column default | pattern of [add-answer-confirmation-columns.ts:81,122-128](../../../migrations/scripts/add-answer-confirmation-columns.ts) |
| Repository default | [chat-settings.repository.ts:254-256](../../../lib/database/repositories/chat-settings.repository.ts) |
| Route param / validate / destructure / pass | [route.ts:48, 253-257, 326, 357](../../../app/api/v1/settings/chat/route.ts) |
| Client type + default const | [components/settings/chat-settings/types.ts:104,131-138](../../../components/settings/chat-settings/types.ts) |
| Hook handler (merge-then-PUT) | [hooks/useChatSettings.ts:740-772](../../../components/settings/chat-settings/hooks/useChatSettings.ts) |
| Card component | pattern of [AnswerConfirmationSettings.tsx](../../../components/settings/chat-settings/AnswerConfirmationSettings.tsx) |
| Tab wiring | [ChatTabContent.tsx:19,179-185](../../../components/settings/tabs/ChatTabContent.tsx) |

**No per-field JSON code to write** — TEXT↔object marshalling is driven by Zod field metadata, not by the repository. `lib/database/schema-translator.ts:70-71` maps `ZodObject` → `'object'`; the marshalling itself is in `lib/database/backends/sqlite/backend.ts:704` and `json-columns.ts:42,61,85`. (`base.repository.ts` contains none of it — look in the backend if it misbehaves.)

Migration `migrations/scripts/add-smart-typography-settings-field.ts`: `ALTER TABLE "chat_settings" ADD COLUMN "smartTypographySettings" TEXT DEFAULT '{"displayQuotes":false,"dashes":true,"ellipsis":true}'`. **No migration in this repo is date-prefixed** — all 179 use `add-<thing>-field.ts` / `add-<thing>-v1.ts`. Add a `PRETTY_LABELS` entry in [lib/startup/prettify.ts](../../../lib/startup/prettify.ts) in the steampunk-Wodehouse voice — *"Teaching the quotation marks to curtsey."* No loop, so no `reportProgress`. Register in `migrations/scripts/index.ts`. Update [docs/developer/DDL.md](../DDL.md).

## Settings card

New `components/settings/chat-settings/SmartTypographySettings.tsx`, in a `<CollapsibleCard sectionId="smart-typography">` directly beneath the Text Replacement card ([ChatTabContent.tsx:99-105](../../../components/settings/tabs/ChatTabContent.tsx)) — they are siblings and should read as such.

Present the two parts as two labelled groups, because they behave differently and the difference is the feature:

- **"Curly quotes when displaying messages"** (`displayQuotes`). Helper: *"Shows `“curly quotes”` in the conversation. What you typed is stored and sent to the model exactly as you typed it — this only changes how it looks, and turning it off puts everything back."*
- **"Dashes and ellipsis as you type"** — two sub-toggles. Helper: *"Turns `--` into an en dash, `---` into an em dash, and `...` into an ellipsis while you type. These become real characters in your text. One Backspace or Cmd/Ctrl+Z undoes any of them."*

Include a live **"Try it"** box for the Part B group, mirroring the affordance at [TextReplacementSettings.tsx:62-108](../../../components/settings/chat-settings/TextReplacementSettings.tsx) — note that one is a `<textarea>` (ref at `:58`), and that its bail conditions (`:64-71`) contain **no code-context check**, so copying them wholesale will diverge from this plugin's list. Copy the shape, not the conditions.

---

# Verification

## Type checks

`npx tsc` at the repo root (per CLAUDE.md — **not** `npm run build`).

## Manual matrix

### Part A — render

| Scenario | Expected |
| --- | --- |
| Send `He said "hello" to me.` | displays `He said “hello” to me.`; the **stored** content still has straight quotes (check via the CLI or LLM Inspector) |
| Same message, mid-stream | streaming render matches the settled render — **the two-pipeline test**; a change on completion is a bug |
| `don't` | displays `don’t` |
| `'tis` | displays `‘tis` — **known limitation**, non-destructive, confirm it is the documented wrong answer |
| `run it with --verbose` | displays `--verbose` **unchanged** — the render-time dash rule must be off |
| `` `const x = "y"` `` inline code | quotes stay straight |
| A fenced code block containing quotes | untouched |
| `$\text{"x"}$` math | KaTeX renders correctly; quotes untouched |
| A markdown link `[a](http://x.com/?q="y")` | the URL is untouched |
| Curly-quoted dialogue in a chat on the **fallback** patterns | `qt-chat-dialogue` highlighting applies — **the prerequisite regression** |
| A chat whose template declares `"` as a wrap delimiter | quotes are **not** curled in that chat |
| Toggle `displayQuotes` off | every message reverts to straight quotes immediately; in v5, confirm the render cache does not serve stale HTML |
| Brahma console, help chat, thinking blocks | consistent with the Salon |
| Export the instance | exported content has straight quotes |

### Part B — type

| Scenario | Expected |
| --- | --- |
| Type `1920--1930` | `1920–1930` |
| Type `wait---no` | `wait—no` |
| Type a fourth `-` | `—-`, no further substitution |
| Type `Well...` | `Well…` |
| Type a fourth `.` | `….` |
| Backspace immediately after any substitution | literal characters restored |
| Cmd-Z once after any substitution | literal characters restored |
| Same in the Document Mode rich editor | identical |
| Same in a source-mode textarea | nothing fires |
| Inside a fenced code block | nothing fires |
| Inside `` `inline code` `` | nothing fires |
| Paste `-- text...` | pasted verbatim |
| `dashes` off, `ellipsis` on | only the ellipsis fires |
| The `Aris...` interaction table above | exactly as tabulated |
| IME active | nothing fires, no interference |

## Automated

- Engine unit tests, corpus-driven, plus the additional cases.
- Plugin tests at `__tests__/unit/components/chat/lexical/plugins/SmartTypographyPlugin.test.tsx` — **note the location**: existing Lexical plugin tests live under `__tests__/unit/…` (see `MarkdownBridgePlugin.test.ts`), not in a colocated `__tests__/` directory.
- ⚠ **No `TextReplacementPlugin` test exists in the repo at all**, so "mirror Layer 1.5's tests" has nothing to mirror. Writing one alongside is strongly encouraged — the two plugins share bail conditions and an undo contract and neither is currently pinned.
- Renderer tests covering the Part A matrix on **both** v4 pipelines. The server side extends `__tests__/unit/lib/services/markdown-renderer.service.test.ts`; the client side needs a `MessageContent` render test asserting the same strings, because a passing server test proves nothing about the streaming path.
- The prerequisite's fallback-path regression test.

## Logs

One `[smart-typography]` debug line per Part B substitution. Nothing on non-trigger keystrokes.

---

# Open questions

- **Should `displayQuotes` default on?** Spec says off for v1. It is reversible and non-destructive, so the usual caution applies less than it did to the type-time design — but it restyles all history on first boot after upgrade. A human call, worth making explicitly, and cheap to change (one schema line plus the migration's column default) as long as it is decided *before* the migration ships.
- **Single-quoted dialogue in the fixed fallback pattern.** The prerequisite recommends double-quote-only. Decide before writing the fix, not after.
- **The seven other bare-`ReactMarkdown` pipelines.** v1 leaves them straight-quoted, so a help topic and a chat message will render the same text differently. Defensible (they are not conversation) but it is an inconsistency someone will notice. Either accept it in writing or extend to them.
- **`remark-smartypants` option surface.** Verify the four option names against the installed version before relying on them; an ignored `dashes: false` is the one failure mode that would ship the `--verbose` bug.

# Deferred

- **Locale quote styles** (`„…“`, `«…»`, `「…」`). Now cheap: a `quoteStyle` enum feeding the render-time options, no stored-data implications at all.
- **The wider substitution table** — fractions, arrows, `(c)`/`(r)`/`(tm)`, `+-` → `±`. Decide per row; render-time for the presentational ones, type-time for the ones that are content.
- **A "Tidy typography" selection action** for source mode and for cleaning pasted or imported text — design **A** from the [design history](#design-history), rehabilitated as an explicit user act rather than an ambient one. That is the form it should take if ever wanted.
- **Character-sheet and memory markdown fields** for Part B, alongside Layer 1.5's identical gap.
- **An elision word list** for `'tis`/`'80s`/`'n'`. Recommended: never. Render-time makes the limitation cosmetic.

# File-touch summary

**Prerequisite — [Bug 62](../bugs/fixed/bug-62-dialogue-fallback-quotes.md): ✅ landed 2026-08-13 as its own commit.**
- [lib/chat/roleplay-rendering.ts](../../../lib/chat/roleplay-rendering.ts) — ✅ both defaults respelled with `“`/`”` escapes
- `__tests__/unit/lib/services/markdown-renderer.service.test.ts` — ✅ `shared defaults (fallback path, no options passed)` block
- `components/chat/__tests__/MessageContent.test.tsx` — ✅ the client render assertion, added to the existing suite (a server-only test proves nothing about the streaming path)
- `docs/developer/bugs/fixed/bug-62-dialogue-fallback-quotes.md` — ✅ moved, dated, `FIXED in v4` paragraph added
- [docs/developer/bugs.md](../bugs.md) — ✅ row and header Status paragraph updated

**Part A:**
- `lib/markdown/typography.ts` — new; `SMARTYPANTS_OPTIONS`, shared by both pipelines (the `REMARK_MATH_OPTIONS` precedent)
- [lib/services/markdown-renderer.service.ts](../../../lib/services/markdown-renderer.service.ts) — plugin at `:86-87`; extend the sync comments at `:79-80,84-85`
- [components/chat/MessageContent.tsx](../../../components/chat/MessageContent.tsx) — plugin in the array at `:501`; extend the sync comment at `:498-500`
- The reserved-character guard, threaded through the existing renderer options
- `package.json` — `remark-smartypants` runtime dependency

**Part B, Tier A/B (copied near-verbatim into v5):**
- `lib/smart-typography/engine.ts`
- `lib/smart-typography/fixtures/typography-vectors.json`
- `lib/smart-typography/__tests__/engine.test.ts`

**Part B, Tier C (rewritten in v5):**
- `components/chat/lexical/plugins/SmartTypographyPlugin.tsx`
- `__tests__/unit/components/chat/lexical/plugins/SmartTypographyPlugin.test.tsx`
- `__tests__/unit/components/chat/lexical/plugins/TextReplacementPlugin.test.tsx` — the missing Layer 1.5 coverage
- [LexicalComposerWrapper.tsx](../../../components/chat/lexical/LexicalComposerWrapper.tsx), [DocumentPane.tsx](../../../app/salon/[id]/components/DocumentPane.tsx) — mount above `TextReplacementPlugin`
- [TextReplacementPlugin.tsx](../../../components/chat/lexical/plugins/TextReplacementPlugin.tsx) — extract and share `isInCodeContext()`, fixing the latent code-context defect (**file that bug too**)

**Settings:**
- `migrations/scripts/add-smart-typography-settings-field.ts`, `migrations/scripts/index.ts`, `lib/startup/prettify.ts`, `docs/developer/DDL.md`
- `lib/schemas/settings.types.ts`, `lib/database/repositories/chat-settings.repository.ts`, `app/api/v1/settings/chat/route.ts`
- `components/settings/chat-settings/types.ts`, `hooks/useChatSettings.ts`, `SmartTypographySettings.tsx`, `components/settings/tabs/ChatTabContent.tsx`

**Cross-cutting:**
- `eslint.config.mjs` — the `lib/smart-typography/**` import restriction
- [help/chat-settings.md](../../../help/chat-settings.md) — a Smart Typography section beside Composer (`:42-58`) and Text Replacement (`:96-116`). ⚠ **Do not change that file's frontmatter** — `:2` declares `url: /settings?tab=chat` with the matching `help_navigate` at `:599`, and CLAUDE.md requires them to agree. A section-scoped deep link means a *separate* help file (`help/answer-confirmation.md` is the precedent), not a frontmatter edit.
- `docs/CHANGELOG.md` — top entry
- [composer-text-replacement.md](composer-text-replacement.md) — record the shared `isInCodeContext()` helper and the plugin-ordering contract
- `packages/theme-storybook/src/css/qt-components.css` **only if** a `qt-*` class changed (**publish gates the commit**). If none proves necessary, say so in the commit message so the omission reads as deliberate.

**No quilltap-shell changes. No `packages/quilltap` (CLI) changes. No provider, tool, or context-builder changes.**

## Changelog entry

Top of [docs/CHANGELOG.md](../../CHANGELOG.md), terse plain American English:

```
- Smart typography, in two parts. Quotes: the conversation now displays curly quotes while storing and sending exactly what you typed, so nothing about your text or the model's input changes; off by default, toggle on the Chat settings tab. Dashes: typing `--` gives an en dash, `---` an em dash, and `...` an ellipsis, in the Salon composer and Document Mode; on by default, and one Backspace or Cmd/Ctrl+Z reverts any substitution. Dashes are deliberately not applied at render time, so `--verbose` in prose stays intact.
- Fixed: the fallback roleplay dialogue pattern matched only straight quotes despite claiming to match curly ones, so dialogue highlighting failed on curly-quoted text in chats not using a template with its own patterns.
```

## Completion gate

Do not move this spec to `docs/developer/features/complete/` until every entry in the file-touch summary is written; the prerequisite has landed as its own commit **with its bug-catalogue entry and its v5 status row**; both manual matrices have been walked on a running instance, **including the streaming-vs-settled comparison that is the only test of the two-pipeline duplication**; and `lib/smart-typography/**` still imports nothing outside the standard library. A v5 port that has to re-derive the dash ladder means Part B failed at its actual job; a v5 render that disagrees with v4's by one character means Part A did.
