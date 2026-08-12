#!/usr/bin/env node
/**
 * Repo-wide guard against the "quilt"-based misspelling of "Quilltap".
 *
 * The ESLint rule (`quilltap/no-quilltap-misspelling`) only fires on files ESLint
 * actually parses. The flat config supplies no configuration for `.md`, `.json`,
 * `.yml`, `.sh`, `.css` and friends, so `eslint .` skips them with a warning —
 * which is how the misspelling sat unnoticed in `docs/**` while `npm run lint`
 * stayed green. This script closes that gap by scanning every tracked (and
 * new-but-not-ignored) text file the rule can't reach.
 *
 * Two escape hatches, both deliberate and greppable:
 *  - ALLOWED_PATHS below — files that must quote the wrong spelling, or frozen
 *    historical records that would be falsified by "correcting" them.
 *  - A line containing `quilltap-spelling-exception` is skipped, for prose that
 *    needs to name the misspelling in passing.
 *
 * Run standalone with `node scripts/check-quilltap-spelling.mjs`; `npm run lint`
 * runs it after ESLint.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { MISSPELLING } = require(path.join(REPO_ROOT, 'quilltap-spelling.js'))

/** Marker that exempts a single line. Spelled correctly, so it can't self-trip. */
const LINE_EXCEPTION = 'quilltap-spelling-exception'

/**
 * Paths that may contain the misspelling, with the reason each one earns it.
 * Repo-relative and exact — a new file is covered by default, and adding one
 * here should take an argument.
 */
const ALLOWED_PATHS = new Map([
  // The enforcers themselves have to spell the word to match it.
  ['quilltap-spelling.js', 'holds the pattern'],
  ['eslint-quilltap-plugin.js', 'implements the ESLint rule'],
  ['scripts/check-quilltap-spelling.mjs', 'this script'],

  // Documents that state the spelling rule, and so must quote the wrong spelling.
  ['CLAUDE.md', 'states the spelling rule'],
  ['docs/developer/bugfix-sessions/README.md', 'states the spelling rule'],
  ['docs/developer/features/complete/brahma-console.md', 'states the spelling rule'],
  ['docs/developer/features/complete/brahma-sql-access.md', 'states the spelling rule'],
  ['docs/developer/features/complete/cli-tier-1-completions.md', 'states the spelling rule'],
  ['docs/developer/features/complete/post-office.md', 'states the spelling rule'],
  ['docs/developer/features/complete/post-office-ui.md', 'states the spelling rule'],
  ['docs/developer/features/complete/salon-answer-confirmation.md', 'states the spelling rule'],

  // Frozen historical records: these describe the misspelling being fixed, and
  // rewriting them would falsify the record.
  ['docs/CHANGELOG_V2.md', 'shipped changelog, records the misspelling being caught'],
  ['docs/CHANGELOG_V3.md', 'shipped changelog, records the misspelling being fixed'],
  ['docs/releases/2.9.0.md', 'shipped release notes'],
])

/** Extensions with no text worth scanning (and plenty of bytes to waste on it). */
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.icns', '.bmp', '.avif',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.zip', '.gz', '.tgz', '.bz2', '.xz', '.7z', '.tar',
  '.pdf', '.mp3', '.mp4', '.wav', '.m4a', '.mov', '.webm',
  '.node', '.wasm', '.dylib', '.so', '.dll', '.exe',
  '.db', '.sqlite', '.sqlite3', '.msgpack', '.pack', '.idx',
])

/** Files this large are generated or vendored; scanning them is not worth the read. */
const MAX_BYTES = 5 * 1024 * 1024

function trackedFiles() {
  // --cached --others --exclude-standard: tracked files plus new files that
  // aren't gitignored, so a brand-new doc is checked before it's ever staged.
  const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  return out.split('\0').filter(Boolean)
}

function scan(relPath) {
  const absPath = path.join(REPO_ROOT, relPath)

  let size
  try {
    const stat = statSync(absPath)
    if (!stat.isFile()) return []
    size = stat.size
  } catch {
    return [] // raced with a delete, or a dangling symlink
  }
  if (size > MAX_BYTES) return []

  let contents
  try {
    contents = readFileSync(absPath, 'utf8')
  } catch {
    return []
  }
  if (contents.includes('\0')) return [] // binary that dodged the extension list

  const pattern = new RegExp(MISSPELLING.source, 'gi')
  const hits = []
  contents.split('\n').forEach((line, index) => {
    if (line.includes(LINE_EXCEPTION)) return
    pattern.lastIndex = 0
    let match
    while ((match = pattern.exec(line)) !== null) {
      hits.push({ line: index + 1, column: match.index + 1, text: line.trim(), found: match[0] })
    }
  })
  return hits
}

function main() {
  const failures = []

  for (const relPath of trackedFiles()) {
    if (ALLOWED_PATHS.has(relPath)) continue
    if (BINARY_EXTENSIONS.has(path.extname(relPath).toLowerCase())) continue
    for (const hit of scan(relPath)) failures.push({ relPath, ...hit })
  }

  if (failures.length === 0) {
    return 0
  }

  console.error(`\nMisspelled "Quilltap" found in ${failures.length} place(s):\n`)
  for (const failure of failures) {
    const where = `${failure.relPath}:${failure.line}:${failure.column}`
    console.error(`  ${where}  ${failure.found}`)
    console.error(`      ${failure.text.slice(0, 140)}`)
  }
  console.error(
    '\nSpell it "Quilltap" — quill + tap, never quilt + tap.\n' +
      `If an occurrence is deliberate, add the file to ALLOWED_PATHS in\n` +
      `scripts/check-quilltap-spelling.mjs, or put ${LINE_EXCEPTION} on the line.\n`
  )
  return 1
}

process.exit(main())
