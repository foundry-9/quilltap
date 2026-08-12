# Bug 59 — a failed read reads as an empty database and triggers first-startup seeding

| | |
|---|---|
| **Status** | **FIXED in v4** |
| **Found** | 2026-08-12 |
| **Fixed** | 2026-08-12 |
| **Severity** | High (a populated instance is sent down the new-install seeding path — default characters, a duplicate embedding profile, and a full `.qtap` import — on nothing worse than a transient read failure) |
| **Who it bites** | any instance whose character read can fail at startup: another process holding the instance lock, a half-materialised iCloud database, a vault the overlay cannot reach |
| **Provenance** | Faithful — found by dogfooding on the Ignite instance, which logged `Seeding initial data for first startup` against a database holding 24 characters, 104 chats, and 10,286 messages |
| **Defect site** | `lib/startup/seed-initial-data.ts:66` — `findByUserId(...).length > 0` as the first-startup test, over `lib/database/repositories/base.repository.ts:286`, whose error fallback is `[]` |
| **Fix site** | `lib/startup/seed-initial-data.ts` + new `countOrThrow` in `lib/database/repositories/base.repository.ts` |
| **v5 status** | Owed (Faithful) |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-08-12).** Both seeding decisions now probe with
`countOrThrow` and fail closed: a probe that throws skips seeding and says so,
rather than seeding on an unanswered question. Regression tests:
[`__tests__/unit/lib/startup/seed-initial-data.test.ts`](../../../../__tests__/unit/lib/startup/seed-initial-data.test.ts).

## Symptom

Ignite's `combined.log`, on an instance with 24 characters:

```json
{"timestamp":"2026-08-12T20:30:45.592Z","level":"error","message":"Error finding entities by filter",
 "context":{"collection":"characters","error":"Another Quilltap instance ... is already using this database"}}
{"timestamp":"2026-08-12T20:30:45.592Z","level":"info","message":"Seeding initial data for first startup",
 "context":{"context":"seed-initial-data"}}
```

The read failed, and one millisecond later the app concluded the instance was
new. It then attempted, in order: the default seed characters, a default
embedding profile, a `.qtap` import (`Starting import execution`), and seed
avatars for Lorian and Riya.

Nothing landed — every write hit the same lock and failed — so the instance
survived intact. That is luck, not design. The reads and the writes failed
together only because they shared one cause.

## Root cause

Two independent pieces, each defensible alone.

**The repository layer collapses failure into emptiness.** `findByFilter` passes
`[]` as the fallback argument to `safeQuery`:

```ts
return this.safeQuery(async () => {
  ...
}, 'Error finding entities by filter', {}, []);
```

`safeQuery`'s four-argument overload logs and returns the fallback; only the
three-argument form rethrows. Every `find*` in `BaseRepository` uses the fallback
form, as does `count()` (fallback `0`). So a caller receives `[]` for "no rows",
"the database is locked", "the file is unreadable" alike — and the log line that
would distinguish them is written somewhere the caller never sees.

**Seeding treats emptiness as permission to write.** `seedInitialData` asked the
question that way:

```ts
const existingCharacters = await repos.characters.findByUserId(SINGLE_USER_ID);
if (existingCharacters.length > 0) return;   // populated — bail
logger.info('Seeding initial data for first startup', { context });
```

Given `[]`, it proceeds. `seedEmbeddingProfiles` had the identical shape over
`findAll()`.

The characters read is a particularly poor emptiness probe for a third reason
unrelated to the lock: `CharactersRepository.findByUserId` runs
`applyDocumentStoreOverlay(raw)`, and per the vault failure semantics a character
whose vault is unavailable is *dropped* from `findAll`-shaped results. A healthy
database with unreachable vaults also answers `[]`.

## Why it survived

The gap between the two pieces is where it hid. `safeQuery`'s fallback form is
correct for the callers it was built for — a list endpoint that renders empty
beats one that 500s — and the seeding check is the obvious way to write "is this
a first startup?" if you trust the read. Neither file is wrong in isolation; the
defect only exists in the composition, and nothing in either file names the
other.

It is also unobservable in every normal run. On a real first startup the
behaviour is correct. On every subsequent startup the read succeeds and returns
rows, so the branch is never taken. Reaching it needs a read failure at the
precise moment of the startup probe — and then, as here, the same failure
usually suppresses the writes that would have made it visible. The bug's own
blast radius is what conceals it.

The docstring compounds it: *"This function is designed to be safe to call
multiple times - it only seeds data when the database is truly empty."* The claim
is sincere and the code does not implement it — "truly empty" and "answered
empty" were never separated.

## The fix

A new `countOrThrow` on `BaseRepository`, the strict sibling of `count()`:

```ts
async countOrThrow(filter?: TypedQueryFilter<T>): Promise<number> {
  return this.safeQuery(async () => {
    const collection = await this.getCollection();
    return collection.countDocuments(filter);
  }, 'Error counting entities (strict)', {});   // 3-arg form — rethrows
}
```

Counting is the right probe on three axes: it rethrows instead of masking, it
runs beneath row validation so an unhydratable row still registers as present,
and it runs beneath the document-store overlay so an unreachable vault does not
subtract from the count.

Both decisions in `seed-initial-data.ts` now use it and fail closed:

```ts
let existingCharacterCount: number;
try {
  existingCharacterCount = await repos.characters.countOrThrow({ userId: SINGLE_USER_ID });
} catch (probeError) {
  logger.error('Skipping initial-data seeding — could not determine whether the database is empty', { ... });
  return;
}
```

`count()` and the `find*` family keep their fallbacks — the blast radius of
changing them is every list view in the app. The rule is narrower and stated on
`count()`'s docstring: a caller that takes a *destructive* branch on emptiness
must use the strict form.

## How to verify

Unit: `npx jest __tests__/unit/lib/startup/seed-initial-data.test.ts` — five
cases covering probe-throws (no seeding, explicit skip log), already-populated,
genuinely-empty, the embedding-profile probe, and an assertion that the probe
calls `countOrThrow` and *not* `findByUserId`, so a revert to the find-based
check fails the suite.

Manual: hold the instance lock with a second Quilltap process, start the server,
and confirm the log shows the skip line and no `Seeding initial data for first
startup`.

## Related

- Bug 58 — the lock conflict that exposed this; the migration runner's missing
  gate is the other half of the same startup.
- `project_character_vault_failure_semantics` — the overlay-drop behaviour that
  makes a `find`-based emptiness probe wrong even on a healthy database.
