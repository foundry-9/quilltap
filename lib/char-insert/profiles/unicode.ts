/**
 * The Unicode dataset profile — Layer 2.0u.
 *
 * A second dataset over the engine the emoji feature already shipped. The only
 * things that differ are in this file: the `\` trigger, the trailing-space
 * commit, the asset path, the recents key, the settings column, the block
 * labels, and the fact that aliases are CASE-SIGNIFICANT.
 *
 * ⚠ `\phi` is φ and `\Phi` is Φ. `normalizeQuery` lowercases, so the engine
 * cannot tell them apart on its own — which is why `caseSensitiveAliases` is
 * true here and `trigger.lowercaseQuery` is false. A port that lowercases the
 * query produces the wrong Greek letter silently. The corpus pins six pairs.
 *
 * @module lib/char-insert/profiles/unicode
 */

import { createIndexLoader } from '../load';
import type { CharProfile } from '../types';

/** Versioned in the filename — a v2 dataset is a new file, never an edit. */
export const UNICODE_INDEX_URL = '/unicode/unicode-index.v1.json';

/**
 * Human labels for the 26 curated blocks, in the dataset's own (code point)
 * order. Shortened from the formal Unicode block names where those are
 * unwieldy — "Misc Math Symbols-A" reads better in a picker header than
 * "Miscellaneous Mathematical Symbols-A".
 */
export const UNICODE_BLOCK_LABELS: Record<string, string> = {
  'latin-1-supplement': 'Latin-1 Supplement',
  'latin-extended-a': 'Latin Extended-A',
  'latin-extended-b': 'Latin Extended-B',
  'ipa-extensions': 'IPA Extensions',
  'spacing-modifier-letters': 'Spacing Modifier Letters',
  'greek-and-coptic': 'Greek and Coptic',
  cyrillic: 'Cyrillic',
  'general-punctuation': 'Punctuation',
  'superscripts-and-subscripts': 'Superscripts & Subscripts',
  'currency-symbols': 'Currency',
  'letterlike-symbols': 'Letterlike Symbols',
  'number-forms': 'Number Forms',
  arrows: 'Arrows',
  'mathematical-operators': 'Mathematical Operators',
  'miscellaneous-technical': 'Technical',
  'box-drawing': 'Box Drawing',
  'block-elements': 'Block Elements',
  'geometric-shapes': 'Geometric Shapes',
  'miscellaneous-symbols': 'Miscellaneous Symbols',
  dingbats: 'Dingbats',
  'misc-math-symbols-a': 'Misc Math Symbols-A',
  'supplemental-arrows-a': 'Supplemental Arrows-A',
  'supplemental-arrows-b': 'Supplemental Arrows-B',
  'misc-math-symbols-b': 'Misc Math Symbols-B',
  'supplemental-math-operators': 'Supplemental Math Operators',
  'misc-symbols-and-arrows': 'Misc Symbols & Arrows',
};

export const UNICODE_PROFILE: CharProfile = {
  id: 'unicode',
  indexUrl: UNICODE_INDEX_URL,
  /** Shared verbatim with quilltap-v5, and separate from the emoji list. */
  recentsStorageKey: 'quilltap.unicode.recents.v1',
  settingsKey: 'composerUnicode',

  trigger: {
    opener: '\\',
    /**
     * Letters, digits, `+` and braces — the alphabet of a LaTeX command name
     * plus the `\u+2192` / `\u{1D538}` code-point forms. No punctuation, and no
     * space (a space commits or cancels; see `commitKey`).
     */
    queryPattern: /[A-Za-z0-9+{}]/,
    /** A letter first, so `\*`, `\_`, `\[` and `\{` stay markdown escapes. */
    queryStartPattern: /[A-Za-z]/,
    /** `\` and `\a` are inert. */
    minQueryLength: 2,
    maxQueryLength: 32,
    /** LaTeX commands have no closing delimiter; the trailing space is the commit. */
    closer: null,
    /** `\Phi` must survive as `Phi`. See the module note. */
    lowercaseQuery: false,
  },

  /**
   * `\to ` → `→ `. The parallel to emoji's closing colon: commit only on an
   * EXACT alias match, and otherwise leave the literal text alone.
   */
  commitKey: {
    key: ' ',
    probeSuffix: '',
    requireClosed: false,
    insertSuffix: ' ',
    mayTriggerLoad: false,
  },

  caseSensitiveAliases: true,
  /** `→`, `\u+2192`, `\u{1D538}` — every character is reachable, curated or not. */
  codePointQueries: true,
  /** `$$\phi$$` must stay LaTeX. See `lib/char-insert/math-span.ts`. */
  bailInsideMath: true,

  groupLabels: UNICODE_BLOCK_LABELS,

  loader: createIndexLoader({
    id: 'unicode',
    url: UNICODE_INDEX_URL,
    warning: "Couldn't load the Unicode index; the `\\` typeahead and symbol picker stay closed.",
  }),

  ui: {
    listboxId: 'qt-unicode-typeahead',
    emptyLabel: 'No symbol found',
    searchPlaceholder: 'Search symbols…',
    searchAriaLabel: 'Search Unicode characters by name',
    gridLabel: 'Unicode symbols',
    loadingLabel: 'Consulting the great catalogue…',
    failedLabel: "Couldn't load the symbol catalogue",
    formatAlias: (alias) => `\\${alias}`,
  },
};
