/**
 * char-index-output.ts
 *
 * The shared build tail of the two character-index generators
 * (`generate-emoji-index.ts`, `generate-unicode-index.ts`): presentation-order
 * sort, the two refusals (empty index, duplicate characters), and the
 * mkdir-and-write. Both datasets are COMMITTED and versioned in their filename,
 * so this file changing the bytes it writes is a `v2` event — see the header
 * of either generator.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/** The shape both indexes share; the picker's search comparator reads `g`/`o`. */
export interface CharIndexEntry {
  /** The character. */
  c: string;
  /** Group slug — index into the top-level `groups` array. */
  g: string;
  /** Presentation order within the group. */
  o: number;
}

export interface CharIndexRefusals {
  /** Thrown when there is nothing to write. */
  empty: string;
  /** Thrown when `count` entries share a character with an earlier one. */
  duplicates: (count: number) => string;
}

/**
 * Sort `entries` in place into presentation order — group order first (the
 * index of `g` in `groups`), then `o` — so the picker's grid and the
 * empty-query result are correct even before the index applies its own
 * comparator. Then refuse to proceed on an empty set or a duplicated
 * character. Returns the same array for chaining.
 */
export function finalizeCharIndexEntries<T extends CharIndexEntry>(
  entries: T[],
  groups: readonly string[],
  refusals: CharIndexRefusals,
): T[] {
  entries.sort((a, b) => {
    const groupDelta = groups.indexOf(a.g) - groups.indexOf(b.g);
    return groupDelta !== 0 ? groupDelta : a.o - b.o;
  });

  if (entries.length === 0) {
    throw new Error(refusals.empty);
  }

  const duplicateChars = entries.length - new Set(entries.map((entry) => entry.c)).size;
  if (duplicateChars > 0) {
    throw new Error(refusals.duplicates(duplicateChars));
  }

  return entries;
}

/** Write `payload` as compact JSON to `outPath`, creating its directory. */
export function writeCharIndex(outPath: string, payload: unknown): void {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(payload), 'utf8');
}
