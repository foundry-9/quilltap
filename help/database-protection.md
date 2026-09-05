---
url: /settings?tab=system
---

# Database Protection

Quilltap automatically protects your databases against corruption and data loss. These protections run silently in the background — no configuration is needed.

## Encryption at Rest

Your databases are not merely tucked away in a drawer, as one might store a perfectly ordinary biscuit tin — they are *locked inside a vault*, the combination to which only Quilltap itself possesses. Every database file Quilltap creates is encrypted on disk using **SQLCipher**, an industry-standard encryption extension for SQLite that has been scrutinising secrets since before most current programming languages were born.

### What This Means for You

**The files are unreadable without the key.** Should some uninvited personage — a snooping sibling, an overcurious IT department, or the sort of fellow who goes through other people's filing cabinets at parties — gain access to your data directory, they would find nothing but a rather elegant arrangement of entirely meaningless bytes. The standard `sqlite3` command-line tool, which one might otherwise employ to peek at the raw data, cannot open these files; it simply throws up its hands in polite bewilderment.

**Backups are also encrypted.** The physical backup files Quilltap creates are byte-for-byte copies of the encrypted database. They are equally unreadable without the key. This is, on balance, rather the point.

### The Key File

The encryption key is stored in a file called **`quilltap.dbkey`**, in the `data/` subdirectory of your data directory — for example, `~/Library/Application Support/Quilltap/data/quilltap.dbkey` on macOS. Note the `data/` part particularly: the key file keeps company with the database files themselves, not with the folder above them, and a backup command aimed one level too high will copy nothing at all while appearing to succeed. This file is managed entirely by Quilltap; you need not concern yourself with its contents under ordinary circumstances.

There is exactly **one** key file per instance, and all three databases open with it. Should you find a `quilltap-llm-logs.dbkey` sitting beside it, that is a relic of an older arrangement: nothing reads it, it may hold an out-of-date copy of the key, and it is safe to delete. Do not mistake it for a spare.

> **Back up your `quilltap.dbkey` file alongside your database.** If you copy your database to another machine without it, the database will be as useful as a very expensive paperweight. When backing up your data directory, ensure the key file travels with it.

### Locked Mode (Optional Passphrase Protection)

For those who require a second bolt on the door, Quilltap supports **locked mode**: the `.dbkey` file itself may be protected with a passphrase. When a passphrase is set, Quilltap cannot open the database at startup until the passphrase is supplied — the application will wait at the locked screen, like a very well-trained butler who knows better than to admit anyone without the password.

Locked mode is configured via environment variable. Consult the [Data & System settings](/settings?tab=system) for details.

### Changing or Removing Your Passphrase

Should you wish to rotate your passphrase — an exercise in security hygiene that the prudent practitioner undertakes with the same regularity as winding a pocket watch — you may do so from **Settings > Data & System > Encryption Passphrase**. This operation re-wraps the encryption key inside a fresh `.dbkey` file; it does *not* re-encrypt the database itself (there is no need, as the underlying key remains unchanged).

You may also *remove* a passphrase entirely, should you decide that the convenience of automatic unlocking outweighs the additional protection. Simply leave the "New Passphrase" field empty when changing. Conversely, you may *add* a passphrase where none existed before by leaving the "Current Passphrase" field empty and providing a new one.

After changing your passphrase, the new passphrase will be required the next time Quilltap starts.

### Rebuilding a Lost or Locked Key File

Here we must be precise about what is lost, because the distinction is the whole of the matter. The `.dbkey` file does not *contain* your data's protection; it merely holds the key in a small locked box of its own. The key itself — that 44-character string Quilltap displayed exactly once at first-run setup, urging you in the strongest terms to write it down — is the thing the databases actually answer to.

Which means: **if you kept the key, nothing is lost.** Not when the `.dbkey` file has gone missing. Not when the passphrase that guards it has slipped your mind entirely, leaving Quilltap waiting at the locked screen with the patience of a doorman who has never once been told the password. A new key file can be built from the key, and the establishment reopens.

With the server stopped, from a terminal:

```bash
# Paste the key at the hidden prompt — or set ENCRYPTION_MASTER_PEPPER first
npx quilltap instances restore-key Friday
```

You will be asked for the key (the typing does not show, as is only proper), and then for a passphrase to guard the rebuilt file — leave it blank for none. Before it writes so much as a byte, it tries your key against every encrypted database it finds and reports what it discovers:

```
  quilltap.db                  opens with this pepper ✓
  quilltap-llm-logs.db         opens with this pepper ✓
  quilltap-mount-index.db      opens with this pepper ✓
```

Should a database decline, the command declines with it. This is deliberate and not negotiable: a key file holding the *wrong* key is a considerably worse companion than no key file at all, since Quilltap would open it, believe it, and then announce that your perfectly intact database has been corrupted. Any previous key file is set aside as `quilltap.dbkey.bak-<timestamp>` rather than discarded.

Two provisos, neither of which is fine print:

- **The server must be down.** A running Quilltap holds the key in memory and will not notice a file rewritten beneath it; the command refuses while the instance lock is held, and says so.
- **Archived characters are keyed to the passphrase, not to the key.** If you rebuild with a *different* passphrase than the one in force when a character was packed away, that bundle still wants the old one — and this offline route cannot rewrite it. Rotating a passphrase you still remember is therefore better done from **Settings > Data & System**, which re-encrypts every archive as it goes.

Without the key, there is no such rescue, and no one — ourselves emphatically included — can furnish one. Write it down. Put it somewhere that is not the machine.

### Auto-Lock (Idle Timer)

For those who prefer their security to be proactive rather than merely passive — the sort of arrangement whereby the valet not only guards the strongbox but also locks it again should the master wander off for a cup of tea — Quilltap offers an **auto-lock** feature.

When enabled, Quilltap monitors your activity (or, more precisely, the absence thereof). After a configurable number of minutes of idleness, it quietly closes the database connections, clears the encryption key from memory, and redirects you to a locked screen. One simply re-enters the passphrase, and the application resumes precisely where it left off, as though the interruption had never occurred.

Every ledger is shuttered when the lock falls — the main database, the conversation logs, and the document-store index together — and every one of them is opened again on your passphrase. The establishment need not be stopped and started to come back to its senses; it merely wakes up.

**To configure auto-lock:**

1. Navigate to **Settings > Data & System > Auto-Lock** (or use the navigation tool below)
2. Enable the "Automatically lock after idle period" toggle
3. Set the desired number of minutes (default: 15, minimum: 1)

**Important notes:**
- Auto-lock requires a passphrase to be set — without one, there is nothing to lock behind
- A warning notification appears approximately one minute before locking
- Upon re-entering your passphrase, you are returned to the exact page you were on
- If you are in the middle of an LLM conversation, the active stream will be interrupted — security, regrettably, does not wait for the end of a sentence

### Accessing the Database Directly

Since the standard `sqlite3` CLI cannot open encrypted databases, Quilltap provides its own subcommand for direct database queries — useful for troubleshooting, migrations, and the occasional moment of diagnostic curiosity:

```bash
# List all tables
npx quilltap db --tables

# Run a query
npx quilltap db "SELECT COUNT(*) FROM characters;"

# Interactive REPL
npx quilltap db --repl

# Query the LLM logs database instead
npx quilltap db --llm-logs --tables

# Use a custom data directory
npx quilltap db --data-dir /path/to/data --tables
```

### Tidying Up the Premises

From time to time — particularly after a great churn of message deletion, log pruning, or document-store reshuffling — the databases will accumulate unused pages and grow stale query-planner statistics. A spot of housekeeping reclaims the disk space and restores the planner's wits:

```bash
# VACUUM + ANALYZE + PRAGMA optimize on every database
npx quilltap db optimize

# Or operate on a single database
npx quilltap db optimize main
npx quilltap db optimize llm-logs
npx quilltap db optimize mount-points
```

The command refuses to proceed while a Quilltap instance still has the database in its grasp — VACUUM rewrites the entire file, an operation which brooks no concurrent writers. Stop the running instance first (or, in the case of a stale lock left behind by a previous crash, consult `quilltap db --lock-status` and `--lock-clean`).

### Taking a Snapshot Without Stopping the Server

When you want a frozen copy of the encrypted databases — for an off-host backup, for forensic spelunking, or simply for the comfort of having a known-good moment recorded — `quilltap db backup` will oblige without asking you to close the application:

```bash
# Snapshot all three databases to a fresh timestamped directory under data/backups/
npx quilltap db backup

# Snapshot only one, to a directory of your choosing
npx quilltap db backup main --out /tmp/qtap-snap
npx quilltap db backup llm-logs --out ~/Desktop/llm-logs-snap
```

Unlike `optimize`, the snapshot operation is **safe alongside a running instance**. Behind the scenes it forces a Write-Ahead-Log checkpoint, takes a brief exclusive lock on the source database, copies the encrypted file byte-for-byte to the destination, and releases the lock — typically a matter of milliseconds for any database of reasonable size. The destination inherits the source's encryption key transparently (the pages are already encrypted), so the snapshot opens with the same `.dbkey` and passphrase as the original. After each copy, Quilltap re-opens the snapshot with the same key and runs `PRAGMA quick_check` to ensure it really is readable; any verification failure halts the operation with a clear complaint.

The default destination is `<dataDir>/backups/<ISO-timestamp>/`, so successive runs never collide. Pass `--out <dir>` to send the snapshot elsewhere. `--json` emits per-target source/dest paths, byte sizes, and durations for scripts that want to know exactly what happened.

### Online Health Checks

Closely related, and equally safe alongside a running instance: `quilltap db integrity` runs SQLite's structural `integrity_check` pragma together with SQLCipher's `cipher_integrity_check` pragma, which together catch both ordinary corruption and any encryption-layer mischief.

```bash
# Check all three databases
npx quilltap db integrity

# Check just one
npx quilltap db integrity mount-points
```

Read-only by construction: the command opens each database in read-only mode and may be run whenever you please, server or no server. Exit codes are deliberate — `0` for clean, `1` for any reported issue, `2` if a database could not be opened at all — so a nightly cron entry can usefully alert you on anything that isn't a clean pass. The startup integrity check (see *What Runs Automatically* below) is the same family of pragmas, performed automatically; this is the same check, on demand.

## Three-Database Architecture

Quilltap stores your data across three separate database files:

- **`quilltap.db`** — Your characters, chats, messages, memories, projects, settings, and all other core data
- **`quilltap-llm-logs.db`** — LLM request/response debug logs (the high-volume records that track every AI call)
- **`quilltap-mount-index.db`** — The Scriptorium's indexed document chunks and embeddings for every document store, plus the full bytes of any **database-backed** store (Markdown and text documents plus uploaded blobs)

This separation means that even if one database becomes corrupted, the others remain perfectly safe. The logs database and the mount-index database both fall back to a "degraded mode" on corruption — the feature they back goes quiet while the rest of Quilltap continues normally.

## What Runs Automatically

### Integrity Check on Startup

Every time Quilltap starts, it runs a quick integrity check on all three databases. If corruption is detected in the main database, you'll see a warning in the application logs. The app will still start so you can access your data and restore from a backup if needed. If corruption is detected in the LLM logs database or the mount-index database, that database enters "degraded mode" — its feature goes quiet but everything else works normally.

### One Instance at a Time

Two Quilltaps writing to the same data directory is the one arrangement SQLite will not forgive — the Write-Ahead Log is a shared ledger, and two hands writing in it at once produce a document neither can read. Quilltap therefore keeps a lock file, `data/quilltap.lock`, naming the process that currently holds your instance. Every part of the application asks that lock's permission before opening the database, including the migration step that runs at startup to bring your data up to date with a new version.

Should a second Quilltap arrive to find your instance already spoken for — a Docker container and a desktop app pointed at the same folder is the usual way this happens — it declines to start rather than write over the first one's work. The logs will name the offending party: its process ID, its hostname, and whether it is running under Docker.

Two situations are worth recognizing:

**The other instance is genuinely running.** Stop it, and the newcomer will start normally. This is nearly always the answer.

**The other instance is long gone but left its lock behind.** A process killed outright — a container stopped abruptly, a laptop closed mid-thought — has no opportunity to tidy up after itself. Quilltap can usually tell: if the lock names a process on this same machine and that process is no longer running, the lock is claimed automatically and you will never know it happened. A lock left by a *Docker container*, however, names a process inside a machine that no longer exists, and no amount of squinting from outside will confirm its demise. For that case:

```bash
# See who holds the lock, and how long since they last drew breath
npx quilltap db --lock-status

# Remove a lock whose owner is demonstrably dead
npx quilltap db --lock-clean
```

`--lock-status` reports the holder's last heartbeat, which is the useful tell: a live instance updates it continuously, while a stale one's grows steadily older. Should you find yourself reaching for `--lock-override`, pause — it seizes the lock regardless of who holds it, and if that party is in fact alive, you have arranged precisely the collision the lock was built to prevent.

### The Version Floor

A newer Quilltap may alter the shape of your data; an older one, meeting that altered shape, will not recognize it and may make matters considerably worse. Quilltap therefore keeps a note of the highest version that has ever opened your database, and stamps the same figure into the key file so the desktop shell can consult it before the server is even started.

Should an older edition come calling, it declines the appointment and shows you a screen saying so — naming both versions and pointing out that installing the newer one is by far the most civilized course. Nothing is touched in the meantime; the server stays up only far enough to explain itself.

The note is rewritten on every startup, so ordinary upgrading requires nothing of you. Should the guard ever be unable to complete its inspection, it now says so in a startup notice rather than passing over the matter in silence: startup proceeds, but you are told that the floor could not be verified this time.

### The Empty-House Rule

On a genuinely new instance, Quilltap furnishes the place: a starter character or two, a default embedding profile, the built-in roleplay templates. It only does this for a house it can see is empty — and, crucially, it distinguishes an empty house from a house it simply cannot get into. If the database cannot be read at that moment (a lock held elsewhere, a file the operating system has not finished fetching from the cloud), Quilltap declines to furnish anything and says so in the log. An unanswered question is not a yes.

### WAL Checkpoints

Quilltap uses SQLite's Write-Ahead Logging (WAL) mode for better performance. The WAL file accumulates changes that periodically need to be merged back into the main database file:

- **Every 5 minutes**: A passive checkpoint runs to keep the WAL file from growing too large
- **On shutdown**: A full checkpoint merges all remaining WAL data into the main database file
- **Before backups**: A checkpoint runs before creating a logical backup (via Backup & Restore) to ensure the backup captures the latest data

### Physical Database Backups

Quilltap creates a physical copy of all three database files once per day. The check happens on startup — if the most recent backup of a given database is less than 24 hours old, that one is skipped. Backups are stored in the `data/backups/` subdirectory of your data directory. Every database — including the mount-index database where database-backed Scriptorium stores keep their bytes — is part of the sweep, so nothing of yours lives outside the backup policy.

**Retention policy:**
- All backups from the last 7 days are kept
- 1 backup per week is kept for weeks 1 through 4
- 1 backup per month is kept for months 1 through 12
- 1 backup per year is kept indefinitely

Old backups are automatically cleaned up according to this schedule.

### Durable Writes

By default, Quilltap uses SQLite's `synchronous = FULL` mode, which ensures that all writes are fully flushed to disk before being acknowledged. This prevents data loss in the event of a power failure or system crash.

If you need better write performance and are willing to accept a small risk of data loss on crash, you can set the environment variable:

```
SQLITE_SYNCHRONOUS=normal
```

## Where Backups Are Stored

Physical backups are stored under your data directory:

| Platform | Path |
|----------|------|
| macOS (Electron) | `~/Library/Application Support/Quilltap/data/backups/` |
| Windows (Electron) | `%APPDATA%\Quilltap\data\backups\` |
| Linux | `~/.quilltap/data/backups/` |
| Docker | `/app/quilltap/data/backups/` |

Backup files are named with timestamps, for example:
- Main database: `quilltap-2026-02-19T143022.db`
- LLM logs database: `quilltap-llm-logs-2026-02-19T143022.db`
- Mount-index database: `quilltap-mount-index-2026-02-19T143022.db`

## Restoring from a Physical Backup

If your main database becomes corrupted:

1. Stop Quilltap
2. Navigate to the backups directory (see paths above)
3. Choose the most recent `quilltap-*.db` backup file that predates the corruption
4. Copy it over the main database file (`quilltap.db` in the `data/` directory)
5. Delete any `.db-wal` and `.db-shm` files next to `quilltap.db`
6. Start Quilltap

If only the LLM logs database is corrupted, you can either restore from a `quilltap-llm-logs-*.db` backup following the same steps (replacing `quilltap-llm-logs.db`), or simply delete the corrupted file — Quilltap will create a fresh one on next startup. You will lose historical LLM logs but no other data is affected.

If the mount-index database is corrupted, restore from a `quilltap-mount-index-*.db` backup in the same manner (replacing `quilltap-mount-index.db` and deleting any sibling `.db-wal` / `.db-shm` files). Deleting the file rather than restoring is a last resort: you would lose all document-store indexes — and, for **database-backed** stores, the document bodies and blobs themselves. Filesystem-backed stores would recover on the next scan because their bytes live on disk.

## Physical Backups vs. Backup & Restore

Quilltap has two independent backup systems:

| Feature | Physical Backups | Backup & Restore |
|---------|-----------------|------------------|
| **What it backs up** | Raw database file (byte-level copy) | All entities exported as JSON + user files |
| **When it runs** | Automatically once per day (on startup) | Manually from The Foundry |
| **Includes files** | No (database only) | Yes (all uploaded files) |
| **Format** | `.db` file | `.zip` archive |
| **Best for** | Quick recovery from corruption | Full data portability and migration |
| **Location** | `data/backups/` | Downloaded to your computer |

For the most complete protection, use both: let physical backups run automatically, and periodically create a manual backup via Backup & Restore.

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/settings?tab=system")`
