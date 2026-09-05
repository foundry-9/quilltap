#!/usr/bin/env node
/**
 * Repo-wide guard against `qt-*` classes that resolve to nothing.
 *
 * A CSS class that does not exist is indistinguishable, at every automated
 * layer we have, from one that exists and happens to inherit: the markup
 * renders, TypeScript is satisfied, ESLint has no opinion, and jsdom does no
 * cascade. Only a person looking at a real browser can tell, and only if the
 * missing colour happens to be far from the inherited one. That is how bug 39
 * (`qt-text-danger`), bug 100 (`qt-text-*-foreground`) and bug 102 (most of the
 * `hover:qt-bg-*` family) each survived for months.
 *
 * Two shapes recur, and this script fails the build on both:
 *
 *  1. A base utility nobody defined — usually the Tailwind name with a `qt-`
 *     bolted on (`qt-text-destructive-foreground`), or an opacity step the
 *     sheet never grew (`qt-bg-muted/50`).
 *  2. A variant form of a real utility. Tailwind generates variants only for
 *     utilities it knows about, and a class declared inside `@layer utilities`
 *     is invisible to it — so `hover:qt-bg-muted` is not "qt-bg-muted, on
 *     hover", it is an undefined class name. Every state form has to be written
 *     out by hand in `_utilities.css`, escaped, with its own pseudo-selector.
 *
 * SCOPE. The guard covers the four *utility* families — `qt-bg-`, `qt-text-`,
 * `qt-border-`, `qt-shadow-` — plus any `qt-*` token carrying a variant prefix,
 * whatever its family. It deliberately does not police bare component classes
 * (`qt-card`, `qt-chat-sidebar-section-participants`): plenty of those are
 * emitted purely as hooks for themes to target and are *meant* to have no rule
 * in the app's own CSS. Widening the net there would mean an allowlist that
 * rots, which is worse than the gap.
 *
 * Escape hatch: a line containing `qt-class-exception` is skipped.
 *
 * Run standalone with `node scripts/check-qt-classes.mjs`; `npm run lint` runs
 * it alongside the other repo-wide guards.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Families whose bare (variant-free) names must resolve. */
const GUARDED_FAMILIES = /^qt-(bg|text|border|shadow)-/

/** Source trees whose className strings the app is responsible for. */
const SOURCE_GLOBS = ['*.tsx', '*.ts', '*.jsx']
const SKIPPED_PREFIXES = ['packages/', 'plugins/', 'scripts/', 'node_modules/']

/**
 * A class token as it appears in markup: an optional chain of variant prefixes
 * (`hover:`, `focus:`, `group-hover/thumb:`) followed by the `qt-` name, which
 * may carry an opacity modifier (`/50`).
 */
const TOKEN = /((?:[a-z][a-z0-9-]*(?:\/[a-z0-9-]+)?:)*)(qt-[a-z0-9-]+(?:\/[0-9]+)?)/g

/**
 * The same thing as a CSS selector, where every `:` and `/` is backslashed.
 * Matched loosely on purpose: we only care that the class name appears at the
 * head of some selector, not what follows it.
 */
const SELECTOR = /\.((?:[a-z][a-z0-9-]*(?:\\\/[a-z0-9-]+)?\\:)*qt-[a-z0-9-]+(?:\\\/[0-9]+)?)/g

function tracked(globs) {
  return execFileSync('git', ['ls-files', ...globs], { cwd: REPO_ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
}

/** Every `qt-*` class the app's own stylesheets define. */
function definedClasses() {
  const defined = new Set()
  for (const file of tracked(['*.css']).filter((f) => f.startsWith('app/'))) {
    const css = readFileSync(path.join(REPO_ROOT, file), 'utf8')
    for (const match of css.matchAll(SELECTOR)) {
      defined.add(match[1].replaceAll('\\', ''))
    }
  }
  return defined
}

/** Every guarded `qt-*` token the app's markup reaches for, with its sites. */
function usedClasses() {
  const used = new Map()
  for (const file of tracked(SOURCE_GLOBS)) {
    if (SKIPPED_PREFIXES.some((p) => file.startsWith(p))) continue
    const source = readFileSync(path.join(REPO_ROOT, file), 'utf8')
    source.split('\n').forEach((line, i) => {
      if (line.includes('qt-class-exception')) return
      // `--qt-foo` is a custom property, not a class.
      for (const match of line.replaceAll(/--qt-[a-z0-9-]+/g, '').matchAll(TOKEN)) {
        const [token, variants, base] = match
        if (!variants && !GUARDED_FAMILIES.test(base)) continue
        if (!used.has(token)) used.set(token, [])
        used.get(token).push(`${file}:${i + 1}`)
      }
    })
  }
  return used
}

const defined = definedClasses()
const missing = [...usedClasses().entries()]
  .filter(([token]) => !defined.has(token))
  .sort((a, b) => b[1].length - a[1].length)

if (missing.length === 0) {
  console.log(`check-qt-classes: ${defined.size} qt-* classes defined, every guarded reference resolves.`)
  process.exit(0)
}

const total = missing.reduce((n, [, sites]) => n + sites.length, 0)
console.error(
  `\ncheck-qt-classes: ${missing.length} qt-* class name(s) used in ${total} place(s) resolve to no CSS rule.\n` +
    `These render as nothing at all — no error, no warning, just an element that keeps\n` +
    `whatever it inherited. Define them in app/styles/qt-components/_utilities.css (and\n` +
    `mirror into packages/theme-storybook), or change the markup to a class that exists.\n` +
    `A variant form (hover:, focus:, disabled:, …) needs its own hand-written escaped\n` +
    `selector — Tailwind generates none for classes declared in @layer utilities.\n`
)
for (const [token, sites] of missing) {
  console.error(`  ${token}`)
  for (const site of sites.slice(0, 5)) console.error(`      ${site}`)
  if (sites.length > 5) console.error(`      … and ${sites.length - 5} more`)
}
console.error('')
process.exit(1)
