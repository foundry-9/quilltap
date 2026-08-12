# Bug 39 — `.qt-text-danger` is defined in no CSS, so error text is body-coloured

| | |
|---|---|
| **Status** | Fixed in v4 (2026-08-06) |
| **Found** | 2026-08-06 |
| **Fixed** | 2026-08-06 |
| **Severity** | Low (cosmetic) |
| **Who it bites** | anyone reading a startup/creation error |
| **Provenance** | Pinned |
| **Fix site** | `app/styles/qt-components/_utilities.css` — `.qt-text-danger { color: var(--color-destructive) }`, mirrored into `packages/theme-storybook/src/css/qt-components.css` |
| **v5 status** | the `_utilities.css` corpus vector self-retires |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-08-06)** — `.qt-text-danger { color: var(--color-destructive) }`
now lives in `app/styles/qt-components/_utilities.css` (alongside its
`qt-text-destructive` twin), mirrored into
`packages/theme-storybook/src/css/qt-components.css` (patch-bumped, published).
No bundled theme overrides `qt-text-destructive`, so none needs a
`qt-text-danger` override either — the token is the single lever. v5 obligation:
the `_utilities.css` corpus vector self-retires once v4 ships the rule.

**Severity: Low (cosmetic).** Pinned.

### Root cause

The class `qt-text-danger` is referenced by markup (`StartupProgress.tsx`,
`ChatCreationProgressModal.tsx`) but has **no CSS rule anywhere** — an exhaustive
search of v4's CSS finds nothing — so each site inherits ordinary body colour.
Inline errors like "Connection lost. The server may still be starting." read as
informational.

### The fix

Define `.qt-text-danger { color: var(--color-destructive) }`. v5 fixed it in
`_utilities.css` and records the identical v4 one-liner.
