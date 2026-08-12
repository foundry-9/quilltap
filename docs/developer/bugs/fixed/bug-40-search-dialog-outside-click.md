# Bug 40 — the toolbar search dialog won't close on an outside click

| | |
|---|---|
| **Status** | Fixed in v4 (2026-08-06) |
| **Found** | 2026-08-06 |
| **Fixed** | 2026-08-06 |
| **Severity** | Low |
| **Who it bites** | anyone using the toolbar search |
| **Provenance** | Faithful |
| **Fix site** | `components/search/search-dialog.tsx` — `SearchDialog` renders through `createPortal(…, document.body)` |
| **v5 status** | **Owed** (Faithful) — mirror the portal |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-08-06)** — `SearchDialog` (`components/search/search-dialog.tsx`)
now renders through `createPortal(…, document.body)`, so its `fixed inset-0`
backdrop resolves against the viewport instead of the `backdrop-filter`
containing block that `.qt-page-toolbar` establishes. Esc (document-level
`useEscapeKey`) and input focus still work through the portal; the toolbar's
`backdrop-filter` is untouched. v5 obligation (Faithful): mirror the portal.

**Severity: Low.**

### Root cause

`.qt-page-toolbar` sets `backdrop-filter: var(--qt-app-header-blur)`
(`_layout.css:709`), which makes the toolbar a containing block for
`position: fixed` descendants. v4's `SearchBar` renders `SearchDialog` **inline,
with no portal**, inside `<div className="qt-page-toolbar">`, so the dialog's
`fixed inset-0` backdrop resolves against the toolbar (~`56,0 1224×64`), not the
viewport — there is no backdrop outside the toolbar to click. Only the
document-level `Esc` handler closes it.

### The fix

Portal the dialog host out of the toolbar (to `document.body`), as v5 does.
