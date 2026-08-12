# Bug 60 — the documented key-file backup procedure copies nothing

| | |
|---|---|
| **Status** | **FIXED in v4** |
| **Found** | 2026-08-12 |
| **Fixed** | 2026-08-12 |
| **Severity** | High (a user follows the documented backup procedure, both `cp` commands fail, and they believe their encryption key is backed up when nothing was copied — discovered only when the key is needed, at which point the databases are unrecoverable) |
| **Who it bites** | anyone backing up an instance by following BACKUP-RESTORE.md, DEPLOYMENT.md, or the in-app help; and anyone reading DDL.md's data-directory listing |
| **Provenance** | Faithful — found by dogfooding on the Ignite instance, which was the only instance with a `quilltap-llm-logs.dbkey`; tracing why led to the docs |
| **Defect site** | `docs/BACKUP-RESTORE.md:361` (key path missing the `data/` component, plus a `cp` of a file most instances lack), `docs/developer/DDL.md:20-22` (two key files that do not exist), `lib/startup/dbkey.ts:554` (the write that created the one that sometimes does) |
| **Fix site** | `lib/startup/dbkey.ts`, `lib/paths.ts`, `lib/startup/version-guard.ts` + BACKUP-RESTORE.md, DEPLOYMENT.md, DDL.md, DATABASE_ENCRYPTION.md, `help/database-protection.md`, `help/data-directory.md`, `help/system-backup-restore.md` |
| **v5 status** | Owed (Faithful) |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-08-12).** The vestigial second key-file write is removed, and
every document that names a `.dbkey` path now names the real one. Regression
coverage rides in the existing
[`dbkey.test.ts`](../../../../__tests__/unit/lib/startup/dbkey.test.ts) and
[`version-guard.test.ts`](../../../../__tests__/unit/lib/startup/version-guard.test.ts)
suites.

## Symptom

The documented way to protect your encryption key, from BACKUP-RESTORE.md:

```bash
cp ~/Library/Application\ Support/Quilltap/quilltap.dbkey /secure/location/
cp ~/Library/Application\ Support/Quilltap/quilltap-llm-logs.dbkey /secure/location/
```

Both commands fail. The key files live in the `data/` subdirectory — the real
path is `~/Library/Application Support/Quilltap/data/quilltap.dbkey` — and the
second file does not exist on most instances at all.

The failure mode is what makes this severe. `cp` reports two "No such file or
directory" errors, of which the second is *expected* to a reader who has been
told the llm-logs file is a real thing, which invites reading the first as the
same kind of noise. The user proceeds believing the key is safe. Without that
file the databases cannot be opened by anything, ever; the discovery happens at
precisely the moment the backup was supposed to help.

The Docker restore block at `:495` had the same missing `data/` component, and
DEPLOYMENT.md told users the llm-logs file was required to decrypt their
databases.

## Root cause

Two layers, and the documentation is the one that bites.

**The docs describe an architecture that was never built.** DDL.md's
data-directory listing claimed three key files, one per database:

```
├── quilltap.dbkey            # Encryption key file (main DB)
├── quilltap-llm-logs.dbkey   # Encryption key file (LLM logs DB)
├── quilltap-mount-index.dbkey # Encryption key file (mount index DB)
```

`quilltap-mount-index.dbkey` has never existed — no code has ever referenced it,
and no instance has one. The actual design is one pepper per instance, wrapped
once in `quilltap.dbkey`; all three client modules
(`lib/database/backends/sqlite/{client,llm-logs-client,mount-index-client}.ts`)
read `ENCRYPTION_MASTER_PEPPER` rather than a key file of their own. Mount-index
is the proof the single file suffices: three databases, one key, no third file,
working fine.

**One limb of the abandoned design survived in code.** `changePassphrase()` wrote
a byte-identical copy to `quilltap-llm-logs.dbkey`. It was the sole creator —
`setupDbKey()` and `storeEnvPepperInDbKey()`, the other two writers of the main
file, never touched it — which is why the file appears only on instances whose
passphrase was changed *after* provisioning. On this machine that was one
instance out of four. Nothing read it; the only other code that touched it was
`version-guard`, stamping a version into a file no reader consults.

That asymmetry is also a latent hazard. `needs-vault-storage` is defined as "env
var set but no `.dbkey`", and that existence check reads the main path only. So:
lose `quilltap.dbkey`, supply the pepper via `ENCRYPTION_MASTER_PEPPER` (the
documented Docker path), and `storeEnvPepperInDbKey` rewrites the main file
alone — leaving the llm-logs copy holding the *old* pepper under the *old*
passphrase. A file that looks like a peer, holding key material that no longer
opens anything.

## Why it survived

The docs and the code drifted apart in opposite directions and neither drift was
observable. Documentation has no test; a wrong path in a backup procedure fails
only in the hands of a user doing something they hope never to need, and the
error it produces is a shell error rather than an application one, so nothing
ever surfaced it to the project.

The code half hid behind its own naming. `quilltap-llm-logs.dbkey` sits beside
`quilltap-llm-logs.db` and reads as obviously correct — a key file for that
database — which is exactly what the docstring claimed ("separate `.dbkey` file
for operational isolation"). Nobody checks whether a file that plainly belongs is
actually read. And its creation being confined to `changePassphrase` meant most
instances never grew one, so the inconsistency between instances that would have
prompted the question was itself rare.

## The fix

The write is gone, along with `getLLMLogsDbKeyPath` (from both `lib/paths.ts` and
`lib/startup/dbkey.ts`) and the version-guard stamp. `DBKEY_FILENAME` now carries
the reasoning so the removal is not re-added by someone reading the old docs.

The existing files on disk are deliberately **not** reaped. Deleting key material
on the user's behalf is the wrong instinct even when the material is known
redundant; the docs and help now tell users the file is inert and safe to remove,
and leave the decision with them.

Every document naming a `.dbkey` path was corrected: the `data/` component
restored in BACKUP-RESTORE.md (three places) and DEPLOYMENT.md, the phantom key
files removed from DDL.md, the per-database claim corrected in
DATABASE_ENCRYPTION.md, and the two help files that named the file `.dbkey`
rather than `quilltap.dbkey` (`help/database-protection.md`,
`help/data-directory.md`) fixed — the former also gained an explicit warning
about aiming a backup one directory too high, since that is the failure this bug
is made of.

## How to verify

Unit: `npx jest __tests__/unit/lib/startup/dbkey.test.ts
__tests__/unit/lib/startup/version-guard.test.ts` — the dbkey suite asserts the
module exposes no per-database key path, and the version-guard suite asserts the
version stamp is written exactly once.

Manual: change an instance's passphrase from Settings and confirm only
`data/quilltap.dbkey` is written. Then run the backup command as documented and
confirm it copies a real file.

## Related

- Bugs 58 and 59 — the same dogfooding session on Ignite; the stale lock there is
  what put the instance's data directory under inspection in the first place.
