# JSON-Backed Data Store Migration Plan

## Objectives

- Remove the PostgreSQL dependency, Prisma schema, and SQL migrations in favor of JSON/JSONL files and local directories for binaries while keeping 100% feature parity.
- Preserve every field that currently lives in the database (including encrypted secrets, metadata, tags, join tables, audit timestamps, and NextAuth state) with deterministic locations on disk.
- Provide deterministic, testable file formats so future features can add new data without central database changes.
- Maintain encryption for sensitive fields (API keys, TOTP secrets, backup codes) and keep future room for additional secure items.
- Simplify deployment by bundling everything inside the workspace directory and providing clear backup/export/restore procedures.

## Storage Layout (Top-Level `data/` Directory)

```text
data/
  settings/
    general.json                # Global state, single-user preferences, NextAuth user + chat settings
    connection-profiles.json    # LLM + Image connection profiles and encrypted API keys
  characters/
    <character-id>.json         # One file per character
  personas/
    <persona-id>.json           # One file per persona
  chats/
    index.jsonl                 # Chat metadata index
    <chat-id>.jsonl             # Chronological log per chat (messages, events, tool calls)
  binaries/
    index.jsonl                 # Metadata index for every binary asset (images, attachments, avatars)
    <sha256>/                   # Deduplicated binary payload directories (or direct files)
  auth/
    accounts.json               # OAuth provider linkage (by userId)
    sessions.jsonl              # Session records for NextAuth
    verification-tokens.jsonl   # Password-reset / email verification tokens
  tags/
    tags.json                   # Canonical list of tags
  image-profiles/
    image-profiles.json         # Image generation presets (mirrors existing ImageProfile model)
  cache/
    *.lock / *.meta             # Optional derived indexes, write locks, and version metadata
```

All paths are relative to the repo root by default; a `DATA_DIR` env variable will allow overrides.

## Mapping Prisma Models to Files

| Prisma Model / Table | New Storage Target |
| --- | --- |
| `User`, `ChatSettings` | `data/settings/general.json` (single-user) or `data/settings/users/<id>.json` if multi-user support is preserved. Includes auth metadata, password hash, TOTP info, backup codes, avatar settings, timestamps. |
| `Account` | `data/auth/accounts.json` (array keyed by provider/providerAccountId). |
| `Session` | `data/auth/sessions.jsonl` (append-only session entries). |
| `VerificationToken` | `data/auth/verification-tokens.jsonl`. |
| `ApiKey` | `connection-profiles.json` (`apiKeys` array with AES-GCM ciphertext, iv, authTag, lastUsed timestamps). |
| `ConnectionProfile`, `ConnectionProfileTag` | `connection-profiles.json` (`profiles` array per LLM profile, `tags` array per profile). |
| `ImageProfile`, `ImageProfileTag` | `image-profiles/image-profiles.json` plus inline `tags`. |
| `Character`, `CharacterTag`, `CharacterPersona`, `ChatAvatarOverride` | `characters/<characterId>.json` (metadata + persona relationships + tag ids + avatar overrides). |
| `Persona`, `PersonaTag` | `personas/<personaId>.json` with reverse character link references if needed. |
| `Chat` | `chats/index.jsonl` (metadata row) + `chats/<chatId>.jsonl` for message history. |
| `Message` | Stored as events inside `chats/<chatId>.jsonl` ordered by timestamp. |
| `ChatFile` | `binaries/index.jsonl` entry referencing `chatId`, `messageId`, `filepath`, metadata; binary file saved inside `binaries/<sha256>/raw`. |
| `Image`, `ImageTag` | Also `binaries/index.jsonl` (type `"image"`), storing `tags`, `defaultUsage`, and metadata. |
| `Tag` | `tags/tags.json` (array with `id`, `userId`, `name`, `nameLower`, timestamps). |
| `ImageProfile` | `image-profiles/image-profiles.json`. |

## Settings File Details

### General Settings (`data/settings/general.json`)

- **User Identity** (`id`, `email`, `name`, `image`, `createdAt`, `updatedAt`).
- **Authentication Secrets**: `passwordHash`, `totp` block (`secretCiphertext`, `iv`, `authTag`, `enabled`, `verifiedAt`), `backupCodes` block (encrypted JSON array + IV/authTag), `magicLinkTokens` for legacy email auth if needed.
- **Chat Preferences**: Avatar display mode/style, theme, default character/persona selection.
- **Application Flags**: Last onboarding step, telemetry opt-in, data version.
- **Encryption Key Metadata**: store the master key id and KDF params (salt, iterations) so encryption can be derived from a passphrase.

### Connection Profiles + API Keys (`data/settings/connection-profiles.json`)

```jsonc
{
  "version": 1,
  "apiKeys": [
    {
      "id": "uuid",
      "label": "Primary OpenAI",
      "provider": "OPENAI",
      "ciphertext": "...",
      "iv": "...",
      "authTag": "...",
      "createdAt": "2024-01-01T00:00:00Z",
      "updatedAt": "...",
      "lastUsed": "..."
    }
  ],
  "llmProfiles": [
    {
      "id": "uuid",
      "name": "Creative",
      "provider": "OPENAI",
      "apiKeyId": "uuid",
      "modelName": "gpt-4o",
      "baseUrl": null,
      "parameters": {"temperature": 0.9},
      "isDefault": true,
      "tags": ["creative", "long-form"],
      "createdAt": "...",
      "updatedAt": "..."
    }
  ]
}
```

- Same file can optionally include `imageProfiles` or they can live under `image-profiles/` depending on desired separation. API key ids reference encrypted entries above.

### Character Files (`data/characters/<characterId>.json`)

- Mirror `Character` model fields plus derived arrays:
  - `personaLinks`: list of persona ids and `isDefault` flags (replaces `CharacterPersona`).
  - `tags`: array of tag ids (replaces `CharacterTag`).
  - `avatarOverrides`: list per chat id mapping to image id (replaces `ChatAvatarOverride`).
  - `systemPrompts`, `sillyTavernData`, `defaultImageId`, timestamps.
- Files are versioned; updates overwrite file atomically using temp-write + rename.

### Persona Files (`data/personas/<personaId>.json`)

- Mirrors `Persona` + `tags` array + `characterLinks` (optional) + `defaultImageId`.
- Additional persona-level preferences (voice, tone) can be appended cleanly.

### Binary Index (`data/binaries/index.jsonl` + directories)

- One JSON object per line storing:

  ```jsonc
  {"id":"uuid","sha256":"...","type":"image|chat_file|avatar","userId":"...","filename":"...","relativePath":"binaries/<sha>/payload.bin","mimeType":"image/png","size":12345,"width":512,"height":512,"source":"generated","chatId":null,"messageId":null,"tags":["abc"],"createdAt":"...","updatedAt":"..."}
  ```

- Binary payload stored in `binaries/<sha256>/raw`. Derived assets (thumbnails) can sit beside the raw file.
- Replaces `Image`, `ChatFile`, `ImageTag`, and `ChatAvatarOverride` file pointers.

### Chat Index + Chat JSONL Files

- `data/chats/index.jsonl`: metadata rows summarizing each chat (id, userId, characterId, personaId, connectionProfileId, imageProfileId, title, summary, createdAt, updatedAt, `lastMessageAt`, `messageCount`, `tags`).
- `data/chats/<chatId>.jsonl`: chronological log; each line tagged with `type` to support messages, tool events, edits, attachments, avatar overrides, or system notes.

  ```jsonc
  {"type":"message","id":"uuid","role":"USER","content":"Hello","tokenCount":12,"createdAt":"...","attachments":["file-id"]}
  {"type":"message","id":"uuid","role":"ASSISTANT","content":"Hi","rawResponse":{...}}
  {"type":"context-summary","id":"uuid","context": "..."}
  ```

- Swipe groups are represented by storing `swipeGroupId` + `swipeIndex` inside each message object.
- File-level metadata written at head (first line) records schema version.

### Tags (`data/tags/tags.json`)

- Array of tag objects with `id`, `userId`, `name`, `nameLower`, `createdAt`, `updatedAt`.
- Entities reference tags by id; the UI builds relational views by scanning character/persona/chat files.

## Additional Persisted Entities

- **Image Profiles**: `image-profiles/image-profiles.json` (mirrors `ImageProfile` + `tags`).
- **Chat Settings**: Already merged into `general.json` under `chatSettings` key.
- **Silly Tavern Metadata**: stored inline in character/persona files as JSON blobs.
- **Tool Invocation Logs / Future Telemetry**: treat them as event rows appended to relevant chat JSONL or dedicated log files.

## Data Access Layer Refactor

1. Introduce a `JsonStore` service responsible for:
   - File discovery and path resolution (based on `DATA_DIR`).
   - Atomic read-modify-write cycles using advisory locks per file.
   - Append helpers for JSONL files with fsync batching.
   - Optional in-memory indexes (Map caches) for hot data (e.g., chat index, tags).
2. Implement repository modules (UsersRepo, CharactersRepo, ChatsRepo, etc.) on top of `JsonStore`. Each repo handles its entity-specific validation and referential integrity checks.
3. Wire the repos into existing services/components by swapping Prisma imports with repo functions. Provide feature-flag to switch between Prisma and JSON store until migration completes.
4. Update NextAuth adapter to use JSON repos for all CRUD operations (Users, Accounts, Sessions, VerificationToken).

## Encryption & Secrets Handling

- Generate a master key derived from a user passphrase (PBKDF2/Argon2) and store only the salt + iterations in `general.json`.
- Provide helper `crypto.ts` functions for `encryptJson`, `decryptJson`, `encryptBuffer` using AES-256-GCM.
- Fields requiring encryption: API keys, TOTP secrets, backup codes, potentially connection profile parameters containing secrets.
- Store encrypted blobs inline with each record, along with `iv` and `authTag`. Non-sensitive metadata (label, provider, timestamps) stays plaintext for discoverability.

## Migration Workflow

1. **Inventory (Day 0-1)**
   - Freeze schema version in code, dump Prisma metadata (list of models, counts) for validation.
   - Introduce feature flag `DATA_BACKEND=json` to start running read-only comparisons.
2. **Scaffold File Store (Day 1-3)**
   - Create directory builders and baseline empty files.
   - Implement JSON schema definitions (zod/io-ts) so files are validated as they're loaded.
3. **Dual-Write Layer (Day 3-6)**
   - Update repositories to write to both Prisma and JSON store to keep data in sync while testing.
   - Build CLI command `npm run data:export` that iterates Prisma models and writes JSON/JSONL data using repositories.
4. **Verification (Day 6-8)**
   - Write integration tests comparing Prisma queries to JSON repo results for random subsets.
   - Validate message counts, tag sets, encrypted field decryptability, chat file integrity.
5. **Cutover (Day 8-10)**
   - Flip feature flag to JSON store only.
   - Run export one final time, snapshot `data/` directory for backup.
   - Remove Prisma client usage from runtime code, update `.env.example` to drop `DATABASE_URL`.
6. **Cleanup (Day 10-11)**
   - Delete `prisma/` directory, SQL migration scripts, Prisma npm dependencies.
   - Update docs (`README`, `DEVELOPMENT`, deployment instructions) to describe JSON store.
   - Provide backup guidance (copy `data/` directory, optionally compress nightly).

## Removing Prisma & SQL Migrations

- Remove `@prisma/client` and `prisma` packages from `package.json`.
- Delete `prisma/schema.prisma` and existing migration files; remove Prisma-related scripts (`prisma generate`, `migrate deploy`).
- Replace Prisma service imports with JSON repository functions across the app, ensuring TypeScript types mirror the JSON schemas.
- Update NextAuth options to use the custom JSON adapter.
- Drop Docker services that provision Postgres, and simplify `docker-compose`.

## Testing & Validation

- Unit tests for each repository covering create/read/update/delete against temp directories.
- Snapshot tests for JSON schemas (e.g., sample character file) to prevent accidental format drift.
- Integration tests for chat flows verifying message append, attachments, tag updates, and binary index writes.
- Migration verification script that compares record counts and checksum of serialized data between Postgres and JSON outputs.

## Risks & Open Questions

- **Multi-User Support**: This plan assumes Quilltap remains single-user on-device. If multi-user support is required, general settings must evolve into `settings/users/<id>.json` and indexes need per-user prefixing.
- **Concurrent Writes**: Desktop electron vs server? Need file locking strategy (`flock` or atomic rename) to avoid corruption when multiple renderer processes write concurrently.
- **Data Growth**: JSONL chat logs could grow; plan periodic compaction or summarization.
- **Encryption Key Recovery**: Need UX for resetting master key without losing encrypted data.
- **Backups**: Document automated zip/tar of `data/` to avoid data loss.

Once the above steps are completed, Postgres can be fully removed and all persistent data will live in deterministic JSON/JSONL files and the binaries directory with encrypted secrets where appropriate.
