# Bug 99 — a character's Photo Gallery had no reachable way to download a picture

| | |
|---|---|
| **Status** | **Fixed in v4** |
| **Found** | 2026-08-25 (dogfooding — "the photo gallery under a specific character page still doesn't have any way to download a picture from there") |
| **Fixed** | 2026-08-25 |
| **Severity** | Medium (a picture in a character's album could not be saved at all under the Electron shell, which has no right-click Save Image; the affordance existed in the DOM and was simply painted over) |
| **Who it bites** | anyone opening a photo from a character's Photo Gallery tab (Aurora) or from the character-photos gallery modal, in the workspace — which is every route now |
| **Provenance** | Structural, and invisible to code review: `ImageDetailModal` has carried its Download/Copy/Close cluster since it was written, positioned `absolute top-4 right-4` inside a `fixed inset-0 z-[60]` backdrop — correct while the modal rendered under `<body>`'s stacking context. The tabbed workspace (`5d616727`, 2026-06-21) gave `.qt-workspace` `isolation: isolate`, and everything the panes render now lives inside that stacking context. `z-[60]` stopped being comparable with the sticky `.qt-page-toolbar` (`z-30`, `_layout.css`), which is painted by an ancestor context and therefore always wins. The same shape as bug 40, where `.qt-page-toolbar`'s `backdrop-filter` trapped the search dialog |
| **Fix site** | `components/images/image-detail/ImageDetailModal.tsx` (portal); `components/images/embedded-gallery/` (hover download) |
| **v5 status** | Not investigated — any v5 shell that isolates a pane's stacking context inherits this for every in-place overlay that isn't portaled |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-08-25).** `ImageDetailModal` now renders through
`createPortal(..., document.body)`, the same remedy bug 40 applied to the
search dialog, so its backdrop and its top-right controls resolve against the
viewport's stacking context and paint above the toolbar. Independently, the
character gallery's thumbnails gained a hover **Download** button beside
Set-as-avatar and Delete — the affordance `af1bc479` gave the
avatar-selector/wizard grid and this grid alone was missed — so the picture can
be saved without opening the detail view at all.

---

## Symptom

Open a character (`/aurora/<id>/view`) → **Photo Gallery** → click a photo. The
detail view opens, the picture is centred and the filename shows at the bottom,
but the row of controls that belongs at the top right — Download, Copy,
Save-to-gallery, Close — is nowhere on screen. Escape still closes the modal, so
nothing looks broken; the picture is simply unsaveable. In the browser one can
fall back on right-click → Save Image. In the Electron shell there is no such
menu, and the picture is stranded.

## Root cause

`.qt-workspace` declares `isolation: isolate` (`_workspace.css:34`) so that the
pane backdrop sits below the panes. That makes it a stacking context, and every
pane's content — the character view included — renders inside it. The modal's
backdrop is `fixed inset-0 z-[60]`; the `z-[60]` is therefore resolved *within
the workspace*, not against the page. `.qt-page-toolbar` is `sticky top-0 z-30`
in an ancestor context, so it is painted after the entire workspace subtree and
covers the strip the controls occupy.

The controls were laid out exactly where they were meant to be —
`getBoundingClientRect()` put Download at `(1080, 16)` in a 1280×1000 viewport —
and `document.elementFromPoint()` at that point returned
`SPAN › .qt-queue-badge-summary › .qt-page-toolbar`. Not clipped, not
mispositioned, not `display:none`: painted over, and unclickable with it.

## Why it survived

Every automated signal reads normal. The buttons render, so a DOM or
accessibility-tree assertion finds them; they are in the viewport, so a
"visible" check passes; jsdom has no compositing, so no unit test could see it.
It needs a real browser, a real hit test, and someone to notice that a control
they can technically *find* cannot be *clicked*. And the regression was
introduced by a stylesheet two months after the modal, in a file that has
nothing to do with images.

## The fix

1. **`components/images/image-detail/ImageDetailModal.tsx`** — the whole
   overlay goes through `createPortal(modal, document.body)`, with the existing
   `if (!isOpen)` early return extended to `typeof document === 'undefined'`
   for SSR. Out of `.qt-workspace`, `z-[60]` beats the toolbar's `z-30` again.
2. **`components/images/embedded-gallery/`** — `useGalleryData` gained
   `handleDownloadImage`, which fetches the mount-blob URL and hands the blob to
   `triggerDownload` (`lib/download-utils.ts`, so Electron gets its native save
   dialog); `EmbeddedPhotoGallery` → `GalleryGrid` → `GalleryImage` thread it
   through to a hover button that `stopPropagation()`s so it downloads without
   opening the detail view.

## How to verify

With a character that has at least one photo, on `/aurora/<id>/view?tab=gallery`:

- Hover a thumbnail — three buttons: Set as avatar, **Download image**, Delete.
  Clicking Download saves the file and does *not* open the detail view.
- Click the thumbnail — the detail view's top-right cluster (Download, Copy,
  Save to my gallery, Close) is visible over the page toolbar and clickable, and
  the backdrop covers the whole window rather than just the pane.
- In the console, `document.elementFromPoint()` at the Download button's centre
  now returns the button's own icon `<span>`, not `.qt-page-toolbar`.
- Regression coverage: `__tests__/unit/components/images/image-detail-modal-portal.test.tsx`
  mounts the modal inside an `isolation: isolate` container and asserts the
  overlay's parent is `document.body` — the structural property the fix turns on.

## Known adjacent wart (not this bug)

`ImageDetailModal` loads its "which characters have this picture" panel from
`GET /api/v1/images/<image.id>`. For a vault-sourced photo, `image.id` is a
`doc_mount_file_links` id, so that request 404s and the panel starts empty. The
failure is caught and the modal is otherwise fine; the panel's *Save to photo
album* dropdown still works. Left as-is here.
