# Bug 109 — a document's curly punctuation defeats the edit, because the model retypes it straight

| | |
|---|---|
| **Status** | FIXED in v4 (2026-08-29) |
| **Found** | 2026-08-29 |
| **Fixed** | 2026-08-29 |
| **Severity** | Medium (an edit a character is fully entitled to make is refused, with an explanation that sends it round the same loop; 5 of 33 `Text not found` failures on one instance, and every one of them was a valid edit) |
| **Who it bites** | Any character editing a document that a model wrote — which is most of them. The likelihood rises with the prose: curly quotes and em dashes are what models produce when they write English |
| **Provenance** | Reported from the Salon while investigating bug 108, then measured across the whole of the Friday instance: every `doc_str_replace` failure was compared against the content of that character's own most recent `doc_read_file` of the same file |
| **Defect site** | `lib/doc-edit/diacritics.ts` — the matcher normalized diacritics and case and nothing else, so `’` and `'` were different text |
| **Fix site** | `lib/doc-edit/typographic-folding.ts` (new) × `lib/doc-edit/diacritics.ts` (the `foldTypography` option, exact-first tiering, one shared per-character rewrite) × `lib/tools/handlers/doc-edit/text-handlers.ts` (`doc_str_replace`, `doc_insert_text`'s anchor, and `doc_grep`'s literal path) |
| **v5 status** | **Applies.** The port copies these matching semantics; a byte-exact editing tool over model-authored prose inherits the whole defect |
| **Index** | [../bugs.md](../bugs.md) |

---

**FIXED in v4 (2026-08-29).** The editing tools now fall back to a typographic
fold when — and only when — the exact reading matches nothing at all. Exact
first is the load-bearing half: a file holding both `Veyra-5's` and `Veyra-5’s`
has one right answer and it is the one the caller typed, so an unconditional
fold would turn a good edit into an ambiguity error. `doc_grep`'s literal search
folds unconditionally, because a search for words is not a search for
punctuation. Nothing about Quilltap's own typography rules changed, and nothing
needed to: they were never the cause.

## Symptom

A character reads a file, retypes a sentence from it into `doc_str_replace`'s
`find`, and is told the text is not there. Re-reading does not help, because the
model retypes it the same way the second time.

Five instances on one instance, in two files:

| When | File | The difference |
|---|---|---|
| 2026-04-25 (×2) | `Men's Meeting/April 2026/Final Teaching Synthesis…md` | file `“Having begun by the Spirit…?”`, find `"Having begun by the Spirit…?"` |
| 2026-08-26 (×3) | `Knowledge/Hestia Search Log.md` | file `Veyra-5’s orbit`, find `Veyra-5's orbit` |

The direction never varies: **the file is curly, the find text is straight.**
Nothing else about those find strings differs from the file — folding the quotes
turns each of them into an exact, unique match.

## Root cause

Two facts that are individually correct.

**Quilltap does not curl anything outside the render layer.** This was checked
before anything was changed, because the natural first suspicion is that some
pipeline is prettifying text on its way past. It is not: `remark-smartypants`
appears at exactly two call sites, `components/chat/MessageContent.tsx:365`
(streaming, client) and `lib/services/markdown-renderer.service.ts:105`
(persisted, server), both of which render HTML for the browser and neither of
which touches stored content, tool arguments, exports, or anything an LLM reads.
The keystroke engine (`lib/smart-typography/engine.ts`) writes real characters,
but only dashes and the ellipsis, and only into what a **human** is typing.
`doc_read_file` returns the file's bytes with `[Ln]` prefixes; `doc_write_file`
and `doc_str_replace` store the string they are given. The rule the codebase
already follows — typography is a rendering opinion — is the right one and is
intact.

**Models write curly punctuation of their own accord, and Quilltap stores it
faithfully.** That is where the `’` comes from. The Hestia one is traceable to
the character: a Pascal custom-tool roll at `2026-08-26T01:55:42` whose model
output contained *"periodically crosses Veyra-5’s orbit"*, which was written to
the file verbatim, exactly as it should have been.

So the file holds `’` because a model put it there, and a later call spells it
`'` because a model — often a different one, often a cheaper one, always working
from a transcript rather than from the bytes — normalized it while retyping.
`findAllMatches` compared the two after NFD-stripping combining marks, which
does nothing at all to `U+2019`, and reported no match. The tool then told the
character its text was stale, which was not true and could not be fixed by the
remedy offered.

This is the same *kind* of difference the matcher already forgives for `Nimuë`
and `Nimue` — a difference of spelling, not of meaning — and the `Text not
found` sentence is only correct for differences of meaning.

## Why it survived

It looks like model error, and 26 of the 33 `Text not found` failures in the
corpus genuinely are. Reading the failed calls one at a time, a curly-vs-straight
apostrophe is nearly invisible in a proportional font and completely invisible
in a summary; the cases only separate out when the find string is compared
byte-for-byte against the read that preceded it, which is what finally
distinguished five valid edits from twenty-six stale ones.

It is also intermittent by nature. The same character editing the same file
succeeds all day and fails on the one sentence that happens to contain an
apostrophe a model curled three weeks earlier.

## The fix

A **per-character fold**, in the same shape as the diacritics one it composes
with, and for the same reason — matching is about what the text says, not how it
is spelled.

- **`lib/doc-edit/typographic-folding.ts`** (new) holds the table: the quote
  family onto `'` and `"`, the dash family onto `-`, `…` onto `...`, and the
  non-breaking/wide spaces onto `U+0020`. Zero-width characters and guillemets
  are deliberately excluded — the first are an encoding problem rather than a
  typographic one, and the second are their own punctuation, not a spelling of
  `"`.

- **`lib/doc-edit/diacritics.ts`** gains a `foldTypography` option, off by
  default, and — the part that makes the fold safe — `findUniqueMatch` now runs
  **exact first and folded only on a total miss**, returning a `tier` saying
  which reading answered. More than one exact match is an answer, not a miss, so
  it never consults the fold. The file's two normalization paths (the string
  being searched, and the map translating a hit back to original positions) are
  now built from **one** per-character function, so a fold that changes length
  (`…` → `...`) maps back correctly and the two cannot drift.

- **`text-handlers.ts`** turns it on for `doc_str_replace`, for
  `doc_insert_text`'s anchor, and for `doc_grep`'s literal (non-regex) search.
  Grep folds unconditionally: there is no uniqueness contract to protect, and a
  character searching for `Veyra-5's` should find the sentence. The regex path
  is left alone, since there the caller is spelling the pattern themselves.

Two consequences worth stating plainly. A typographic-tier match splices the
replacement over the **original** span, so the file's punctuation in that
passage becomes whatever the caller supplied — which is precisely what
`doc_str_replace` means, and it cannot reach beyond the passage the caller
named. And the success message now says when a match needed the fold, so the
model learns that the file's punctuation differs from its own rather than
guessing.

## How to verify

`__tests__/unit/lib/doc-edit/typographic-matching.test.ts` pins the matcher,
including the real failing passage from the Hestia log, that the reported
index/length address the original curly bytes, that an ellipsis (whose fold is
one character to three) maps back correctly, and that a file carrying *both*
spellings resolves to the exact one.

`__tests__/unit/lib/tools/handlers/doc-edit-handler-str-replace-arguments.test.ts`
drives the real matcher through the real dispatcher and asserts the bytes
written: the curly passage is replaced, the rest of the file keeps its own
punctuation, and an exactly-matching edit says nothing about typography.

By hand: write a file containing a curly apostrophe through a character, then
ask a character to `doc_str_replace` that sentence using a straight one. The
edit lands, and the reply says why it needed to look past the punctuation.
