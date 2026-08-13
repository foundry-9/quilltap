/**
 * The emoji dataset profile — Layer 2.0e.
 *
 * Everything that used to be hardcoded across `lib/emoji/` now lives here, and
 * nowhere else: the `:` trigger, the closing-`:` commit, the asset path, the
 * recents key, the settings column, and the strings the two surfaces show.
 *
 * ⚠ Every value below is a BEHAVIOUR CONTRACT pinned by
 * `fixtures/emoji-{search,trigger}-vectors.json`. Changing one is changing what
 * `:smile` means in two apps.
 *
 * @module lib/char-insert/profiles/emoji
 */

import { createIndexLoader } from '../load';
import type { CharProfile } from '../types';

/** Versioned in the filename — a v2 dataset is a new file, never an edit. */
export const EMOJI_INDEX_URL = '/emoji/emoji-index.v1.json';

export const EMOJI_PROFILE: CharProfile = {
  id: 'emoji',
  indexUrl: EMOJI_INDEX_URL,
  /** Shared verbatim with quilltap-v5. Changing it orphans every user's list. */
  recentsStorageKey: 'quilltap.emoji.recents.v1',
  settingsKey: 'composerEmoji',

  trigger: {
    opener: ':',
    /**
     * `[a-z0-9_+-]`, case-insensitively. Space is deliberately EXCLUDED — `: `
     * cancels. That forbids searching multi-word names from the inline trigger
     * (the picker's job), and it is the difference between a menu that opens
     * when you want it and one that opens when you type a time.
     */
    queryPattern: /[a-z0-9_+-]/i,
    /** `:` and `:a` are inert; `:)` and `:-)` never open a menu. */
    minQueryLength: 2,
    maxQueryLength: 32,
    closer: ':',
    lowercaseQuery: true,
  },

  /** `:smile:` commits without the menu ever mattering. */
  commitKey: {
    key: ':',
    probeSuffix: ':',
    requireClosed: true,
    insertSuffix: '',
    mayTriggerLoad: true,
  },

  /** github shortcodes are lowercase by construction; there is no case to respect. */
  caseSensitiveAliases: false,
  /** `:u2192:` is not a thing anyone types, and the corpus does not expect it. */
  codePointQueries: false,
  /** `:` means nothing to KaTeX, so there is no math to protect. */
  bailInsideMath: false,

  groupLabels: {
    'smileys-emotion': 'Smileys & Emotion',
    'people-body': 'People & Body',
    'animals-nature': 'Animals & Nature',
    'food-drink': 'Food & Drink',
    'travel-places': 'Travel & Places',
    activities: 'Activities',
    objects: 'Objects',
    symbols: 'Symbols',
    flags: 'Flags',
  },

  loader: createIndexLoader({
    id: 'emoji',
    url: EMOJI_INDEX_URL,
    warning: "Couldn't load the emoji index; the emoji typeahead and picker stay closed.",
  }),

  ui: {
    listboxId: 'qt-emoji-typeahead',
    emptyLabel: 'No emoji found',
    searchPlaceholder: 'Search emoji…',
    searchAriaLabel: 'Search emoji by name',
    gridLabel: 'Emoji',
    loadingLabel: 'Fetching the little faces…',
    failedLabel: "Couldn't load emoji",
    formatAlias: (alias) => `:${alias}:`,
  },
};
