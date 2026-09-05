# Bug 121 — an attached text file reaches the first character to answer and no one else, ever

| | |
|---|---|
| **Status** | Fixed in v4 (2026-09-04) |
| **Found** | 2026-09-04 |
| **Fixed** | 2026-09-04 |
| **Severity** | **Medium** (nothing errors and nothing is lost from disk — but in a six-character scene the document the user shared reaches exactly one model, and the other five reason from its absence or confabulate around it; every later turn in the chat, including the summarizer, is equally blind) |
| **Who it bites** | every multi-character chat where the user attaches a text file, and every chat at all from the second turn onward — the attachment chip stays visible in the UI forever, so the loss is invisible from the only surface the user watches |
| **Provenance** | Live (Friday, chat `df82edc2` *Shelves and Shared Vaults*, 2026-09-04 21:28–21:33 UTC). Reported by the user noticing that Friday said she could not read a transcript Abigail had just quoted from, and asking which of them was telling the truth |
| **Fix site** | `lib/services/chat-message/context-builder.service.ts` (`collectUnseenUserAttachmentsForCharacter`, `rehydrateUserAttachments`, `isCharactersOwnPriorResponse`) |
| **v5 status** | **Applies.** Any port that expands an attachment into prompt text at request-assembly time, and persists only the user's typed words, inherits this whole. The lesson is about *where* the expansion is stored, not about how it is produced |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-09-04).** The expansion was incidental to one HTTP request;
it is now derived on read, for every character that has not yet been shown the
file, and for every kind of attachment rather than only text.

### Symptom

Charlie attached `Amber Light and Biscuit Oaths_transcript.md` — 29,116 bytes,
`text/markdown`, `isPlainText: 1`, `fileStatus: ok` — to message `e3fc69a8` at
21:28:37, with the words *"Oh, and read this transcript."*

Abigail answered first and quoted it accurately, naming a question Laura had
asked in it. Friday answered a minute later and said:

> "I can't read that transcript from here — the tea happened in a room I wasn't
> in, and it isn't in any record I can reach."

Which of them was lying? Neither. Thirteen `CHAT_MESSAGE` calls went out after
that message, and **exactly one of them contained the file**:

| request | character | model | the transcript message |
|---|---|---|---|
| `9757495e` | Abigail | `deepseek-v4-pro` | `[Charlie] [User attached text file: Amber Light and Biscuit Oaths_transcript.md]\n\n# Amber…` — **51,092 chars** |
| `e1f9589f` … `4f949c47` (5) | Friday | `glm-5.3-flash` | `[Charlie] Oh, and read this transcript.…` — **224 chars** |
| `478799c3` … `1431cc32` (4) | Jackie | | 224 chars |
| 3 more | later turns | | 224 chars |

Abigail's message 61 is the user's turn with 28,941 characters of transcript
spliced in ahead of it, closed by `[End of attached file]`. Everyone else's
message 61 is the user's 224 typed characters and nothing else — not the file,
not a filename, not a note that an attachment existed at all.

Friday was the only participant who noticed. Jackie, third to speak, opened
*"I let the transcript settle behind my eyes a moment"* — her request did not
have it either. She then ran `doc_grep` for `"Red Cloud"` and `"entropy went"`,
got `No matches found` for both, and carried on as though she had read it. That
is the failure mode this bug produces by default: the honest answer looks like
a malfunction and the confabulated one looks like success.

### Root cause

The expansion is computed per **HTTP request** and never written down.

`fileIds` arrives only from the POST body — `request-helpers.ts:38` copies
`parsed.fileIds` onto `SendMessageOptions`, and nothing else ever sets it.
`orchestrator.service.ts:648` hands it to `loadAndProcessFiles`, which returns
early with `messageContentPrefix: ''` when the list is empty
(`context-builder.service.ts:155`). The prefix it does build is applied here:

```ts
// orchestrator.service.ts:828
const finalUserMessageContent = isContinueMode
  ? undefined
  : (fileProcessing.messageContentPrefix ? fileProcessing.messageContentPrefix + content : content)
```

and travels exactly one hop, to `newUserMessage` at `:1128`. It is an in-memory
local. The row that outlives the request is written eighty lines earlier and
stores the raw text:

```ts
// orchestrator.service.ts:740
const userMessage = {
  ...
  content,                              // the user's 224 characters
  attachments: options.fileIds || [],   // ["ca88cd9e-…"]
}
```

So the database keeps a *pointer* where the model was given *prose*, and there
is no reader that turns the pointer back into prose. The second character to
speak in a multi-character turn is a fresh POST carrying neither `content` nor
`fileIds`; its context is assembled from `chat_messages`, and `chat_messages`
holds the 224 characters. Six characters in the scene, thirteen model calls,
one of them sighted.

The one path that *does* re-hydrate attachments out of history is
`collectLanternImageFileIdsForCharacter` (`context-builder.service.ts:249`),
and its very first filter is `msg.role !== 'ASSISTANT'`. It exists to carry
Lantern backgrounds and avatars forward, and it is correct for that. A
**USER**-role message with attachments is outside its walk by construction — so
this is not specific to text: a user-uploaded *image* is one-shot in the same
way, reaching the first responder and then falling out of the world. Bug 95
fixed *which* message the bytes ride on
(`selectAttachmentAnchorIndex:515`); it did not change *how long* they ride,
and the question never came up because a single-character chat has exactly one
rider.

### Why it survived

Because the common case is a single character answering immediately, and in
that case the behaviour is perfect: attach a file, get an answer about the
file. The bug needs a second reader — another character in the same turn, or
the same character one turn later — and by then the conversation has moved on
and nobody re-asks about the attachment.

Three things then conspire to hide it:

- **The UI never stops showing the attachment.** The chip is rendered from
  `chat_messages.attachments`, which is intact and always will be. Every
  surface the user watches says the file is in the conversation.
- **There is no error, no warning, and no log line.** An empty `fileIds`
  is the overwhelmingly normal case — `loadAndProcessFiles` returning an empty
  prefix is not an anomaly to be reported, so the sighted call and the blind
  ones are indistinguishable in the logs unless you diff the request bodies.
- **Models paper over it.** A character asked about a document it cannot see
  will usually infer from context and answer plausibly, as Jackie did. It took
  a character with the disposition to say *"I can't read that from here"* — and
  a user who trusted her enough to check — for this to surface at all.

### The fix

**Re-hydrate on read** — candidate 1 of the two considered. The file stays the
single source of truth; nothing new is persisted, so the repair reaches chats
that already exist and survives regenerate, swipe, import and restore.

`collectUnseenUserAttachmentsForCharacter` is the USER-side counterpart of the
Lantern walk: same tail-walk, same "stop at the character's own prior response"
rule, but keyed on `role: USER` and returning `{ messageId, fileIds }` so each
file can be spliced back in **at the message that carried it** rather than
restated at the tail. The stop rule doubles as the budget: a character is shown
a given upload once, on its first turn after the upload, and never again — so
this costs nothing per turn thereafter. The two walks now share
`isCharactersOwnPriorResponse`, which was the three lines inside the Lantern
loop, and share one hoisted `attachmentHistoryCutoff` so a joining participant
without history access is clamped identically on both sides.

`rehydrateUserAttachments` runs each file through the **same**
`processFileAttachmentFallback` / `formatFallbackAsMessagePrefix` pair that
`loadAndProcessFiles` uses, which is what makes this general rather than
text-specific: that pass already inlines a text file, describes an image for a
provider without vision, and hands the raw bytes back (`type: 'unsupported'`
with no error) for one that has it. Text and image descriptions are spliced
into message content; raw bytes join `mergedAttachmentsToSend` and are anchored
by `selectAttachmentAnchorIndex` exactly like a Lantern image. It never throws:
an unreadable file leaves the turn as it was before this existed.

Two placement decisions worth keeping:

- **Before `buildContext`, not after.** The Lantern prefix is spliced in after
  budgeting, which is affordable for a description and would not be for a 29 KB
  transcript. Expanding into `filteredExistingMessages` means the tokens are
  budgeted, compressed and trimmed like any other message body.
- **A per-turn ceiling** (`REHYDRATED_ATTACHMENT_CHAR_BUDGET`, 80k characters)
  bounds size where the walk bounds only count, since a user may attach a
  novel. Files are taken oldest-first and what does not fit is skipped with a
  warning rather than truncated mid-document — half a transcript is a worse
  input than none, and a model given one cannot tell.

Not done: nothing was persisted to `chat_messages`, and `loadAndProcessFiles`
was left alone. The first responder still takes the request-time path; the new
walk cannot double-deliver to it, because `existingMessages` is read before the
user row is written.

### How to verify

```bash
npx jest __tests__/unit/lib/services/chat-message/context-builder.service.test.ts
```

Ten cases on the walker, including the exact reported shape (an upload between
the character's own previous turn and another character's reply), the
already-answered case that must **not** re-deliver, the single-character mode
where `participantId` is absent, the joining-character cutoff, and the lookback
cap.

End to end, verified in **V4test** on 2026-09-04 — a three-participant chat
(Tester, Lorian, Riya, all on `OPENAI/gpt-5`), driven through the real
`/api/v1/chats/[id]/messages` route and read back out of `llm_logs`:

- **Text.** A markdown file whose Article Three carries the phrase *"seventeen
  brass hinges and a quiet Tuesday"*. The first responder received it the old
  way (6,469-char user message). The **second** character's request carried it
  too — an 882-char message opening `[User attached text file: bug121-probe.md]`
  — and answered with the phrase verbatim; before this change that request was
  the typed words alone and the answer was not derivable. Both characters' next
  turns showed **no** re-expansion, confirming once-apiece.
- **Images.** A PNG of three coloured bars. `attachmentResults.sent` names the
  file on **three** separate turns, and three different participants each
  answered *"red, blue, yellow"* independently.

The original evidence is preserved in Friday, chat
`df82edc2-a4d5-4057-9894-6341552bbb4f`, LLM logs `9757495e` (sighted) against
`4f949c47` (blind).
