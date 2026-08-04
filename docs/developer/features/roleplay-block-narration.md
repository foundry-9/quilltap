# Block-Scoped Narration — Design Spec

**Status:** Proposed
**Audience:** Claude Code (and whoever reviews the handoff)
**Scope:** Roleplay-template narration formatting — the delimiter schema, the shared rendering core, the composer toolbar, and the template-authoring UI. No change to existing chat message bodies.

---

## 1. The problem, stated plainly

A roleplay template that claims `*` for narration is competing with Markdown emphasis for the same character, and it loses on volume.

This is not a hypothesis. It was measured on a live Friday chat (`af01394d-1f04-4b50-9267-aaa68766910f`) whose template — "Covenant RP" — correctly specifies `+` on both sides of a narration span, in a `systemPrompt` that says so twice and explicitly warns against asterisks. Every model in the chat produced hybrid spans: opening with `+`, closing with `*`.

The provider's raw response was checked (LLM log `c7c05a21`) to rule out a post-processing bug. The models emitted the hybrid themselves.

Counting delimiter-shaped spans in the exact request that produced the **first** hybrid — before any contaminated example existed in the history:

| Source | `*…*` spans | `+…+` spans |
|---|---|---|
| System prompt — character card | 16 | 2 (the template's own examples) |
| System prompt — tool-execution rules | 3 | 0 |
| Scene description | 22 | 0 |
| Character greeting | 1 | 0 |
| `search` tool results (document text echoed back) | 8 | 0 |
| User's own message | 0 | 1 |
| **Total** | **50** | **3** |

The instruction wins at the *opening* delimiter — a single decision made shortly after reading the rule. The ambient prior wins at the *closing* delimiter, decided a couple hundred tokens later, where "what closes a narration span" is predicted against fifty in-context examples that all say `*`.

Two structural facts make this permanent:

1. **`*` is CommonMark emphasis.** Character cards, scene descriptions, project instructions, and every document a character reads back through `search` will contain `*emphasis*` forever. None of it is narration; all of it teaches the model that `*` closes a span.
2. **Most roleplay conventions outside Quilltap also use `*` for narration.** So the pretraining prior and the in-context prior point the same direction, and any template that picks a different character is fighting both.

A template that picks `*` inherits the collision. A template that picks anything else inherits the fight. Neither is winnable by wording.

## 2. What has already been done, and why it isn't enough

Two code-side sources of ambient asterisks were removed (4.8-dev):

- `lib/tools/native-tool-prompt.ts` illustrated its "don't narrate tool use" rule with `"*pulls up the file*"` and two siblings. Unconditional — every tool-enabled turn, every template.
- Twelve staff-announcement strings across `aurora-notifications/` (×3), `commonplace-notifications/` (×7), and `suparna-notifications/` (×2) were asterisk-delimited narration. Most were already neutralized for the model by the `opaqueContent` swap in `context-builder.service.ts`; the exceptions were all-transparent chats, and Suparṇā, whose `opaqueContent` equals `content` by design.

That removed 15 of the 50 spans in the table above — the portion Quilltap itself authored. **The remaining 35 are user content**: character cards, scene text, greetings, and documents. Those cannot be fixed by code, and asking authors to stop using emphasis in their own prose is not a real ask.

So the delimiter fight cannot be won by reducing ambient asterisks. It has to be sidestepped.

## 3. Design principle

**Separate narration from emphasis by structure, not by character.**

Inline emphasis and a block-level construct cannot occupy the same syntactic slot, so they cannot compete. A block-scoped narration rule is immune to ambient `*emphasis*` no matter how much of it the context contains, because the model is not choosing between two meanings of one character — it is choosing a line shape.

This also inverts the reliability argument. Today, the more Markdown-literate the model, the *worse* it follows a `+`-narration template. With block narration, Markdown literacy becomes the mechanism instead of the obstacle.

## 4. Recommended design: narration as a themed blockquote

Narration is written as a Markdown blockquote. Emphasis inside it works normally.

```
> The door's particular sound has already done its work — Owen is turned,
> rag in one hand, by the time Charlie's across the threshold.

Done. Sealed the old cold room off the east wall.
```

Why this one:

- **The model already knows it.** Blockquote continuation across lines is drilled in by Markdown pretraining far harder than any roleplay convention. This is the one construct where the prior is an asset.
- **The parser already handles it.** `remark` turns it into a `<blockquote>` before the roleplay layer runs. No new regex, no continuation-line matching, no coalescing of adjacent single-line matches — the block boundary is computed by the Markdown parser, which is better at it than a `^marker(.+)$` rule with the `m` flag will ever be.
- **`hideDelimiters` becomes free.** Markdown consumes the `>` marks; nothing needs stripping.
- **Emphasis survives.** `*text*` inside a blockquote is still emphasis, at a different layer. The collision is gone by construction, not by convention.
- **Lexical supports it natively.** The composer's blockquote node already exists; the toolbar's narration button becomes a block-format toggle rather than a wrap.
- **Multi-paragraph narration becomes expressible.** See below — this is not a minor convenience; it removes a limitation authors currently have to instruct around.
- **A dropped marker is forgiven.** See below.

### 4.0 Multi-paragraph narration, and tolerance for dropped markers

Two properties fall out of using the Markdown parser rather than a regex. Both were verified against this repo's own `remark-parse`:

| Input | Parsed as |
|---|---|
| `> p1` / `>` / `> p2` | **one** blockquote, 2 paragraphs |
| `> line one` / `line two` *(marker dropped entirely)* | **one** blockquote, 1 paragraph |
| `> p1` / *(blank)* / `p2` *(marker dropped after blank line)* | blockquote + separate paragraph |

**Multi-paragraph narration works.** A `>` carried across the blank line keeps one passage in one block. This is impossible with any wrap delimiter in the current pipeline, and not as a matter of instruction-wording: `remark` splits paragraphs into separate nodes *before* the roleplay layer runs, and `wrapBlockMatchFor` anchors its match to a single block. A `+` opened in one paragraph and closed two paragraphs later never meets a text block containing both. That structural limit is why the Covenant template has to carry the line "Every line of action/narration must be enclosed this way, this is not a multi-line pattern" — the author is working around the renderer, and paying for it with an open/close pair on every paragraph.

**The most likely model error is absorbed.** CommonMark lazy continuation means a paragraph continuation line does not need the marker — row 2 above. The single most common failure mode for a marker-based format (forgetting it on continuation lines) costs nothing. No character-delimiter design can match this: a dropped closing `+` corrupts the remainder of the message, while a dropped mid-paragraph `>` is invisible.

The failure that is *not* forgiven is row 3 — dropping the marker after a blank line ends the quote early. So the prompt hint should say the marker goes on every line, including the blank one between paragraphs. That is the one thing the model has to get right, and it is a much smaller ask than "close every span with the correct character, every time, across fifty contrary in-context examples."

The cost is that narration no longer nests inside a line — you cannot have `He said +quietly+ and left` with a block rule. That is a real loss and should be stated to authors, not papered over. Mid-line action beats stay available through a `wrap` delimiter with a non-`*` character; the block rule is for the paragraph-scale narration that dominates actual play.

### 4.1 Schema

Add a `blockQuote` kind to the `TemplateDelimiter` union in `lib/schemas/template.types.ts` (currently `wrap` | `linePrefix` | `tagPrefix`):

```ts
const BlockQuoteDelimiter = z.object({
  kind: z.literal('blockQuote'),
  name: z.string().min(1).max(50),
  buttonName: z.string().min(1).max(10),
  style: z.string().min(1).max(50),
  addOns: DelimiterAddOnsSchema.optional(),
});
```

No `delimiters` / `marker` / `open` / `close` field — the construct is fixed. `NarrationDelimitersSchema` needs a representation for "block, no delimiter pair"; the least invasive option is a `'blockquote'` literal in the union alongside the existing string and `[open, close]` tuple, since `narrationDelimiters` is what drives both auto-pattern generation and the composer's narration button.

Both are stored inside existing JSON columns (`roleplay_templates.delimiters`, `.narrationDelimiters`), so **no DDL change** — but three places document the JSON shape and must be updated in the same change:

- `docs/developer/DDL.md` (the `delimiters` shape note, ~line 1095)
- `public/schemas/qtap-export.schema.json` (the `kind` discriminant, ~line 884)
- `docs/developer/TEMPLATE_PLUGIN_DEVELOPMENT.md`

### 4.2 Rendering

`RenderingPatternSchema.scope` is currently `'inline' | 'line'`. Block narration does not fit either, and — importantly — **does not need a regex at all**. Rather than forcing it through `compileRenderingPatterns`, the cleaner path is to let the Markdown pipeline produce the `<blockquote>` and have both renderers apply the template's class to it:

- `components/chat/MessageContent.tsx` — **the `blockquote` override already exists** (line 427, routed through `renderLineBlock` like `li` and the headings). It needs to additionally apply the template's composed narration class (base `style` + `addOnClassesFor(addOns)`); the plumbing point is already there.
- `lib/services/markdown-renderer.service.ts` — the equivalent rehype step.

Note that `renderLineBlock` styles a block by flattening it through `extractTextContent`, which joins children with `''`. For a blockquote that spans paragraphs the class belongs on the `<blockquote>` element itself, so the multi-paragraph body should not be routed through the flattening path — apply the class and render children normally.

Both already import the shared core from `lib/chat/roleplay-rendering.ts`; the class composition helper (`addOnClassesFor`) is already exported from `lib/chat/annotations.ts`. Keep the two renderers deriving from one definition — do not hand-write the class list twice.

**Open question:** whether a template that does *not* declare block narration should still style blockquotes, and how a blockquote used as an ordinary quotation (Suparṇā reads letters aloud as blockquotes — `suparna-notifications/writer.ts` `quoteBody`) is distinguished from narration. Suparṇā's letters are staff whispers, so one option is to scope the narration class to character-authored messages only. This needs a decision before implementation.

### 4.3 Composer

`lib/chat/text-transforms.ts` and the formatting toolbar treat the narration button as a wrap (insert prefix/suffix around selection). For `blockQuote` it becomes a block-format toggle. Lexical has `$createQuoteNode` / `$setBlocksType`; the source-textarea path prefixes selected lines with `> ` and toggles off by stripping.

The `MarkdownBridgePlugin` invariant holds unchanged: `COMPOSER_TRANSFORMERS` must keep excluding `ITALIC_STAR` and `BOLD_ITALIC_STAR`. Note that this invariant exists *because* asterisks are roleplay narration — once block narration is available, a template that uses it has no reason to need that exclusion, but the exclusion must stay for templates that still use `*` wrap narration. Do not remove it as "no longer needed."

### 4.4 Prompt hint

`generateFormattingPromptHint` (`lib/chat/template-prompt-hint.ts`) needs a `blockQuote` branch. Suggested bullet:

```
- Narration and action: write it as a Markdown blockquote — every line begins with "> ",
  including the blank line between paragraphs of the same passage.
  Dialogue and everything else is written as ordinary text.
```

The "including the blank line" clause is the load-bearing part — per §4.0 it is the only marker omission the parser does not silently absorb.

State it positively. **Do not add a negation** naming the character to avoid. The existing Covenant template says "It begins with a plus and it ends with a plus, not an asterisk," which places the tokens "ends with" and "asterisk" adjacent in the stream; negated instructions prime the thing they forbid, and this sentence plausibly made the behavior worse rather than better.

Also worth fixing regardless of this work: the template block is injected by `system-prompt-builder.ts:275`, followed by the math-notation block and the tool-execution rules — roughly 6.4k characters of system prompt after the formatting rule in the measured chat. Formatting instructions belong last, where recency helps them.

## 5. Phasing

**Phase 1 — authoring warning (independent, ship first).** In the template editor (`components/settings/roleplay-templates/index.tsx`), warn inline when an author picks `*` or `_` as a narration delimiter. It is cheap, needs none of the above, and is useful even if the rest is never built. Draft copy in §6.

**Phase 2 — the `blockQuote` kind.** Schema, both renderers, composer toggle, prompt hint, plus the three doc-shape updates in §4.1.

**Phase 3 — a built-in template using it.** Ship "Blockquote Narration" as a built-in in `roleplay-templates.repository.ts` so the collision-free option is the path of least resistance rather than something an author has to discover and hand-build.

**Phase 4 (optional) — prose-default narration.** The strongest anti-collision design is no delimiter at all: prose paragraphs *are* narration, quoted text is dialogue, emphasis is entirely free. `DialogueDetectionSchema` already exists and is currently unused by this path (the Covenant template has `dialogueDetection: null`). Weaker than Phase 2 in one respect — paragraph classification becomes a heuristic, and a paragraph mixing dialogue with action cannot be styled — so it is a second built-in for prose-style users, not a replacement.

## 6. Template-author guidance

Add to `help/roleplay-templates-settings.md`, in the Quilltap voice, near the narration-delimiter control. Substance to convey:

- Asterisks are Markdown's own emphasis marks. A template that claims them for narration is asking one character to mean two things, and the model will resolve the ambiguity against you roughly as often as your prose contains emphasis.
- Choosing a *different* character does not escape it — it puts your instruction in a fight with every `*emphasis*` in your character cards, scene text, and documents. Measured on a real chat: fifty asterisk-shaped spans against three of the template's chosen character. Models open the span correctly and close it wrong.
- The durable fix is to stop competing: narration as a block, emphasis inline. They cannot collide.
- Block narration also carries a passage across paragraph breaks, which a wrapped delimiter cannot do at all. A template built on wrapped narration has to open and close on every paragraph, and say so in its instructions.
- If you keep a character-delimited narration style, expect to correct the model, and keep your own prose light on emphasis.

State the trade-off honestly — block narration cannot mark a mid-sentence action beat.

## 7. Explicitly out of scope

- **Rewriting existing message bodies.** Chats carry whatever their models produced. Contaminated history is best fixed per-chat by hand; a bulk migration guessing at intent across every stored message is not worth the risk.
- **Changing the Covenant template or any user template.** This spec adds an option. Migrating built-ins is Phase 3 and touches only built-ins.
- **The `systemTransparency` conditional-exposure gap.** The staff writers were fixed at the wording level in 4.8-dev, so the gap no longer has a payload, but the underlying asymmetry — persona bodies reaching the model in all-transparent chats — is unrelated to this work and should be tracked separately.

## 8. Reproducing the measurement

The audit behind §1 is re-runnable against any chat:

```bash
node packages/quilltap/bin/quilltap.js db --instance Friday logs --chat <chatId> --tail 20
```

Take a `CHAT_MESSAGE` log id, dump it with `db … log <logId>`, parse the `── Request ──` JSON, and count `/(^|[^*\w])\*[^*\n]{2,}\*/g` against the template's own delimiter per message. Attributing per message is what shows whether contamination is code-authored (fixable) or user-authored (not). Compare the stored message body against the log's `── Response ──` to distinguish a model behavior from a post-processing bug — that check is what ruled out a Quilltap bug here.
