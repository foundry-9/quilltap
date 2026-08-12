# Bug 42 — toasts have no entry animation

| | |
|---|---|
| **Status** | Fixed in v4 (2026-08-06) |
| **Found** | 2026-08-06 |
| **Fixed** | 2026-08-06 |
| **Severity** | Low (cosmetic) |
| **Who it bites** | every toast |
| **Provenance** | Faithful |
| **Fix site** | `app/globals.css` — `slideInUp` keyframes defined app-level (+ `prefers-reduced-motion` guard); `lib/toast.tsx` drops the dead Tailwind-plugin classes |
| **v5 status** | **Owed** (Faithful) — mirror the keyframes |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-08-06)** — the `slideInUp` keyframes are now defined as a
plain app-level rule in `app/globals.css` (no `qt-*` class, so no theme-storybook
mirror is owed), and `lib/toast.tsx` drops the dead `animate-in fade-in
slide-in-from-bottom-3 duration-300` classes (that Tailwind plugin isn't loaded)
while keeping the inline `animation: slideInUp 0.3s ease-out`. Toasts now fade
and slide up on entry; a `prefers-reduced-motion` guard on the toast's
`app-toast` class disables the animation. v5 obligation (Faithful): mirror the
keyframes.

**Severity: Low (cosmetic).**

### Root cause

The toast body carries `animate-in fade-in slide-in-from-bottom-3 duration-300`
plus an inline `animation: 'slideInUp 0.3s ease-out'`, but `slideInUp` is defined
**nowhere** in v4 (`grep -rn slideInUp app lib components` returns only the call
site) and `animate-in` belongs to `tailwindcss-animate`, which v4's
`tailwind.config.ts` does not load. So the toast appears instantly. v5
reproduces the instant appearance.

### The fix

Define the `slideInUp` keyframes (or load the Tailwind plugin).
