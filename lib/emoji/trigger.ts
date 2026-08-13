/**
 * Emoji trigger detection — Tier B (pure logic).
 *
 * Decides where a `:query` trigger starts and ends. This is the whole reason the
 * typeahead does not fire on `http://`, `10:30`, `a:b`, `C:\Users`, or `:)`.
 *
 * Pinned by `fixtures/emoji-trigger-vectors.json`, copied verbatim into
 * quilltap-v5. No imports.
 *
 * @module lib/emoji/trigger
 */

import type { EmojiTriggerMatch } from './types';

/** Menu stays shut below this. `:` and `:a` are inert; `:)` and `:-)` never open one. */
export const MIN_QUERY_LENGTH = 2;

/** Beyond this the match is abandoned — pasted text must not hold a menu open. */
export const MAX_QUERY_LENGTH = 32;

/**
 * Characters that may sit immediately before the opening `:` (in addition to any
 * whitespace). Everything else — a letter, a digit, `/` — means the colon is
 * punctuation in someone else's construct, not an emoji trigger.
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
 * Query alphabet: `[a-z0-9_+-]`, case-insensitively. Space is deliberately
 * EXCLUDED — `: ` cancels. That forbids searching multi-word names from the
 * inline trigger (the picker's job), and it is the difference between a menu
 * that opens when you want it and one that opens when you type a time.
 */
function isQueryChar(ch: string): boolean {
  return /[a-z0-9_+-]/i.test(ch);
}

/**
 * True when `ch` may sit immediately before the opening `:`.
 *
 * Exported because the ADAPTER needs the same rule: an editor hands us the text
 * of one inline run, so a colon at offset 0 might still be glued to the end of a
 * preceding run (`**bold**:smi`). The adapter checks the previous sibling's last
 * character with this predicate rather than re-deriving the rule and drifting.
 */
export function isTriggerOpenerContext(ch: string): boolean {
  return /\s/.test(ch) || OPENER_CHARS.has(ch);
}

/**
 * Find the active emoji trigger in `textBefore` — the text of the current block
 * up to the cursor. Returns null when there is nothing to act on.
 */
export function findEmojiTrigger(textBefore: string): EmojiTriggerMatch | null {
  let end = textBefore.length;
  let closed = false;

  // A trailing ':' is the CLOSING colon of `:smile:`, not the opener. Step over
  // it so the query scan below sees `smile`, and remember to commit on it.
  if (end > 0 && textBefore[end - 1] === ':') {
    closed = true;
    end -= 1;
  }

  // Walk back over the query alphabet. The first disallowed character closes the
  // match, so only the NEAREST colon is ever a candidate.
  let cursor = end;
  while (cursor > 0 && isQueryChar(textBefore[cursor - 1])) cursor -= 1;

  // No room for the opening ':' before the query.
  if (cursor === 0) return null;
  if (textBefore[cursor - 1] !== ':') return null;

  const start = cursor - 1;
  const query = textBefore.slice(cursor, end);

  if (query.length < MIN_QUERY_LENGTH || query.length > MAX_QUERY_LENGTH) return null;

  // The colon must open a word: block start, whitespace, or an opening bracket
  // or quote. This is what stops `http://`, `10:30` and every Windows path.
  if (start > 0 && !isTriggerOpenerContext(textBefore[start - 1])) return null;

  return { start, end, query: query.toLowerCase(), closed };
}
