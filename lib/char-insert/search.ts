/**
 * Character search — Tier B (pure logic).
 *
 * The single source of match order for BOTH surfaces of BOTH profiles (the `:`
 * and `\` typeaheads, and the two toolbar pickers), so none of the four can
 * diverge. Deterministic, no I/O, no imports outside this directory.
 *
 * Pinned by `fixtures/{emoji,unicode}-search-vectors.json`, which quilltap-v5
 * copies verbatim. If a port disagrees with a corpus, fix the port, not the
 * vectors.
 *
 * @module lib/char-insert/search
 */

import { CharIndexError } from './types';
import type { CharEntry, CharIndex, NormalizedCharEntry } from './types';

/**
 * Lowercase, collapse whitespace, and fold `-`/`_` to a single space. Applied to
 * BOTH the query and every indexed field, so `:thumbs_up`, `:thumbs-up` and
 * `thumbs up` all land on the same text.
 *
 * ⚠ This lowercases, which is why alias lookups that must distinguish `\phi`
 * from `\Phi` go through `byAliasExactCase` BEFORE they come here.
 */
export function normalizeQuery(value: string): string {
  return value.toLowerCase().replace(/[-_\s]+/g, ' ').trim();
}

/**
 * Match buckets, best first. The numeric value IS the sort key — lower wins.
 * These eight steps are the documented ranking and the corpora pin them.
 *
 * A plain const object rather than an `enum`: the repo compiles with
 * `isolatedModules`, which bans `const enum`, and a bare object ports to v5
 * without a TypeScript-ism to translate.
 *
 * `NameAllWords` was added by Layer 2.0u and is deliberately the WORST matching
 * bucket. `bucketFor` returns the best bucket an entry reaches, so an entry that
 * already matched keeps its old bucket and only entries that previously returned
 * `NoMatch` can newly appear — which is why the shipped emoji corpus stayed
 * green, unedited, across that change.
 */
const Bucket = {
  AliasExact: 0,
  AliasPrefix: 1,
  NamePrefix: 2,
  NameWordStart: 3,
  KeywordExact: 4,
  KeywordPrefix: 5,
  NameSubstring: 6,
  NameAllWords: 7,
  NoMatch: 8,
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
 * Both profiles ship the same `{version, groups, <rows>}` shape with the same
 * `{c, n, s, k, g, o}` columns, so this reads either without a branch. The row
 * array is called `entries` in the Unicode dataset and `emoji` in the emoji one
 * — the latter shipped first and its bytes are frozen (quilltap-v5 serves a
 * byte-identical copy), so both keys are accepted here rather than rewriting an
 * asset two apps agree on.
 *
 * Throws `CharIndexError` on anything malformed rather than producing a
 * half-built index — a partly-populated index would silently return wrong
 * results forever, which is far worse than a feature that stays shut.
 */
export function buildIndex(raw: unknown): CharIndex {
  if (typeof raw !== 'object' || raw === null) {
    throw new CharIndexError('Character dataset is not an object');
  }

  const payload = raw as { version?: unknown; groups?: unknown; entries?: unknown; emoji?: unknown };

  if (typeof payload.version !== 'number') {
    throw new CharIndexError('Character dataset is missing a numeric `version`');
  }
  if (!isStringArray(payload.groups) || payload.groups.length === 0) {
    throw new CharIndexError('Character dataset is missing a non-empty `groups` array');
  }

  const rows = payload.entries ?? payload.emoji;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new CharIndexError('Character dataset is missing a non-empty `entries` array');
  }

  const groups = payload.groups;
  const groupOrderBySlug = new Map<string, number>(groups.map((slug, i) => [slug, i]));

  const normalized: NormalizedCharEntry[] = rows.map((row, i) => {
    if (typeof row !== 'object' || row === null) {
      throw new CharIndexError(`Character entry ${i} is not an object`);
    }
    const { c, n, s, k, g, o } = row as RawEntry;

    if (typeof c !== 'string' || c.length === 0) {
      throw new CharIndexError(`Character entry ${i} has no character`);
    }
    if (typeof n !== 'string' || n.length === 0) {
      throw new CharIndexError(`Character entry ${i} (${c}) has no name`);
    }
    if (!isStringArray(s)) {
      throw new CharIndexError(`Character entry ${i} (${c}) has malformed aliases`);
    }
    if (!isStringArray(k)) {
      throw new CharIndexError(`Character entry ${i} (${c}) has malformed keywords`);
    }
    if (typeof g !== 'string') {
      throw new CharIndexError(`Character entry ${i} (${c}) has no group`);
    }
    if (typeof o !== 'number') {
      throw new CharIndexError(`Character entry ${i} (${c}) has no numeric order`);
    }

    const groupOrder = groupOrderBySlug.get(g);
    if (groupOrder === undefined) {
      throw new CharIndexError(`Character entry ${i} (${c}) is in unknown group "${g}"`);
    }

    const entry: CharEntry = {
      char: c,
      name: n,
      aliases: s,
      keywords: k,
      group: g,
      order: o,
    };
    const normalizedName = normalizeQuery(n);

    return {
      entry,
      name: normalizedName,
      nameWords: normalizedName.split(' ').filter(Boolean),
      aliases: s.map(normalizeQuery).filter(Boolean),
      keywords: k.map(normalizeQuery).filter(Boolean),
      groupOrder,
    };
  });

  // Presentation order — the dataset's own. Every consumer downstream (the empty
  // query, the picker grid, the tie-break inside a ranking bucket) reads this
  // order, so establish it exactly once, here.
  normalized.sort(comparePresentation);

  const byAlias = new Map<string, CharEntry>();
  const byAliasExactCase = new Map<string, CharEntry>();
  for (const candidate of normalized) {
    for (const alias of candidate.aliases) {
      // First writer wins: a duplicate alias must resolve the same way on every
      // run, and presentation order is the only stable rule available.
      if (!byAlias.has(alias)) byAlias.set(alias, candidate.entry);
    }
    for (const alias of candidate.entry.aliases) {
      if (!byAliasExactCase.has(alias)) byAliasExactCase.set(alias, candidate.entry);
    }
  }

  return {
    version: payload.version,
    entries: normalized.map((candidate) => candidate.entry),
    normalized,
    byAlias,
    byAliasExactCase,
    groups,
  };
}

function comparePresentation(a: NormalizedCharEntry, b: NormalizedCharEntry): number {
  if (a.groupOrder !== b.groupOrder) return a.groupOrder - b.groupOrder;
  return a.entry.order - b.entry.order;
}

/**
 * Every query token prefix-matches a DISTINCT name word.
 *
 * Assignment is greedy, left to right: each token claims the first not-yet-taken
 * word it prefixes. That is deterministic (so a port cannot disagree) and it is
 * not the same as a maximum matching — `right right` against `rightwards arrow`
 * fails, because the first `right` takes the only word the second could use.
 * The corpus pins that case; do not "improve" it into a backtracking matcher
 * without regenerating both corpora.
 */
function matchesAllWords(nameWords: string[], tokens: string[]): boolean {
  const taken = new Array<boolean>(nameWords.length).fill(false);

  for (const token of tokens) {
    let claimed = false;
    for (let i = 0; i < nameWords.length; i += 1) {
      if (taken[i]) continue;
      if (!nameWords[i].startsWith(token)) continue;
      taken[i] = true;
      claimed = true;
      break;
    }
    if (!claimed) return false;
  }
  return true;
}

/** The eight-step ranking, collapsed to the best bucket this entry reaches. */
function bucketFor(candidate: NormalizedCharEntry, query: string, tokens: string[]): Bucket {
  for (const alias of candidate.aliases) {
    if (alias === query) return Bucket.AliasExact;
  }
  for (const alias of candidate.aliases) {
    if (alias.startsWith(query)) return Bucket.AliasPrefix;
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
  // Non-adjacent query words — `right arrow` reaching RIGHTWARDS ARROW, `greek
  // phi` reaching GREEK SMALL LETTER PHI. Unicode's taxonomy interpolates words
  // in a way emoji shortcodes never do, so this bucket is what makes a
  // description search usable on the Unicode profile.
  if (tokens.length > 1 && matchesAllWords(candidate.nameWords, tokens)) {
    return Bucket.NameAllWords;
  }
  return Bucket.NoMatch;
}

/**
 * Pure. Deterministic. No I/O. The single source of match order.
 *
 * An empty query returns the first `limit` entries in presentation order — that
 * is exactly what a picker's initial grid shows.
 *
 * SORT STABILITY: `Array.prototype.sort` has been required to be stable since
 * ES2019, but this comparator does not lean on that — it is TOTAL, breaking
 * every tie by `(bucket, groupOrder, entry order)`, which is unique across each
 * dataset. Two runs, two engines, and the v5 port therefore cannot disagree.
 * Do not "simplify" it back to comparing bucket alone.
 */
export function searchChars(index: CharIndex, query: string, limit: number): CharEntry[] {
  if (limit <= 0) return [];

  const normalizedQuery = normalizeQuery(query);
  if (normalizedQuery.length === 0) {
    return index.entries.slice(0, limit);
  }

  const tokens = normalizedQuery.split(' ').filter(Boolean);

  const matches: { candidate: NormalizedCharEntry; bucket: Bucket }[] = [];
  for (const candidate of index.normalized) {
    const bucket = bucketFor(candidate, normalizedQuery, tokens);
    if (bucket !== Bucket.NoMatch) matches.push({ candidate, bucket });
  }

  matches.sort((a, b) => {
    if (a.bucket !== b.bucket) return a.bucket - b.bucket;
    return comparePresentation(a.candidate, b.candidate);
  });

  return matches.slice(0, limit).map((match) => match.candidate.entry);
}

/**
 * Resolve an exact alias, for the menu-free commit path (emoji's closing `:`,
 * Unicode's trailing space). Returns null when the query is not an alias — in
 * which case the caller leaves the literal text alone rather than guessing.
 *
 * `caseSensitive` consults the raw-case map FIRST and only then falls back to
 * the normalized one. That ordering is the whole point: `\phi` and `\Phi` are
 * different characters, but `\PHI` should still find *something* rather than
 * nothing. Emoji passes `false` and is unaffected.
 */
export function findByAlias(
  index: CharIndex,
  query: string,
  options?: { caseSensitive?: boolean },
): CharEntry | null {
  if (options?.caseSensitive) {
    const exact = index.byAliasExactCase.get(query);
    if (exact) return exact;
  }
  return index.byAlias.get(normalizeQuery(query)) ?? null;
}

/**
 * `U+XXXX` direct entry — `u2192`, `u+2192`, `u{1D538}`, in any case.
 *
 * Resolved arithmetically, with NO table lookup, so every assigned character is
 * reachable including the ~151,000 the curation dropped. When the index happens
 * to know the character, its row is returned so the menu can show the real name;
 * otherwise a bare synthetic entry is returned and the menu shows the code point.
 *
 * Returns null for anything out of range or in the surrogate gap — a lone
 * surrogate in a document is a mojibake generator.
 */
export function findByCodePoint(index: CharIndex | null, query: string): CharEntry | null {
  const match = /^u\+?\{?([0-9a-f]{4,6})\}?$/i.exec(query);
  if (!match) return null;

  const codePoint = Number.parseInt(match[1], 16);
  if (!Number.isFinite(codePoint)) return null;
  if (codePoint > 0x10ffff) return null;
  if (codePoint >= 0xd800 && codePoint <= 0xdfff) return null;

  const char = String.fromCodePoint(codePoint);
  const hex = codePoint.toString(16).toUpperCase().padStart(4, '0');

  if (index) {
    const known = index.entries.find((entry) => entry.char === char);
    if (known) return known;
  }

  return {
    char,
    name: `u+${hex}`,
    aliases: [],
    keywords: [],
    // Not in any real group. Consumers that need a group order treat an unknown
    // slug as "last", and this entry never enters a sorted result set anyway —
    // it is resolved directly, never ranked.
    group: '',
    order: codePoint,
  };
}
