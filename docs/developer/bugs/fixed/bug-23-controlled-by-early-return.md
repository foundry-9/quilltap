# Bug 23 — a `controlledBy` patch returns early, skipping the identity recompile

| | |
|---|---|
| **Status** | Fixed in v4 (2026-08-06) |
| **Found** | 2026-08-06 |
| **Fixed** | 2026-08-06 |
| **Severity** | Medium |
| **Who it bites** | changing who controls a participant |
| **Provenance** | Faithful |
| **Fix site** | `app/api/v1/chats/[id]/helpers.ts` — `handleParticipantUpdate` falls through to the shared sync + `compileAllIdentityStacks` tail |
| **v5 status** | **Owed** (Faithful) — re-rule `update_controlled_by_with_status_early_return` |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-08-06)** — `handleParticipantUpdate` (`helpers.ts`) no longer
returns inside the `controlledBy !== undefined` block; it falls through to the
shared tail so the status/`isActive` back-compat sync and
`compileAllIdentityStacks(finalChat)` run for a `controlledBy` patch too, fed by
the post-write re-read. Pinned by `helpers.participant-update.test.ts`. v5
obligation (**Faithful**): the v5 ruling
`update_controlled_by_with_status_early_return` — which pins the early-return
behaviour — must be re-ruled when this lands; mirror in the same round.

**Severity: Medium.**

### Symptom

Changing who controls a participant skips the status/`isActive` back-compat sync
and the identity-stack recompile that a participant update is supposed to run.

### Root cause

`handleParticipantUpdate` re-reads the chat and **returns** inside the
`controlledBy !== undefined` block (`helpers.ts:196`–`199`), so a patch carrying
`controlledBy` never reaches the code below it — including v4's own
`compileAllIdentityStacks(finalChat)` call, which is thereby dead. v5 pins this
with `update_controlled_by_with_status_early_return`.
