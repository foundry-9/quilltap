# Bug 67 — a send made from the composer's raw-source view discards every source edit

| | |
|---|---|
| **Status** | **Fixed in v4** |
| **Found** | 2026-08-14 (the v5 port's P4.9L composer-toolbar lane, reading the send path while porting the source toggle; verified against v4 source by an independent review the same day) |
| **Fixed** | 2026-08-14 |
| **Severity** | Medium (silent loss of typed text) |
| **Who it bites** | anyone who opens "Edit markdown source" in the Salon composer, edits, and sends |
| **Provenance** | v5 port survey |
| **Fix site** | new `app/salon/[id]/composer-source-mode.ts` (`resolveComposerSubmitText` / `resolveComposerHasContent`), applied at `SalonView.tsx`'s submit and `hasContent` feed |
| **v5 status** | v5 **diverges deliberately** — it sends the bytes the writer can see (the source textarea's, when showing), pinned by `chat-composer.toolbar.spec.ts` (one of its mutations is exactly this v4 bug); v4 has now converged and that mutation stops being a divergence |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-08-14).** Which surface is authoritative is now decided in
one place — new `app/salon/[id]/composer-source-mode.ts`, a sibling of
`whisper-visibility.ts` in the same directory:

- `resolveComposerSubmitText(showSource, sourceValue, editorMarkdown)` — in
  source view the page's `input` (what the textarea shows and edits) ships; in
  rich mode the editor handle still wins, with `input` as the not-mounted
  fallback. `SalonView.tsx`'s `onSubmit` calls it instead of reading
  `inputRef.current?.getMarkdown() ?? input` unconditionally.
- `resolveComposerHasContent(showSource, sourceValue, editorHasContent)` — in
  source view the textarea's own value gates Send, so the button cannot be held
  shut (or held open) by a presence flag the suspended editor is no longer
  updating.

Post-send clearing already covered both surfaces: `clearComposerInput('')`
writes the page state *and* calls `inputRef.current?.setMarkdown('')`, so the
hidden editor does not keep the sent draft.

**One correction to the entry below.** The claim that "Send does not even
enable for text typed only in the source view" did not hold as written:
the textarea's `onChange` runs the page's `setInput`, which sets
`hasComposerContent` itself (`SalonView.tsx:168-171`), so Send did light. What
was true — and what the fix nails down — is that the flag was being maintained
by two writers with only one of them tied to the visible surface. The data loss
on send is exactly as described.

**Not fixed here (unchanged, pre-existing):** Ctrl/Cmd+Enter does nothing in the
source textarea — the keyboard send lives in the Lexical `KeyboardPlugin`, which
is hidden in source view, so the Send button is the only send route there.
Source-view edits are likewise outside draft persistence, which is fed by the
editor's debounced `onPersistDraft`. Both are papercuts of their own, not part
of the byte-source defect.

Regression coverage: `__tests__/unit/app/salon/composer-source-mode.test.ts`
(11 cases across both helpers, including the exact bug — a source-view send with
a stale handle behind it).

**The original entry follows.**

The Salon composer's raw-source view (`showSource`) renders a
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
