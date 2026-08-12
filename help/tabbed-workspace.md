---
url: /workspace
---

# The Tabbed Workspace

> **[Open this page in Quilltap](/workspace)**

The Tabbed Workspace is the parlour in which your whole establishment may be
arranged to taste. Rather than shuttling from one room to the next and forever
losing your place, you keep several surfaces open at once as **tabs** — and, when
the occasion calls for it, you may throw the room open into **two side-by-side
panes**, the better to keep a conversation murmuring along on the left while you
consult a character's dossier on the right.

## The lay of the land

- **Tabs** sit in a slim strip along the top of each pane. Each tab is a single
  open surface — a Salon conversation, the characters gallery (Aurora), a
  project (Prospero), the Scriptorium, Settings, and so on.
- **Panes.** The workspace begins as a single pane filling the width. Drag a tab
  toward the centre and release, and the room divides into a **left** and a
  **right** pane, each with its own tabs.
- **The home tab** is always there to welcome you back; closing the very last
  tab simply returns you to it.

## What you can do

- **Open a surface** by clicking its icon in the slim rail on the far left. It
  opens — or, if already open, comes to the front — in whichever pane you last
  had your hand in.
- **Start or open a conversation** and it takes up residence in its own Salon
  tab, streaming away undisturbed even as you wander to other tabs and back. Your
  draft text and your place in the scrollback are kept faithfully.
- **Call up a character's dossier** by clicking their name in a conversation's
  header; their detail view opens in its own tab (each character keeps their own)
  rather than sweeping you away from the room you were in.
- **Reorder tabs** by dragging them along their strip.
- **Move a tab between panes** by dragging it onto the other pane's strip.
- **Split the workspace** by dragging a tab onto the centre of an undivided
  pane; **resize** the two panes by dragging the divider between them (a
  double-click restores the even split), and **rejoin** them by gathering every
  tab back into one pane.
- **Close a tab** with the small ✕ on its right. Close the last one and the home
  tab reappears.

Your arrangement — which tabs are open, in which pane, in what order, and how the
split is set — is remembered between visits.

## A few turns of the wrist (keyboard shortcuts)

For those who prefer to keep their hands upon the keys, the workspace answers to a
small set of commands. Each is held with **Ctrl + Alt** (or **⌘ + Alt** on a Mac),
so as never to tread upon your browser's own bindings — and each politely stands
aside while you are typing in a field:

- **Ctrl/⌘ + Alt + → / ←** — step to the next or previous tab in the pane you last
  touched (it wraps neatly around the ends).
- **Ctrl/⌘ + Alt + 1 … 9** — leap straight to the first, second, ninth tab.
- **Ctrl/⌘ + Alt + W** — close the tab presently in view.
- **Ctrl/⌘ + Alt + \\** — throw the room into two panes (sending the current tab to
  the right), or, if already divided, gather it back into one.

Should a great many tabs crowd a single strip, it scrolls of its own accord to
keep the one you are reading in plain sight.

## The Chat Sidebar in close quarters

When a conversation is squeezed into a narrow pane, its sidebar grows considerate:
rather than crowding the talk, it tucks itself away to a slim ribbon of avatars and,
when you call it forth, **floats over** the conversation as an overlay. A click
anywhere outside it — or a tap of **Escape** — sends it back to its ribbon. Give the
pane room to breathe and the sidebar returns to its ordinary, settled manners.

## A word on dress (themes)

Every bundled theme wears the workspace in its own colours — the Madman's Box runs
its tabs and dividers in cool phosphor cyan, the Great Estate in gold leaf, and so
on — so the active tab, the pane divider, and the drop-zones always look of a piece
with the rest of the establishment.

## Conversations and their companions

A conversation may summon companions, each of which opens as its **own tab**
linked to the chat:

- **The Terminal (Ariel)** — a live shell, should your work call for one.
- **Document Mode (the Librarian)** — a full editor for a working document. You
  may keep **several documents open at once**, each in its own tab; the
  **Open Document** button in the composer never goes into hiding, so you can
  call up another volume whenever the work demands it. Each document keeps its
  own place, its own unsaved changes, and saves itself quite independently of the
  rest. Close a document's tab and that document alone is set down — its
  companions read on undisturbed.

Drag any of them to the opposite pane to set it beside the conversation it
belongs to. Closing the conversation's tab dismisses its companions along with
it.

When you reopen a conversation, every document you had open returns to its tab,
just as you left it (save any whose file has since been spirited away). And
should a character ask to draw your eye to a passage — by way of the Librarian's
`doc_focus` — it knows precisely which of your open documents to point at.

## Document Mode without a conversation

Not every manuscript wants an audience. The left rail carries a **Document
Mode** button of its own (the little page with a plus sign, seated just above
Settings), and pressing it opens the very same Open Document dialog you know
from the composer — save that, having no conversation to defer to, it looks
**everywhere** from the start: every character vault, every document store, the
general library, and your recent documents across all conversations.

Choose a volume — or a fresh blank page — and it opens as a **standalone
document tab**, attached to no chat at all. The editor is the same in every
particular: rich or source Markdown, autosave, rename by clicking the title,
the little trash-can for dismissals. The one difference is discretion itself:
with no conversation attached, **the Librarian makes no announcements and no
character is told** of your openings, scribblings, renamings, or erasures. The
work is entirely between you and the page.

Pick the same file twice and the workspace politely brings its existing tab
forward rather than opening a second copy; standalone tabs are likewise
remembered between visits, reopening their files just as you left them. Each
volume you open this way is entered into the same roll of recent documents the
dialog consults, so it stands ready for a quick reopening next time — whether
from the rail or from within a conversation.

## Old addresses, faithfully forwarded

Every address of the old, one-room-at-a-time establishment still answers the
bell — and each now shows you in through the workspace rather than leaving you
on the doorstep. Bookmark a conversation, a project, a document store, a
character's dossier, or even the all-chats list (`/salon`), and calling on that
address opens the proper tab, drilled straight down to the very thing you
bookmarked. The address for starting a new chat (`/salon/new`) raises the
familiar New Chat dialog over the workspace, and a terminal's old full-page
address seats the conversation and its terminal side by side as tabs.

## A note on the Help and the Wardrobe

This Help remains a floating window, so it may follow you wherever you roam and
send you straight to the page you need. The **Wardrobe** opens as a roomy tab
when summoned from the left rail (for browsing and tailoring), but keeps its
familiar dialog when opened from within a conversation, where it can change what
a character is presently wearing.

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/workspace")`

## Related Topics

- [Ariel — Terminal Mode](/help/ariel.md)
- [The Brahma Console](/help/brahma-console.md)
