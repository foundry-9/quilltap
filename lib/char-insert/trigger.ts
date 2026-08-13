/**
 * Trigger detection — Tier B (pure logic).
 *
 * Decides where an `<opener>query` trigger starts and ends. This is the whole
 * reason the emoji typeahead does not fire on `http://`, `10:30`, `a:b`,
 * `C:\Users` or `:)`, and the reason the Unicode typeahead does not fire on a
 * markdown escape.
 *
 * ### Why `\` does not collide with markdown escapes
 *
 * A markdown escape is a backslash followed by ASCII **punctuation** — `\*`,
 * `\_`, `\[`, `\\`. A backslash followed by a **letter** is never an escape; it
 * is literal text. The Unicode profile's query alphabet excludes punctuation
 * entirely, so the two syntaxes occupy disjoint space and `\*` can never open a
 * menu. This is not obvious and someone will worry about it; that is what this
 * paragraph is for.
 *
 * Pinned by `fixtures/{emoji,unicode}-trigger-vectors.json`, copied verbatim
 * into quilltap-v5. No imports.
 *
 * @module lib/char-insert/trigger
 */

import type { TriggerConfig, TriggerMatch } from './types';

/**
 * Characters that may sit immediately before the opener (in addition to any
 * whitespace). Everything else — a letter, a digit, `/` — means the opener is
 * punctuation in someone else's construct, not a trigger.
 */
const OPENER_CHARS = new Set([
  '(',
  '[',
  '{',
  '"',
  "'",
  '\u201C', // “
  '\u2018', // ‘
  '\u2014', // —
  '\u2013', // –
]);

/**
 * True when `ch` may sit immediately before the opener.
 *
 * Exported because the ADAPTER needs the same rule: an editor hands us the text
 * of one inline run, so an opener at offset 0 might still be glued to the end of
 * a preceding run (`**bold**:smi`). The adapter checks the previous sibling's
 * last character with this predicate rather than re-deriving the rule and
 * drifting.
 */
export function isTriggerOpenerContext(ch: string): boolean {
  return /\s/.test(ch) || OPENER_CHARS.has(ch);
}

/**
 * Find the active trigger in `textBefore` — the text of the current run up to
 * the cursor. Returns null when there is nothing to act on.
 *
 * `config.queryPattern` is tested one character at a time. It MUST NOT carry the
 * `g` or `y` flags: a stateful regex would make this function depend on how many
 * times it had previously been called, which is exactly the class of bug a pure
 * engine exists to rule out.
 */
export function findTrigger(textBefore: string, config: TriggerConfig): TriggerMatch | null {
  let end = textBefore.length;
  let closed = false;

  // A trailing closer is the CLOSING delimiter of `:smile:`, not an opener. Step
  // over it so the query scan below sees `smile`, and remember to commit on it.
  if (config.closer !== null && end > 0 && textBefore[end - 1] === config.closer) {
    closed = true;
    end -= 1;
  }

  // Walk back over the query alphabet. The first disallowed character closes the
  // match, so only the NEAREST opener is ever a candidate.
  let cursor = end;
  while (cursor > 0 && config.queryPattern.test(textBefore[cursor - 1])) cursor -= 1;

  // No room for the opener before the query.
  if (cursor === 0) return null;
  if (textBefore[cursor - 1] !== config.opener) return null;

  const start = cursor - 1;
  const query = textBefore.slice(cursor, end);

  if (query.length < config.minQueryLength || query.length > config.maxQueryLength) return null;
  if (config.queryStartPattern && !config.queryStartPattern.test(query[0])) return null;

  // The opener must open a word: run start, whitespace, or an opening bracket or
  // quote. This is what stops `http://`, `10:30` and every Windows path.
  if (start > 0 && !isTriggerOpenerContext(textBefore[start - 1])) return null;

  return { start, end, query: config.lowercaseQuery ? query.toLowerCase() : query, closed };
}
