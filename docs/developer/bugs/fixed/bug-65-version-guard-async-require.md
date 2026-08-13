# Bug 65 — the version guard has been silently inert since 2026-08-12: a sync `require()` of an async module returns `{}`

| | |
|---|---|
| **Status** | **Fixed in v4** |
| **Found** | 2026-08-13 |
| **Fixed** | 2026-08-13 |
| **Severity** | Medium-High (a safety gate that reports success while doing nothing. Nothing is corrupted *by* the bug, but the one guard standing between an older binary and a newer database has been off since 2026-08-12, and the failure is logged at `error` in a place nobody reads on a healthy boot) |
| **Who it bites** | anyone who runs an older Quilltap against a database a newer Quilltap has already migrated — the exact accident the guard exists to refuse. Electron users additionally lose the pre-launch check, since `minServerVersion` is never written into `.dbkey`. On a fresh instance the stored version is never recorded at all, so *every* instance created since 2026-08-12 has no version floor whatsoever |
| **Provenance** | Noticed 2026-08-13 while verifying the [bug 64](fixed/bug-64-setup-stale-db-handle.md) fix on a fresh instance — two `error` lines at the top of every boot log, `isSQLiteBackend is not a function`, present identically on unmodified `HEAD` |
| **Defect site** | `lib/startup/version-guard.ts:50-54` and `:141-145` — both do `require('@/migrations/lib/database-utils')` synchronously. Since `migrations/lib/database-utils.ts:34-37` gained a static import of `lib/database/backends/sqlite/instance-lock` (commit `02821db6`, 2026-08-12, the bug 58 fix), that module is an **async module** in Turbopack's server graph, and a sync `require()` against one returns an exports object that is never populated |
| **Fix site** | `lib/startup/version-guard.ts` (both functions `async` + `await import`, failures announced through the migration-warnings channel), `instrumentation.ts` (both call sites awaited), `eslint.config.mjs` (a `no-restricted-syntax` rule that fails the build on a sync `require` of `migrations/` from app code), `__tests__/unit/lib/startup/version-guard.test.ts` (effect assertions + a source-level pin) |
| **v5 status** | Design note for the native port: the version floor is a real requirement and its v4 implementation had never been exercised before this fix. Port the *behaviour* from this spec, and give it a test that asserts a blocked launch rather than asserting "no exception" |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-08-13).** Both guard functions are now `async` and reach
`migrations/lib/database-utils` with `await import(...)`, matching every other
app-side reach into `migrations/`; `instrumentation.ts` awaits both. The import
edge in `database-utils.ts` was deliberately left alone — unwinding it would
have left the next static import free to break the guard again, silently.

Three things beyond the one-line mechanism:

- **The guard can now say it is broken.** Both catch arms still allow startup,
  but they also push a warning into the migration-warnings channel
  (`startupState.addMigrationWarning`), which surfaces to the user rather than
  dying at `error` level in a log nobody reads on a healthy boot. The announcer
  is itself wrapped, so a broken warning path cannot turn a non-fatal guard
  failure into a fatal startup failure.
- **A lint rule replaces the tribal knowledge.** `no-restricted-syntax` in
  `eslint.config.mjs` fails the build on `require('@/migrations/…')` — and on
  the relative form — anywhere in `lib/`, `app/`, `components/`, or `hooks/`.
  The next occurrence is a build failure instead of a silent no-op.
- **The tests assert the effect.** The suite now asserts that
  `storeCurrentVersion()` writes `highest_app_version` with the running
  version, that a failed guard announces a warning, and — since Jest resolves
  modules synchronously and cannot reproduce Turbopack's async-module
  classification — a source-level pin that the file contains no sync `require`
  of the migration utilities.

Verified end to end on a fresh instance (all five steps below): no
`isSQLiteBackend is not a function` in the log, `Stored current version in
instance_settings` at `info`, the row present and rewritten on the next boot,
`minServerVersion` written into `.dbkey` once one exists, and a stored value of
`99.0.0` producing the block screen ("A Most Regrettable Anachronism") instead
of a normal startup.

## Symptom

Every boot, in `logs/combined.log`, two `error` lines:

```
Version guard check failed — allowing startup to proceed   error: isSQLiteBackend is not a function
Failed to store current version in instance_settings       error: isSQLiteBackend is not a function
```

The server starts normally and nothing else appears wrong. That is the whole
problem: both messages are the *catch* arms, both are deliberately non-fatal,
and the guard they belong to is doing nothing at all.

Two observable consequences:

- **The floor is never written.** A fresh instance created today never gets an
  `instance_settings.highest_app_version` row. Confirmed on the V4test instance
  (created 2026-08-13): the row does not exist. On the Friday instance the row
  exists but reads `4.8.0` — frozen at the last version that ran *before*
  2026-08-12, despite Friday having been the daily driver through 4.8.1, 4.8.2
  and 4.8.3.
- **`minServerVersion` is never written into `.dbkey`.**
  `storeMinServerVersionInDbKeys` (`version-guard.ts:217`) is the last statement
  in `storeCurrentVersion`, and the throw happens on its first line, so the
  Electron shell's pre-launch version check has nothing to read.

Because `checkVersionGuard()` returns `{ blocked: false }` from its catch, an
older binary opens a newer database without complaint.

## Root cause

`checkVersionGuard()` and `storeCurrentVersion()` both open with:

```ts
const {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
} = require('@/migrations/lib/database-utils');
```

`require()` there is not Node's — it is the bundler's. Turbopack classifies a
module as **async** when its import graph reaches something it must load
asynchronously, and a synchronous `require()` of an async module hands back the
module's exports object *before the module body has run*. The object is real,
so the destructure succeeds; every property on it is `undefined`, so the first
call throws `isSQLiteBackend is not a function` and lands in the catch.

Measured directly, by instrumenting `checkVersionGuard` on an unmodified tree
and booting a fresh instance:

```
require('@/migrations/lib/database-utils')
  → { typeofMod: 'object', keys: [], hasEsModule: false,
      typeofIsSQLiteBackend: 'undefined', default: undefined }

// still empty one microtask later — this never resolves, it is not a race:
require(...) after await Promise.resolve()
  → { keys: [], typeofIsSQLiteBackend: 'undefined' }

await import('@/migrations/lib/database-utils')
  → { keys: ['closeDatabase', 'closeSQLite', 'detectDatabaseBackend',
             'ensureSQLiteDataDir', 'executeSQLite', 'getSQLiteDatabase',
             'getSQLitePath', 'getSQLiteTableColumns', 'isSQLiteBackend',
             'querySQLite', 'sqliteTableExists', 'testSQLiteConnection'],
      typeofIsSQLiteBackend: 'function' }
```

**What made the module async**, confirmed by experiment: `migrations/lib/database-utils.ts:34-37`

```ts
import {
  acquireInstanceLock,
  InstanceLockError,
} from '../../lib/database/backends/sqlite/instance-lock';
```

Replacing that one static import with a lazy `require()` inside
`getSQLiteDatabase()` and rebooting flips the sync `require()` in version-guard
to fully populated (`__esModule: true`, `isSQLiteBackend` a function). The edge
is the trigger; nothing else in the file changed.

That import arrived in **`02821db6`** (2026-08-12), the fix for bug 58 —
migrations were opening the database without the instance lock. The fix is
correct and must stay. It simply had an invisible second effect: it pulled
`database-utils` into async territory and, with it, disabled the only two
call sites in the app that reach that module synchronously.

The timeline corroborates it exactly. `02821db6` is dated 2026-08-12; the
version bump off `4.8.0` (`6c7e235b`) is the same day; and Friday's stored
`highest_app_version` is stuck at `4.8.0`.

## Why it survived

- **Both failures are caught and downgraded by design.** The guard's own
  comment says so: "We don't want a bug in the guard to brick the server." That
  is the right instinct and it is exactly what hid this — the guard cannot
  distinguish "nothing to block" from "I am broken", and both return
  `{ blocked: false }`.
- **The success path is silent and the failure path is noisy in the wrong
  place.** A healthy boot logs `Stored current version in instance_settings` at
  `info`; nobody notices its absence.
- **The two sites are the only synchronous `require('@/migrations/...')` in the
  entire app.** Every other app-side reach into `migrations/` uses
  `await import(...)`, which is immune. There was no second call site to fail
  alongside them and draw attention.
- **Nothing tests it.** There is no test asserting that the guard actually
  blocks, or that a version is stored. A test that only asserts
  "startup did not throw" passes against a guard that does nothing.

## The fix (spec)

1. **Make both functions async and use `await import(...)`.**
   `checkVersionGuard()` becomes `Promise<VersionGuardResult>` and
   `storeCurrentVersion()` becomes `Promise<void>`; both replace the
   `require(...)` with `await import('@/migrations/lib/database-utils')`. This
   matches the convention everywhere else in the app and does not depend on any
   bundler classification staying put. Update the two call sites in
   `instrumentation.ts` (Phase 0.5, and the post-migration store) to `await`.
2. **Do not "fix" it by unwinding the import edge in `database-utils.ts`.**
   The lazy-require experiment above proves the mechanism but is the wrong
   remedy: it leaves the next static import anyone adds free to break the guard
   again, silently. The async-safe call site is the durable fix.
3. **Distinguish "broken" from "clear".** The catch in `checkVersionGuard`
   should keep allowing startup, but should surface the failure somewhere a
   user or maintainer will see — a `startupState` warning, or the
   migration-warnings channel that already exists for exactly this class of
   "startup noticed something" message. A guard that cannot tell you it is
   broken is not a guard.
4. **Regression coverage.** At minimum: a unit test that `storeCurrentVersion()`
   writes `highest_app_version`, and that `checkVersionGuard()` returns
   `blocked: true` when the stored version is higher than the current one —
   both asserting *the effect*, not the absence of a throw. Ideally an
   integration check that boots twice and asserts the row is present and
   current after the first boot.
5. **Consider a lint rule.** `require('@/migrations/...')` from `lib/` or `app/`
   is never correct under the bundler. A targeted `no-restricted-syntax` rule
   would make the next occurrence a build failure rather than a silent one.

## Repair for existing instances

None strictly required — the fix writes the correct value on the next boot.
Note that every instance created since 2026-08-12 will jump straight from "no
row" to the current version, which is the desired end state. Instances stuck at
an old value (Friday at `4.8.0`) will simply be corrected upward. No instance
should be blocked by the repair, since the stored value can only be lower than
or equal to the version doing the storing.

## How to verify

1. On a fresh instance (empty data dir), boot fully. `logs/combined.log` must
   contain **no** `isSQLiteBackend is not a function`, and must contain
   `Stored current version in instance_settings` at `info`.
2. `npx quilltap db --instance <name> "SELECT key, value FROM instance_settings
   WHERE key='highest_app_version';"` returns the running app's version.
3. Restart and confirm the value is rewritten (not just created once).
4. On an instance with a `.dbkey`, confirm `minServerVersion` now appears in the
   file and matches the running version.
5. Prove the guard actually blocks: set the stored value to an impossibly high
   version (`quilltap db --write ... UPDATE instance_settings SET value='99.0.0'
   WHERE key='highest_app_version'`), restart, and confirm startup halts with
   the version-guard block screen rather than proceeding. Restore the value
   afterwards.
