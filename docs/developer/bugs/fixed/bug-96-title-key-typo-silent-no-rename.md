# Bug 96 — a two-letter typo in the model's JSON reads as "this chat is fine as it is"

| | |
|---|---|
| **Status** | Fixed in v4 (2026-08-23) |
| **Found** | 2026-08-23 |
| **Fixed** | 2026-08-23 |
| **Severity** | **Medium** (no data loss; a chat silently keeps its generic title, never receives a story background, and burns the checkpoint that would have retried) |
| **Who it bites** | anyone whose cheap-LLM profile is a small/fast model — the smaller the model, the likelier the key drift. Group chats worst, since their default title is the least informative |
| **Provenance** | Live (Friday, chat `745e8a5e`, 2026-08-23 22:18:10 UTC): `deepseek/deepseek-v4-flash-latest` returned `needsNewTitle: true` with the title under `suggestTitle` |
| **Fix site** | `lib/memory/cheap-llm-tasks/title-verdict.ts` (new), `lib/memory/cheap-llm-tasks/chat-tasks.ts` (both title-consideration parsers), `lib/background-jobs/handlers/title-update.ts` |
| **v5 status** | **Applies.** Any port that reads a structured verdict out of a cheap model inherits this exactly — see the rule at the bottom |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-08-23).** The model said yes. We read it as no, because it
misspelled the key by two letters.

### Symptom

A six-character group chat kept the title `Group Chat (6 characters)` through
seven interchanges of substantial conversation, and no story background ever
appeared. Both were reported together, and the working hypothesis was
environmental — the volume was at 96% capacity, and this instance has a history
of iCloud-materialisation faults.

It was neither. The `TITLE_UPDATE` job ran, spent its tokens, and reported
`COMPLETED`.

### Root cause

From `llm_logs` entry `2d4c4102`, the model's reply in full:

```json
{
  "needsNewTitle": true,
  "reason": "The current title is generic and doesn't reflect the content. ...",
  "suggestTitle": "The Beast's Hundred Gigajoules"
}
```

`suggestTitle`, where the prompt asked for `suggestedTitle`. A good title, a
correct verdict, under a key two letters short of the one being read.

The parser in `chat-tasks.ts` read `parsed.suggestedTitle`, got `undefined`,
and coerced it with `suggestedTitle: suggestedTitle || null`. The handler's
guard then folded three distinct outcomes into one branch:

```ts
if (!result.result || !result.result.needsNewTitle || !result.result.suggestedTitle) {
  // "No rename needed" — advance the checkpoint and return
```

*The model declined*, *the model was unreadable*, and *the model agreed but we
could not find its answer* are not the same event, and only the first justifies
advancing the cursor.

Two consequences, both of which the user saw:

1. **The title never changed.** `lastRenameCheckInterchange` advanced to 7, so
   the next attempt was not until interchange 10 — where an identical stumble
   would burn that checkpoint too, and the one after, indefinitely.
2. **The story background never queued.** `queueStoryBackgroundIfEnabled` is
   called *only* from the rename-succeeded branch, using the new title as its
   `sceneContext`. No rename, no background: `storyBackgroundImageId` and
   `lastBackgroundGeneratedAt` were both still `NULL`, and no
   `STORY_BACKGROUND_GENERATION` job had ever been enqueued for the chat.

The second symptom is the more instructive one. One unread key in one cheap
call took out an entire unrelated-looking subsystem, because that subsystem's
only trigger hangs off this call's success.

### Why it survived

Nothing failed. The job completed, the LLM log recorded a well-formed response
with a sensible verdict in it, the token spend showed up in the system events,
and the cursor advanced exactly as a legitimate decline would advance it. There
is no error, no warning, no retry, and no field left visibly empty — the chat
simply keeps a title that a reasonable person might believe the model chose to
keep.

It is also intermittent by nature. The same model titled three other chats
correctly the same afternoon (16:16, 16:25, 16:33 UTC). Key drift is a dice
roll, so the feature looks like it works, occasionally doesn't, and never says
which.

Both title parsers carried the same 25 lines, duplicated verbatim, so there was
one bug in two places — and the help-chat copy was additionally mislabelled
`consider-title-update`, making its LLM logs indistinguishable from the regular
path's had anyone gone looking.

### The fix

`lib/memory/cheap-llm-tasks/title-verdict.ts` is now the single parser for both
tasks. It:

- **Tolerates near-miss keys**, canonical first: `suggestedTitle`,
  `suggestTitle`, `newTitle`, `proposedTitle`, `title`. A second pass folds
  case and separators away (`suggested_title`, `SUGGESTED-TITLE`,
  `SuggestedTitle`), so casings are handled by rule rather than by enumeration.
  The list is deliberately short: every entry has to be unambiguously *the new
  title* inside a response object whose only subject is the new title, and the
  canonical key always wins when a model emits more than one.
- **Says when it had to reach.** Recovering a title from a non-canonical key
  logs a warning naming the key the model actually used. The recovery is not
  the point — the visibility is. A provider that starts drifting should be
  legible in the logs before it is legible in the symptom.
- **Says when it could not reach far enough.** `needsNewTitle: true` with no
  usable title under any key now warns in the parser *and* in the handler,
  which names the chat and the checkpoint it is about to burn.

`stripCodeFences` stays the single source for fence-stripping, `MAX_TITLE_LENGTH`
replaces the twice-written `60`/`57`, and both call sites are one line each.

The safe direction is unchanged: an unparseable response still resolves to *no
new title*, because the failure mode of guessing is renaming a chat to
something the model never said.

### Known coupling, deliberately left standing

Story-background generation still fires only from the rename-succeeded branch.
That means a chat whose title is *already good* — the common steady state of any
long conversation — never receives a background either, which is a wider
behavioural question (and an image-generation cost question) than this bug.
Recorded here so the next person to meet the symptom knows where it comes from;
decoupling is a separate decision, not a bug fix.

### How to verify

```bash
npx jest lib/memory/cheap-llm-tasks/__tests__/title-verdict.test.ts
```

The suite pins the exact live payload from `llm_logs` entry `2d4c4102`, each
tolerated key spelling, the canonical-key-wins precedence, and — importantly —
that a genuine `needsNewTitle: false` is still honoured when a title happens to
be present.

In V4test: open a chat on a small cheap-LLM profile, run it past interchange 2,
and confirm the rename lands and a `STORY_BACKGROUND_GENERATION` job follows it.
Then grep the logs for `[Title Verdict]` — silence there is the healthy state.

### The rule

A structured verdict from a cheap model has two failure modes, and only one of
them is *the model said no*. Reading a missing field as a decision is how a
provider's stumble becomes a product behaviour — and it stays invisible for
exactly as long as the code that reads it declines to say it reached for
something and found nothing. Sibling of bugs 84 and 94 (a field with no
reader), inverted: here the reader was present and read the wrong key, which is
quieter still.
