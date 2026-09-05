# Bug 112 — a chat's "last updated" was the last time anything changed, so Staff announcements floated dead conversations to the top

| | |
|---|---|
| **Status** | FIXED in v4 (2026-08-30) |
| **Found** | 2026-08-30 |
| **Fixed** | 2026-08-30 |
| **Severity** | Medium (nothing is lost or corrupted, but the chat list — the primary way anyone finds their way back into their work — is ordered by the wrong thing, and the wrong thing is noisier than the right thing) |
| **Who it bites** | Everyone, on every list of chats: the home dashboard, the Salon list, a project's conversations, a character's conversations, the merge picker, the Brahma Console |
| **Provenance** | Reported 2026-08-30: "I want a chat's last updated time, in sorts and lists and pretty much anywhere it's used, to be the last time a character (the user or an LLM) posted content. Not the last time anything changed in the chat, like a background image or summary or other announcement being added." |
| **Defect site** | `lib/database/repositories/chats-messages.ops.ts` — `addMessage`/`addMessages` bumped `lastMessageAt` on `validated.type === 'message'`, and `app/api/v1/characters/[id]/handlers/get.ts` re-derived the same wrong value by hand from `msg.type === 'message'` |
| **Fix site** | New chokepoint `lib/chat/chat-activity.ts` (`isCharacterAuthoredMessage`, `CHARACTER_AUTHORED_MESSAGE_FILTER`, `chatActivityAt`, `byChatActivityDesc`); the two write sites gated on it; every sort/display site routed through it; backfill migration `recompute-chat-last-message-at-v1` |
| **v5 status** | Not investigated. **The shape applies** to any port that stores synthetic/system messages in the same table as conversational ones: "newest row" stops being "newest turn" the moment a non-character can write a row, and every ordering built on it silently inherits the error |
| **Index** | [../bugs.md](../bugs.md) |

---

**FIXED in v4 (2026-08-30).** `lastMessageAt` now moves only when a character
— the human user or an LLM — posts content, per the single predicate
`isCharacterAuthoredMessage`. Existing rows are recomputed under the same rule
by `recompute-chat-last-message-at-v1`. Readers fall back to `createdAt`, not
`updatedAt`, when no character has ever posted.

## Symptom

A conversation nobody had touched in months would reappear at the top of the
chat list, dated moments ago, having had nothing said in it. The list is sorted
newest-first, so this is not cosmetic: it displaces the conversations the user
actually is in the middle of.

The triggers were all invisible to the reader — a story background finishing
its render, a context summary being folded, a Concierge notice, a Commonplace
Book recall whisper, a Host presence announcement, a Pascal roll, a Suparṇā
mail delivery. Each of them is the *house* moving, not the conversation.

## Root cause

Two independent instances of the same wrong test.

**The write path.** `lib/database/repositories/chats-messages.ops.ts` stamped
the column on any message row:

```ts
const isActualMessage = validated.type === 'message';
if (isActualMessage) {
  updateData.lastMessageAt = now;
  updateData.updatedAt = now;
}
```

`type === 'message'` distinguishes a message from a `context-summary` or
`system` event — it does **not** distinguish a character from the Staff. Every
personified feature persists its announcements as `type: 'message'` rows
carrying a `systemSender` (that is what gives them an avatar and a name in the
Salon). So did raw `TOOL` result rows and user announcement bubbles. All of
them counted.

**The read path.** `app/api/v1/characters/[id]/handlers/get.ts` ignored the
stored column and recomputed its own from the same wrong filter:

```ts
const messageTimestamps = allMessages
  .filter((msg) => msg.type === 'message')
  .map((msg) => new Date(msg.createdAt).getTime());
```

Two copies of one mistake, which is why fixing only the column would have left
a character's conversation list still wrong.

Compounding both: the display fallback was `lastMessageAt ?? updatedAt`. Even
with the column corrected, a chat where only the Staff had ever spoken would
have fallen straight back onto the drifting timestamp the fix exists to escape.

## Why it survived

The correct predicate already existed and was already in production — but for
something else. `getLastPlayedMessageAt` was written for the stale-chat asset
sweep, whose whole job is knowing that a Lantern whisper is not activity; its
doc comment says so explicitly. Nothing connected that judgement to the
timestamp shown to the reader, and the sweep is invisible maintenance, so the
two never got compared. The codebase ended up with three different answers to
"what counts as a message" — `getLastPlayedMessageAt`, `isConversationalMessage`
(summary files, which additionally drops whispers by spec), and the bare
`type === 'message'` in the write path.

## The fix

`lib/chat/chat-activity.ts` is now the one place that answers the question.

- **`isCharacterAuthoredMessage(event)`** — `type: 'message'`, role `USER` or
  `ASSISTANT`, no `systemSender`, no `customAnnouncer`. Whispers
  (`targetParticipantIds`) deliberately **count**: a character murmuring to one
  other character is still a character speaking, and a room full of whispering
  is not a room gone quiet. Staff announcements, announcement bubbles, and raw
  tool rows deliberately do not.
- **`CHARACTER_AUTHORED_MESSAGE_FILTER`** — the SQLite mirror, so the indexed
  lookup and the in-memory predicate cannot drift.
- **`chatActivityAt(chat)`** — `lastMessageAt ?? createdAt`. The fallback is
  `createdAt`, never `updatedAt`.
- **`byChatActivityDesc`** — the comparator every chat list sorts by.

Gated on it: both write sites; `getLastPlayedMessageAt` (so staleness and
display now agree by construction); deletion, which recomputes the column so it
walks *backwards* when the newest character message is removed; the character
conversations route, whose hand-rolled derivation is gone; the enrichment
service, project chats, Brahma Console, self-inventory, and AI import.

`recompute-chat-last-message-at-v1` rewrites the column for every existing chat
under the same rule, clearing it to NULL where no character ever posted.

One neighbouring defect surfaced while checking the fix against backup/restore
and fell to the same chokepoint. Restore replays a chat's transcript through
`addMessage`, which stamps `lastMessageAt` with the wall clock — so a restored
instance dated *every* chat to the instant of the restore, landing the whole
history in one flat heap at the top of the list. `lib/backup/restore/restore.ts`
now re-derives the column from the transcript it just wrote, via
`getLastPlayedMessageAt`. (Pre-existing, and previously masked: `updatedAt` was
flattened by the same replay, so both candidates were wrong together. Making
`lastMessageAt` the sole authority is what made it worth fixing.)

`updatedAt` is untouched and keeps its meaning — "anything about this row
changed". It is simply no longer what the reader is shown.

## How to verify

1. Open a chat that has been quiet for a while and generate a story background
   for it. The chat's date in every list must not move.
2. Post a message in it as the user. The date moves to now, everywhere.
3. Delete that message. The date walks back to the previous character message.
4. `npx jest chat-activity chats-messages-last-activity chat-enrichment` — the
   predicate, the write-side gate, and the list ordering.
5. On an existing instance, the startup screen shows *"Re-reading each
   conversation to find when a soul last actually spoke in it…"* once.
6. `npx jest restore-field-fidelity` — a restore puts the real activity dates
   back rather than stamping its own.
