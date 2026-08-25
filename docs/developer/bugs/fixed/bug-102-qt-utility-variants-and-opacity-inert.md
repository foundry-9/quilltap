# Bug 102 — 82 `qt-*` utility classes across 493 call sites resolve to no CSS rule

| | |
|---|---|
| **Status** | Fixed in v4 (2026-08-25) |
| **Found** | 2026-08-25 |
| **Fixed** | 2026-08-25 |
| **Severity** | Low individually, Medium in aggregate (no error anywhere; ~493 elements silently keep whatever they inherited, and roughly half of them are hover states that never move) |
| **Provenance** | Found by v4's own `qt-*` sweep while fixing bug 100 — the same census, widened from the foreground family to every utility family |
| **Fix site** | `app/styles/qt-components/_utilities.css` (the missing opacity steps, surface colours, and every state form), 24 call-site rewrites onto classes that already existed, and the new `scripts/check-qt-classes.mjs` guard wired into `npm run lint` |
| **v5 status** | Not investigated. The variant half is a Tailwind-v4 fact and applies to any port that keeps `qt-*` in `@layer utilities`; the guard is the transferable part |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-08-25)** — `app/styles/qt-components/_utilities.css` gained
the missing opacity steps (`qt-bg-muted/20`–`/80`, `qt-bg-card/50`–`/90`,
`qt-border-primary/20`–`/60`, `qt-text-secondary/50`–`/80`, and the rest), the
two surface colours the markup asked for and the sheet never had (`qt-bg-input`,
`qt-bg-secondary`), and a rewritten **STATE VARIANTS** section carrying every
`hover:` / `focus:` / `disabled:` / `placeholder:` / `file:` / named-group form
the app uses — 34 of them, each hand-written and escaped. Twenty-four call sites
that had *invented* a name were rewritten onto the class that already existed
rather than given a definition (see below). All of it mirrored into
`packages/theme-storybook` (1.0.63, published).

The durable half of the fix is **`scripts/check-qt-classes.mjs`**, run by
`npm run lint`: it cross-checks every `qt-bg-*` / `qt-text-*` / `qt-border-*` /
`qt-shadow-*` reference, and every variant-prefixed `qt-*` reference whatever its
family, against the selectors the app's stylesheets actually define, and fails
the build on one that resolves to nothing.

**Severity: Low individually, Medium in aggregate.**

### Root cause

Two shapes, one census.

**1. Opacity steps that were never written.** `qt-bg-muted/50` appears 34 times
and `qt-bg-muted/30` 21 times, and neither was ever a class. Tailwind's `/50`
suffix is a *modifier* its engine applies to utilities it owns; a `qt-*` class
declared inside `@layer utilities` is not one of those, so `qt-bg-muted/50` is
not "`qt-bg-muted` at half strength", it is a class name nobody defined. The
sheet had grown `/5`, `/10`, `/20` for some tokens and stopped, and every step
past the edge of that arbitrary set was inert.

**2. Variant forms.** Same mechanism, more consequential: **Tailwind v4
generates no variants for a class it does not own**, so `hover:qt-bg-muted`
— the single most-used state class in the app, 73 sites — styled nothing at all.
The file already knew this and hand-wrote `.hover\:qt-bg-destructive\/10:hover`
and eight friends; what it did not have was any way to notice the ninety-odd
places that reached for a form nobody had written. 34 distinct variant tokens
were dead across 236 sites, including the `hover:qt-bg-primary/90` and
`hover:qt-bg-destructive/90` darkens on filled buttons throughout Aurora,
Prospero and the file dialogs.

The census, taken over `.tsx`/`.ts` outside `packages/`, `plugins/` and
`scripts/`: **82 distinct class names, 493 call sites, 170 files** — 48 plain
names over 257 sites, 34 variant names over 236.

A third, smaller shape rode along: names invented by analogy that were never
part of the vocabulary at all — `qt-text-error` (18 sites), `qt-text-sm` (15),
`qt-surface-alt` (18), `qt-text-tertiary`, `qt-text-default`, `qt-text-body`,
`qt-text-base`, `qt-text-link`, `qt-bg-hover`, `qt-surface-secondary`. Each has
a real counterpart that already existed, so these were **rewritten, not
defined** — minting `qt-text-error` beside `qt-text-destructive` and
`qt-text-danger` would have made three names for one colour:

| invented | rewritten to |
|---|---|
| `qt-text-error` | `qt-text-destructive` |
| `qt-text-tertiary` | `qt-text-secondary` |
| `qt-text-default` | `qt-text` |
| `qt-text-link` | `qt-action` |
| `qt-text-body` | `qt-body` |
| `qt-text-sm` / `qt-text-base` | `text-sm` / `text-base` (pure sizing, no theme dimension) |
| `qt-bg-hover` | `qt-bg-surface-hover` |
| `qt-surface-alt` / `qt-surface-secondary` | `qt-bg-surface-alt` |

One of those rewrites is not mechanical and is worth recording. `AIImportWizard`
had ``className={`qt-text-default ${step.status === 'pending' ? 'qt-text-muted' : ''}`}``,
which worked *because* `qt-text-default` was dead: `qt-text` lives in
`@layer utilities` and `qt-text-muted` in `@layer components`, so the naive
substitution would have made the base class beat the modifier and every pending
step would have lost its muting. Rewritten as a straight ternary instead.

### Why it survived

The reason from bug 39 and bug 100, at scale: **a class that does not exist and
a class that resolves to the inherited value are indistinguishable to every
automated layer this repo has.** ESLint has no model of the stylesheet,
TypeScript sees a string, and jsdom runs no cascade, so the unit suite is as
green over 493 inert classes as over none. In a browser the symptom is an
element that looks *plausible* — a hover row that does not light up reads as a
design that chose not to highlight.

The variant half compounds it by being locally invisible: `hover:qt-bg-muted`
sits in a `className` beside `qt-bg-card` and `qt-text-secondary`, which are
real, and beside `hover:bg-primary`, which is real Tailwind. Nothing about the
line suggests that one of the four is fictional.

### The fix

Define the families; rewrite the inventions; **and then make the class of defect
impossible to reintroduce quietly.** The first two are the visible part and the
third is the load-bearing one — bugs 39, 100 and 102 are the same bug found
three times by three accidents, and the only thing that changes that is a check
that runs on every lint.

`scripts/check-qt-classes.mjs` deliberately does **not** police bare component
classes (`qt-card`, `qt-chat-sidebar-section-participants`, `qt-list-row`):
many of those are emitted purely as hooks for themes to target and are *meant*
to carry no rule in the app's own CSS. Guarding them would need an allowlist,
and an allowlist rots into noise. The utility families and the variant forms are
the part where "no rule" is always a mistake, so that is exactly what it guards.
Escape hatch, for the same reason the spelling guard has one: a line containing
`qt-class-exception` is skipped.

### How to verify

1. `node scripts/check-qt-classes.mjs` exits 0 and reports every guarded reference resolving. Plant `hover:qt-bg-nonexistent` in any component and it exits 1, naming the file and line.
2. `npm run lint` runs it after ESLint and the spelling guard.
3. In a browser: hover any character card in Aurora — the card outline takes `hover:qt-border-primary/50` and the **Chat** button darkens through `hover:qt-bg-success/90`, neither of which moved before. Table rows in the Scriptorium take `hover:qt-bg-muted/50`; the Delete buttons in the file dialogs darken through `hover:qt-bg-destructive/90`.

### Adjacent, not fixed here

- **Component-class residue.** Outside the four utility families, ~70 bare `qt-*` names used in markup match no rule in the app's CSS. Most are deliberate theme hooks; a handful (`qt-code`, `qt-callout`, `qt-divider`, `qt-card-content`, `qt-form-label`, `qt-input-sm`, `qt-badge-muted`, `qt-alert-destructive`, `qt-dialog-content`, `qt-card-selected`, `qt-button-danger`, `qt-range`) look like components somebody expected to exist. Telling the two apart is a per-class design decision, not a sweep, which is why the guard does not cover them.
- **Typography mirror gap.** `qt-text-small`, `qt-text-xs`, `qt-text-label`, `qt-text-label-xs`, `qt-text-large`, `qt-text-lead` and `qt-text-section` are defined in the app's `@layer components` sheet and have never been mirrored into `packages/theme-storybook`. The colour-carrying `qt-text-*` utilities are now complete there; these seven are not.
