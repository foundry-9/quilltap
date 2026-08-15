# Bug 67 — a send made from the composer's raw-source view discards every source edit

| | |
|---|---|
| **Status** | **Open** |
| **Found** | 2026-08-14 (the v5 port's P4.9L composer-toolbar lane, reading the send path while porting the source toggle; verified against v4 source by an independent review the same day) |
| **Fixed** | — |
| **Severity** | Medium (silent loss of typed text) |
| **Who it bites** | anyone who opens "Edit markdown source" in the Salon composer, edits, and sends |
| **Provenance** | v5 port survey |
| **Fix site** | `app/salon/[id]/SalonView.tsx:1581` (the submit's editor-handle read) + the `hasContent` feed |
| **v5 status** | v5 **diverges deliberately** — it sends the bytes the writer can see (the source textarea's, when showing), pinned by `chat-composer.toolbar.spec.ts` (one of its mutations is exactly this v4 bug) |
| **Index** | [bugs.md](../bugs.md) |

---

**OPEN.** The Salon composer's raw-source view (`showSource`) renders a
`<textarea>` while keeping the Lexical editor mounted-but-hidden with its
bridge suspended (`ChatComposer.tsx:457`, `suspendSync={showSource}` — the
suspension is correct: it is what keeps the editor from clobbering the
textarea). But the submit path reads the **editor handle unconditionally**:

- `SalonView.tsx:1578-1581` — `onSubmit` sends
  `inputRef.current?.getMarkdown() ?? input`, i.e. the hidden editor's
  pre-toggle document, even while the textarea is the visible, edited
  surface. The textarea's own onChange only writes the page's lagging
  `input` state, which the `??` never reaches while the editor mounts.
- `hasContent` is fed only by the editor's content-change
  (`SalonView.tsx:1550` ← `ChatComposer.tsx:111`), so the Send button does
  not even **enable** for text typed only in the source view.

**Consequence:** open source view over an existing draft, edit it, press
Send (or Cmd+Enter) — the **pre-edit** bytes ship and the source edits are
silently discarded. Text composed entirely in source view cannot be sent at
all (Send never lights), which is the only thing keeping the data loss
partially contained.

### The fix

On submit, read the source textarea when `showSource` (or sync the textarea
back into the editor before the handle read), and feed `hasContent` from
whichever surface is visible.

### v5 coordination

v5's composer (which gained the same source toggle at P4.9L) **diverges
deliberately**: it sends the bytes the writer can see, and one of its
mutation proofs is precisely "the source send reading the hidden editor —
i.e. v4's own bug". When v4 fixes this, the two apps converge and nothing
v5-side needs to move.
