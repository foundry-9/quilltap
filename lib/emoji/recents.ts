/**
 * Recently-used emoji — Tier B (pure list arithmetic).
 *
 * The ADAPTER owns the `localStorage` calls; this file owns what the list
 * becomes. Storage key is `quilltap.emoji.recents.v1` — the SAME literal in v4
 * and v5, so a user moving between them on one origin keeps their list.
 *
 * Why not a server setting? Recents are high-frequency, low-value, single-device
 * state. A settings round-trip per emoji pick would be absurd, and a
 * `chat_settings` column would ride every backup and export for no benefit.
 *
 * @module lib/emoji/recents
 */

export const RECENTS_LIMIT = 24;

/** Shared verbatim with quilltap-v5. Changing it orphans every user's list. */
export const RECENTS_STORAGE_KEY = 'quilltap.emoji.recents.v1';

/** Move-to-front, dedupe, cap at `RECENTS_LIMIT`. Never mutates `current`. */
export function pushRecent(current: string[], char: string): string[] {
  if (!char) return current.slice(0, RECENTS_LIMIT);
  return [char, ...current.filter((existing) => existing !== char)].slice(0, RECENTS_LIMIT);
}

/**
 * Tolerant of junk and NEVER throws: this reads whatever happens to be sitting
 * in `localStorage`, which is user-writable, shared with other tabs, and may
 * predate any shape we ship. Anything unrecognised degrades to an empty list.
 */
export function parseRecents(raw: string | null): string[] {
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of parsed) {
    if (typeof item !== 'string' || item.length === 0) continue;
    if (seen.has(item)) continue;
    seen.add(item);
    result.push(item);
    if (result.length >= RECENTS_LIMIT) break;
  }
  return result;
}

export function serializeRecents(list: string[]): string {
  return JSON.stringify(list.slice(0, RECENTS_LIMIT));
}
