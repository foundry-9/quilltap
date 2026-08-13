# Bug 64 — first-run encryption setup wedges every database connection until the process is restarted

| | |
|---|---|
| **Status** | **Open** |
| **Found** | 2026-08-13 |
| **Fixed** | — |
| **Severity** | High (every fresh instance hits it at the one moment a new user is forming a first impression; the whole app errors on every database operation until a manual restart. No data is lost — the encryption conversion itself completes correctly — but nothing tells the user that a restart is the cure) |
| **Who it bites** | anyone standing up a new instance: the moment the first-run setup screen displays the generated encryption key, every repository call in the server starts failing with `The database connection is not open`, and keeps failing until the process is stopped and started again. Docker/standalone users bite hardest — the log flood is the only evidence, and the setup UI itself reports success |
| **Provenance** | Dogfooding: observed 2026-08-13 starting a fresh Docker instance; the production log shows the session route, `instance_settings` reads, scheduled housekeeping and maintenance all failing with `TypeError: The database connection is not open` immediately after setup, and a restart clearing it |
| **Defect site** | `app/api/v1/system/unlock/route.ts` — `handleSetup` (~159–197) calls `closeSQLiteClient()` out-of-band; the closed handle stays cached in `SQLiteBackend.db` (`lib/database/backends/sqlite/backend.ts:479`, early-return at `:499-501`) behind the manager's initialized-forever cache (`lib/database/manager.ts:94-99`, `:163-169`) |
| **Fix site (proposed)** | `app/api/v1/system/unlock/route.ts` (`handleSetup`, `handleLock`) — tear down through `closeDatabase()` and re-run `initializeDatabase()` after conversion; `lib/database/backends/sqlite/backend.ts` (`disconnect()` closes mount-index too; optional liveness self-heal). See [The fix](#the-fix-spec) |
| **v5 status** | Design note for the native port: key setup / lock / unlock must reset every cached DB handle through one chokepoint, atomically — the port must not reproduce v4's three-layer singleton stack where the bottom layer can be closed behind the top two |
| **Index** | [bugs.md](../bugs.md) |

---

## Symptom

Start a brand-new instance (no `.dbkey`, no `ENCRYPTION_MASTER_PEPPER`). The
server boots fully, the browser shows the first-run encryption setup, you
submit it, and the UI displays the generated key with "Save this value — it
will not be displayed again."

From that moment the instance is dead. The log fills with:

```
Raw query failed … "error":"The database connection is not open"
SQLite find error … "table":"background_jobs" …
Error finding entity by ID … "collection":"users","id":"ffffffff-…" …
Failed to get or create single user … TypeError: The database connection is not open
```

Every surface fails the same way: the session route (`getOrCreateSingleUser`),
`instance_settings` reads, the scheduled housekeeping and maintenance timers,
job reaping — anything that touches a repository. The HTTP server itself keeps
serving, so the failure looks like a mystery rather than a crash.

Stopping and restarting the process fixes it completely, and the instance is
fine thereafter.

## Root cause

Three singleton layers each keep their own copy of "the database is open", and
the setup handler closes only the bottom one.

**The stage.** On a fresh instance `provisionDbKey()` returns `needs-setup`,
which is *not* locked mode — only `needs-passphrase` sets `isLockedMode`
(`lib/startup/startup-state.ts:320-323`). So `instrumentation.ts` runs the
entire startup: migrations create a plaintext database, the backend connects
(`createSQLiteBackend()` → `connect()`, `backend.ts:909-911`), repositories,
timers and the setup UI all come up against it. This is deliberate — the
handler's own comment says so ("on fresh installs the database is created
during migrations (Phase 1) before the user runs setup").

**The trigger.** Submitting the form hits
`POST /api/v1/system/unlock?action=setup` → `handleSetup`
(`app/api/v1/system/unlock/route.ts:144-204`), which:

1. generates the pepper, writes `.dbkey`, and puts the pepper in
   `process.env` (`setupDbKey`, `lib/startup/dbkey.ts:405-434`);
2. closes the migrations connection and then the **main app singleton** via
   `closeSQLiteClient()` (`route.ts:167-177`) — which closes the
   better-sqlite3 handle and nulls the `globalThis` slot
   (`client.ts:159-186`);
3. converts the main and LLM-logs database files to SQLCipher
   (copy → encrypt → `renameSync` over the original,
   `lib/startup/db-encryption-converter.ts:57`);
4. returns the pepper for one-time display.

**The wedge.** Nothing above the client layer hears about the close:

- `SQLiteBackend` captured the handle at connect time into `this.db`
  (`backend.ts:479`, `:539`) and its `_state` is still `'connected'`, so even
  if `connect()` were called again it would early-return (`:499-501`). Nothing
  calls it.
- The manager cached the backend on `globalThis` with
  `__quilltapDatabaseInitialized = true` (`manager.ts:94-99`), so
  `getDatabaseAsync()` (`:163-169`) hands back the wedged backend forever.
  `closeDatabase()` (`manager.ts:196`) — the function built for exactly this
  teardown — has **zero callers** in the codebase.
- Repositories fetch a fresh collection per operation
  (`base.repository.ts:100-114`), but `backend.getCollection()`
  (`backend.ts:678`) wraps the dead handle, and better-sqlite3 throws
  `TypeError: The database connection is not open` at the first `prepare`.

**Why restart heals it.** On the next boot, Phase -0.5a resolves the pepper
from `.dbkey` before anything opens a database; the (now encrypted) file opens
with the key; the backend connects fresh. The conversion in step 3 did its job
correctly — only the live process's view of the world was broken.

## Secondary defects in the same handler

These ride along and should be fixed in the same pass:

1. **The LLM-logs client is left open while its file is converted.**
   `handleSetup` closes only the migrations and main connections, but the
   conversion list (`route.ts:179`) includes `getLLMLogsDatabasePath()`. The
   still-open llm-logs singleton now points at the *unlinked pre-conversion
   inode*: subsequent LLM-log writes land in a ghost file and are lost, and
   because the singleton is non-null, `getLLMLogsSQLiteClient` never reopens
   against the encrypted file either.
2. **The mount-index database is not converted at setup at all.** Phase -0.5b
   converts it on the *next restart* (`instrumentation.ts:357`), so
   document-store bytes sit plaintext on disk until then — against the
   handler's own stated intent ("no window where data sits unencrypted on
   disk").
3. **`handleLock` has the same disease** (`route.ts:387-431`): it closes the
   main and llm-logs clients out-of-band and never touches the backend or the
   manager. `handleUnlock`'s deferred `register()` re-run does not reset the
   manager (nothing does), so the auto-lock → unlock cycle almost certainly
   wedges identically, without even a restart prompt. Needs an explicit
   verification pass, but the code path is the same.

## Why it survived

- **Setup runs exactly once per instance lifetime.** Developers run with the
  pepper already in the environment or an existing `.dbkey` and never see the
  setup screen; anyone who did hit it naturally restarted (or re-created the
  container) and the problem vanished.
- **The failure is quiet where the user is looking.** The setup UI completes
  and shows the key; HTTP keeps serving; the errors go to the log. Nothing on
  screen says "restart me".
- **Each layer is individually correct.** The client singleton nulls itself on
  close; the backend caches its handle exactly as a connection pool would; the
  manager memoizes initialization exactly as an idempotent init should. The
  bug lives in the seam: an out-of-band `closeSQLiteClient()` respects only
  the bottom layer's invariant.

## The fix (spec)

The principle: **any code that closes database connections behind the
backend's back must instead tear down and rebuild through the manager.** The
chokepoint already exists — `closeDatabase()` — it just has no callers.

1. **`handleSetup`: teardown through the manager, then reconnect.**
   - Before conversion: keep closing the migrations connection, then replace
     the raw `closeSQLiteClient()` with `await closeDatabase()`
     (`lib/database/manager.ts:196`) — `backend.disconnect()` closes the
     llm-logs and main clients, releases the instance lock, and the manager
     clears its cached backend and initialized flag — and close the
     mount-index client as well (see item 3).
   - Convert **all three** databases: main, llm-logs, and mount-index —
     mirroring Phase -0.5b's list, closing item 2 of the secondary defects.
   - After conversion: `await initializeDatabase()` before returning the
     success response. `connect()` reopens the main DB with the pepper now in
     `process.env`, re-acquires the instance lock, and brings the llm-logs and
     mount-index clients back up (`backend.ts:560-606`). The response then
     reports success only when the app is actually usable — the UI needs no
     change.
   - Note the window: between `disconnect()` and `connect()` the instance
     lock is briefly released while the files are swapped. Single-process
     this is fine (that is precisely why the files can be renamed); the spec
     accepts it and the reconnect re-acquires.
2. **`handleLock`: same treatment.** Replace the raw client closes with
   `await closeDatabase()` so the manager cache clears; unlock's first
   repository call then lazily re-initializes through
   `getDatabaseAsync() → initializeDatabase() → connect()` with the restored
   pepper. Verify the full auto-lock → unlock cycle end to end (it has
   presumably never worked without a restart).
3. **`SQLiteBackend.disconnect()` closes the mount-index client.**
   `connect()` opens all three databases; `disconnect()` closes only two
   (`backend.ts:621-646`). Make them symmetric rather than special-casing the
   mount-index close at call sites.
4. **Hardening (optional but cheap):** in `backend.getCollection()` /
   `rawQuery`, if `this.db` is non-null but `this.db.open === false`
   (better-sqlite3 exposes `.open`), re-fetch via
   `getSQLiteClient(this.config)` instead of handing out the dead handle.
   That turns any *future* out-of-band close into a self-heal instead of a
   process-lifetime wedge.
5. **Regression coverage:**
   - a unit test (real-binding, `@jest-environment node`, per the Jest
     conventions) that initializes the manager, runs the
     teardown-convert-reinitialize sequence, and asserts a repository
     operation succeeds afterward — and a companion asserting the *old*
     sequence (out-of-band `closeSQLiteClient()` alone) is what the new code
     no longer does;
   - ideally an integration test of `?action=setup` asserting a subsequent
     `GET /api/v1/session` succeeds in the same process.

## How to verify

1. Fresh instance (empty data dir), `npm run dev` or the Docker image. Let it
   boot fully; confirm the setup screen.
2. Complete setup (once with a passphrase, once without, on two fresh dirs).
   The key is displayed.
3. **Without restarting:** load the app — `GET /api/v1/session` returns 200
   and the dashboard works; `logs/combined.log` shows **no**
   `The database connection is not open` after the setup timestamp; send a
   chat message and confirm an `llm_logs` row lands (item 1 of the secondary
   defects).
4. Check encryption on disk immediately after setup: the first 16 bytes of
   `data/quilltap.db`, the llm-logs DB **and the mount-index DB** are not the
   plaintext `SQLite format 3\0` header.
5. Restart; confirm the instance still comes up clean (Phase -0.5b finds
   nothing left to convert).
6. Auto-lock cycle: set a passphrase, trigger `?action=lock`, unlock with the
   passphrase, and confirm repositories work without a restart.
