/**
 * Shared math-rendering configuration for markdown pipelines.
 *
 * Both renderers — the client (`components/chat/MessageContent.tsx`, via
 * react-markdown) and the server (`lib/services/markdown-renderer.service.ts`,
 * via unified) — must produce identical output, so everything either side
 * needs beyond the `remark-math`/`rehype-katex` plugins themselves lives here.
 *
 * Supported delimiters:
 * - `$$...$$` inline and block math (remark-math native)
 * - `\(...\)` inline and `\[...\]` display math (normalized to `$$` form
 *   below, because CommonMark consumes `\(` as a character escape before any
 *   parse-time plugin could see it)
 * - single-`$...$` inline math *when the content is unmistakably LaTeX* —
 *   heuristically promoted to `$$...$$` below (see `promoteSingleDollarMath`)
 *
 * Single-dollar inline math is DISABLED at the parser level: Quilltap chat is
 * full of ordinary prose where paired dollar amounts ("He slid $50 across the
 * table, then another $20") would otherwise be swallowed as garbled math. But
 * models ignore the system-prompt steering toward `$$...$$` and emit standard
 * single-`$` math constantly, so we recover the clearly-mathematical spans in
 * preprocessing while leaving currency prose alone.
 */

/**
 * Options passed to `remark-math` on both client and server. Kept in one place
 * so the two pipelines cannot drift. Single-dollar parsing stays off — the
 * clearly-LaTeX cases are promoted to `$$` in `normalizeMathDelimiters` before
 * the parser ever runs, so currency prose is never at the parser's mercy.
 */
export const REMARK_MATH_OPTIONS = { singleDollarTextMath: false } as const;

/**
 * Regions the delimiter normalizer must not touch: fenced code blocks, inline
 * code spans, and existing `$$` math (whose LaTeX may legitimately contain
 * `\[`-lookalikes such as `\\[3pt]` row spacing). Unterminated fences and `$$`
 * runs swallow the remainder of the string on purpose — during streaming a
 * region still being received is left alone rather than half-transformed.
 */
const MATH_SKIP_PATTERN = /(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]+`|\$\$[\s\S]*?(?:\$\$|$))/g;

/**
 * Markers that make a single-`$...$` span unmistakably LaTeX rather than a
 * dollar amount: a backslash-command (`\mathcal`, `\pi`, `\vec`), a
 * sub/superscript (`_`/`^`), or braces (`{}`). Currency ("$50", "$1,000.00")
 * and paired prose amounts ("$50 ... $20") contain none of these.
 */
const LATEX_MARKER = /\\[a-zA-Z]|[_^{}]/;

/**
 * A bare single-token span — a letter optionally trailed by one or two
 * alphanumerics (`$K$`, `$x$`, `$v0$`). It carries no LaTeX marker of its own,
 * so it is promoted only when a marker span keeps it company on the same line
 * (see `promoteLine`). Letter-anchored so a lone currency figure like `$5$`
 * never qualifies.
 */
const BARE_TOKEN = /^[A-Za-z][A-Za-z0-9]{0,2}$/;

/**
 * Apply `transform` to every plain region of `markdown`, leaving the protected
 * regions (fenced/inline code, existing `$$` math) byte-identical. Splitting on
 * a single capture group alternates plain segments (even indices) with
 * protected regions (odd indices).
 */
function mapPlainRegions(markdown: string, transform: (segment: string) => string): string {
  return markdown
    .split(MATH_SKIP_PATTERN)
    .map((part, index) => (index % 2 === 1 || part === undefined ? part : transform(part)))
    .join('');
}

/**
 * Promote single-dollar inline math (`$\mathcal{P}$`, `$T_{CMB}$`) to the
 * double-dollar form remark-math parses — but ONLY when the span's interior
 * carries a LaTeX marker (see `LATEX_MARKER`). A span whose content is plain
 * text — a currency amount, or the run of prose caught between two unrelated
 * dollar signs — fails the test and is returned untouched, so this recovers
 * models' habitual single-`$` formulas without reviving the dollar-amount
 * mangling that single-dollar parsing was disabled to avoid. Runs inside the
 * shared code/`$$`-region skip so it never reaches into code or real display
 * math. A bare single token with no marker (`$K$`) is promoted only when a
 * marker span shares its line; standing alone, it is left literal.
 */
function promoteSingleDollarMath(markdown: string): string {
  // Inline math never spans a newline, and the bare-token rule is scoped to a
  // single line, so each plain region is processed line by line (newlines are
  // preserved exactly by splitting and rejoining on `\n`).
  return mapPlainRegions(markdown, (segment) => segment.split('\n').map(promoteLine).join('\n'));
}

/**
 * Whether some `$...$` pair on this line carries a LaTeX marker. Uses the same
 * left-to-right pairing as `promoteLine` (a non-marker pair releases its
 * closing `$` to open the next candidate), so the answer matches how the line
 * will actually be paired.
 */
function lineHasMarkerPair(line: string): boolean {
  let i = 0;
  while (i < line.length) {
    const open = line.indexOf('$', i);
    if (open === -1) return false;
    const close = line.indexOf('$', open + 1);
    if (close === -1) return false;
    if (LATEX_MARKER.test(line.slice(open + 1, close))) return true;
    i = open + 1; // release the closing `$` to open the next candidate
  }
  return false;
}

/**
 * Promote single-dollar inline math on one line. Each `$` pairs with the
 * nearest following `$`; a pair is promoted to `$$...$$` when its interior
 * carries a LaTeX marker, OR when it is a bare token (`$K$`) and the line
 * *also* holds a marker span — so a symbol renders alongside the formula it
 * belongs with, while a bare token standing alone stays literal. A pair that
 * fails keeps its opening `$` literal and releases its closing `$` to open the
 * next candidate, so a leading currency amount ("The $50 fee scales as
 * $\pi r^2$") can't consume the real formula's opening delimiter.
 */
function promoteLine(line: string): string {
  if (line.indexOf('$') === -1) return line;
  const hasMarker = lineHasMarkerPair(line);

  let out = '';
  let i = 0;
  while (i < line.length) {
    const open = line.indexOf('$', i);
    if (open === -1) {
      out += line.slice(i);
      break;
    }
    const close = line.indexOf('$', open + 1);
    if (close === -1) {
      out += line.slice(i);
      break;
    }

    const inner = line.slice(open + 1, close);
    const accept =
      inner.length > 0 &&
      (LATEX_MARKER.test(inner) || (hasMarker && BARE_TOKEN.test(inner)));
    if (accept) {
      out += `${line.slice(i, open)}$$${inner}$$`;
      i = close + 1;
    } else {
      // Emit through the opening `$` and resume at the next char so a rejected
      // pair's closing `$` can re-open.
      out += line.slice(i, open + 1);
      i = open + 1;
    }
  }
  return out;
}

/**
 * Rewrite LaTeX-style `\(...\)` / `\[...\]` math delimiters to the `$$` forms
 * remark-math parses. LLMs emit the backslash forms constantly, but CommonMark
 * treats `\(` as an escaped parenthesis and strips the backslash during
 * parsing, so this rewrite must happen on the raw markdown string *before* the
 * parser runs.
 */
function rewriteBackslashDelimiters(markdown: string): string {
  return mapPlainRegions(markdown, (segment) =>
    segment
      // Display math becomes flow math on its own lines — `\[...\]` is
      // display-mode by definition, so promoting it out of a surrounding
      // paragraph is the correct rendering.
      .replace(/\\\[([\s\S]+?)\\\]/g, (_match, tex: string) => `\n$$\n${tex.trim()}\n$$\n`)
      .replace(/\\\(([\s\S]+?)\\\)/g, (_match, tex: string) => `$$${tex.trim()}$$`)
  );
}

/**
 * Normalize the math delimiters models emit into the `$$...$$` form remark-math
 * parses. Two independent passes, each guarded by a cheap substring check and
 * scoped to plain (non-code, non-`$$`) regions:
 *
 * 1. Promote clearly-LaTeX single-`$...$` spans to `$$...$$`
 *    (`promoteSingleDollarMath`) — runs first so the `$$` it produces becomes a
 *    protected region for pass 2.
 * 2. Rewrite `\(...\)` / `\[...\]` to `$$` (`rewriteBackslashDelimiters`).
 *
 * This is the first step of both renderers' preprocessing chains, ahead of
 * roleplay-bracket escaping (which would otherwise try to claim `\[...\]` as a
 * roleplay bracket span).
 */
export function normalizeMathDelimiters(markdown: string): string {
  let out = markdown;
  if (out.includes('$')) {
    out = promoteSingleDollarMath(out);
  }
  if (out.includes('\\(') || out.includes('\\[')) {
    out = rewriteBackslashDelimiters(out);
  }
  return out;
}
