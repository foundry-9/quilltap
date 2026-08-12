# Bug 36 — the "tools disabled by profile" warning box is dead code

| | |
|---|---|
| **Status** | Fixed in v4 (2026-08-06) |
| **Found** | 2026-08-06 |
| **Fixed** | 2026-08-06 |
| **Severity** | Low |
| **Who it bites** | chats whose profile forbids tools |
| **Provenance** | Faithful (v5 gated) |
| **Fix site** | `lib/services/chat-enrichment.service.ts` (+ `helpers.ts`) — project `allowToolUse` on the connection profile |
| **v5 status** | **Owed** (Faithful) — mirror the projection; v5 keeps a gated box |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-08-06)** — `getConnectionProfile`
(`lib/services/chat-enrichment.service.ts`) now projects `allowToolUse` (and the
mirror `getEnrichedConnectionProfile` in `helpers.ts` does too), so
`ChatModals.tsx`'s `allowToolUse === false` condition can finally be true and the
warning box fires for a tools-forbidding profile. The box was kept, not deleted.
Pinned by `chat-enrichment.service.test.ts` ("projects allowToolUse when the
profile forbids tools"). v5 obligation (**Faithful**, v5 keeps a gated box):
mirror the projection in the same round.

**Severity: Low.** No v4 user has ever seen it.

### Root cause

`ChatModals.tsx` renders the warning when an LLM participant's profile has
`allowToolUse === false` (the box explains the tool-settings dialog is moot). But
`getConnectionProfile` (`lib/services/chat-enrichment.service.ts:354`–`379`)
projects only `{ id, name, provider, modelName, apiKey }` — never `allowToolUse`
— so the condition is always `undefined === false` and can never be true. A chat
whose profile really does forbid tools looks identical to one that allows them.

### The fix

Add `allowToolUse` to the enrichment projection (the warning starts working) or
delete the box. v5 keeps a gated box + input so one binding turns it on if v4
grows the projection.
