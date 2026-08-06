# Session 9 — UI polish (Bugs 39, 40, 41, 42)

Four small user-facing fixes: a missing CSS class, a dialog that won't close,
a mangled download filename, and a missing toast animation.

**⚠️ This session contains a human gate.** Bug 39 adds a `qt-*` rule, which
**must** be mirrored into
`packages/theme-storybook/src/css/qt-components.css` (de-Tailwinded, faithful)
with a patch version bump — and the **npm publish gates the commit**: stop and
ask the human to `npm publish` before committing. Plan the session so that
gate lands once, at the end.

Read the standing rules in [README.md](README.md). Full root causes:
`../found-bugs.md` → Bugs 39–42.

---

## Bug 39 — `.qt-text-danger` is defined in no CSS file

**Severity: Low (cosmetic). Provenance: Pinned.**

The class is referenced by `StartupProgress.tsx` and
`ChatCreationProgressModal.tsx` but has no rule anywhere — inline errors
render in body colour.

**Fix:** define `.qt-text-danger { color: var(--color-destructive); }` in the
app's utility CSS (v5 put it in its `_utilities.css`; match the analogous v4
location). Then the mandatory follow-through for any `qt-*` change:

1. Mirror the rule (and, if the `qt-text-*` family isn't in the storybook yet,
   **the whole family**) into
   `packages/theme-storybook/src/css/qt-components.css` as plain CSS.
2. Bump the theme-storybook patch version; `npm run build` in the package.
3. **Stop and ask the human to `npm publish`** — the publish gates the commit.
4. Consider the stylebook, `create-quilltap-theme`, and the bundled themes per
   CLAUDE.md; check whether any bundled theme should override the colour.

**Verification:** the startup "Connection lost…" error renders in the
destructive colour, in light and dark, across a couple of bundled themes.
**v5 tripwire:** the `_utilities.css` corpus — vanished divergence fails loud.

---

## Bug 40 — the toolbar search dialog won't close on an outside click

**Severity: Low. Provenance: Faithful.**

`.qt-page-toolbar` sets `backdrop-filter` (`_layout.css:709`), making the
toolbar the containing block for `position: fixed` descendants. `SearchBar`
renders `SearchDialog` inline inside the toolbar, so the dialog's
`fixed inset-0` backdrop resolves against the toolbar — there is nothing
outside it to click; only `Esc` closes it.

**Fix:** portal the dialog host to `document.body` (as v5 does) — do not
remove the toolbar's `backdrop-filter`. Check focus handling and Esc still
work through the portal.

**Verification:** open toolbar search, click anywhere outside → closes. A
Playwright check is ideal if a suitable spec exists; otherwise manual + note.

---

## Bug 41 — `Content-Disposition` mangles a filename with an apostrophe and non-ASCII

**Severity: Low. Provenance: Pinned.**

`lib/api/content-disposition.ts:16`–`:17` builds `filename*=UTF-8''${…}` with
`encodeURIComponent`, which leaves `'` unescaped — and in RFC 8187 the
apostrophe is the `charset'lang'value` delimiter, so browsers discard the
whole `filename*` and fall back to the underscore-substituted ASCII name.

**Fix:** percent-encode every character outside RFC 8187 `attr-char` in the
ext-value — beyond `encodeURIComponent`, that means at least `'`, `*`, `(`,
`)`, and `!`. Mirror v5's `encode_ext_value`.

**Verification:** unit test with the entry's own case
(`Wings Over Suparṇā's Quiet Governance`) → grammatical `filename*` with `%27`
for the apostrophe; plain-ASCII titles unchanged. Fails pre-fix.
**v5 tripwire:** corpus vector `ascii-apostrophe-with-non-ascii` —
self-retires when v4 ships.

---

## Bug 42 — toasts have no entry animation

**Severity: Low (cosmetic). Provenance: Faithful.**

The toast markup names `animate-in fade-in slide-in-from-bottom-3`
(`tailwindcss-animate`, which `tailwind.config.ts` doesn't load) plus an
inline `animation: 'slideInUp 0.3s ease-out'` — and `slideInUp` is defined
nowhere. Toasts appear instantly.

**Fix:** define the `slideInUp` keyframes in the app CSS and keep the inline
animation (no new dependency), and remove the dead `animate-in …` classes so
the markup stops lying. If the keyframes land in a `qt-*` context, the
storybook mirror rule from Bug 39 applies — prefer a plain app-level keyframe
so it doesn't.

**Verification:** trigger a toast → it slides in; respects
`prefers-reduced-motion` if the app has a convention for that (check first).

---

## Definition of done

- [ ] All four fixes; unit tests for 41 (and any testable CSS/portal logic)
      failing pre-fix
- [ ] theme-storybook mirrored + patch-bumped; **human `npm publish` done
      before the commit** (the gate)
- [ ] `npx tsc`, `npm run lint`, full `npm run test:unit` green
- [ ] Visual pass in light + dark, a couple of bundled themes
- [ ] `docs/CHANGELOG.md` entries; `found-bugs.md` Status rows flipped
- [ ] Final report: pins retiring for 39/41; same-round v5 mirrors owed for
      40/42
