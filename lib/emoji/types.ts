/**
 * Emoji engine types — Tier B (pure logic).
 *
 * ⚠ PORTABILITY: this file, and every other file in `lib/emoji/`, imports
 * NOTHING — no React, no Lexical, no Next, no TanStack, not even a repo helper.
 * quilltap-v5 copies this directory near-verbatim into its Angular/ProseMirror
 * editor, and an ESLint `no-restricted-imports` override on `lib/emoji/**`
 * enforces it. See `docs/developer/features/complete/composer-emoji.md`
 * → Portability contract.
 *
 * @module lib/emoji/types
 */

/** One base emoji. Skin-tone variants and component modifiers are not in the set. */
export interface EmojiEntry {
  /** The literal character to insert (fully qualified, so it renders as emoji). */
  char: string;
  /** CLDR label, lowercased — also the accessible name for screen readers. */
  name: string;
  /** Shortcodes without colons, lowercased (github preset). */
  shortcodes: string[];
  /** CLDR keywords, lowercased. */
  keywords: string[];
  /** Group slug, e.g. `smileys-emotion`. */
  group: string;
  /** CLDR presentation order — emojibase's own, globally unique. */
  order: number;
}

/**
 * Search-time projection of an entry. Built once by `buildIndex` so the per
 * keystroke path never re-normalizes 1,900 rows.
 */
export interface NormalizedEmojiEntry {
  entry: EmojiEntry;
  /** Normalized name (see `normalizeQuery`). */
  name: string;
  /** Normalized name, split on spaces — powers the word-start bucket. */
  nameWords: string[];
  /** Normalized shortcodes. */
  shortcodes: string[];
  /** Normalized keywords. */
  keywords: string[];
  /** Index of `entry.group` in `EmojiIndex.groups` — the group's display order. */
  groupOrder: number;
}

export interface EmojiIndex {
  /** Dataset version. Mirrors the `v1` in the asset's filename. */
  version: number;
  /**
   * Every entry, pre-sorted by `(groupOrder, order)` — i.e. Unicode's own
   * presentation order. The empty-query result is a prefix of this array.
   */
  entries: EmojiEntry[];
  /** Parallel to `entries`, same order. */
  normalized: NormalizedEmojiEntry[];
  /** Normalized shortcode -> entry, for exact `:name:` commits. */
  byShortcode: Map<string, EmojiEntry>;
  /** Group slugs in display order; the array index IS the group's order. */
  groups: string[];
}

/** A live `:query` trigger in the text before the cursor. */
export interface EmojiTriggerMatch {
  /** Offset of the `:` within the supplied text. */
  start: number;
  /** Offset one past the last query character (excludes any closing `:`). */
  end: number;
  /** The query text, colon excluded, lowercased. */
  query: string;
  /** True when the user typed the closing `:` — commit an exact match immediately. */
  closed: boolean;
}

/** Thrown by `buildIndex` when the dataset payload is not the shape we ship. */
export class EmojiIndexError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmojiIndexError';
  }
}
