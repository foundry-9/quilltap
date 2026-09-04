/**
 * generate-emoji-index.ts
 *
 * Regenerates `public/emoji/emoji-index.v1.json` — the Tier A dataset behind the
 * composer's `:` emoji typeahead and the toolbar picker (see
 * `docs/developer/features/complete/composer-emoji.md`).
 *
 * Run after bumping `emojibase-data`, or when the filter/shape below changes:
 *
 *   npm run generate:emoji-index
 *
 * The output is COMMITTED; CI never regenerates it. This mirrors how
 * `_icons.css` is generated-and-committed by `generate-icon-css.ts`.
 *
 * ⚠ The dataset is versioned in its FILENAME. A regeneration that changes search
 * results is a `v2` file plus a corpus regeneration — never an in-place edit of
 * `v1` — because quilltap-v5 ships a byte-identical copy of this asset and the
 * two apps must not silently disagree. See the spec's Portability contract.
 *
 * `emojibase-data` is a devDependency and MUST NOT reach the runtime bundle:
 * nothing outside this script may import it.
 */

import { join } from 'node:path';

import { finalizeCharIndexEntries, writeCharIndex } from './lib/char-index-output';

import emojibaseData from 'emojibase-data/en/data.json';
import emojibaseMessages from 'emojibase-data/en/messages.json';
import githubShortcodes from 'emojibase-data/en/shortcodes/github.json';

const OUT_PATH = join(process.cwd(), 'public', 'emoji', 'emoji-index.v1.json');

/** Bump alongside the filename, never on its own. */
const DATASET_VERSION = 1;

/**
 * emojibase's `component` group holds the standalone skin-tone and hair-colour
 * modifiers (🏻, 🦰, …). They are not emoji a writer inserts on their own.
 */
const COMPONENT_GROUP = 2;

interface RawEmoji {
  label: string;
  hexcode: string;
  emoji: string;
  tags?: string[];
  order?: number;
  group?: number;
}

interface OutputEntry {
  /** The character. */
  c: string;
  /** CLDR label, lowercased. */
  n: string;
  /** Shortcodes, no colons, lowercased. */
  s: string[];
  /** CLDR keywords, lowercased, deduped against the name and shortcodes. */
  k: string[];
  /** Group slug — index into the top-level `groups` array. */
  g: string;
  /** CLDR presentation order (emojibase's own, globally unique). */
  o: number;
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/** github.json maps hexcode -> string | string[]. */
function shortcodesFor(hexcode: string): string[] {
  const raw = (githubShortcodes as Record<string, string | string[]>)[hexcode];
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  return [...new Set(list.map(normalize).filter(Boolean))];
}

const groupSlugs: string[] = (
  emojibaseMessages as { groups: { order: number; key: string }[] }
).groups
  .slice()
  .sort((a, b) => a.order - b.order)
  .map((group) => group.key);

const entries: OutputEntry[] = (emojibaseData as RawEmoji[])
  // Drop the regional-indicator letters (no `group`) and the component
  // modifiers. Skin-tone variants are already nested under `skins` in the
  // source, so they never appear at this level.
  .filter((raw) => raw.group !== undefined && raw.group !== COMPONENT_GROUP)
  .map((raw): OutputEntry => {
    const name = normalize(raw.label);
    const shortcodes = shortcodesFor(raw.hexcode);

    // A keyword that merely repeats the name or a shortcode buys nothing at
    // search time and costs bytes in every install.
    const nameWords = new Set(name.split(/\s+/));
    const shortcodeSet = new Set(shortcodes);
    const keywords = [
      ...new Set((raw.tags ?? []).map(normalize).filter(Boolean)),
    ].filter((tag) => !nameWords.has(tag) && !shortcodeSet.has(tag));

    const group = groupSlugs[raw.group as number];
    if (!group) {
      throw new Error(`No group slug for group index ${raw.group} (${raw.label})`);
    }

    return { c: raw.emoji, n: name, s: shortcodes, k: keywords, g: group, o: raw.order as number };
  });

finalizeCharIndexEntries(entries, groupSlugs, {
  empty: 'Refusing to write an empty emoji index — check the emojibase-data import.',
  duplicates: (count) => `Refusing to write emoji index: ${count} duplicate characters.`,
});

const emojibaseVersion = (
  require('emojibase-data/package.json') as { version: string }
).version;

const payload = {
  version: DATASET_VERSION,
  generatedAt: new Date().toISOString().slice(0, 10),
  source: `emojibase-data ${emojibaseVersion} (CLDR annotations, github shortcode preset)`,
  // Index in this array IS the group's presentation order; the search
  // comparator's group tie-break reads it. Do not sort it at load time.
  groups: groupSlugs.filter((slug) => entries.some((entry) => entry.g === slug)),
  emoji: entries,
};

writeCharIndex(OUT_PATH, payload);

console.log(
  `Wrote ${entries.length} emoji (${payload.groups.length} groups) to ${OUT_PATH}`,
);
