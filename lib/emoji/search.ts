/**
 * Emoji search — Tier B (pure logic).
 *
 * The single source of match order for BOTH surfaces (the `:` typeahead and the
 * toolbar picker), so the two can never diverge. Deterministic, no I/O, no
 * imports outside this directory.
 *
 * Pinned by `fixtures/emoji-search-vectors.json`, which quilltap-v5 copies
 * verbatim. If a port disagrees with the corpus, fix the port, not the vectors.
 *
 * @module lib/emoji/search
 */

import { EmojiIndexError } from './types';
import type { EmojiEntry, EmojiIndex, NormalizedEmojiEntry } from './types';

/**
 * Lowercase, collapse whitespace, and fold `-`/`_` to a single space. Applied to
 * BOTH the query and every indexed field, so `:thumbs_up`, `:thumbs-up` and
 * `thumbs up` all land on the same text.
 */
export function normalizeQuery(value: string): string {
  return value.toLowerCase().replace(/[-_\s]+/g, ' ').trim();
}

/**
 * Match buckets, best first. The numeric value IS the sort key — lower wins.
 * These seven steps are the documented ranking and the corpus pins them.
 *
 * A plain const object rather than an `enum`: the repo compiles with
 * `isolatedModules`, which bans `const enum`, and a bare object ports to v5
 * without a TypeScript-ism to translate.
 */
const Bucket = {
  ShortcodeExact: 0,
  ShortcodePrefix: 1,
  NamePrefix: 2,
  NameWordStart: 3,
  KeywordExact: 4,
  KeywordPrefix: 5,
  NameSubstring: 6,
  NoMatch: 7,
} as const;

type Bucket = (typeof Bucket)[keyof typeof Bucket];

interface RawEntry {
  c: unknown;
  n: unknown;
  s: unknown;
  k: unknown;
  g: unknown;
  o: unknown;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/**
 * Validate and index the raw dataset payload.
 *
 * Throws `EmojiIndexError` on anything malformed rather than producing a
 * half-built index — a partly-populated index would silently return wrong
 * results forever, which is far worse than a feature that stays shut.
 */
export function buildIndex(raw: unknown): EmojiIndex {
  if (typeof raw !== 'object' || raw === null) {
    throw new EmojiIndexError('Emoji dataset is not an object');
  }

  const payload = raw as { version?: unknown; groups?: unknown; emoji?: unknown };

  if (typeof payload.version !== 'number') {
    throw new EmojiIndexError('Emoji dataset is missing a numeric `version`');
  }
  if (!isStringArray(payload.groups) || payload.groups.length === 0) {
    throw new EmojiIndexError('Emoji dataset is missing a non-empty `groups` array');
  }
  if (!Array.isArray(payload.emoji) || payload.emoji.length === 0) {
    throw new EmojiIndexError('Emoji dataset is missing a non-empty `emoji` array');
  }

  const groups = payload.groups;
  const groupOrderBySlug = new Map<string, number>(groups.map((slug, i) => [slug, i]));

  const normalized: NormalizedEmojiEntry[] = payload.emoji.map((row, i) => {
    if (typeof row !== 'object' || row === null) {
      throw new EmojiIndexError(`Emoji entry ${i} is not an object`);
    }
    const { c, n, s, k, g, o } = row as RawEntry;

    if (typeof c !== 'string' || c.length === 0) {
      throw new EmojiIndexError(`Emoji entry ${i} has no character`);
    }
    if (typeof n !== 'string' || n.length === 0) {
      throw new EmojiIndexError(`Emoji entry ${i} (${c}) has no name`);
    }
    if (!isStringArray(s)) {
      throw new EmojiIndexError(`Emoji entry ${i} (${c}) has malformed shortcodes`);
    }
    if (!isStringArray(k)) {
      throw new EmojiIndexError(`Emoji entry ${i} (${c}) has malformed keywords`);
    }
    if (typeof g !== 'string') {
      throw new EmojiIndexError(`Emoji entry ${i} (${c}) has no group`);
    }
    if (typeof o !== 'number') {
      throw new EmojiIndexError(`Emoji entry ${i} (${c}) has no numeric order`);
    }

    const groupOrder = groupOrderBySlug.get(g);
    if (groupOrder === undefined) {
      throw new EmojiIndexError(`Emoji entry ${i} (${c}) is in unknown group "${g}"`);
    }

    const entry: EmojiEntry = {
      char: c,
      name: n,
      shortcodes: s,
      keywords: k,
      group: g,
      order: o,
    };
    const normalizedName = normalizeQuery(n);

    return {
      entry,
      name: normalizedName,
      nameWords: normalizedName.split(' ').filter(Boolean),
      shortcodes: s.map(normalizeQuery).filter(Boolean),
      keywords: k.map(normalizeQuery).filter(Boolean),
      groupOrder,
    };
  });

  // Presentation order — Unicode's own. Every consumer downstream (the empty
  // query, the picker grid, the tie-break inside a ranking bucket) reads this
  // order, so establish it exactly once, here.
  normalized.sort(comparePresentation);

  const byShortcode = new Map<string, EmojiEntry>();
  for (const candidate of normalized) {
    for (const shortcode of candidate.shortcodes) {
      // First writer wins: shortcodes are unique in the dataset, and a
      // duplicate must resolve the same way on every run.
      if (!byShortcode.has(shortcode)) byShortcode.set(shortcode, candidate.entry);
    }
  }

  return {
    version: payload.version,
    entries: normalized.map((candidate) => candidate.entry),
    normalized,
    byShortcode,
    groups,
  };
}

function comparePresentation(a: NormalizedEmojiEntry, b: NormalizedEmojiEntry): number {
  if (a.groupOrder !== b.groupOrder) return a.groupOrder - b.groupOrder;
  return a.entry.order - b.entry.order;
}

/** The seven-step ranking, collapsed to the best bucket this entry reaches. */
function bucketFor(candidate: NormalizedEmojiEntry, query: string): Bucket {
  for (const shortcode of candidate.shortcodes) {
    if (shortcode === query) return Bucket.ShortcodeExact;
  }
  for (const shortcode of candidate.shortcodes) {
    if (shortcode.startsWith(query)) return Bucket.ShortcodePrefix;
  }
  if (candidate.name.startsWith(query)) return Bucket.NamePrefix;
  for (const word of candidate.nameWords) {
    if (word.startsWith(query)) return Bucket.NameWordStart;
  }
  for (const keyword of candidate.keywords) {
    if (keyword === query) return Bucket.KeywordExact;
  }
  for (const keyword of candidate.keywords) {
    if (keyword.startsWith(query)) return Bucket.KeywordPrefix;
  }
  if (candidate.name.includes(query)) return Bucket.NameSubstring;
  return Bucket.NoMatch;
}

/**
 * Pure. Deterministic. No I/O. The single source of match order.
 *
 * An empty query returns the first `limit` entries in presentation order — that
 * is exactly what the picker's initial grid shows.
 *
 * SORT STABILITY: `Array.prototype.sort` has been required to be stable since
 * ES2019, but this comparator does not lean on that — it is TOTAL, breaking
 * every tie by `(bucket, groupOrder, entry order)`, which is unique across the
 * dataset. Two runs, two engines, and the v5 port therefore cannot disagree.
 * Do not "simplify" it back to comparing bucket alone.
 */
export function searchEmoji(index: EmojiIndex, query: string, limit: number): EmojiEntry[] {
  if (limit <= 0) return [];

  const normalizedQuery = normalizeQuery(query);
  if (normalizedQuery.length === 0) {
    return index.entries.slice(0, limit);
  }

  const matches: { candidate: NormalizedEmojiEntry; bucket: Bucket }[] = [];
  for (const candidate of index.normalized) {
    const bucket = bucketFor(candidate, normalizedQuery);
    if (bucket !== Bucket.NoMatch) matches.push({ candidate, bucket });
  }

  matches.sort((a, b) => {
    if (a.bucket !== b.bucket) return a.bucket - b.bucket;
    return comparePresentation(a.candidate, b.candidate);
  });

  return matches.slice(0, limit).map((match) => match.candidate.entry);
}

/**
 * Resolve an exact shortcode, for the closing-`:` commit path. Returns null when
 * the query is not a shortcode — in which case the caller leaves the literal
 * text alone rather than guessing.
 */
export function findByShortcode(index: EmojiIndex, query: string): EmojiEntry | null {
  return index.byShortcode.get(normalizeQuery(query)) ?? null;
}
