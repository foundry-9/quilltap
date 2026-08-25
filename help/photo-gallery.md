---
url: /photos
---

# Your Own Photo Gallery — Saving, Searching, Re-sharing

A character may keep a photograph in their album with `keep_image`, but you, the gentle reader, ought to have a parlour cabinet of your own — a place where the pictures you find worth a second glance are filed tidily away, searchable, and ready to be brought out again whenever the conversation calls for one.

That parlour cabinet is **My Photos**. You'll find it tucked into the collapsed sidebar, between Characters and Scenarios, behind a small framed-picture icon.

## How a photograph finds its way into the cabinet

When you click an image in the Salon — any image: one a character has just summoned, an avatar, an attachment you yourself uploaded, a story background — a detail panel slides into view. Among its controls (download, copy-to-clipboard, close) you'll see a small bookmark-shaped button. A click is all that's required. The image is hard-linked into your gallery; no bytes are duplicated, and the original goes on living wherever it already was.

If the image has already been saved to your gallery, the system politely declines the second saving and tells you so. (One link per image is plenty.)

## What you'll see when you visit

The gallery presents your photographs as a tidy grid of thumbnails. Each thumbnail bears a small badge: `1 link`, `3 links`, and so on. That number tells you in how many places the image is presently hard-linked — your own gallery, of course, but also any character's photo album that has independently kept the same picture, plus any chat attachments still pointing at the same bytes.

A click on a thumbnail unfolds a detail card with the picture, the original generation prompt (when known), the caption you assigned (if any), the tags, the time you saved it, and a list of every other place that's holding a link to those bytes — by mount name and relative path. So if your character Friday saved a portrait of a copper kettle six chats ago and you save the same picture today, both of you will appear in each other's link lists.

Along the bottom of the card sit a **Download** button and a **Copy** button. Download hands you the picture as a proper file — a native save dialog in the desktop application, your browser's usual arrangements otherwise — and Copy places it on the clipboard, ready to be pasted wherever pictures are welcome. No right-clicking or other conjuring required.

There's a search bar at the top. Set it to *"sunroom"* and the gallery rummages, semantically, through every saved photograph's prompt, scene snapshot, caption, and tags, returning the ones whose stored description best matches your phrase.

## Removing a photograph

The detail card has a discreet **Remove from gallery** button. Click it and the link is severed; if your gallery was the last place holding a link to those bytes, the bytes themselves are quietly garbage-collected. (If another character's album, a chat attachment, or any other link is still pointing at the picture, the bytes stay where they are — your gallery's link is the only thing removed.)

## In-Chat Navigation

To take a guest directly there:

`help_navigate(url: "/photos")`
