# Bug 58 — migrations open the database without the instance lock

| | |
|---|---|
| **Status** | **FIXED in v4** |
| **Found** | 2026-08-12 |
| **Fixed** | 2026-08-12 |
| **Severity** | High (two processes writing one SQLCipher database — the exact WAL-corruption scenario the instance lock exists to prevent — and the writer that escapes the gate is the heaviest one there is) |
| **Who it bites** | anyone whose instance is reachable by a second Quilltap process: a Docker container plus a dev server on the same volume, two shells, an Electron shell started while a container still holds the lock |
| **Provenance** | Faithful — found by dogfooding on the Ignite instance: a Docker container took the lock at 20:28:26, a local dev server then ran ten migrations against the same database at 20:30:40 and only afterwards discovered it could not open it |
| **Defect site** | `migrations/lib/database-utils.ts:74` — `new Database(dbPath)` with no `acquireInstanceLock` call |
| **Fix site** | `migrations/lib/database-utils.ts` (`getSQLiteDatabase`) |
| **v5 status** | Owed (Faithful) |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-08-12).** `getSQLiteDatabase()` now calls
`acquireInstanceLock(getInstanceLockPath())` before opening, mirroring the
repository backend, and logs the conflicting holder before rethrowing. Regression
tests:
[`__tests__/unit/migrations/database-utils-instance-lock.test.ts`](../../../../__tests__/unit/migrations/database-utils-instance-lock.test.ts).

## Symptom

On the Ignite instance, `combined.log` records ten migrations completing
successfully and then, seventy milliseconds later, the same process discovering
it cannot open the database at all:

```json
{"timestamp":"2026-08-12T20:30:45.499Z","level":"info","message":"Migrations completed successfully",
 "context":{"migrationsRun":10,"migrationsSkipped":168,"totalDurationMs":5185}}
{"timestamp":"2026-08-12T20:30:45.561Z","level":"error","message":"Cannot open database: another instance holds the lock",
 "context":{"conflictPid":1,"conflictHostname":"2656f2de3f8a","conflictEnvironment":"docker",
            "conflictStartedAt":"2026-08-12T20:28:57.017Z"}}
```

The ordering is the tell. The lock holder had been in place for one minute and
forty-eight seconds *before* the migrations started. They should never have run.

What they did while unlocked is in `migrations_state`:

| id | itemsAffected | message |
|---|---|---|
| `quantize-embeddings-v1` | 20037 | Quantized 20037 embeddings to int8 |
| `add-episodic-memory-fields-v1` | 9212 | Episodic spine in place (9212 changes) |
| `add-doc-mount-link-groups-v1` | 1 | Added linkGroupId column; collected 1 orphaned content row |

Twenty thousand rows rewritten in a database another process believed it held
exclusively.

## Root cause

The instance lock is acquired by the SQLite *backend*, at
`lib/database/backends/sqlite/backend.ts:509`, in `connect()`:

```ts
// Acquire the instance lock before opening the database.
// This prevents two processes from writing to the same SQLCipher
// database simultaneously, which causes WAL corruption.
acquireInstanceLock(getInstanceLockPath());
```

Every repository read and write inherits that gate. The migration runner does
not use the backend. It has its own connection, opened in
`migrations/lib/database-utils.ts`:

```ts
ensureSQLiteDataDir();
const dbPath = getSQLitePath();
const db = new Database(dbPath);   // no lock
```

So the gate guarded everything except the one caller that rewrites whole tables.
`instrumentation.ts` compounds it by ordering startup correctly for every other
purpose — PHASE 1 runs migrations "FIRST - before anything else", ahead of the
backend connect that would have refused — which means the unlocked writer always
runs before anything can discover the conflict.

## Why it survived

The lock was introduced for the repository layer, and the migration runner's
separate connection predates it. Nothing links the two: the comment explaining
*why* the lock matters lives in `backend.ts`, three directories away from the
code that ignores it, and the migration path's own connection setup looks
complete on its face — it sets the SQLCipher key, WAL, foreign keys, and a busy
timeout, so it reads as a considered configuration rather than one with a hole
in it. The 5-second `busy_timeout` is the specific thing that makes it look safe:
it addresses SQLite-level contention, which is a different problem from two
processes sharing a WAL, and its presence answers the question a reviewer would
have asked.

The failure is also invisible in the ordinary case. One Quilltap per instance is
the norm; the lock is never contended, so migrations never notice the gate they
are missing. It takes a second process on the same data directory to expose it,
and then the damage is silent — WAL corruption does not announce itself at the
point of the write.

## The fix

`getSQLiteDatabase()` acquires the lock before opening, and refuses to proceed
if another live process holds it:

```ts
try {
  acquireInstanceLock(getInstanceLockPath());
} catch (lockError) {
  if (lockError instanceof InstanceLockError) {
    logger.error('Cannot run migrations: another instance holds the database lock', { ... });
  }
  throw lockError;
}
```

Acquisition is re-entrant for the same PID, so the backend connecting later in
startup simply re-claims the lock this call already took — the server sees no
behavioural change when it is the only process on the instance.

`closeSQLite()` deliberately does **not** release. In the server the migration
runner closes its connection while the process keeps running under the same lock
(`instrumentation.ts` cleans up the runner's connection immediately after PHASE
1), so releasing there would drop the lock the server still needs and stop its
heartbeat. Release stays with the normal shutdown handlers; a process that dies
without releasing leaves a same-host lock that the next acquisition reaps as
stale via `isPidAlive`.

A failed acquisition now propagates out of `runMigrations()`, and
`instrumentation.ts:419` already treats a migration failure as fatal
(`process.exit(1)`) — which is the correct outcome. Refusing to start is
strictly better than starting by corrupting the database.

## How to verify

Unit: `npx jest __tests__/unit/migrations/database-utils-instance-lock.test.ts`
— asserts the lock is acquired *before* `new Database` (by invocation order),
and that a held lock prevents the open entirely rather than merely logging.

Manual: start a Quilltap container against an instance, then start a second
Quilltap against the same data directory. Before the fix the second one runs
migrations and only then reports the lock conflict; after it, the second one
reports the conflict without touching the database.

## Related

- Bug 59 — the same lock conflict, read through the repository layer's `[]`
  fallback, put a populated instance on the first-startup seeding path.
