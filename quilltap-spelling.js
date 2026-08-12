/**
 * Single source of truth for the "quilt"-based misspelling of "Quilltap".
 *
 * Two enforcers share this pattern so they can never drift apart:
 *  - `eslint-quilltap-plugin.js` — the `quilltap/no-quilltap-misspelling` ESLint
 *    rule, which covers JS/TS sources (identifiers, strings, JSX, comments).
 *  - `scripts/check-quilltap-spelling.mjs` — a repo-wide sweep over every other
 *    tracked text file (markdown, JSON, YAML, shell, CSS, …), which ESLint never
 *    parses.
 *
 * This file and both enforcers are exempted from the check, since they all have
 * to spell the forbidden word in order to match it.
 */

const MISSPELLING = /quilttap(?!ap)/i

module.exports = { MISSPELLING }
