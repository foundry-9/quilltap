# Bug 12 — a second-generation restore loses archived link ids

| | |
|---|---|
| **Status** | Fixed in v4 (2026-08-06) |
| **Found** | 2026-08-06 |
| **Fixed** | 2026-08-06 |
| **Severity** | Medium |
| **Who it bites** | disaster-recovery of an instance that was itself restored |
| **Provenance** | Pinned |
| **Fix site** | `lib/backup/restore/carried-store-rows.ts` (`makeCarriedStoreRowsResolver`) consulted by the 22a-bis replay in `lib/backup/restore/restore.ts` — carried project-less store rows skip re-ingest |
| **v5 status** | **Owed** — retire `system_restore_state` dedupe arms (ruled `REPLAY_DEDUPE`) |
| **Index** | [bugs.md](../../bugs.md) |

---

**Severity: Medium.** This is the residue named at the end of Bug 3
(the ["Known residue from Bug 3's placement"](../../bugs.md#known-residue-from-bug-3s-placement)
note), promoted to its own
entry because v5 has since **fixed** it and v4 has not (P4.d23, 2026-07-26).

### Symptom

Restore a backup taken from an instance that was **itself** restored. v4 emits
`UNIQUE constraint failed` for the `restored` folder and for
`restored/<name>` link rows; the archived link ids are lost and the store rows
duplicate again — one more copy on every restore generation.

### Root cause

v4 re-ingests **every** user file in an archive unconditionally, so its replay
writes into `restored/<name>` — exactly where the **archived** link rows for
those files already live. The replay gets there first, so the archived rows
collide and are refused. The bytes survive (the replay wrote its own copy); the
link ids do not.

### The fix

Teach the replay to recognise that the archive already carries the store rows for
a file and skip re-ingesting it — the repair v4's own notes name and put out of
scope ([bugs.md](../../bugs.md#known-residue-from-bug-3s-placement)). v5 does exactly this
(`orchestrator.rs` → `carried_store_rows`), pinned by
`system_restore_state`'s dedupe arms as evidence the check is small and needs no
phase-order change.

**Fixed 2026-08-06.** `lib/backup/restore/carried-store-rows.ts`
(`makeCarriedStoreRowsResolver`) is consulted by the 22a-bis replay in
`restore.ts`: a project-less file whose archived `storageKey` is a `mount-blob:`
key pointing at a carried blob skips re-ingest and keeps the (remapped)
storageKey, so the archived rows restore intact at 22b–22f. No phase reorder;
first-generation archives (non-`mount-blob:` keys) still run the replay.
