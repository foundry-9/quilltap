# Bug 95 — the image rode on "your response model is now X" instead of the user's message

| | |
|---|---|
| **Status** | Fixed in v4 (2026-08-23) |
| **Found** | 2026-08-23 |
| **Fixed** | 2026-08-23 |
| **Severity** | **Medium** (degraded grounding on every regenerate/swipe; total attachment loss after a tool call) |
| **Who it bites** | every chat with images — the misplacement is invisible and the loss case is silent |
| **Provenance** | Live (Friday, chat `9d1155d9`, 2026-08-23 04:04 and 04:05 UTC), found while tracing bug 91 |
| **Fix site** | `lib/services/chat-message/context-builder.service.ts` (`selectAttachmentAnchorIndex`), `lib/chat/context-manager.ts`, `lib/chat/context/message-selector.ts` |
| **v5 status** | **Applies.** Any port that re-roles staff whispers to `user` inherits this exactly: after that transform, "role is user" no longer means "the user said it", and anything keying off the tail needs a different signal. |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-08-23).** The attachment was anchored by position, and the
position stopped meaning what it used to.

### Symptom

From the logged requests for the turn where the user shared an illustration,
the message actually carrying the image bytes:

| model | anchor message | length |
|---|---|---|
| `deepseek-v4-flash-vision-exp` | *"Abigail's current response model is now NANOGPT/deepseek/…"* | 124 chars |
| `grok-4.20-reasoning` | a Prospero group-context memorandum | 1,284 chars |

The user's actual message — *"No, I mean 'underground' like… Like this one"* —
sat three and four messages earlier with no attachment on it, while the
Librarian's announcement in the same transcript told the model *"The bytes ride
with the user's message above."*

### Root cause

`context-builder.service.ts`:

```ts
const isLastUserMessage = idx === formattedContextMessages.length - 1 && msg.role === 'user'
```

Two independent failures in one line.

**Misplacement.** `normalizeWhisperRoles` re-roles Staff whispers to `role:
USER` — deliberately, and for a good reason (Anthropic 4.6+ rejects
`assistant` tails, bug 85). After that transform `role === 'user'` no longer
distinguishes the human from the Host, Prospero, the Librarian or a
connection-profile-change bubble. On a fresh turn the anchor is correct, because
`newUserMessage` is pushed last. On a **regenerate or swipe** there is no new
user message: the human's words are back in history and whatever whispers
accumulated since are the tail.

**Total loss.** After a tool call the last message is `assistant` or `tool`, so
`isLastUserMessage` is false everywhere and `mergedAttachmentsToSend` is
dropped without a log line.

Both matter because a vision model binds an image to the text around it.
"Abigail's current response model is now…" is close to the worst available
framing for a picture the user is asking about.

### Why it survived

The happy path is the common path, and it is correct: type a message, attach an
image, get an answer. The bug needs a regenerate, a swipe, or a tool call to
appear, and even then the model usually answers plausibly enough — it *has* the
image, just badly introduced — so the output does not look wrong. The
attachment-loss case produced no error either, only a slightly vaguer reply.

### The fix

`selectAttachmentAnchorIndex(contextMessages, userTurnMessageIds)` — a pure,
exported, unit-tested function preferring, in order:

1. `metadata.isUserTurn`, stamped by the context manager where `newUserMessage`
   is appended;
2. the last `role: user` message whose source row was a genuine human turn —
   the regenerate/swipe case;
3. the last `role: user` message of any kind. This is the old behaviour, kept
   deliberately as a floor: a context shape we have not anticipated should
   still deliver the bytes *somewhere* rather than discard them.

Returning `-1` (no user-role message at all) now logs a warning instead of
failing mutely.

Making (2) possible needed a small amount of identity plumbing: the source row
id survives `selectRecentMessages` (it was being dropped), lands on
`ContextMessage.metadata.messageId`, and the set of genuine human turns is
captured in `buildMessageContext` **before** `normalizeWhisperRoles` erases the
distinction. `formatMessagesForProvider` is a pure `map`, so an index chosen
against `builtContext.messages` applies unchanged to the formatted array.

The Lantern description prefix moved to the same anchor — it had the same
problem for the same reason.

### How to verify

```bash
npx jest __tests__/unit/lib/services/chat-message/attachment-anchor.test.ts
```

The test set includes the exact observed shape: a user message followed by
Librarian, Host and profile-change whispers, all wearing `role: user`.

End to end in V4test: attach an image, let the character answer, then hit
regenerate. Confirm from `llm_logs` that the attachment sits on the user's own
message and not on a trailing whisper.
