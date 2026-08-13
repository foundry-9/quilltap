/**
 * "Is the cursor inside a math span?" — Tier B (pure string work).
 *
 * ### Why this exists
 *
 * Quilltap ships KaTeX. `$$\phi$$` is LaTeX that KaTeX renders; substituting φ
 * into the source would BREAK the math. A `\` typeahead firing inside math is
 * the single most likely way the Unicode feature annoys the person who most
 * wants it, so the Unicode trigger bails whenever this returns true.
 *
 * ### What counts as math
 *
 * Mirrors `lib/markdown/math.ts`, which is the authority on what Quilltap
 * actually renders — read it before touching this file. In particular
 * `REMARK_MATH_OPTIONS` sets `singleDollarTextMath: false`, but
 * `normalizeMathDelimiters` PROMOTES single-`$` spans and rewrites `\(…\)` /
 * `\[…\]` into `$$` form before the parser ever sees them. So all four
 * delimiter styles are math by the time it matters here.
 *
 * ### Where it deliberately differs
 *
 * `math.ts` decides whether a CLOSED span should be promoted. This decides
 * whether an UNCLOSED one is being typed, which is a weaker question, so the
 * single-`$` rule is coarser: a `$` opens math unless the next character is
 * whitespace or an ASCII digit — the currency shape (`$5`, `$1,000`) that
 * single-dollar parsing was disabled to protect. `costs $5 and \ph` therefore
 * still opens a menu, which is the case the corpus pins.
 *
 * The bias is deliberate: a false positive costs a writer one menu that did not
 * open, and a false negative costs them a formula that silently stopped
 * rendering. Prefer the former.
 *
 * No imports. Pinned by `fixtures/unicode-trigger-vectors.json`.
 *
 * @module lib/char-insert/math-span
 */

/**
 * Count of unclosed `\(` (or `\[`) openers in `text`.
 *
 * Scans left to right so `\(a\) then \(b` reports one open span, not two.
 */
function hasUnclosedDelimiter(text: string, open: string, close: string): boolean {
  let depth = 0;
  let i = 0;
  while (i < text.length) {
    if (text.startsWith(open, i)) {
      depth += 1;
      i += open.length;
      continue;
    }
    if (text.startsWith(close, i)) {
      if (depth > 0) depth -= 1;
      i += close.length;
      continue;
    }
    i += 1;
  }
  return depth > 0;
}

/**
 * True when `textBefore` — the run of text preceding the cursor — leaves an
 * unterminated math span open.
 *
 * `$$` is consumed as a unit before single `$` is considered, so `$$x$$ costs $5`
 * is read as one closed display span followed by a currency amount, not as four
 * loose dollars.
 */
export function isInsideMathSpan(textBefore: string): boolean {
  let displayOpen = false;
  let inlineOpen = false;

  let i = 0;
  while (i < textBefore.length) {
    if (textBefore.startsWith('$$', i)) {
      // A `$$` inside an open single-`$` span closes nothing — but that shape
      // (`$a$$`) is malformed either way, so treat `$$` as authoritative and
      // reset the weaker state.
      displayOpen = !displayOpen;
      inlineOpen = false;
      i += 2;
      continue;
    }

    if (textBefore[i] === '$') {
      if (inlineOpen) {
        inlineOpen = false;
      } else if (!displayOpen) {
        const next = textBefore[i + 1];
        // Currency, not math: `$5`, `$ 5`, or a lone trailing `$`.
        const isCurrencyish = next === undefined || /[\s\d]/.test(next);
        inlineOpen = !isCurrencyish;
      }
      i += 1;
      continue;
    }

    i += 1;
  }

  if (displayOpen || inlineOpen) return true;

  return (
    hasUnclosedDelimiter(textBefore, '\\(', '\\)') ||
    hasUnclosedDelimiter(textBefore, '\\[', '\\]')
  );
}
