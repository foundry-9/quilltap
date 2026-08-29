/**
 * Typographic Folding
 *
 * A per-character fold that collapses the typographic spellings of a handful of
 * ASCII characters onto the ASCII form: curly quotes onto `'` and `"`, the dash
 * family onto `-`, `…` onto `...`, and the non-breaking/wide spaces onto a plain
 * space. Used only for **matching** — nothing here ever reaches a file.
 *
 * ## Why the document tools need it
 *
 * Quilltap's typography rules are a rendering opinion and live entirely in the
 * two render pipelines (`lib/markdown/typography.ts`); no tool, no export, and
 * no LLM-facing string is ever curled on its way past. That is the correct
 * arrangement and this module does not disturb it. The problem it solves comes
 * from the other direction: **models write curly punctuation of their own
 * accord.** A character's prose, a custom tool's answer, a pasted passage — any
 * of them can put `’` into a file, and `doc_write_file` stores exactly that,
 * as it should.
 *
 * The failure arrives one turn later, when a model that has just read the file
 * retypes a sentence from it into `doc_str_replace`'s `find` and — as models
 * routinely do — spells the apostrophe `'`. The bytes differ, the exact match
 * fails, and the tool tells the model its text is stale. It re-reads, produces
 * the same straight apostrophe, and fails identically. Bug 109 has five of
 * these on one instance, all in the same direction: the file curly, the find
 * straight.
 *
 * A fold is the right shape of answer because the difference is one of
 * *spelling*, not of meaning — the same argument the sibling
 * {@link module:lib/doc-edit/diacritics} fold already makes for `Nimuë` and
 * `Nimue`, whose machinery this composes with.
 *
 * ## What it deliberately leaves alone
 *
 * Zero-width and invisible characters (U+200B, U+00AD, U+FEFF) are **not**
 * folded. They are an encoding problem rather than a typographic one, a model
 * cannot see them in a read to reproduce them either way, and stripping them
 * would let a needle match across a boundary no reader would agree was there.
 * Guillemets (`«` `»`) are left alone for the opposite reason: they are their
 * own punctuation, not a spelling of `"`.
 *
 * @module lib/doc-edit/typographic-folding
 */

/**
 * The fold table, keyed by the single character being folded.
 *
 * Values may be any length — {@link foldTypographicChar}'s callers map result
 * positions back to source positions per character, so `…` → `...` (one to
 * three) is as legal as `’` → `'` (one to one).
 */
export const TYPOGRAPHIC_FOLDINGS: Readonly<Record<string, string>> = Object.freeze({
  // Single quotes and apostrophes
  '‘': "'", // ‘ left single quotation mark
  '’': "'", // ’ right single quotation mark (the apostrophe models write)
  '‚': "'", // ‚ single low-9 quotation mark
  '‛': "'", // ‛ single high-reversed-9 quotation mark
  '′': "'", // ′ prime
  'ʼ': "'", // ʼ modifier letter apostrophe

  // Double quotes
  '“': '"', // “ left double quotation mark
  '”': '"', // ” right double quotation mark
  '„': '"', // „ double low-9 quotation mark
  '‟': '"', // ‟ double high-reversed-9 quotation mark
  '″': '"', // ″ double prime

  // The dash family
  '‐': '-', // ‐ hyphen
  '‑': '-', // ‑ non-breaking hyphen
  '‒': '-', // ‒ figure dash
  '–': '-', // – en dash
  '—': '-', // — em dash
  '―': '-', // ― horizontal bar
  '−': '-', // − minus sign

  // Ellipsis — the one fold that is not one-to-one
  '…': '...', // …

  // Spaces that are not U+0020. Written as escapes deliberately: a literal
  // no-break space in source is indistinguishable from a plain one by eye, and
  // ESLint's no-irregular-whitespace rule is right to object to it.
  '\u00A0': ' ', // no-break space
  '\u2002': ' ', // en space
  '\u2003': ' ', // em space
  '\u2007': ' ', // figure space
  '\u2009': ' ', // thin space
  '\u202F': ' ', // narrow no-break space
});

/**
 * Fold one character. Returns the character unchanged when it is not in the
 * table, which is the overwhelmingly common case and must stay cheap — this
 * runs once per character of every haystack it is asked about.
 */
export function foldTypographicChar(char: string): string {
  return TYPOGRAPHIC_FOLDINGS[char] ?? char;
}

/**
 * Fold every character of `text`.
 *
 * Exported for tests and for callers that want the folded string itself; the
 * matcher in {@link module:lib/doc-edit/diacritics} does not use it, because it
 * must fold character-by-character to keep its position map honest.
 */
export function foldTypography(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    out += foldTypographicChar(text[i]);
  }
  return out;
}

/** True if `text` contains at least one character the fold would change. */
export function hasTypographicVariants(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (TYPOGRAPHIC_FOLDINGS[text[i]] !== undefined) return true;
  }
  return false;
}
