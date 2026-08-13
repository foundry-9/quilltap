# Bug 62 — the fallback dialogue pattern matches only straight quotes, despite its comment claiming otherwise

| | |
|---|---|
| **Status** | **FIXED in v4 (2026-08-13)** |
| **Found** | 2026-08-13 |
| **Fixed** | 2026-08-13 |
| **Severity** | Medium (cosmetic, but pervasive and long-standing: curly-quoted dialogue has *never* been highlighted in any chat falling back to the defaults, and most model output is curly-quoted) |
| **Who it bites** | anyone in a chat with no roleplay template, or one whose template supplies no `renderingPatterns` / a null `dialogueDetection`, whose text contains curly quotes — which is most LLM output, anything pasted from Word/Pages/Scrivener, and anything typed on macOS with system smart quotes on |
| **Provenance** | Faithful — v5 copied the defect byte-for-byte and says so in a comment. Surfaced 2026-08-13 while spec'ing [composer-smart-typography](../../features/composer-smart-typography.md), which cannot ship until this is fixed |
| **Defect site** | `lib/chat/roleplay-rendering.ts:32-33` (`DEFAULT_RENDERING_PATTERNS`, the dialogue entry) and `:43-49` (`DEFAULT_DIALOGUE_DETECTION`) |
| **Fix site** | `lib/chat/roleplay-rendering.ts` (both defaults) + fallback-path regression coverage in `__tests__/unit/lib/services/markdown-renderer.service.test.ts` plus a bug-62 block in the existing `components/chat/__tests__/MessageContent.test.tsx` |
| **v5 status** | Owed (Faithful) — v5 reproduces it deliberately; the fix moves v5's captured parity corpus. See [v5](#v5) |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-08-13).** Both defaults in `lib/chat/roleplay-rendering.ts`
now carry the real curly code points, spelled as `“` / `”` escapes the
way the seeded Standard Roleplay template does — the inline pattern is
`'["“][^"”]+["”]'` and `DEFAULT_DIALOGUE_DETECTION` is
`openingChars: ['"', '“']` / `closingChars: ['"', '”']`. Single quotes
are **not** matched; see [the product decision](#one-product-decision-to-take-not-to-omit).
Both misleading comments were rewritten to say what the code does and why the
escapes are mandatory.

Regression coverage lands on **both** renderers, asserting the defaults with no
options passed and with the empty-array / null forms that fall through to the
same place: a `shared defaults (fallback path, no options passed)` block in the
server suite, and a bug-62 block appended to the existing `components/chat/__tests__/MessageContent.test.tsx`
that renders the real client component (the ESM-only markdown stack is mocked;
everything downstream of `components.p` is the real code). Each suite also has a
*the template path must not move* case asserting the defaults now render
byte-identically to the seeded template. Verified by reverting each half of the
defect independently: the pattern-only revert fails 9 tests across the two
suites, the detection-only revert fails 5.

Two spellings of the same defect survive elsewhere and are **not** covered by
this fix, because both cost more than the bug does:

- **`packages/plugin-types`** repeats `openingChars: ['"', '"']` — the same
  duplicated ASCII — in three JSDoc *examples*
  (`src/plugins/roleplay-template.ts:83,187` and the built `dist/index.d.ts`).
  Documentation only, but it is what a plugin author copies. Correcting it means
  a version bump and a manual `npm publish`, so it is left as a follow-up rather
  than gating this commit.
- **Stored template rows** written by anyone who copied those examples are
  unaffected by a defaults change and would need a migration. None are known to
  exist.

---

## Symptom

In a chat that is not using a roleplay template with its own rendering patterns,
dialogue written with curly quotes gets no `qt-chat-dialogue` styling:

```
“Get down,” she said.      → renders as plain body text
"Get down," she said.      → renders styled, correctly
```

The same message, in a chat on the seeded **Standard Roleplay** template, styles
correctly either way — which is what has kept this invisible.

Both the paragraph-level dialogue detection and the inline dialogue pattern are
affected, so neither the whole-line treatment nor the inline span appears.

## Root cause

`lib/chat/roleplay-rendering.ts` is, by its own module doc, the "single source of
truth" that stops the client and server renderers drifting apart. It succeeds at
that — and its two dialogue defaults are simply wrong, so both renderers inherit
the same wrong behaviour identically.

**1. The inline pattern.** `:32-33`:

```ts
// Dialogue: "speech" - straight and curly quotes
{ pattern: '[""][^""]+[""]', className: 'qt-chat-dialogue' },
```

The comment says straight *and* curly. The bytes say otherwise —
`hexdump -C` of that line:

```
00000000  20 20 7b 20 70 61 74 74  65 72 6e 3a 20 27 5b 22  |  { pattern: '["|
00000010  22 5d 5b 5e 22 22 5d 2b  5b 22 22 5d 27 2c 20 63  |"][^""]+[""]', c|
```

`5b 22 22 5d` is `[`, `"`, `"`, `]`. Every quote in that pattern is ASCII
`0x22`; there is no `e2 80 9c` / `e2 80 9d` anywhere on the line. The character
class is the straight quote **duplicated**, which is a no-op — it has never
matched a curly quote, and the pattern is exactly equivalent to `"[^"]+"`.

**2. The dialogue detection.** `:43-49`, with the same misleading comment:

```ts
/**
 * Default dialogue detection for paragraph-level styling.
 * Handles straight and curly quotes.
 */
export const DEFAULT_DIALOGUE_DETECTION: DialogueDetection = {
  openingChars: ['"', '"'],
  closingChars: ['"', '"'],
  className: 'qt-chat-dialogue',
}
```

Hexdump of `:47-48`:

```
00000050  5b 27 22 27 2c 20 27 22  27 5d 2c 0a 20 20 63 6c  |['"', '"'],.  cl|
00000060  6f 73 69 6e 67 43 68 61  72 73 3a 20 5b 27 22 27  |osingChars: ['"'|
00000070  2c 20 27 22 27 5d 2c 0a                           |, '"'],.|
```

Again `0x22` four times. Both arrays are the straight quote listed twice.

**3. These are the live fallback, on both renderers.**
`renderMarkdownToHtml` destructures them as its defaults
(`lib/services/markdown-renderer.service.ts:125-127`) and re-asserts them at
`:133` and `:169` — so an empty `renderingPatterns` array or a null
`dialogueDetection` lands here too, not just an absent options object. The client
does the same at `components/chat/MessageContent.tsx:19,24`, consuming them at
`:338` and `:386`.

## Why it survived

Three things, together:

- **The seeded template is correct.** *Standard Roleplay*
  (`lib/database/repositories/roleplay-templates.repository.ts:55,61-62`) declares
  `'[""“][^""”]+[""”]'` and `openingChars: ['"', '“']` —
  spelled with explicit escapes, and right. Most chats are on a template, so most
  chats never touch the defaults.
- **The comments assert the opposite of the code**, so anyone reading the file to
  check would have found the claim and moved on. The duplicated-quote character
  class also *looks* like it is doing something.
- **The existing curly-quote test coverage exercises the template path, not the
  fallback.** `__tests__/unit/lib/services/markdown-renderer.service.test.ts:409-421`
  has curly-quote cases; they pass options in. Nothing asserts the defaults.

## The fix

Small, and the shape is not in dispute:

1. **Verify the bytes first.** `hexdump`/`xxd` the lines rather than trusting the
   comment or how the glyphs render in an editor — that is precisely the trap
   that hid this.
2. Correct `DEFAULT_RENDERING_PATTERNS`' dialogue entry to match straight **and**
   curly, and `DEFAULT_DIALOGUE_DETECTION` to `openingChars: ['"', '“']` /
   `closingChars: ['"', '”']`. Write the curly characters as explicit `“` /
   `”` escapes, as the seeded template does — a literal curly glyph in source
   is exactly how this got lost.
3. Fix the two comments, or delete them. A comment that has been wrong since it
   was written has earned deletion.
4. Add fallback-path regression coverage: assert the defaults, with no options
   passed, on **both** renderers. The server side extends the existing suite; the
   client needs a `MessageContent` render assertion, because a passing server test
   proves nothing about the streaming path.

### One product decision to take, not to omit

**Should single-quoted dialogue highlight?** Recommendation: **no** — double-quote
only, matching the seeded template. `'` is far more often an apostrophe than a
quotation mark, so a single-quote dialogue pattern false-positives across ordinary
English prose (`don't`, `writers'`, `'80s`). Decide before writing the fix; adding
it later is a behaviour change, and adding it silently is worse.

## How to verify

1. A chat with **no** roleplay template. Send `“Get down,” she said.` — the
   dialogue is styled `qt-chat-dialogue`. Send the straight-quote version — still
   styled.
2. A template with `renderingPatterns: []` and `dialogueDetection: null` — the
   same, since both fall through to the defaults.
3. A chat on **Standard Roleplay** — unchanged in every case (the regression
   check: the template path must not move).
4. Mid-stream and settled render agree. The client and server pipelines are
   duplicated by convention, so a message that changes appearance when streaming
   ends means only one of the two was fixed.

## Why this is on the critical path

[composer-smart-typography](../../features/composer-smart-typography.md) applies
curly quotes as a **remark plugin**, and the roleplay layer runs *after* parsing —
on the HTML string on the server, on React children on the client. So the
typographer curls the text before the dialogue matcher ever sees it.

Shipping that feature against this bug would silently stop dialogue highlighting
in every chat on the fallback patterns, the moment a user turned the setting on.
The feature would appear to break an unrelated one, with no error and no obvious
connection. That spec therefore gates on this bug landing first, as its own
commit.

## v5

v5 ported the defect **knowingly**, byte-for-byte, as the port's discipline
requires: `apps/web/src/app/chat/render/roleplay-rendering.ts:68-69` carries the
comment *"v4's stored pattern is straight-quote-only — copied byte-for-byte"*,
with the same ASCII `openingChars` / `closingChars` at `:79-83`.

Consequences for that side, to be worked there:

- **Owed (Faithful).** No both-directions tripwire exists, so nothing over there
  fires when v4 converges — the two sides simply disagree until the mirror lands.
  Mirror it in the same drift round.
- **The parity corpus moves.** `apps/web/src/app/chat/render/__fixtures__/markdown-fixtures.json`
  (51 fixtures, asserted byte-exact) is captured from v4's *real* renderer; the
  dialogue and fallback fixtures change. Regenerate at the new baseline via
  `apps/web/tooling/capture-markdown-fixtures.mts` — ordinary drift, not a port
  regression.
