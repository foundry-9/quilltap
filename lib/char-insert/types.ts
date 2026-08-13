/**
 * Character-insertion engine types — Tier B (pure logic).
 *
 * ⚠ PORTABILITY: this file, and every other file in `lib/char-insert/`, imports
 * NOTHING — no React, no Lexical, no Next, no TanStack, not even a repo helper.
 * quilltap-v5 copies this directory near-verbatim into its Angular/ProseMirror
 * editor, and an ESLint `no-restricted-imports` override on `lib/char-insert/**`
 * enforces it. See `docs/developer/features/complete/composer-emoji.md`
 * → Portability contract, and `complete/composer-unicode.md` → the refactor.
 *
 * ONE engine, TWO dataset profiles: emoji (`:` trigger) and Unicode (`\`
 * trigger). Nothing here knows which one it is serving — the differences live
 * entirely in `profiles/`.
 *
 * @module lib/char-insert/types
 */

/** One insertable character. */
export interface CharEntry {
  /** The literal character to insert (fully qualified, so emoji render as emoji). */
  char: string;
  /** Human label, lowercased — also the accessible name for screen readers. */
  name: string;
  /**
   * Short names without their sigil, in the dataset's own casing.
   *
   * Emoji: github shortcodes (`smile`), always lowercase.
   * Unicode: LaTeX/Julia commands without the backslash (`to`, `phi`, `Phi`) —
   * **case-significant**, which is why `CharIndex` carries a second, exact-case
   * map. See `findByAlias`.
   */
  aliases: string[];
  /** Extra search terms, lowercased. Empty for the Unicode profile. */
  keywords: string[];
  /** Group slug — emoji category, or Unicode block. */
  group: string;
  /** Presentation order within the dataset. Emoji: CLDR order. Unicode: code point. */
  order: number;
}

/**
 * Search-time projection of an entry. Built once by `buildIndex` so the per
 * keystroke path never re-normalizes thousands of rows.
 */
export interface NormalizedCharEntry {
  entry: CharEntry;
  /** Normalized name (see `normalizeQuery`). */
  name: string;
  /** Normalized name, split on spaces — powers the word-start and all-words buckets. */
  nameWords: string[];
  /** Normalized aliases. */
  aliases: string[];
  /** Normalized keywords. */
  keywords: string[];
  /** Index of `entry.group` in `CharIndex.groups` — the group's display order. */
  groupOrder: number;
}

export interface CharIndex {
  /** Dataset version. Mirrors the `v1` in the asset's filename. */
  version: number;
  /**
   * Every entry, pre-sorted by `(groupOrder, order)` — i.e. the dataset's own
   * presentation order. The empty-query result is a prefix of this array.
   */
  entries: CharEntry[];
  /** Parallel to `entries`, same order. */
  normalized: NormalizedCharEntry[];
  /** NORMALIZED alias -> entry, for case-insensitive exact commits. */
  byAlias: Map<string, CharEntry>;
  /**
   * RAW alias -> entry, preserving the dataset's casing.
   *
   * `\phi` is φ and `\Phi` is Φ; `normalizeQuery` lowercases, so the normalized
   * map alone cannot tell them apart. A profile that declares
   * `caseSensitiveAliases` consults this map first.
   */
  byAliasExactCase: Map<string, CharEntry>;
  /** Group slugs in display order; the array index IS the group's order. */
  groups: string[];
}

/** A live trigger in the text before the cursor. */
export interface TriggerMatch {
  /** Offset of the opener within the supplied text. */
  start: number;
  /** Offset one past the last query character (excludes any closer). */
  end: number;
  /** The query text, opener and closer excluded. Lowercased only if the profile asks. */
  query: string;
  /** True when the user typed the closer — commit an exact match immediately. */
  closed: boolean;
}

/**
 * Everything `findTrigger` needs in order to be profile-agnostic. Emoji and
 * Unicode differ ONLY in these six fields.
 */
export interface TriggerConfig {
  /** The single character that opens a query: `':'` or `'\\'`. */
  opener: string;
  /**
   * Query alphabet, tested one character at a time. Space is excluded in both
   * profiles — a space cancels the trigger, which is what stops `10:30` and
   * keeps multi-word search the picker's job.
   */
  queryPattern: RegExp;
  /**
   * Optional extra constraint on the FIRST query character.
   *
   * The Unicode profile sets `/[A-Za-z]/` so that `\` can never claim a markdown
   * escape: an escape is a backslash plus ASCII punctuation, so demanding a
   * letter puts the two syntaxes in disjoint space. Emoji omits it.
   */
  queryStartPattern?: RegExp;
  /** Menu stays shut below this many query characters. */
  minQueryLength: number;
  /** Beyond this the match is abandoned — pasted text must not hold a menu open. */
  maxQueryLength: number;
  /** Character that closes a query and commits an exact alias: `':'` for emoji, `null` for Unicode. */
  closer: string | null;
  /**
   * Whether `query` is lowercased before it leaves this module.
   *
   * Emoji: true — shortcodes are lowercase by construction and the corpus pins
   * a lowercased query. Unicode: false — `\Phi` must survive as `Phi` or the
   * case-sensitive alias lookup has nothing to work with.
   */
  lowercaseQuery: boolean;
}

/**
 * The keystroke that commits an exact alias WITHOUT the menu — emoji's closing
 * `:` and Unicode's trailing space, which are the same idea with different
 * punctuation.
 */
export interface CommitKeyConfig {
  /** `KeyboardEvent.key` to intercept: `':'` or `' '`. */
  key: string;
  /** Appended to the pre-cursor text before asking `findTrigger` — `':'` for emoji, `''` for Unicode. */
  probeSuffix: string;
  /** Whether the resulting match must report `closed`. */
  requireClosed: boolean;
  /** Appended to the inserted character — `''` for emoji, `' '` for Unicode (the space the user typed). */
  insertSuffix: string;
  /**
   * Whether this keystroke may kick off the lazy dataset fetch.
   *
   * TRUE only when the commit key IS the opener (emoji's `:`), where a fast
   * `:smile:` can outrun the trigger-driven fetch. FALSE for Unicode: the key is
   * the space bar, and fetching a quarter-megabyte the first time anyone presses
   * space would defeat the entire point of loading the dataset lazily.
   */
  mayTriggerLoad: boolean;
}

/** Thrown by `buildIndex` when the dataset payload is not the shape we ship. */
export class CharIndexError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CharIndexError';
  }
}

/** The lazy dataset loader for one profile. Created by `createIndexLoader`. */
export interface CharIndexLoader {
  /** Resolve the index, fetching at most once. Resolves to null rather than rejecting. */
  load(now?: number): Promise<CharIndex | null>;
  /** Synchronous peek — returns the index only if it is already in memory. */
  getLoaded(): CharIndex | null;
  /** True when a load has failed and we are waiting out the cooldown. */
  isUnavailable(): boolean;
  /** Test seam. Not used in app code. */
  resetForTests(): void;
}

/**
 * One dataset profile: which characters, which trigger, which storage key, and
 * the handful of strings the two surfaces show.
 */
export interface CharProfile {
  /** Stable id, also used in log lines. */
  id: 'emoji' | 'unicode';
  /** Versioned asset path under `public/`. */
  indexUrl: string;
  /** `localStorage` key for this profile's recents. Shared verbatim with quilltap-v5. */
  recentsStorageKey: string;
  /** `chat_settings` boolean that gates the INLINE trigger (never the picker). */
  settingsKey: 'composerEmoji' | 'composerUnicode';
  trigger: TriggerConfig;
  /** Null when the profile has no menu-free commit keystroke. */
  commitKey: CommitKeyConfig | null;
  /** Whether alias lookups consult `byAliasExactCase` first. */
  caseSensitiveAliases: boolean;
  /**
   * Whether a `uXXXX` / `u+XXXX` / `u{XXXXX}` query resolves arithmetically to a
   * code point. True for Unicode; false for emoji, where it would add results
   * the shipped corpus does not expect.
   */
  codePointQueries: boolean;
  /**
   * Whether the inline trigger bails inside a math span.
   *
   * True for Unicode — `$$\phi$$` is LaTeX KaTeX renders, and substituting φ
   * would break it. False for emoji: `:` carries no meaning in LaTeX, and
   * turning the check on there would change shipped behaviour for no benefit.
   */
  bailInsideMath: boolean;
  /** Human labels for the dataset's group slugs. Missing slugs fall back to the slug. */
  groupLabels: Record<string, string>;
  /** The lazy loader for this profile's dataset. One instance per profile, app-wide. */
  loader: CharIndexLoader;
  /** Strings the typeahead and the picker show. */
  ui: {
    /** `id` of the typeahead listbox — must be unique per mounted profile. */
    listboxId: string;
    /** Shown when the menu has no results. */
    emptyLabel: string;
    /** Picker search-field placeholder. */
    searchPlaceholder: string;
    /** Picker search-field `aria-label`. */
    searchAriaLabel: string;
    /** Picker grid `aria-label`. */
    gridLabel: string;
    /** Shown in the picker while the dataset is in flight. */
    loadingLabel: string;
    /** Shown in the picker when the dataset could not be fetched. */
    failedLabel: string;
    /** How an alias reads in the menu's detail column, e.g. `:smile:` or `\to`. */
    formatAlias: (alias: string) => string;
  };
}
