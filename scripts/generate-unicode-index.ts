/**
 * generate-unicode-index.ts
 *
 * Regenerates `public/unicode/unicode-index.v1.json` — the Tier A dataset behind
 * the composer's `\` Unicode typeahead and the toolbar symbol picker (see
 * `docs/developer/features/complete/composer-unicode.md`).
 *
 *   npm run generate:unicode-index
 *
 * The output is COMMITTED; CI never regenerates it. This mirrors how
 * `emoji-index.v1.json` is generated-and-committed by `generate-emoji-index.ts`.
 *
 * ⚠ The dataset is versioned in its FILENAME. A regeneration that changes search
 * results is a `v2` file plus a corpus regeneration — never an in-place edit of
 * `v1` — because quilltap-v5 ships a byte-identical copy of this asset and the
 * two apps must not silently disagree.
 *
 * ## Three inputs, none of which reach the runtime bundle
 *
 * 1. **`scripts/vendor/unicode-names.txt`** — the vendored name table, refreshed by
 *    `scripts/vendor/refresh-unicode-names.py` from Python's `unicodedata`. It
 *    decides which BLOCKS exist; everything else is decided here.
 * 2. **KaTeX's own symbol table** (`node_modules/katex/src/symbols.ts`) — the
 *    LaTeX-to-Unicode mapping, read at generation time.
 *
 *    The spec called for the Julia/VS Code table. KaTeX's is used instead
 *    because it is already a pinned dependency of this repo (no network, no new
 *    devDependency), and — the real argument — it is the table Quilltap's OWN
 *    math renderer uses, so `\to` in the composer inserts exactly what `$$\to$$`
 *    would have rendered. It is smaller (~490 commands rather than ~2,000);
 *    the difference is almost entirely commands with no single-character
 *    replacement, which this feature could not have used anyway.
 * 3. **`public/emoji/emoji-index.v1.json`** — read only to DEDUPE, so `\` and `:`
 *    never both offer ☂.
 *
 * A shape change in any of the three throws rather than quietly producing a
 * thinner dataset.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { finalizeCharIndexEntries, writeCharIndex } from './lib/char-index-output';

// A dev-time read of a pinned dependency's source table. Never bundled: this
// script's only output is the committed JSON asset.
import katexSymbols from '../node_modules/katex/src/symbols';
import { UNICODE_BLOCK_LABELS } from '../lib/char-insert/profiles/unicode';

const NAMES_PATH = join(process.cwd(), 'scripts', 'vendor', 'unicode-names.txt');
const EMOJI_INDEX_PATH = join(process.cwd(), 'public', 'emoji', 'emoji-index.v1.json');
const OUT_PATH = join(process.cwd(), 'public', 'unicode', 'unicode-index.v1.json');

/** Bump alongside the filename, never on its own. */
const DATASET_VERSION = 1;

/**
 * General categories dropped wholesale, each for a stated reason:
 *
 * - `Mn`/`Mc`/`Me` — combining marks. A lone U+0301 in a composer is a trap: it
 *   attaches to whatever precedes it, including the character before the one the
 *   writer thought they were decorating.
 * - `Cf` — format characters (ZERO WIDTH SPACE, the bidi controls). Invisible,
 *   and every one of them is a way to make a document behave strangely later.
 * - `Zl`/`Zp` — LINE/PARAGRAPH SEPARATOR. Not what the Enter key is for.
 *
 * `Zs` (NO-BREAK SPACE, EM SPACE, THIN SPACE) is deliberately KEPT: those are
 * typographic tools a writer genuinely reaches for, and unlike `Cf` they occupy
 * visible width.
 *
 * Unassigned code points, surrogates and private use never appear in the
 * vendored table at all — they have no name.
 */
const EXCLUDED_CATEGORIES = new Set(['Mn', 'Mc', 'Me', 'Cf', 'Zl', 'Zp']);

/**
 * Aliases shorter than this are dropped. The trigger's `minQueryLength` is 2, so
 * `\S` can never be typed; keeping such aliases would only distort the picker's
 * ranking for single-letter searches.
 */
const MIN_ALIAS_LENGTH = 2;

/**
 * Greek normalization — the one place this generator overrules KaTeX.
 *
 * KaTeX maps `\phi` to U+03D5 (ϕ) because that is the glyph LaTeX *renders* in
 * its math fonts. This feature inserts a CHARACTER into prose, where someone
 * typing `\phi` wants GREEK SMALL LETTER PHI. The `\var…` forms take the
 * variant letters, which is the same split every Greek keyboard layout makes.
 *
 * ⚠ Case is significant here and everywhere downstream: `\phi` is φ and `\Phi`
 * is Φ. The Unicode corpus pins six pairs.
 */
const GREEK_OVERRIDES: Record<string, string> = {
  phi: 'φ', // φ GREEK SMALL LETTER PHI
  varphi: 'ϕ', // ϕ GREEK PHI SYMBOL
  epsilon: 'ε', // ε GREEK SMALL LETTER EPSILON
  varepsilon: 'ϵ', // ϵ GREEK LUNATE EPSILON SYMBOL
  theta: 'θ', // θ GREEK SMALL LETTER THETA
  vartheta: 'ϑ', // ϑ GREEK THETA SYMBOL
  pi: 'π', // π GREEK SMALL LETTER PI
  varpi: 'ϖ', // ϖ GREEK PI SYMBOL
  rho: 'ρ', // ρ GREEK SMALL LETTER RHO
  varrho: 'ϱ', // ϱ GREEK RHO SYMBOL
  kappa: 'κ', // κ GREEK SMALL LETTER KAPPA
  varkappa: 'ϰ', // ϰ GREEK KAPPA SYMBOL
  sigma: 'σ', // σ GREEK SMALL LETTER SIGMA
  varsigma: 'ς', // ς GREEK SMALL LETTER FINAL SIGMA
};

/** The query alphabet's first-character rule, applied to aliases at build time. */
const ALIAS_PATTERN = /^[A-Za-z][A-Za-z0-9]*$/;

interface OutputEntry {
  /** The character. */
  c: string;
  /** Unicode name, lowercased. */
  n: string;
  /** LaTeX names without the backslash, case-significant. */
  s: string[];
  /** Always empty — Unicode names carry no separate keyword vocabulary. */
  k: string[];
  /** Block slug — index into the top-level `groups` array. */
  g: string;
  /** Code point. `(groupOrder, order)` reproduces Unicode's own order exactly. */
  o: number;
}

// ---------------------------------------------------------------------------
// 1. The vendored name table.
// ---------------------------------------------------------------------------

interface NameRow {
  codePoint: number;
  name: string;
  category: string;
  block: string;
}

function readNameTable(): NameRow[] {
  const raw = readFileSync(NAMES_PATH, 'utf8');
  const rows: NameRow[] = [];

  for (const line of raw.split('\n')) {
    if (line.length === 0 || line.startsWith('#')) continue;
    const parts = line.split(';');
    if (parts.length !== 4) {
      throw new Error(`Malformed row in ${NAMES_PATH}: ${line}`);
    }
    const [hex, name, category, block] = parts;
    const codePoint = Number.parseInt(hex, 16);
    if (!Number.isFinite(codePoint)) {
      throw new Error(`Malformed code point in ${NAMES_PATH}: ${line}`);
    }
    rows.push({ codePoint, name, category, block });
  }

  if (rows.length === 0) {
    throw new Error(
      `${NAMES_PATH} is empty — run \`python3 scripts/vendor/refresh-unicode-names.py\`.`,
    );
  }
  return rows;
}

// ---------------------------------------------------------------------------
// 2. LaTeX aliases, from KaTeX's symbol table.
// ---------------------------------------------------------------------------

type KatexSymbolTable = Record<string, Record<string, { replace?: string | null }>>;

function readLatexAliases(): Map<string, string[]> {
  const table = katexSymbols as unknown as KatexSymbolTable;
  if (!table || typeof table !== 'object' || !table.math) {
    throw new Error("KaTeX's symbol table is not the shape this generator expects.");
  }

  /** alias -> character. Later modes must not overwrite earlier ones; math wins. */
  const charByAlias = new Map<string, string>();

  for (const mode of ['math', 'text'] as const) {
    const entries = table[mode];
    if (!entries) continue;

    for (const [command, info] of Object.entries(entries)) {
      if (!command.startsWith('\\')) continue;
      const replace = info?.replace;
      if (typeof replace !== 'string' || replace.length === 0) continue;
      // Multi-code-point replacements are ligatures and spacing hacks, not
      // characters a writer means to insert.
      if ([...replace].length !== 1) continue;

      const alias = command.slice(1);
      if (alias.length < MIN_ALIAS_LENGTH) continue;
      if (!ALIAS_PATTERN.test(alias)) continue;
      if (charByAlias.has(alias)) continue;

      charByAlias.set(alias, replace);
    }
  }

  for (const [alias, char] of Object.entries(GREEK_OVERRIDES)) {
    charByAlias.set(alias, char);
  }

  // Sanity anchors. If a KaTeX bump moves these, the LaTeX vocabulary this
  // feature promises has changed and the corpus must be regenerated — so fail
  // here rather than shipping a dataset where `\to` finds nothing.
  const ANCHORS: Record<string, string> = {
    to: '→',
    rightarrow: '→',
    leq: '≤',
    in: '∈',
    infty: '∞',
    Rightarrow: '⇒',
    phi: 'φ',
    Phi: 'Φ',
    Omega: 'Ω',
    ddagger: '‡',
  };
  for (const [alias, expected] of Object.entries(ANCHORS)) {
    const actual = charByAlias.get(alias);
    if (actual !== expected) {
      throw new Error(
        `LaTeX alias "${alias}" resolved to ${
          actual ? `U+${actual.codePointAt(0)!.toString(16).toUpperCase()}` : 'nothing'
        }, expected U+${expected.codePointAt(0)!.toString(16).toUpperCase()}.`,
      );
    }
  }

  const aliasesByChar = new Map<string, string[]>();
  for (const [alias, char] of charByAlias) {
    const list = aliasesByChar.get(char);
    if (list) list.push(alias);
    else aliasesByChar.set(char, [alias]);
  }

  // Shortest first, then alphabetical: `→` reads as `\to`, not `\rightarrow`,
  // in the menu's detail column. Deterministic, which the committed asset needs.
  for (const list of aliasesByChar.values()) {
    list.sort((a, b) => (a.length !== b.length ? a.length - b.length : a.localeCompare(b)));
  }

  return aliasesByChar;
}

// ---------------------------------------------------------------------------
// 3. Emoji dedupe.
// ---------------------------------------------------------------------------

/**
 * Base code points already offered by the `:` picker.
 *
 * Emoji characters are fully qualified, so ☂️ is U+2602 U+FE0F while the Unicode
 * table's row is a bare U+2602. Strip the presentation selectors and compare the
 * single remaining code point; multi-character sequences (flags, ZWJ families)
 * can never collide with a single-code-point row and are skipped.
 *
 * Where a character exists in both, THE EMOJI INDEX WINS and the Unicode row is
 * dropped — one character, one place to find it.
 */
function readEmojiChars(): Set<string> {
  const raw = JSON.parse(readFileSync(EMOJI_INDEX_PATH, 'utf8')) as { emoji?: { c: string }[] };
  if (!Array.isArray(raw.emoji) || raw.emoji.length === 0) {
    throw new Error(`${EMOJI_INDEX_PATH} has no emoji array — refusing to skip the dedupe.`);
  }

  const chars = new Set<string>();
  for (const row of raw.emoji) {
    const stripped = [...row.c].filter((ch) => ch !== '️' && ch !== '︎');
    if (stripped.length === 1) chars.add(stripped[0]);
  }
  return chars;
}

// ---------------------------------------------------------------------------
// Build.
// ---------------------------------------------------------------------------

const nameRows = readNameTable();
const aliasesByChar = readLatexAliases();
const emojiChars = readEmojiChars();

/** Block slugs in first-seen (i.e. code point) order. */
const groups: string[] = [];
const seenBlocks = new Set<string>();
for (const row of nameRows) {
  if (seenBlocks.has(row.block)) continue;
  seenBlocks.add(row.block);
  groups.push(row.block);
}

for (const slug of groups) {
  if (!UNICODE_BLOCK_LABELS[slug]) {
    throw new Error(
      `Block "${slug}" has no label in UNICODE_BLOCK_LABELS ` +
        `(lib/char-insert/profiles/unicode.ts). Add one, or drop the block from ` +
        `scripts/vendor/refresh-unicode-names.py.`,
    );
  }
}

let droppedByCategory = 0;
let droppedAsEmoji = 0;
const entries: OutputEntry[] = [];

for (const row of nameRows) {
  if (EXCLUDED_CATEGORIES.has(row.category)) {
    droppedByCategory += 1;
    continue;
  }

  const char = String.fromCodePoint(row.codePoint);

  if (emojiChars.has(char)) {
    droppedAsEmoji += 1;
    continue;
  }

  entries.push({
    c: char,
    n: row.name.toLowerCase(),
    s: aliasesByChar.get(char) ?? [],
    k: [],
    g: row.block,
    o: row.codePoint,
  });
}

finalizeCharIndexEntries(entries, groups, {
  empty: 'Refusing to write an empty Unicode index — check the vendored name table.',
  duplicates: (count) => `Unicode index has ${count} duplicate characters.`,
});

const aliasedEntries = entries.filter((entry) => entry.s.length > 0).length;
const totalAliases = entries.reduce((sum, entry) => sum + entry.s.length, 0);

// Aliases that KaTeX knows but the curation dropped — worth seeing, because a
// writer typing `\aleph` and getting nothing is a curation bug, not a typo.
const includedChars = new Set(entries.map((entry) => entry.c));
const orphanedAliases = [...aliasesByChar.entries()].filter(
  ([char]) => !includedChars.has(char) && !emojiChars.has(char),
).length;

const payload = {
  version: DATASET_VERSION,
  generatedAt: new Date().toISOString().slice(0, 10),
  source: `Unicode names via scripts/vendor/unicode-names.txt; LaTeX aliases via katex ${
    (JSON.parse(readFileSync(join(process.cwd(), 'node_modules', 'katex', 'package.json'), 'utf8')) as {
      version: string;
    }).version
  }`,
  groups,
  entries,
};

writeCharIndex(OUT_PATH, payload);

const bytes = Buffer.byteLength(JSON.stringify(payload));
console.log(`Wrote ${OUT_PATH}`);
console.log(`  ${entries.length} characters across ${groups.length} blocks`);
console.log(`  ${aliasedEntries} carry a LaTeX alias (${totalAliases} aliases total)`);
console.log(`  dropped ${droppedByCategory} by general category (combining marks, format, separators)`);
console.log(`  dropped ${droppedAsEmoji} already offered by the emoji picker`);
console.log(`  ${orphanedAliases} LaTeX aliases name characters outside the curated blocks`);
console.log(`  ${(bytes / 1024).toFixed(1)} KB raw`);
