# Bug 92 — every image tool was custodial, so models used `attach_image` to try to see

| | |
|---|---|
| **Status** | Fixed in v4 (2026-08-23) |
| **Found** | 2026-08-23 (long-standing; user reports noticing it "for a while") |
| **Fixed** | 2026-08-23 |
| **Severity** | **Medium** (wasted turns and a dead-end error loop; the character cannot answer a direct question about a picture) |
| **Who it bites** | every character in every chat where an image appears — worse on non-vision models, which have no other route to the content |
| **Provenance** | Live (Friday, chat `9d1155d9`, 2026-08-23 04:04 UTC) plus a standing user observation that "all the LLMs think they need to use `attach_image` to read or keep an image" |
| **Fix site** | `lib/tools/describe-image-tool.ts` (new), `lib/tools/handlers/doc-edit/photo-handlers.ts` (`handleDescribeImage`), `lib/tools/attach-image-tool.ts`, `lib/tools/keep-image-tool.ts`, `lib/tools/list-images-tool.ts`, `lib/services/librarian-notifications/writer.ts` |
| **v5 status** | **Applies as a design rule.** A tool vocabulary must contain a verb for every intent a model actually has. Any port needs the looking verb from the start, not the three filing verbs. |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-08-23).** A missing verb, and copy that pointed at the
wrong one.

### Symptom

Abigail, handed an uploaded illustration, called:

```json
{"toolName":"attach_image","success":false,
 "result":"Error: No kept image found for uuid 71fcab67-… in Abigail's vault.
           Call keep_image first to save it."}
```

She wanted to look at the picture. `attach_image` takes a photograph out and
holds it up to the room; it shows the caller nothing. The error then told her
to *file* it — filing advice in answer to a looking question — and the next
attempt improvised a reaction instead.

### Root cause

The complete image vocabulary was three custodial verbs:

| tool | what it does |
|---|---|
| `keep_image` | file it in my album |
| `attach_image` | hold it up to the room again |
| `list_images` | what have I filed? |

There was **no** `describe_image`, `view_image` or equivalent anywhere in
`lib/tools/`. `doc_read_blob` with `include_bytes` returns base64 inside a tool
result *string*, which no provider interprets as vision, so it is not a route
either.

Faced with "what is in this picture?" and a menu with no answer to it, a model
picks the closest-sounding option. Of the three, only `attach_image` sounds
like engaging with the image rather than administering it.

**And Quilltap actively recommended it.** The Librarian's upload announcement
(`writer.ts:759`) read:

> The bytes ride with the user's message above; the image may be filed away
> later with keep_image, or **re-summoned with attach_image**.

Two verbs offered, both custodial, and no statement that a vision-capable model
is already looking at the thing. The model was following instructions.

### The galling part

The content was already on disk. Chat uploads are auto-described on arrival
(`lib/photos/auto-describe-attachment.ts`). For this very image, at 04:00:44 —
two minutes before the user's message — Grok produced a 3,427-character
description and persisted it to the FileEntry. Nothing could reach it: no tool
read `FileEntry.description`, and the describe-fallback only fires for a
profile that cannot take images at all.

### Why it survived

The failure is polite. `attach_image` returns a clean, accurate error; nothing
crashes; the model recovers by writing something plausible. From the
transcript it reads as a character being coy about a picture, not as a tool gap.
It took a user noticing the same wrong call across many models and many months
to name it as a defect in the vocabulary rather than in the models.

### The fix

**`describe_image(uuid)`** — the looking verb. It resolves any handle a
character might hold (image-v2 file uuid, `generate_image` id, Librarian
catalogue handle, or an album link uuid) and answers with the best description
available:

1. `FileEntry.description` — written at upload by auto-describe. Free.
2. `generationRevisedPrompt` / `generationPrompt` — for Quilltap-generated
   images, the most faithful account available. Free.
3. Otherwise a vision call via `autoDescribeChatImageAttachment`, which
   persists the result so the next caller lands in case 1.

It deliberately does **not** require the image to be in the caller's album. The
album requirement is what made `attach_image` a dead end, and reproducing it
here would rebuild the trap.

**`attach_image` stays, and keeps its job** — it is genuinely useful for showing
a picture to the room. Its description now says in as many words that it does
not let you see anything, and names `describe_image` for that. Its
not-found error does the same, so a model that still guesses wrong is
redirected rather than sent to file things. `keep_image` and `list_images` got
the same treatment ("This is filing, not looking").

**The Librarian's announcement was rewritten** to state that a vision-capable
model is already looking at the image, to name `describe_image` for models that
aren't or that want the particulars in words, and to disclaim the other two
explicitly: *"neither of those shows it to you."* A regression test asserts
`describe_image` appears **before** `attach_image` in that copy.

### How to verify

```bash
npx jest __tests__/unit/librarian-notifications-upload.test.ts __tests__/unit/lib/tools/handlers/doc-edit-handler-photos.test.ts
```

In V4test: upload an image on a **non**-vision profile and ask the character
what it shows. It should call `describe_image` and answer from the stored
description, without a `keep_image` round-trip.
