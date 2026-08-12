# Bug 29 — a user-initiated tool card wears the last speaker's face

| | |
|---|---|
| **Status** | Fixed in v4 (2026-08-06) |
| **Found** | 2026-08-06 |
| **Fixed** | 2026-08-06 |
| **Severity** | Medium |
| **Who it bites** | anyone running a tool from the composer |
| **Provenance** | Faithful |
| **Fix site** | `app/salon/[id]/group-tool-messages.ts` — `resolveToolRowAttributionMessage` heads a `initiatedBy: 'user'` TOOL row as the operator (USER row), suppressing the positional borrow; character rows unchanged |
| **v5 status** | **Owed** (Faithful) — mirror at `chat-view-model.ts::resolveToolAvatar` |
| **Index** | [bugs.md](../../bugs.md) |

---

**Severity: Medium.**

**FIXED in v4 (2026-08-06)** — the positional borrow is extracted into
`resolveToolRowAttributionMessage` (`app/salon/[id]/group-tool-messages.ts`) and
now heads a TOOL row with `initiatedBy: 'user'` as the operator (resolved as a
USER row) instead of borrowing the nearest preceding assistant's participant;
character-initiated rows keep the borrow. `VirtualizedMessageList.tsx` calls the
helper. Pinned by `group-tool-messages.test.ts`. v5 obligation: same-round
mirror at `chat-view-model.ts::resolveToolAvatar`.

### Symptom

Run an RNG/tool from the composer. Its own line correctly reads "You ran rng.",
but the card is headed with an unrelated character's avatar and bold name — the
last participant to speak.

### Root cause

The pending tool result is persisted with `initiatedBy: 'user'` and **no**
`participantId` (`orchestrator.service.ts:611`–`630`). The renderer does a
positional borrow — a TOOL row with no participant takes the nearest preceding
assistant's participant, stopping at a USER boundary
(`VirtualizedMessageList.tsx:228`–`247`) — and because the tool row is written
*before* the user's message, that's whoever spoke last. The name block is
`ToolMessage.tsx:428`–`443`.

### The fix

Suppress the positional borrow when `initiatedBy === 'user'` and head the row
with the operator. v5's borrow (`chat-view-model.ts::resolveToolAvatar`) is a
verbatim port; the two sides move together.
