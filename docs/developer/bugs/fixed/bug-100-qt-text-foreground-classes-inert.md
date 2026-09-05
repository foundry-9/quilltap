# Bug 100 — `qt-text-success-foreground` / `qt-text-destructive-foreground` are defined in no CSS, so fifteen filled surfaces never set their text colour

| | |
|---|---|
| **Status** | Fixed in v4 (2026-08-25) |
| **Found** | 2026-08-25 |
| **Fixed** | 2026-08-25 |
| **Severity** | Low (cosmetic) |
| **Who it bites** | anyone hovering a gallery thumbnail's Set-as-avatar / Delete button, or reading a solid green or red button or badge on a theme whose page foreground is close to the fill |
| **Provenance** | Found by v4's own `qt-*` sweep (release checklist 7) while fixing bug 99 |
| **Fix site** | `app/styles/qt-components/_utilities.css` — the `qt-text-on-primary` / `-on-success` / `-on-destructive` family plus the four `hover:qt-text-on-*` partners, mirrored into `packages/theme-storybook/src/css/qt-components.css` |
| **v5 status** | Not investigated — v4's own finding, with no v5 vector behind it. Any port of the `qt-*` utility sheet inherits both halves: the missing foreground family, and the rule that a `hover:qt-…` form exists only where someone wrote the escaped selector by hand |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-08-25)** — `app/styles/qt-components/_utilities.css` now
carries the rest of the family `qt-text-on-accent` started:
`.qt-text-on-primary`, `.qt-text-on-success`, `.qt-text-on-destructive`, each
reading the theme's matching `--color-*-foreground` token, plus the four
hand-written hover partners `.hover\:qt-text-on-accent/-primary/-success/
-destructive:hover`. All fifteen call sites were rewritten onto the real
classes. Mirrored into `packages/theme-storybook/src/css/qt-components.css`
(1.0.62, published), with a "Foregrounds on filled surfaces" section added to
the `Surfaces` story so a theme author can see the contract. No bundled theme
needs a change: all six already define `primaryForeground`, `successForeground`
and `destructiveForeground` in both light and dark.

**Severity: Low (cosmetic).**

### Root cause

`qt-text-success-foreground` (6 sites) and `qt-text-destructive-foreground`
(9 sites) appear in the markup and **match no rule anywhere** — not in
`app/styles/`, not in the theme-storybook mirror, nowhere. They are the Tailwind
utility names `text-success-foreground` / `text-destructive-foreground` with a
`qt-` prefix bolted on, which is a plausible thing to write and is not a class.

The prefix looks right because the neighbouring classes on the same elements
are real: `bg-destructive`, `hover:bg-success` and `text-primary-foreground`
are all genuine Tailwind utilities generated from the `@theme inline` block in
`app/globals.css`. So a button reading
`bg-destructive qt-text-destructive-foreground` paints its fill correctly and
then silently declines to set the text colour, leaving whatever the element
inherited. Nothing errors, nothing logs, and on most themes the inherited
foreground is legible enough on the fill that the defect reads as a design
choice rather than a missing rule.

The two hover forms fail the same way for a second reason worth recording:
Tailwind v4 generates **no variants for classes declared inside
`@layer utilities`**, so `hover:qt-…` only exists where someone has written the
escaped selector out by hand. The file already does this for
`.hover\:qt-bg-destructive\/10:hover` and friends. An unwritten hover form is
therefore inert even when its resting counterpart is real.

Affected sites:

| Class | Sites |
|---|---|
| `qt-text-success-foreground` | `app/prospero/[id]/components/ProjectDetailHeader.tsx`, `app/aurora/AuroraView.tsx`, `app/aurora/[id]/view/components/CharacterHeader.tsx`, `components/images/image-detail/ImageMetadata.tsx`, `components/images/embedded-gallery/GalleryImage.tsx` (×2, one of them a hover form) |
| `qt-text-destructive-foreground` | `app/prospero/components/DeleteProjectDialog.tsx`, `components/chat/ChatCard.tsx`, `components/images/DeletedImagePlaceholder.tsx`, `components/images/embedded-gallery/GalleryImage.tsx` (×2, one of them a hover form), `components/images/image-gallery.tsx`, `components/files/FileDeleteConfirmation.tsx`, `components/files/OrphanCleanupModal.tsx`, `components/files/FilePreview/FilePreviewActions.tsx` (hover form) |

### Why it survived

The same reason bug 39 survived: a CSS class that does not exist is
indistinguishable, at every automated layer, from one that exists and happens to
resolve to the inherited colour. Nothing in lint, `tsc` or jest knows the set of
defined class names, and the visible symptom — a green "Avatar" badge whose
label is the ordinary page foreground — is exactly what an intentional design
would look like.

The hover cases are the ones a person could plausibly have noticed, since the
background does change and the text conspicuously does not, but they live on
`opacity-0 group-hover:opacity-100` overlay buttons that are only on screen
while the pointer is already inside them.

### The fix

Add the missing family beside `qt-text-on-accent` rather than defining the
misspelled names, so there is one spelling of this idea and it is the one that
already existed. The naming is load-bearing and is now stated in the comment at
the definition site and in the `Surfaces` story: these are `-on-<fill>`, never
`-<fill>-foreground`.

`components/images/embedded-gallery/GalleryImage.tsx`'s Download button (added
the same day by bug 99) had deliberately used the raw Tailwind
`hover:text-primary-foreground` to avoid adding a third dead class; it now uses
`hover:qt-text-on-primary` with the rest.

### How to verify

1. `grep -rn 'qt-text-success-foreground\|qt-text-destructive-foreground' --include='*.tsx' .` returns nothing.
2. Every `qt-text-on-*` and `hover:qt-text-on-*` selector used in the app resolves in `app/styles/qt-components/_utilities.css`, and the same eight selectors resolve in `packages/theme-storybook/src/css/qt-components.css`.
3. In a character's Photo Gallery, hover a thumbnail: the Set-as-avatar, Download and Delete buttons each take their fill **and** flip their glyph to that fill's foreground. On Madman's Box, whose `primaryForeground` is near-black, the Download glyph goes dark on amber instead of staying muted.

### What the same sweep turned up — [bug 102](bug-102-qt-utility-variants-and-opacity-inert.md)

The census that found these two names did not stop at them. Most `hover:qt-bg-*`
**opacity** variants are inert for the identical Tailwind-v4 reason — only the
`/10` forms (plus `hover:qt-bg-muted-foreground/60`) had hand-written selectors,
while the markup also reaches for `hover:qt-bg-muted` (73 sites),
`hover:qt-bg-primary/90` (21), `hover:qt-bg-muted/50` (19) and thirty other
unwritten combinations, and the plain opacity steps (`qt-bg-muted/50`, 34 sites)
were missing too: 82 further class names over 493 call sites.

That was filed as **bug 102** and fixed the same day, along with the guard —
`scripts/check-qt-classes.mjs`, run by `npm run lint` — that would have caught
all three of bugs 39, 100 and 102 on the commit that introduced them.
