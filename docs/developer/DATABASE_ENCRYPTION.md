# Database Encryption

This document describes Quilltap's database-at-rest encryption system using SQLCipher. For user-facing documentation, see [help/database-protection.md](../help/database-protection.md).

## Overview

All Quilltap databases are encrypted at rest using **SQLCipher** via the `better-sqlite3-multiple-ciphers` npm package (aliased as `better-sqlite3`). Every byte on disk is encrypted — there is no plaintext window after initial setup. This replaces the earlier approach of per-field AES-256-GCM encryption on individual API key values.

### Key Concepts

| Term | Description |
|------|-------------|
| **Pepper** | A 32-byte random value (44-char base64 string) used as the SQLCipher database key. Lives in `process.env.ENCRYPTION_MASTER_PEPPER` at runtime. |
| **`.dbkey` file** | A JSON file on disk that stores the pepper, encrypted with AES-256-GCM. Located at `<data-dir>/quilltap.dbkey`. One per instance. |
| **Passphrase** | An optional user-supplied string used to derive the AES key that wraps the pepper inside the `.dbkey` file. When omitted, an internal sentinel (`__quilltap_no_passphrase__`) is used instead — the `.dbkey` file is always encrypted. |

All three databases — main (`quilltap.db`), LLM logs (`quilltap-llm-logs.db`), and mount index (`quilltap-mount-index.db`) — open with the same pepper, unwrapped from the one `quilltap.dbkey`. Each client module reads `ENCRYPTION_MASTER_PEPPER` rather than a key file of its own.

> **Historical note.** Before 4.8.1, `changePassphrase()` also wrote a byte-identical copy to `quilltap-llm-logs.dbkey` — the remnant of a per-database-key design that was never built. Nothing ever read it, and because the other two writers of the main key file (`setupDbKey`, `storeEnvPepperInDbKey`) did not touch it, it could hold a stale wrapping. The write was removed; the file is inert wherever it still exists. See [Bug 60](bugs/fixed/bug-60-phantom-per-database-key-files.md).

## Architecture

### Source Files

```
lib/startup/
├── dbkey.ts                  # .dbkey file management and pepper lifecycle
├── db-encryption-state.ts    # Detects whether a DB file is encrypted or plaintext
├── db-encryption-converter.ts # Converts plaintext DBs to encrypted format
├── startup-state.ts          # Global startup state machine (includes locked mode)
└── pepper-vault.ts           # Legacy pepper vault (migration support only)

lib/database/backends/sqlite/
├── client.ts                 # Main DB connection — applies SQLCipher key pragma
└── llm-logs-client.ts        # LLM logs DB connection — applies same key pragma

app/api/v1/system/unlock/
└── route.ts                  # Unlock/setup/change-passphrase API endpoints

components/settings/
└── ChangePassphraseCard.tsx   # Settings UI for changing the passphrase

migrations/scripts/
├── drop-api-key-encryption-columns.ts  # Removes legacy per-field encryption columns
└── drop-pepper-vault.ts               # Drops legacy pepper_vault table
```

### How the Key Reaches SQLCipher

The pepper flows from the `.dbkey` file to the database connection:

```
.dbkey file → PBKDF2 decrypt → process.env.ENCRYPTION_MASTER_PEPPER (base64)
                                        ↓
                              Buffer.from(pepper, 'base64').toString('hex')
                                        ↓
                              PRAGMA key = "x'<hex>'"
```

Using SQLCipher's raw key format (`x'...'`) bypasses SQLCipher's own internal KDF, since we already performed key derivation via PBKDF2 when unwrapping the `.dbkey` file. This is set as the very first pragma before any other database operations.

Relevant code in `lib/database/backends/sqlite/client.ts`:

```typescript
const sqlcipherKey = process.env.ENCRYPTION_MASTER_PEPPER;
if (sqlcipherKey) {
  const keyHex = Buffer.from(sqlcipherKey, 'base64').toString('hex');
  sqliteDatabase.pragma(`key = "x'${keyHex}'"`);
}
```

## The `.dbkey` File Format

The `.dbkey` file is a JSON document containing all cryptographic parameters needed to decrypt the pepper:

```json
{
  "version": 1,
  "algorithm": "aes-256-gcm",
  "kdf": "pbkdf2",
  "kdfIterations": 600000,
  "kdfDigest": "sha256",
  "salt": "<hex>",
  "iv": "<hex>",
  "ciphertext": "<hex>",
  "authTag": "<hex>",
  "pepperHash": "<hex>"
}
```

| Field | Purpose |
|-------|---------|
| `version` | Schema version for forward compatibility (currently `1`) |
| `algorithm` | Always `aes-256-gcm` — authenticated encryption |
| `kdf` / `kdfIterations` / `kdfDigest` | PBKDF2 parameters: 600,000 iterations of SHA-256 |
| `salt` | 32-byte random salt for PBKDF2 (hex-encoded) |
| `iv` | 16-byte random IV for AES-GCM (hex-encoded) |
| `ciphertext` | The encrypted pepper (hex-encoded) |
| `authTag` | GCM authentication tag for tamper detection (hex-encoded) |
| `pepperHash` | SHA-256 of the plaintext pepper — used for verification, not decryption |

### Security Properties

- **File permissions**: Set to `0o600` (owner read/write only).
- **Opaque design**: The file does not reveal whether a user passphrase was used. The `hasPassphrase` field was intentionally removed to prevent information leakage — an attacker cannot determine whether to attempt cracking a passphrase.
- **Tamper detection**: The GCM auth tag ensures that any modification to the file (including the ciphertext, IV, or salt) causes decryption to fail.
- **Fresh random values**: Each encryption operation generates a new random salt and IV, even when re-wrapping with the same passphrase.

## Startup Lifecycle

### DbKeyState (4 states)

Defined in `lib/startup/dbkey.ts`:

| State | Meaning |
|-------|---------|
| `resolved` | Pepper is in `process.env`, database is accessible |
| `needs-setup` | No pepper exists; first-run setup required |
| `needs-passphrase` | `.dbkey` exists with a user passphrase; unlock required |
| `needs-vault-storage` | Pepper is set via env var but has no `.dbkey` file yet |

### Startup Phase Sequence

The startup sequence is orchestrated in `instrumentation.ts`:

#### Phase -0.5a: Database Key Provisioning

`provisionDbKey()` runs before any logger/env imports to avoid circular dependencies. Resolution logic:

1. **Env var set + `.dbkey` exists** → Verify pepper hash matches stored `pepperHash`. Fatal exit on mismatch (prevents serving data with wrong key). Return `resolved`.
2. **Env var set + no `.dbkey`** → Return `needs-vault-storage`. The pepper works but should be persisted.
3. **No env var + `.dbkey` exists** → Try internal sentinel passphrase first. If it decrypts successfully, set `process.env.ENCRYPTION_MASTER_PEPPER` and return `resolved`. If it fails, return `needs-passphrase` (user passphrase required).
4. **Neither exists** → Return `needs-setup` (first run).

If the state is `needs-passphrase`, the server enters **locked mode** (`startup-state.ts` sets `isLockedMode = true`). All API routes return `423 Locked` until the unlock endpoint is called.

#### Phase -0.5b: Database Encryption Conversion

If the pepper is resolved and a database file exists but is plaintext (detected by `isDatabaseEncrypted()` in `db-encryption-state.ts`, which checks whether the first 16 bytes match the SQLite magic header `"SQLite format 3\0"`), the `convertDatabaseToEncrypted()` function runs.

#### Phase 1 onward

Migrations, seeding, plugins, and other startup tasks proceed normally.

### Legacy Pepper Vault Migration

For users upgrading from the old in-database `pepper_vault` system:

- During startup: if `provisionDbKey()` returns `needs-setup` but a database file exists, the system tries the legacy `provisionPepper()` function. If that succeeds, a `.dbkey` file is written immediately.
- During unlock: if the unlock endpoint is called and the `.dbkey` state is `needs-setup` but `startupState` says `needs-passphrase`, the legacy `unlockPepper()` function is used, then the pepper is migrated to `.dbkey` format via `storeEnvPepperInDbKey()`.

## Database Encryption Conversion

Implemented in `lib/startup/db-encryption-converter.ts`.

### Conversion Steps

1. **Backup**: Copy original DB to `<name>.pre-sqlcipher.bak` (safety rollback)
2. **Working copy**: Copy original DB to `<name>.encrypting` — avoids iCloud/Spotlight file locks
3. **Copy WAL/SHM**: Copy sidecar files to the working copy for consistency
4. **Checkpoint + journal mode**: Open working copy, run `TRUNCATE` checkpoint, switch to `DELETE` journal mode (required by `PRAGMA rekey`)
5. **Encrypt**: Run `PRAGMA rekey = "x'<keyHex>'"` on the working copy
6. **Restore WAL**: Switch back to `WAL` journal mode
7. **Verify**: Reopen with key and run `SELECT count(*) FROM sqlite_master`
8. **Replace**: Remove original WAL/SHM files, rename working copy over original

### Error Recovery

On failure at any step:
- Close DB handle if open
- Delete working copy and its WAL/SHM files
- Restore original from the `.pre-sqlcipher.bak` backup
- Re-throw the error

### Platform Considerations

- **iCloud sync / Spotlight (macOS)**: The converter works on a temporary `.encrypting` copy to avoid file coordination locks held by macOS services on the original database file.
- **WAL journal mode**: `PRAGMA rekey` does not work in WAL mode. The converter switches to DELETE mode, runs rekey, then restores WAL mode.

## API Endpoints

All endpoints are at `/api/v1/system/unlock`. They are **unauthenticated** because they must be accessible before the app is fully operational.

| Method | Action | Body | Description |
|--------|--------|------|-------------|
| `GET` | — | — | Returns `{ state: DbKeyState }` |
| `POST` | `?action=setup` | `{ passphrase?: string }` | First-run: generate pepper, write `.dbkey`, encrypt existing plaintext DBs |
| `POST` | `?action=unlock` | `{ passphrase: string }` | Decrypt `.dbkey` with passphrase; triggers deferred startup if in locked mode |
| `POST` | `?action=store` | `{ passphrase?: string }` | Persist an env-var pepper into a new `.dbkey` file |
| `POST` | `?action=change-passphrase` | `{ oldPassphrase: string, newPassphrase: string }` | Re-wrap the pepper with a new passphrase |

### Setup Flow Details

After `?action=setup` generates a pepper and writes the `.dbkey` file:

1. The pepper is returned **once** in the response for the user to save
2. Any existing plaintext databases are encrypted immediately (closes migration and app DB connections first)
3. If post-setup encryption fails, it's non-fatal — Phase -0.5b will retry on next restart

### Unlock Flow Details

After `?action=unlock` successfully decrypts the pepper:

1. `startupState.setPepperState('resolved')` exits locked mode
2. If the server phase was `locked`, `register()` from `instrumentation.ts` is re-invoked via `setImmediate()` to run deferred startup phases (migrations, seeding, plugins)

## Settings UI

The **Change Passphrase** card is located on the **Data & System** tab in Settings (`/settings?tab=system`). Implemented in `components/settings/ChangePassphraseCard.tsx`.

- Three password fields: Current Passphrase, New Passphrase, Confirm New Passphrase
- Client-side validation: new and confirm must match
- Both old and new passphrases can be empty (empty = no passphrase)
- Calls `POST /api/v1/system/unlock?action=change-passphrase`
- This only re-wraps the pepper — it does **not** re-encrypt the database

## Related Migrations

| Migration ID | Script | Purpose |
|--------------|--------|---------|
| `drop-api-key-encryption-columns-v1` | `migrations/scripts/drop-api-key-encryption-columns.ts` | Renames `ciphertext` → `key_value`, drops `iv` and `authTag` columns from `api_keys` table. API keys are now stored as plaintext within the encrypted database. |
| `drop-pepper-vault-v1` | `migrations/scripts/drop-pepper-vault.ts` | Drops the legacy `pepper_vault` table from the database. |

## CLI Access

The Quilltap CLI replicates the same `.dbkey` decryption logic:

```bash
# Standard usage (auto-decrypts .dbkey with internal passphrase)
npx quilltap db --tables
npx quilltap db "SELECT COUNT(*) FROM characters;"
npx quilltap db --repl

# If passphrase-protected
npx quilltap db --passphrase <pass> --tables

# Query LLM logs database
npx quilltap db --llm-logs --tables

# Custom data directory
npx quilltap db --data-dir /path/to/data --tables
```

**Important**: The standard `sqlite3` CLI cannot open SQLCipher-encrypted databases. Always use the Quilltap CLI.

## Security Summary

| Aspect | Implementation |
|--------|---------------|
| Database encryption | SQLCipher (AES-256 in CBC mode with HMAC-SHA512) |
| Pepper generation | `crypto.randomBytes(32)` → base64 (44 chars) |
| Pepper wrapping | AES-256-GCM with PBKDF2 key derivation |
| PBKDF2 iterations | 600,000 (upgraded from 100,000 in legacy system) |
| File permissions | `.dbkey` files set to `0o600` |
| Hash verification | SHA-256 of plaintext pepper stored in `.dbkey` for verification |
| Fatal on mismatch | Env pepper hash ≠ stored hash → `process.exit(1)` |
| Opaque `.dbkey` | No `hasPassphrase` flag — prevents information leakage |
| Legacy migration | Transparent upgrade from pepper_vault to `.dbkey` format |
