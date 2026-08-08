# Bug 10 — `conversation_annotations` is wiped by no delete path

| | |
|---|---|
| **Status** | Fixed in v4 (2026-08-06) |
| **Found** | 2026-08-06 |
| **Fixed** | 2026-08-06 |
| **Severity** | **High** |
| **Who it bites** | delete-all; restore |
| **Provenance** | Pinned |
| **Fix site** | `lib/backup/restore/delete-service.ts` — added to `clearFormat3Entities` `mainTables` (covers `deleteUserData`); `lib/database/repositories/chats.repository.ts` `delete()` — per-chat `deleteAllForChat` sweep |
| **v5 status** | **Owed** — retire `system_delete_data_equivalence` → `ANNOTATION_DIVERGENCE_KEY` (v5 = 0, oracle non-zero) |
| **Index** | [bugs.md](../../bugs.md) |

---

**Severity: High.** A privacy leak on delete-all and a hard restore failure on a
migrated instance (dogfood #57).

### Symptom

"Delete all my data" leaves `conversation_annotations` rows behind. And a
restore into a migrated instance fails with
`UNIQUE constraint failed: conversation_annotations.chatId, messageIndex,
characterName`.

### Root cause

`conversation_annotations` appears on **no** delete path in v4:

- it is absent from `clearFormat3Entities`' `mainTables`
  (`lib/backup/restore/delete-service.ts:34`),
- `deleteUserData` never collects it, and
- `chats.repository.delete()` sweeps only the message rows.

The `UNIQUE` constraint that turns this into a restore failure is a migration
artifact — `migrations/scripts/sqlite-initial-schema.ts` and
`create-conversation-tables.ts` both declare
`UNIQUE("chatId","messageIndex","characterName")` (the older adds
`FOREIGN KEY("chatId") … ON DELETE CASCADE`), while `generateDDL` emits neither.
So only a *migrated* instance reproduces the restore failure; every instance
leaks on delete-all.

### The fix

Add `conversation_annotations` to the delete-all table list. v5 does this via
`delete_all.rs`'s `V5_EXTRA_MAIN_TABLES`, pinned both directions by
`ANNOTATION_DIVERGENCE_KEY` in `system_delete_data_equivalence` (v5 must be 0,
the oracle must be non-zero — v4 converging fails the test).

**Fixed 2026-08-06.** Added to `clearFormat3Entities`' `mainTables`
(`lib/backup/restore/delete-service.ts`, which covers `deleteUserData` since it
routes through it) and a per-chat sweep via `deleteAllForChat` in
`chats.repository.ts#delete()`.

**DDL drift confirmed (out of scope, noted per the session spec).** The
`UNIQUE("chatId","messageIndex","characterName")` constraint and the
`FOREIGN KEY … ON DELETE CASCADE` are declared only by the migrations
(`sqlite-initial-schema.ts` / `create-conversation-tables.ts`), not by
`generateDDL` — which builds `conversation_annotations` from the Zod field
metadata and expresses neither a composite UNIQUE nor a foreign key. So a
*migrated* instance hard-fails restore on the UNIQUE and gets FK-cascade cleanup
on chat delete, while a *fresh* (generateDDL) instance has neither — which is
exactly why the leak-on-delete bites every instance but the restore hard-fail
only migrated ones. `DDL.md` documents the migrated shape and stays accurate;
reconciling `generateDDL` to emit the same constraint is a separate follow-up.
