# Quilltap Database Schema Reference (DDL)

This document describes the three SQLite databases used by Quilltap, how to access them, and the complete schema of every table.

## Database Overview

| Database | Filename | Purpose |
|----------|----------|---------|
| **Main** | `quilltap.db` | All application data: users, characters, chats, messages, projects, files, memories, settings, etc. |
| **LLM Logs** | `quilltap-llm-logs.db` | LLM request/response debug data. Isolated so high-churn logging can't corrupt main data. |
| **Mount Index** | `quilltap-mount-index.db` | Document mount point tracking: file inventory, checksums, text chunks, and embeddings for external document directories. |

All three databases live in `<data-dir>/data/`. Alongside them:

```
<data-dir>/data/
├── quilltap.db
├── quilltap.dbkey            # Encryption key file — one per instance, all three DBs
├── quilltap-llm-logs.db
├── quilltap-mount-index.db
├── quilltap.lock             # Instance lock (prevents dual-instance corruption)
└── backups/                  # Physical backups
```

### Default data directory by platform

| Platform | Path |
|----------|------|
| macOS | `~/Library/Application Support/Quilltap/` |
| Linux | `~/.quilltap/` |
| Windows | `%APPDATA%\Quilltap\` |
| Docker | `/app/quilltap/` |
| Lima VM | `/data/quilltap/` (VirtioFS mount) |

Override with `QUILLTAP_DATA_DIR` env var, `--data-dir` CLI flag, or `SQLITE_PATH` / `SQLITE_LLM_LOGS_PATH` / `SQLITE_MOUNT_INDEX_PATH` for individual databases.

## Encryption

All three databases are encrypted with **SQLCipher** (AES-256-CBC with HMAC-SHA512). The standard `sqlite3` CLI **cannot** open them.

### How the key works

1. A 32-byte random **pepper** (base64-encoded) is the actual SQLCipher key
2. The pepper is wrapped with AES-256-GCM + PBKDF2 (600,000 iterations, SHA-256) and stored in the instance's single `data/quilltap.dbkey` file
3. An optional user passphrase protects the `.dbkey` wrapper; without one, a sentinel value is used
4. At runtime, the pepper lands in `process.env.ENCRYPTION_MASTER_PEPPER`
5. SQLCipher receives it as a raw hex key: `PRAGMA key = "x'<hex>'"`

### Runtime PRAGMAs

After the key is set, the following PRAGMAs are applied:

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;      -- (default config value)
PRAGMA busy_timeout = 5000;       -- (default config value)
PRAGMA cache_size = -8000;        -- (default config value, ~8MB)
PRAGMA mmap_size = 268435456;     -- 256MB memory-mapped I/O
PRAGMA temp_store = MEMORY;
```

Periodic `PRAGMA wal_checkpoint(PASSIVE)` runs every 5 minutes. `PRAGMA optimize` runs at shutdown.

## How to Query

**Always use the Quilltap CLI** — never raw `sqlite3`.

### High-level subcommands (preferred)

These auto-pick the right database, resolve characters/chats/projects by name, and skip the JOIN/PRAGMA hunting that bare SQL forces.

```bash
# Schema (instead of PRAGMA table_info)
npx quilltap db schema                          # Tables grouped by domain
npx quilltap db schema chat_messages            # Columns, FKs, indexes, DDL link
npx quilltap db schema --grep memory            # Search tables/columns by substring

# Resolve by name → UUID (fuzzy; checks character aliases too)
npx quilltap db find character Friday
npx quilltap db find chat "physical prompts"
npx quilltap db find project "Quilltap"

# Drill-down — pass a name OR a UUID; the CLI does the right thing
npx quilltap db chats --character Friday                    # Containing a character
npx quilltap db chats --project "Quilltap"                  # In a project
npx quilltap db messages --chat <id|title> --last 50 --full
npx quilltap db logs --chat <id|title>                      # LLM logs for a chat
npx quilltap db logs --message <id>                         # LLM logs for one message
npx quilltap db logs --character <id|name>                  # LLM logs for a character
npx quilltap db logs --tail 20                              # Most recent LLM logs
npx quilltap db memories --character Friday [--about Amy] [--source AUTO|MANUAL]

# Single records, full body
npx quilltap db message <id>                                # Full chat-message content
npx quilltap db log <id> [--field request|response|both]    # Full LLM request/response

# Add --json to any of the above for machine-readable output.
```

### Low-level (still supported)

```bash
# The db command opens the database READ-ONLY by default. Add --write to make changes;
# --write claims the instance lock for the duration and refuses if a server/another
# instance holds it (no override). --repl is read-only unless combined with --write.
npx quilltap db --tables                           # List tables in active DB
npx quilltap db "SELECT COUNT(*) FROM characters;" # Run arbitrary SQL (read-only)
npx quilltap db --repl                             # Interactive REPL, read-only (.cols, .find shortcuts)
npx quilltap db --write "UPDATE characters SET title = 'rival' WHERE id = '...';"  # Lock-gated write
npx quilltap db --repl --write                     # Interactive REPL, read-write
npx quilltap db --count chat_messages              # Row count

# LLM logs database
npx quilltap db --llm-logs --tables
npx quilltap db --llm-logs "SELECT * FROM llm_logs ORDER BY createdAt DESC LIMIT 5;"

# Mount-index database
npx quilltap db --mount-points --tables

# With passphrase (if set)
npx quilltap db --passphrase <pass> --tables
QUILLTAP_DB_PASSPHRASE=secret npx quilltap db --tables

# Custom data directory (pass instance root, not its data/ subdir)
npx quilltap db --data-dir /path/to/instance --tables

# Instance lock management
npx quilltap db --lock-status
npx quilltap db --lock-clean
npx quilltap db --lock-override
```

### Querying via the Brahma `run_sql` tool

The **Brahma Console** can also query these databases from inside a running instance, via the read-only `run_sql` tool. It picks one of the three databases per call (`main` / `llm-logs` / `mount-index`), runs a single read-only statement against the server's already-open, decrypted handle, and returns rows as JSON. It is read-only (writes and schema changes are rejected at the tool layer), so it never needs `--write` and never claims the instance lock. The same schema in this document is the contract it queries against; no schema change is involved. See [brahma-sql-access](features/complete/brahma-sql-access.md) for the tool contract, guard layers, and the SQL prompt the model is given.

---

## Main Database Schema (`quilltap.db`)

### Embedding BLOB format (all `embedding` columns)

Every `embedding BLOB` column in every database (`memories`, `vector_entries`,
`conversation_chunks`, `help_docs`, `help_doc_chunks` in the main DB;
`doc_mount_chunks` in the
mount index) holds a **self-describing quantized vector** since
`quantize-embeddings-v1` (v4.8.0). The single-source-of-truth codec is
`lib/embedding/float32-conversion.ts`; consumers always see a hydrated
`Float32Array` — the on-disk layout is:

```
Byte layout (little-endian):
  [0]      magic   = 0xEB
  [1]      version = 0x01
  [2]      dtype   : 0x01 = int8-symmetric, 0x02 = float16
  [3..6]   dim     : uint32
  dtype==int8: [7..10] scale : float32   (dequant: f = int8 * scale)
               [11..11+dim)   int8 body            → total = 11 + dim bytes
  dtype==f16 : [7..7+2*dim)   float16 body (no scale) → total = 7 + 2*dim bytes
```

New writes use int8-symmetric (`scale = max|v|/127`, ~4× smaller than
Float32; embeddings are unit-normalized so mean cosine similarity to the
original is ≥ 0.999). Blobs **without** the magic+version prefix (or whose
declared dim is inconsistent with their byte length) are legacy raw Float32
bytes (`dim = byteLength / 4`) and remain readable forever — the read path
dispatches on the header. Raw SQL that infers dimensions from
`length(embedding)` must branch on the prefix (see `EMBEDDING_DIM_SQL` in
`lib/embedding/reapply-profile.ts`).

### users

```sql
CREATE TABLE "users" (
  "id" TEXT PRIMARY KEY,
  "username" TEXT NOT NULL,
  "email" TEXT UNIQUE,
  "name" TEXT,
  "image" TEXT,
  "emailVerified" TEXT,
  "passwordHash" TEXT,
  "totp" TEXT,
  "backupCodes" TEXT,
  "totpAttempts" TEXT,
  "trustedDevices" TEXT DEFAULT '[]',
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);

CREATE INDEX "idx_users_createdAt" ON "users" ("createdAt" DESC);
CREATE INDEX "idx_users_email" ON "users" ("email");
CREATE INDEX "idx_users_username" ON "users" ("username");
```

### api_keys

```sql
CREATE TABLE "api_keys" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "key_value" TEXT NOT NULL,
  "isActive" INTEGER DEFAULT 1,
  "lastUsed" TEXT,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);

CREATE INDEX "idx_api_keys_createdAt" ON "api_keys" ("createdAt" DESC);
CREATE INDEX "idx_api_keys_provider" ON "api_keys" ("provider");
CREATE INDEX "idx_api_keys_userId" ON "api_keys" ("userId");
```

### characters

The `characters` table holds only identity, reference fields, behavior
flags, and the vault pointer. Every content field — identity, description,
manifesto, personality, exampleDialogues, firstMessage, scenarios,
systemPrompts, physicalDescription (singular, previously a
`physicalDescriptions` array), title, talkativeness, aliases, pronouns —
lives only in the per-character document vault (linked via
`characterDocumentMountPointId`). The 4.6 `cutover-characters-to-vault-v1`
migration dropped those columns, along with the now-defunct `avatarUrl`,
`clothingRecords` (folded into wardrobe_items in 4.5), and
`readPropertiesFromDocumentStore` opt-in flag (vault-sourcing is now
unconditional).

`systemTransparency` is **intentionally still a DB column** — it is
access-control application state, not character content, and is therefore
not vault-mirrored.

Because the vault is the sole source of truth post-cutover, the read overlay
fails loudly rather than returning a hollow character (there is no DB column
left to fall back to), mirroring the project/group stores: a vault-linked
character whose `properties.json` keystone is missing/unreadable causes
`findById` to throw `CharacterVaultUnavailableError` (mapped to a 503 by the
route handler) and list reads (`findAll`/`findByIds`) to drop the offending
row. Existence-only callers (delete, ownership pre-checks, cascade delete) read
`findByIdRaw`, which never applies the overlay, so a broken vault stays
deletable/repairable; the startup backfill repopulates a linked-but-empty vault
from the raw row.

```sql
CREATE TABLE "characters" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "scenario" TEXT,                        -- DEPRECATED legacy column (pre-scenarios-array, also pre-cutover); see convert-scenario-to-scenarios-v1
  "defaultImageId" TEXT,                  -- Vault link id (doc_mount_file_links.id) of the character's portrait.
  "defaultConnectionProfileId" TEXT,
  "defaultPartnerId" TEXT,
  "defaultRoleplayTemplateId" TEXT,
  "sillyTavernData" TEXT,
  "isFavorite" INTEGER DEFAULT 0,
  "npc" INTEGER DEFAULT 0,
  "controlledBy" TEXT DEFAULT 'llm',
  "partnerLinks" TEXT DEFAULT '[]',
  "tags" TEXT DEFAULT '[]',
  "avatarOverrides" TEXT DEFAULT '[]',    -- JSON array of { chatId, imageId } where imageId is a vault link id.
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL,
  "defaultImageProfileId" TEXT,
  "defaultAgentModeEnabled" INTEGER DEFAULT NULL,
  "defaultHelpToolsEnabled" INTEGER DEFAULT NULL,
  "defaultTimestampConfig" TEXT DEFAULT NULL,
  "defaultScenarioId" TEXT DEFAULT NULL,
  "defaultSystemPromptId" TEXT DEFAULT NULL,
  "canDressThemselves" INTEGER DEFAULT NULL,
  "canCreateOutfits" INTEGER DEFAULT NULL,
  "characterDocumentMountPointId" TEXT DEFAULT NULL,
  "archivedAt" TEXT DEFAULT NULL,            -- ISO timestamp when the character was archived into a tombstone.
  "archiveFileId" TEXT DEFAULT NULL,         -- File row holding the archived character bundle export.
  "archivedAvatarFileId" TEXT DEFAULT NULL,  -- File row holding the archived avatar thumbnail copy.
  "systemTransparency" INTEGER DEFAULT NULL,  -- when 1 (true), this character may inspect "the Staff" — the chat-level toggles for self_inventory, Staff messages (Lantern/Aurora/Librarian/Prospero/Host), and character vaults still apply. When NULL or 0 (false), the character cannot see Staff messages, the self_inventory tool is withheld, and all character vaults (own + peers) are hidden from doc_* tools — a hard override on top of chat/project settings. Default NULL (opaque).
  "coreWhisperEnabled" INTEGER DEFAULT NULL,  -- per-character override of the global coreWhisper.enabled setting (Aurora's Core whisper). NULL = inherit from global. Resolution: chat → character → global.
  "canBeCarina" INTEGER DEFAULT NULL          -- Carina (inline LLM queries): when 1 (true), this character can answer @Name queries / ask_carina calls as an isolated reference answer (identity only, no history, no memory). NULL/0 = not an answerer. Added by add-carina-flag-v1.
);

CREATE INDEX "idx_characters_createdAt" ON "characters" ("createdAt" DESC);
CREATE INDEX "idx_characters_userId" ON "characters" ("userId");
```

#### Vault-managed content fields

These fields no longer live in the DB row. They are stored under
`<dataDir>/data/quilltap-mount-index.db` in `doc_mount_documents` rows
keyed by `(mountPointId, relativePath)` where `mountPointId` matches
`characters.characterDocumentMountPointId`:

| Field | Vault path |
|---|---|
| identity | `identity.md` |
| description | `description.md` |
| manifesto | `manifesto.md` |
| personality | `personality.md` |
| exampleDialogues | `example-dialogues.md` |
| pronouns, aliases, title, firstMessage, talkativeness, canChooseOutfit | `properties.json` — `canChooseOutfit` is optional-with-default (absent hydrates as `false`), so old vaults need no backfill and no migration exists. |
| metadata | `metadata.json` — optional; a flat object of user-authored keys with any JSON value. Absent file or unparseable content hydrates as `{}` (**not** a keystone — only `properties.json` may declare a vault broken), so old vaults need no backfill and no migration exists. A patch REPLACES the whole object rather than merging keys. |
| physicalDescription.fullDescription | `physical-description.md` |
| physicalDescription.{headAndShoulders,short,medium,long,complete}Prompt | `physical-prompts.json` |
| systemPrompts[] | `Prompts/<sanitized-name>.md` (one file per record) |
| scenarios[] | `Scenarios/<sanitized-title>.md` (one file per record) |

Reads go through `applyDocumentStoreOverlay()` in
`lib/database/repositories/character-properties-overlay.ts`; writes through
`applyDocumentStoreWriteOverlay()`. The repository's `*Raw` helpers bypass
the overlay (used by exports and the migration's populator).

### wardrobe_items — DROPPED in 4.7 (`drop-wardrobe-items-table-v1`)

The wardrobe became **vault-first** in 4.6; in 4.7 the legacy DB mirror and its
sync-back machinery were removed and the table itself was dropped by
`drop-wardrobe-items-table-v1`. The migration snapshots all rows to
`<dataDir>/backup/pre-drop-wardrobe-items.json` before the drop, and its
`shouldRun` is gated behind **both** population flags in `instance_settings`
(`wardrobe_folder_migrated_v1` and `shared_wardrobe_moved_to_general_v1`) so the
table can never be dropped before the one-time vault-population startup tasks
have completed (a two-startup sequence: migrations run before startup tasks, so
the flags are set on one startup and the table is dropped on the next).

Wardrobe items now live exclusively as `Wardrobe/*.md` frontmatter files in the
document store:

- **Character-owned items** live in each character's document vault under
  `Wardrobe/*.md` (the vault linked via
  `characters.characterDocumentMountPointId`).
- **Shared archetypes** (formerly `wardrobe_items` rows with
  `characterId = NULL`) live in the singleton **"Quilltap General"** mount under
  a `Wardrobe/` folder. A one-time startup task
  (`lib/startup/move-shared-wardrobe-to-general.ts`) relocated the existing
  shared archetypes there before the table was dropped.
- **Project stores** may shadow shared archetypes under their own `Wardrobe/`
  folders (project tier wins over Quilltap General on id collision).

Reads flow through the vault overlay (`getOverlaidWardrobeItems` /
`WardrobeRepository`); writes go through the vault-first writers
(`createVaultWardrobeItem` / `updateVaultWardrobeItem` / `deleteVaultWardrobeItem`
in `lib/database/repositories/vault-overlay/wardrobe-writes.ts`, which re-project
the `Wardrobe/` folder via `projectVaultWardrobe`). File shape is produced by
`buildWardrobeItemFile` (`lib/mount-index/character-vault.ts`) and parsed by
`parseWardrobeItemFile` (`lib/database/repositories/vault-overlay/parsers.ts`).

The historical table shape (for reference; no longer present):

```sql
-- DROPPED in 4.7 by drop-wardrobe-items-table-v1
CREATE TABLE "wardrobe_items" (
  "id" TEXT PRIMARY KEY,
  "characterId" TEXT,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "types" TEXT NOT NULL DEFAULT '[]',
  "componentItemIds" TEXT DEFAULT NULL,
  "appropriateness" TEXT,
  "isDefault" INTEGER DEFAULT 0,
  "migratedFromClothingRecordId" TEXT,
  "archivedAt" TEXT DEFAULT NULL,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL,
  FOREIGN KEY ("characterId") REFERENCES "characters"("id") ON DELETE CASCADE
);

CREATE INDEX "idx_wardrobe_items_character" ON "wardrobe_items"("characterId");
```

`componentItemIds` is a JSON array of other wardrobe item ids. An empty array (or NULL, treated identically) means a leaf item; a populated array means a composite — equipping the item stores its own id but at read time `expandComposites` resolves the components transitively (cycle-tolerant, depth-capped). Cycles are rejected at save time by the vault writers (`wardrobe-writes.ts`).

#### Wardrobe/*.md frontmatter

The vault-first wardrobe files carry their fields in YAML frontmatter, with
the markdown body holding the item's description. Optional fields are
emitted only when set; vault path lookups are case-insensitive.

| Field | Type | Description |
|---|---|---|
| id | string (UUID) | Stable item id. Falls back to a deterministic UUID derived from the mount + path if absent. |
| title | string | Display name. Falls back to a leading `# Heading` or the filename if absent. |
| types | list | Coverage slots this item designates: any of `top`, `bottom`, `footwear`, `accessories`. For composites this **may be a superset** of the components' slot union (so a composite can designate slots beyond the garments it actually contains, in order to clear them). |
| componentItems | list (composites only) | Component refs as slugs or UUIDs; resolved to canonical UUIDs in a second pass. Omitted for leaf items. |
| appropriateness | string | Context tags ("casual", "formal", "intimate", etc.). |
| imagePrompt | string | Optional plain-text cue fed to image-generation pipelines (avatar + Lantern scene) **in place of** the title; falls back to the title when absent/blank. Authored for a diffusion model (e.g. a literal description of a rank glyph), unlike the human-prose `description` body, which is stripped from image prompts. Emitted only when set. |
| default | bool | `true` when the item is part of the character's default outfit. Legacy `isDefault: true` is also honored on read. |
| replace | bool | **Composites only**, emitted only when `true`. When `true`, equipping the composite first clears every slot it designates (`types`) and then places only its own components; when `false`/absent, equipping is **additive** — components layer onto whatever already occupies those slots without clearing. Leaf items always replace their own slots and ignore the flag. |
| archived / archivedAt | bool / string (ISO 8601) | `archived: true` marks the item archived; `archivedAt` records when (falls back to the document's `updatedAt`). |
| migratedFromClothingRecordId | string (UUID) | Provenance from the legacy clothingRecords migration. |
| createdAt | string (ISO 8601) | Creation timestamp (falls back to the document's `createdAt`). |
| updatedAt | string (ISO 8601) | Last-update timestamp (falls back to the document's `updatedAt`). |

### outfit_presets — REMOVED in 4.5

The `outfit_presets` table was eliminated; named outfit bundles are now expressed as composite `wardrobe_items` rows whose `componentItemIds` references the constituent items. Migrations `migrate-outfit-presets-to-composites-v1` and `drop-outfit-presets-table-v1` perform the fold-and-drop. A snapshot of the table content is written to `<dataDir>/backup/pre-drop-outfit-presets.json` before the drop.

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT (UUID) | Primary key |
| characterId | TEXT (UUID, nullable) | Owner character. NULL = archetype (shared across characters) |
| title | TEXT | Display name of the item |
| description | TEXT | Detailed description for prompts and image generation |
| types | TEXT (JSON array) | Coverage slots: `["top"]`, `["bottom"]`, `["top","bottom"]` for dresses, etc. |
| componentItemIds | TEXT (JSON array, nullable) | Other wardrobe item ids this composite bundles. Empty/NULL = leaf item. Cycles rejected on save. |
| appropriateness | TEXT | Context tags: "casual", "formal", "intimate", etc. |
| isDefault | INTEGER | 1 = part of character's default outfit |
| migratedFromClothingRecordId | TEXT (UUID) | Tracks provenance from legacy clothingRecords migration |
| createdAt | TEXT (ISO 8601) | Creation timestamp |
| updatedAt | TEXT (ISO 8601) | Last update timestamp |

### character_plugin_data

Stores arbitrary per-character, per-plugin JSON metadata. Each plugin can store any valid JSON value associated with a character. Quilltap enforces only that the data field is parseable JSON.

```sql
CREATE TABLE "character_plugin_data" (
  "id" TEXT PRIMARY KEY,
  "characterId" TEXT NOT NULL,
  "pluginName" TEXT NOT NULL,
  "data" TEXT NOT NULL DEFAULT '{}',
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL,
  UNIQUE("characterId", "pluginName"),
  FOREIGN KEY ("characterId") REFERENCES "characters"("id") ON DELETE CASCADE
);

CREATE INDEX "idx_cpd_character" ON "character_plugin_data"("characterId");
CREATE INDEX "idx_cpd_plugin" ON "character_plugin_data"("pluginName");
```

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT (UUID) | Primary key |
| characterId | TEXT (UUID) | Character this data belongs to |
| pluginName | TEXT | Plugin name (e.g., "qtap-plugin-curl"), max 200 chars |
| data | TEXT (JSON) | Arbitrary JSON value — any valid JSON (object, array, string, number, boolean, null) |
| createdAt | TEXT (ISO 8601) | Creation timestamp |
| updatedAt | TEXT (ISO 8601) | Last update timestamp |

### chats

```sql
CREATE TABLE "chats" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "participants" TEXT DEFAULT '[]',
  "title" TEXT NOT NULL,
  "contextSummary" TEXT,
  "sillyTavernMetadata" TEXT,
  "tags" TEXT DEFAULT '[]',
  "roleplayTemplateId" TEXT,
  "timestampConfig" TEXT,
  "lastTurnParticipantId" TEXT,
  "messageCount" INTEGER DEFAULT 0,
  "lastMessageAt" TEXT,
  "lastRenameCheckInterchange" INTEGER DEFAULT 0,
  "compactionGeneration" INTEGER DEFAULT 0,
  "lastSummaryTurn" INTEGER DEFAULT 0,
  "lastSummaryTokens" INTEGER DEFAULT 0,
  "lastFullRebuildTurn" INTEGER DEFAULT 0,
  "summaryAnchorMessageIds" TEXT DEFAULT '[]',
  "isPaused" INTEGER DEFAULT 0,
  "isManuallyRenamed" INTEGER DEFAULT 0,
  "impersonatingParticipantIds" TEXT DEFAULT '[]',
  "activeTypingParticipantId" TEXT,
  "allLLMPauseTurnCount" INTEGER DEFAULT 0,
  "documentEditingMode" INTEGER DEFAULT 0,
  "projectId" TEXT,
  "totalPromptTokens" INTEGER DEFAULT 0,
  "totalCompletionTokens" INTEGER DEFAULT 0,
  "estimatedCostUSD" REAL,
  "priceSource" TEXT,
  "showSystemEventsOverride" INTEGER,
  "requestFullContextOnNextMessage" INTEGER DEFAULT 0,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL,
  "disabledTools" TEXT DEFAULT '[]',
  "disabledToolGroups" TEXT DEFAULT '[]',
  "forceToolsOnNextMessage" INTEGER DEFAULT 0,
  "state" TEXT DEFAULT '{}',
  "compressionCache" TEXT DEFAULT NULL,
  "agentModeEnabled" INTEGER DEFAULT NULL,
  "agentTurnCount" INTEGER DEFAULT 0,
  "storyBackgroundImageId" TEXT DEFAULT NULL,
  "lastBackgroundGeneratedAt" TEXT DEFAULT NULL,
  "imageProfileId" TEXT DEFAULT NULL,
  "isDangerousChat" INTEGER DEFAULT NULL,
  "dangerScore" REAL DEFAULT NULL,
  "dangerCategories" TEXT DEFAULT '[]',
  "dangerClassifiedAt" TEXT DEFAULT NULL,
  "dangerClassifiedAtMessageCount" INTEGER DEFAULT NULL,
  "conciergeOverride" TEXT DEFAULT NULL,  -- per-chat Concierge mode: NULL = follow global; 'OFF' = off-duty (skip every Concierge effect)
  "answerConfirmationOverride" TEXT DEFAULT NULL,  -- per-chat answer-confirmation override: NULL = inherit (project override, then global); 'ON'/'OFF' = force the Salon consistency check on/off. Added by add-answer-confirmation-columns-v2.
  "turnQueue" TEXT DEFAULT '[]',
  "spokenThisCycleParticipantIds" TEXT DEFAULT '[]',  -- JSON array of participantIds that have spoken in the current rotation cycle (includes user-controlled characters)
  "sceneState" TEXT DEFAULT NULL,
  "renderedMarkdown" TEXT DEFAULT NULL,
  "equippedOutfit" TEXT DEFAULT NULL,
  "pendingOutfitNotifications" TEXT DEFAULT NULL,
  "characterAvatars" TEXT DEFAULT NULL,  -- JSON map { [characterId]: { imageId, generatedAt, afterMessageCount } } where imageId is a vault link id (post-photos-Phase-3); pre-cutover values were legacy files.id and are translated by the migration.
  "avatarGenerationEnabled" INTEGER DEFAULT NULL,
  "alertCharactersOfLanternImages" INTEGER DEFAULT NULL,
  "chatType" TEXT DEFAULT 'salon',                  -- 'salon' | 'help' | 'autonomous' | 'brahma'
  "helpPageUrl" TEXT DEFAULT NULL,
  "consoleConnectionProfileId" TEXT DEFAULT NULL,   -- Brahma Console (chatType='brahma') active model; NULL on other chats
  "scenarioText" TEXT DEFAULT NULL,
  "documentMode" TEXT DEFAULT 'normal',
  "dividerPosition" INTEGER DEFAULT 45,
  "terminalMode" TEXT DEFAULT 'normal',
  "activeTerminalSessionId" TEXT DEFAULT NULL,
  "rightPaneVerticalSplit" INTEGER DEFAULT 50,
  "allowCrossCharacterVaultReads" INTEGER DEFAULT 0,
  "compiledIdentityStacks" TEXT DEFAULT NULL,
  "courierCheckpoints" TEXT DEFAULT NULL,
  "commonplaceSceneCache" TEXT DEFAULT NULL,
  "commonplaceRecallHistory" TEXT DEFAULT NULL,
  "timelineMode" TEXT DEFAULT NULL,  -- added in 4.9 (add-episodic-memory-fields-v1): 'realtime' (NULL reads as realtime) | 'narrative' — which clock the chat's story runs on (episodic recall)
  -- 4.6 Private Character Rooms: budget caps, schedule, run lifecycle, and visibility
  -- (populated only when chatType = 'autonomous'; NULL on other chats)
  "budgetMaxTurns" INTEGER DEFAULT NULL,
  "budgetMaxTokens" INTEGER DEFAULT NULL,   -- per-run token cap; counts cache-miss + output by default (see budgetExcludeCacheHits)
  "budgetMaxWallClockMs" INTEGER DEFAULT NULL,
  "budgetEstimatedSpendCapUSD" REAL DEFAULT NULL,
  "scheduleCron" TEXT DEFAULT NULL,
  "scheduleFreshnessWindowMs" INTEGER DEFAULT NULL,
  "scheduleNextRunAt" TEXT DEFAULT NULL,
  "scheduleLastRunAt" TEXT DEFAULT NULL,
  "runState" TEXT DEFAULT NULL,            -- 'idle' | 'running' | 'paused' | 'stopped' | 'budgetExhausted' | 'error'
  "currentRunId" TEXT DEFAULT NULL,        -- UUID of authoritative run; stale-run guard target
  "runStateMessage" TEXT DEFAULT NULL,
  "runStartedAt" TEXT DEFAULT NULL,
  "runEndedAt" TEXT DEFAULT NULL,
  "runPausedAt" TEXT DEFAULT NULL,         -- ISO time the current paused interval began; cleared on resume
  "runPausedAccumMs" INTEGER DEFAULT 0,    -- cumulative ms spent paused; wall-clock budget = (now - runStartedAt) - runPausedAccumMs (keeps runStartedAt as the token-window anchor)
  "runTurnsConsumed" INTEGER DEFAULT NULL,
  "runTokensConsumed" INTEGER DEFAULT NULL,
  "runMilestonesAnnounced" INTEGER DEFAULT 0, -- added in 4.6.1 (add-autonomous-run-milestones-v1): per-run bitmask of pacing nudges the Host has posted (bit 0 = halfway, bit 1 = near-end/10% remaining); reset to 0 at each run start
  "runDestructiveToolsAllowed" INTEGER DEFAULT 0,
  "budgetExcludeCacheHits" INTEGER DEFAULT 1, -- 1 = budget counts only billable cache-miss + output tokens; 0 = count every token incl. prompt-cache hits (added back from cacheUsage)
  "runVisibility" TEXT DEFAULT NULL,       -- 'owner_only' | 'household' | 'open'; NULL = inherit user default
  -- Aurora Core whisper per-chat overrides (NULL = inherit from character → global)
  "coreWhisperEnabled" INTEGER DEFAULT NULL,
  "coreWhisperInterval" INTEGER DEFAULT NULL,
  "turnSkippingEnabled" INTEGER DEFAULT NULL, -- added in 4.8 (add-turn-skipping-field-v1): "nothing to add" turn-skipping toggle. NULL = enabled (default); 0 = disabled.
  "showThinking" INTEGER DEFAULT NULL          -- added in 4.6 (add-thinking-display-fields-v1): per-chat thinking-visibility override (tri-state). NULL = inherit global chat_settings.thinkingDisplay.defaultVisible; 0 = hide; 1 = show. DISPLAY ONLY.
);

CREATE INDEX "idx_chats_chatType" ON "chats"("chatType");
CREATE INDEX "idx_chats_createdAt" ON "chats" ("createdAt" DESC);
CREATE INDEX "idx_chats_projectId" ON "chats" ("projectId");
CREATE INDEX "idx_chats_userId" ON "chats" ("userId");

-- 4.6 Private Character Rooms — partial indexes driving the scheduler tick and management list
CREATE INDEX "idx_chats_autonomous_nextRunAt" ON "chats"("scheduleNextRunAt") WHERE "chatType" = 'autonomous';
CREATE INDEX "idx_chats_autonomous_runState"  ON "chats"("runState")          WHERE "chatType" = 'autonomous';
```

### chat_documents

```sql
CREATE TABLE "chat_documents" (
  "id" TEXT PRIMARY KEY,
  "chatId" TEXT NOT NULL,
  "filePath" TEXT NOT NULL,
  "scope" TEXT NOT NULL DEFAULT 'project',
  "mountPoint" TEXT,
  "displayTitle" TEXT,
  "isActive" INTEGER DEFAULT 1,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);

CREATE INDEX "idx_chat_documents_chatId" ON "chat_documents" ("chatId");
CREATE UNIQUE INDEX "idx_chat_documents_unique" ON "chat_documents" ("chatId", "filePath", "scope", "mountPoint");
```

Tracks which documents are open in each chat's Document Mode. `isActive = 1`
means the document is currently open; **several rows per chat may be active at
once** — each open document surfaces as its own tab in the tabbed workspace
(`chats.documentMode` is the coarse "any document open" flag). Inactive rows are
retained as quick-reopen history. (Before 4.8 only one row per chat could be
active.)

### terminal_sessions

```sql
CREATE TABLE "terminal_sessions" (
  "id" TEXT PRIMARY KEY,
  "chatId" TEXT NOT NULL,
  "label" TEXT,
  "shell" TEXT NOT NULL,
  "cwd" TEXT NOT NULL,
  "startedAt" TEXT NOT NULL,
  "exitedAt" TEXT,
  "exitCode" INTEGER,
  "transcriptPath" TEXT,
  FOREIGN KEY ("chatId") REFERENCES "chats" ("id") ON DELETE CASCADE
);

CREATE INDEX "idx_terminal_sessions_chatId" ON "terminal_sessions" ("chatId");
CREATE INDEX "idx_terminal_sessions_startedAt" ON "terminal_sessions" ("startedAt" DESC);
```

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT (UUID) | Primary key |
| chatId | TEXT (UUID) | Chat this session belongs to; cascade deletes when chat is deleted |
| label | TEXT (nullable) | Optional user-provided label for the session |
| shell | TEXT | Shell executable name (e.g., `bash`, `zsh`) |
| cwd | TEXT | Working directory when session was started |
| startedAt | TEXT (ISO 8601) | Session creation timestamp |
| exitedAt | TEXT (ISO 8601, nullable) | Session exit timestamp; `null` if session is still active |
| exitCode | INTEGER (nullable) | Process exit code; `null` if session is still active |
| transcriptPath | TEXT (nullable) | Relative path to transcript file if recorded; `null` if not recorded |

### conversation_annotations

```sql
CREATE TABLE "conversation_annotations" (
  "id" TEXT PRIMARY KEY,
  "chatId" TEXT NOT NULL,
  "messageIndex" INTEGER NOT NULL,
  "sourceMessageId" TEXT,
  "characterName" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL,
  UNIQUE("chatId", "messageIndex", "characterName"),
  FOREIGN KEY ("chatId") REFERENCES "chats"("id") ON DELETE CASCADE
);

CREATE INDEX "idx_conversation_annotations_chatId" ON "conversation_annotations"("chatId");
```

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT (UUID) | Primary key |
| chatId | TEXT (UUID) | Chat this annotation belongs to |
| messageIndex | INTEGER | 0-based message number in rendered output |
| sourceMessageId | TEXT (UUID, nullable) | Original message UUID for resilience |
| characterName | TEXT | Annotation author |
| content | TEXT | Annotation text |
| createdAt | TEXT (ISO 8601) | Creation timestamp |
| updatedAt | TEXT (ISO 8601) | Last update timestamp |

### conversation_chunks

```sql
CREATE TABLE "conversation_chunks" (
  "id" TEXT PRIMARY KEY,
  "chatId" TEXT NOT NULL,
  "interchangeIndex" INTEGER NOT NULL,
  "content" TEXT NOT NULL,
  "participantNames" TEXT DEFAULT '[]',
  "messageIds" TEXT DEFAULT '[]',
  "embedding" BLOB,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL,
  UNIQUE("chatId", "interchangeIndex"),
  FOREIGN KEY ("chatId") REFERENCES "chats"("id") ON DELETE CASCADE
);

CREATE INDEX "idx_conversation_chunks_chatId" ON "conversation_chunks"("chatId");
```

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT (UUID) | Primary key |
| chatId | TEXT (UUID) | Chat this chunk belongs to |
| interchangeIndex | INTEGER | 0-based interchange number |
| content | TEXT | Rendered Markdown for this interchange |
| participantNames | TEXT (JSON array) | Names of participants in this interchange |
| messageIds | TEXT (JSON array) | Message UUIDs included in this interchange |
| embedding | BLOB (nullable) | Quantized vector embedding (see "Embedding BLOB format" above; same codec as memories.embedding). NULL when cold-tiered by the stale-chat maintenance sweep — content stays for keyword search and the chat re-embeds on next open |
| createdAt | TEXT (ISO 8601) | Creation timestamp |
| updatedAt | TEXT (ISO 8601) | Last update timestamp |

### chat_messages

```sql
CREATE TABLE "chat_messages" (
  "id" TEXT PRIMARY KEY,
  "chatId" TEXT NOT NULL,
  "type" TEXT DEFAULT 'message',
  "role" TEXT,
  "content" TEXT,
  "rawResponse" TEXT,
  "tokenCount" INTEGER,
  "promptTokens" INTEGER,
  "completionTokens" INTEGER,
  "swipeGroupId" TEXT,
  "swipeIndex" INTEGER,
  "attachments" TEXT DEFAULT '[]',
  "debugMemoryLogs" TEXT,
  "thoughtSignature" TEXT,
  "participantId" TEXT,
  "recoveryType" TEXT,
  "context" TEXT,
  "systemEventType" TEXT,
  "description" TEXT,
  "totalTokens" INTEGER,
  "provider" TEXT,
  "modelName" TEXT,
  "estimatedCostUSD" REAL,
  "createdAt" TEXT NOT NULL,
  "renderedHtml" TEXT DEFAULT NULL,
  "dangerFlags" TEXT DEFAULT NULL,
  "targetParticipantIds" TEXT DEFAULT NULL,
  "isSilentMessage" INTEGER DEFAULT NULL,
  "systemSender" TEXT DEFAULT NULL,
  "hostEvent" TEXT DEFAULT NULL,
  "systemKind" TEXT DEFAULT NULL,
  "summaryAnchor" TEXT DEFAULT NULL,
  "customAnnouncer" TEXT DEFAULT NULL,
  "pendingExternalPrompt" TEXT DEFAULT NULL,
  "pendingExternalAttachments" TEXT DEFAULT NULL,
  "pendingExternalPromptFull" TEXT DEFAULT NULL,
  "opaqueContent" TEXT DEFAULT NULL,
  "reasoningContent" TEXT DEFAULT NULL,
  "reasoningSegments" TEXT DEFAULT NULL,
  "carinaMeta" TEXT DEFAULT NULL,             -- Carina (inline LLM queries): JSON { answererId, question } on systemSender='carina' messages. Drives answerer-avatar resolution + "prior Carina exchanges" continuity. NULL on every non-Carina message. Added by add-carina-message-meta-v1.
  "confirmed" INTEGER DEFAULT NULL,           -- Answer confirmation: 1 = consistent/revised, 0 = affirmed a flagged answer, NULL = could-not-verify / not applicable, absent = feature off. Added by add-answer-confirmation-columns-v2.
  "confirmationChecked" INTEGER DEFAULT NULL, -- Answer confirmation: 1 when a check actually ran; distinguishes a persisted "unverified" (confirmed NULL but checked) from "never checked".
  "confirmationRevised" INTEGER DEFAULT NULL, -- Answer confirmation: shown content is a re-affirmation rewrite of the original.
  "confirmationNotes" TEXT DEFAULT NULL,      -- Answer confirmation: cheap-LLM discrepancy explanation (badge hover text).
  "confirmationOriginalContent" TEXT DEFAULT NULL, -- Answer confirmation: pre-revision text retained for the logs when confirmationRevised.
  "pascalMeta" TEXT DEFAULT NULL              -- Pascal the Croupier (custom pseudo-tools): JSON { tool, toolTitle?, chipLabel?, definitionTier, definitionMountId, params, rollForm, notation?, raw, diceRolls?, value, state, outcomeIndex, metadataTested?, llm?, effects?, invokedBy, callerParticipantId? } on systemSender='pascal' messages. `toolTitle` is the display title at roll time; absent on rows written before it existed, where readers fall back to `tool`. `chipLabel` is the definition's chipLabel template rendered at roll time — the per-run label the Salon chip and the bubble heading share; absent on older rows and unlabelled tools, where readers fall back to `toolTitle`, then `tool`. `metadataTested` records the keys the winning row consulted at their roll-time values. `llm` records an LLM consult when the definition declared one: { ok, output, prompt, reason?, provider?, model? } — output is the model's trimmed answer, or the author's errorMessage when the consult failed (`reason` holds the technical cause). `effects` records the side effects the run applied, in order: [{ target, previous?, next, tier? }] — the raw target as written ('state.encounter.count' / 'metadata.lockpick'), the prior value when there was one, what was written, and (state targets only) which tier the write landed in; absent when the run declared or applied none. The Salon body shows none of it — the bubble stays the author's message; this column carries the audit. The server-side roll record — authoritative, so a model cannot fudge a failure into a success (nor its recorded consequences). NULL on every non-Pascal message. Added by add-pascal-message-meta-v1; chipLabel/effects ride the JSON column with no migration.
);

CREATE INDEX "idx_chat_messages_chatId" ON "chat_messages" ("chatId");
CREATE INDEX "idx_chat_messages_createdAt" ON "chat_messages" ("createdAt" DESC);
CREATE INDEX "idx_chat_messages_swipeGroupId" ON "chat_messages" ("swipeGroupId");
```

### chat_settings

```sql
CREATE TABLE "chat_settings" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "avatarDisplayMode" TEXT DEFAULT 'ALWAYS',
  "avatarDisplayStyle" TEXT DEFAULT 'CIRCULAR',
  "tagStyles" TEXT DEFAULT '{}',
  "cheapLLMSettings" TEXT DEFAULT '{}',
  "imageDescriptionProfileId" TEXT,
  "uncensoredImageDescriptionProfileId" TEXT, -- added in 4.4 (add-uncensored-image-description-profile-field-v1): vision-LLM fallback used when the primary refuses
  "defaultRoleplayTemplateId" TEXT,
  "themePreference" TEXT DEFAULT '{}',
  "sidebarWidth" INTEGER DEFAULT 256,
  "defaultTimestampConfig" TEXT DEFAULT '{}',
  "memoryCascadePreferences" TEXT DEFAULT '{}',
  "autoHousekeepingSettings" TEXT DEFAULT '{"enabled":false,"perCharacterCap":2000,"perCharacterCapOverrides":{},"autoMergeSimilarThreshold":0.9,"mergeSimilar":false}',
  "memoryExtractionLimits" TEXT DEFAULT '{"enabled":false,"maxPerHour":20,"softStartFraction":0.7,"softFloor":0.7}', -- DEPRECATED in 4.4: superseded by instance_settings['memoryExtractionLimits']; column retained for backwards compat
  "memoryExtractionConcurrency" INTEGER DEFAULT 1, -- DEPRECATED at introduction in 4.4: superseded by instance_settings['memoryExtractionConcurrency']; column retained for backwards compat
  "tokenDisplaySettings" TEXT DEFAULT '{}',
  "contextCompressionSettings" TEXT DEFAULT '{}',
  "llmLoggingSettings" TEXT DEFAULT '{}',
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL,
  "autoDetectRng" INTEGER DEFAULT 1,
  "agentModeSettings" TEXT DEFAULT '{"maxTurns":10,"defaultEnabled":false}',
  "storyBackgroundsSettings" TEXT DEFAULT '{"enabled":false,"defaultImageProfileId":null}',
  "dangerousContentSettings" TEXT DEFAULT '{"mode":"OFF","threshold":0.7,"scanTextChat":true,"scanImagePrompts":true,"scanImageGeneration":false,"displayMode":"SHOW","showWarningBadges":true}',
  "autoLockSettings" TEXT DEFAULT '{"enabled":false,"idleMinutes":15}',
  "compositionModeDefault" INTEGER DEFAULT 0,
  "composerSpellcheck" INTEGER DEFAULT 1, -- added in 4.6 (add-composer-spellcheck-field-v1): governs browser spellcheck on Salon composer + Document Mode rich editor
  "composerEmoji" INTEGER DEFAULT 1, -- added in 4.8.2 (add-composer-emoji-field-v1): governs the `:` emoji typeahead on Salon composer + Document Mode rich editor; the toolbar's emoji picker is NOT gated by it
  "composerUnicode" INTEGER DEFAULT 1, -- added in 4.8.2 (add-composer-unicode-field-v1): governs the `\` Unicode typeahead on Salon composer + Document Mode rich editor; the toolbar's symbol picker is NOT gated by it
  "textReplacementsEnabled" INTEGER DEFAULT 1, -- added in 4.6 (add-text-replacements-enabled-field-v1): master switch for the Layer 1.5 text-replacement plugin; rule list lives in text_replacement_rules
  "autonomousRoomSettings" TEXT DEFAULT '{}', -- added in 4.6 (add-autonomous-rooms-fields-v1): user-level defaults for autonomous rooms { dailyTokenBudget, defaultFreshnessWindowMs, visibilityDefault, destructiveToolPolicy }
  "coreWhisper" TEXT DEFAULT '{"enabled":true,"interval":12,"silenceThreshold":3,"packetTokenBudget":4096,"fireOnContextTransition":true}', -- added in 4.6 (add-core-whisper-settings-field-v1): global defaults for Aurora's Core whisper { enabled, interval, silenceThreshold, packetTokenBudget, fireOnContextTransition }. Per-chat/per-character overrides live on chats.coreWhisper*/characters.coreWhisperEnabled. Resolution: chat → character → global.
  "thinkingDisplay" TEXT DEFAULT '{"defaultVisible":true,"defaultCollapsed":true}', -- added in 4.6 (add-thinking-display-fields-v1): global defaults for showing reasoning models' thinking { defaultVisible, defaultCollapsed }. Per-chat override lives on chats.showThinking. DISPLAY ONLY.
  "autoScrollOnResponseComplete" INTEGER DEFAULT 0, -- added in 4.6 (add-auto-scroll-on-response-complete-field-v1): when 1, the Salon scrolls to the newest message as a reply finishes / a new message arrives (only when already near the bottom). Default 0 so long replies don't yank the reader away. DISPLAY ONLY.
  "answerConfirmationSettings" TEXT DEFAULT '{"enabled":false}', -- added in 4.8 (add-answer-confirmation-columns-v2): global default for the Salon answer-confirmation check { enabled }. Per-project override in project properties.json; per-chat override on chats.answerConfirmationOverride.
  "customTools" INTEGER DEFAULT 1, -- added in 4.8 (add-custom-tools-field-v1): when 0, Pascal's run_custom pseudo-tool is never offered to models and the composer gutter button is hidden. Custom tool definitions themselves are retained.
  "smartTypographySettings" TEXT DEFAULT '{"displayQuotes":false,"dashes":true,"ellipsis":true}', -- added in 4.8.2 (add-smart-typography-settings-field-v1): Layer 1.6 { displayQuotes, dashes, ellipsis }. `displayQuotes` curls quotes at RENDER time only — chat_messages.content is never rewritten, so model input, embeddings and exports are unaffected; suppressed for a template whose patterns claim a quote character. `dashes`/`ellipsis` are type-time and DO write real –/—/… into the composer text.
  UNIQUE("userId")
);

CREATE INDEX "idx_chat_settings_createdAt" ON "chat_settings" ("createdAt" DESC);
CREATE INDEX "idx_chat_settings_userId" ON "chat_settings" ("userId" ASC);
```

### text_replacement_rules

Global list (no `userId` — single-user model) of literal `from → to` text replacements applied on word boundaries by the Lexical `TextReplacementPlugin`. The master switch sits on `chat_settings.textReplacementsEnabled`; this table holds the rules themselves.

```sql
CREATE TABLE "text_replacement_rules" (
  "id" TEXT PRIMARY KEY,
  "fromText" TEXT NOT NULL,                       -- literal trigger; whole-word match only (no leading/trailing whitespace enforced by the API)
  "toText" TEXT NOT NULL,                         -- replacement output (verbatim)
  "caseSensitive" INTEGER NOT NULL DEFAULT 0,     -- 0 = case-insensitive lookup; 1 = exact-case lookup
  "enabled" INTEGER NOT NULL DEFAULT 1,           -- 0 = rule skipped at compile time
  "sortOrder" INTEGER NOT NULL DEFAULT 0,         -- UI presentation order; does NOT affect match priority
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);

CREATE INDEX "idx_text_replacement_rules_enabled" ON "text_replacement_rules" ("enabled");
CREATE INDEX "idx_text_replacement_rules_sortOrder" ON "text_replacement_rules" ("sortOrder");
```

Match priority is *not* keyed off `sortOrder`. The renderer compiles enabled rows into two maps — `caseSensitive` and `caseInsensitive` (keyed on `fromText.toLowerCase()`) — and looks them up in that order. A `(fromText, caseSensitive)` collision is rejected at the API with 409.

Participates in **backup/restore** (since 4.6) as `data/text-replacement-rules.json` — an optional array, so it did not bump `backupFormat`. Replace-mode restore truncates the table via `clearFormat3Entities()`; merge-mode restore inserts each row and skips `(fromText, caseSensitive)` collisions. Excluded from `.qtap` export/import on purpose: it is global config with no `userId`, the same class as `chat_settings`/`instance_settings`.

### connection_profiles

```sql
CREATE TABLE "connection_profiles" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "apiKeyId" TEXT,
  "baseUrl" TEXT,
  "modelName" TEXT NOT NULL,
  "parameters" TEXT DEFAULT '{}',
  "isDefault" INTEGER DEFAULT 0,
  "isCheap" INTEGER DEFAULT 0,
  "allowWebSearch" INTEGER DEFAULT 0,
  "useNativeWebSearch" INTEGER DEFAULT 0,
  "tags" TEXT DEFAULT '[]',
  "totalTokens" INTEGER DEFAULT 0,
  "totalPromptTokens" INTEGER DEFAULT 0,
  "totalCompletionTokens" INTEGER DEFAULT 0,
  "messageCount" INTEGER DEFAULT 0,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL,
  "isDangerousCompatible" INTEGER DEFAULT 0,
  "allowToolUse" INTEGER DEFAULT 1,
  "sortIndex" INTEGER DEFAULT 0,
  "modelClass" TEXT DEFAULT NULL,
  "maxContext" INTEGER DEFAULT NULL,
  "maxTokens" INTEGER DEFAULT NULL,
  "supportsImageUpload" INTEGER DEFAULT 0,
  "transport" TEXT NOT NULL DEFAULT 'api',
  "courierDeltaMode" INTEGER DEFAULT 1,
  "pseudoToolMode" TEXT DEFAULT 'auto',
  -- Multi-character turn anchor. 1 = prefill an assistant "[Name]" message;
  -- 0 = append a prose instruction to the system prompt instead. NULL means
  -- never chosen (rows older than the migration, or imported from a pre-4.9
  -- bundle) and resolves to the provider default — off for Anthropic, on
  -- elsewhere. Read it only through profileUsesNamePrefill()
  -- (lib/llm/multi-character-prefill.ts).
  "multiCharacterPrefill" INTEGER DEFAULT 1
);

CREATE INDEX "idx_connection_profiles_createdAt" ON "connection_profiles" ("createdAt" DESC);
CREATE INDEX "idx_connection_profiles_provider" ON "connection_profiles" ("provider");
CREATE INDEX "idx_connection_profiles_userId" ON "connection_profiles" ("userId");

-- Profile names are unique per user, case-insensitive and whitespace-trimmed.
-- The expression mirrors normalizeProfileName() in lib/llm/connection-profile-names.ts.
-- Added by add-connection-profile-unique-name-index-v1 (which de-dups first).
CREATE UNIQUE INDEX "idx_connection_profiles_userId_name" ON "connection_profiles" ("userId", lower(trim("name")));
```

### projects

As of the project-store cutover (`cutover-projects-to-store-v1`), the `projects`
row is slim: only `id`, `name`, `officialMountPointId`, and the timestamps are
columns. Everything else lives in the project's **official document store**
(the mount point `officialMountPointId` points at) as top-level files:

| Former column(s) | Store file | Format |
| --- | --- | --- |
| `description` | `description.md` | Markdown body |
| `instructions` | `instructions.md` | Markdown body |
| `state` | `state.json` | the JSON object |
| `allowAnyCharacter`, `characterRoster`, `color`, `icon`, `defaultDisabledTools`, `defaultDisabledToolGroups`, `defaultAgentModeEnabled`, `defaultAvatarGenerationEnabled`, `defaultImageProfileId`, `defaultRoleplayTemplateId`, `defaultAlertCharactersOfLanternImages`, `storyBackgroundsEnabled`, `staticBackgroundImageId`, `storyBackgroundImageId`, `backgroundDisplayMode` | `properties.json` | one flat JSON object |

The repository (`projects.repository.ts`) overlays these files on read
(`applyProjectStoreOverlay`) and routes them back to the store on write, so the
hydrated `Project` object is unchanged for callers. `userId` was dropped
entirely — projects are global to the instance (single-user-per-instance).

```sql
CREATE TABLE "projects" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "officialMountPointId" TEXT DEFAULT NULL,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);

CREATE INDEX "idx_projects_createdAt" ON "projects" ("createdAt" DESC);
```

### groups

A **Group** is a cross-section of *characters* (parallel to how a Project is a
cross-section of files/chats). Like `projects`, the `groups` row is slim: only
`id`, `name`, `officialMountPointId`, and the timestamps are columns. Everything
else lives in the group's **official document store** (the mount point
`officialMountPointId` points at) as top-level files:

| Hydrated field(s) | Store file | Format |
| --- | --- | --- |
| `description` | `description.md` | Markdown body |
| `instructions` | `instructions.md` | Markdown body |
| `state` | `state.json` | the JSON object |
| `color`, `icon` | `properties.json` | one flat JSON object |

The repository (`groups.repository.ts`) overlays these files on read
(`applyGroupStoreOverlay`) and routes them back to the store on write, so the
hydrated `Group` object is unchanged for callers. The official store also holds a
`Scenarios/` folder and a `Knowledge/` folder. Group membership and *additional
linked* stores live in the mount-index database (`group_character_members` and
`group_doc_mount_links`).

```sql
CREATE TABLE "groups" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "officialMountPointId" TEXT DEFAULT NULL,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);

CREATE INDEX "idx_groups_name" ON "groups" ("name");
```

### files

```sql
CREATE TABLE "files" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "sha256" TEXT NOT NULL,
  "originalFilename" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  -- width/height are the ACTUAL stored-raster dimensions, measured from the
  -- bytes after WebP conversion (convertToWebP), not the requested size. For
  -- generated images this matters because providers often return a different
  -- shape than asked; null when not a raster image (e.g. SVG) or unmeasured.
  "width" INTEGER,
  "height" INTEGER,
  "isPlainText" INTEGER,
  "linkedTo" TEXT DEFAULT '[]',
  "source" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "generationPrompt" TEXT,
  "generationModel" TEXT,
  "generationRevisedPrompt" TEXT,
  "description" TEXT,
  "tags" TEXT DEFAULT '[]',
  "projectId" TEXT,
  "folderPath" TEXT,
  "storageKey" TEXT,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL,
  "fileStatus" TEXT DEFAULT 'ok'
);

CREATE INDEX "idx_files_category" ON "files" ("category");
CREATE INDEX "idx_files_createdAt" ON "files" ("createdAt" DESC);
CREATE INDEX "idx_files_projectId" ON "files" ("projectId");
CREATE INDEX "idx_files_sha256" ON "files" ("sha256");
CREATE INDEX "idx_files_userId" ON "files" ("userId");
```

### folders

```sql
CREATE TABLE "folders" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "parentFolderId" TEXT,
  "projectId" TEXT,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);

CREATE INDEX "idx_folders_createdAt" ON "folders" ("createdAt" DESC);
CREATE INDEX "idx_folders_parentFolderId" ON "folders" ("parentFolderId");
CREATE INDEX "idx_folders_projectId" ON "folders" ("projectId");
CREATE INDEX "idx_folders_userId" ON "folders" ("userId");
```

### help_docs

Stores help documentation synced from the `help/` directory on disk. Unlike the old pre-built MessagePack bundle, help docs are now stored in the database and embedded at runtime using the user's chosen embedding profile, allowing the embedding model to be swapped system-wide. Introduced in v2.15.0 (migration: `create-help-docs-table-v1`).

```sql
CREATE TABLE "help_docs" (
  "id" TEXT PRIMARY KEY,
  "title" TEXT NOT NULL,
  "path" TEXT NOT NULL UNIQUE,
  "url" TEXT NOT NULL DEFAULT '',
  "content" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "embedding" BLOB,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);

CREATE INDEX "idx_help_docs_path" ON "help_docs" ("path");
CREATE INDEX "idx_help_docs_url" ON "help_docs" ("url");
```

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT (UUID) | Primary key |
| title | TEXT | Document title (from first H1 or filename) |
| path | TEXT | Relative path to Markdown file (e.g., `help/aurora.md`). Unique constraint. |
| url | TEXT | URL route this doc is associated with (e.g., `/aurora`, `/settings?tab=chat`) |
| content | TEXT | Full document content with frontmatter stripped |
| contentHash | TEXT | SHA-256 hash of raw file content, used for change detection during sync |
| embedding | BLOB (nullable) | Quantized embedding vector (see "Embedding BLOB format"), generated at runtime using user's embedding profile. Whole-document granularity — the coarse signal; see `help_doc_chunks` for section granularity |
| createdAt | TEXT (ISO 8601) | Creation timestamp |
| updatedAt | TEXT (ISO 8601) | Last update timestamp |

### help_doc_chunks

Section-level slices of each help document, one row per chunk, so semantic search can match a *section* rather than only a whole page. A whole-document vector for a long, topically broad page (`help/chat-settings.md` covers a dozen subsystems) is a smear that matches any specific question only weakly. Rows are rebuilt from disk by the help-doc sync whenever a document's content hash changes, and their embeddings are filled by the same `HELP_DOC` background job that embeds the parent document — so a chunk can never carry a dimension its parent doesn't. Introduced in v4.9.0 (migration: `create-help-doc-chunks-table-v1`).

```sql
CREATE TABLE "help_doc_chunks" (
  "id" TEXT PRIMARY KEY,
  "docId" TEXT NOT NULL,
  "chunkIndex" INTEGER NOT NULL,
  "heading" TEXT,
  "content" TEXT NOT NULL,
  "embedding" BLOB,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL,
  UNIQUE("docId", "chunkIndex"),
  FOREIGN KEY ("docId") REFERENCES "help_docs"("id") ON DELETE CASCADE
);

CREATE INDEX "idx_help_doc_chunks_docId" ON "help_doc_chunks" ("docId");
```

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT (UUID) | Primary key |
| docId | TEXT (UUID) | Owning `help_docs` row; cascade-deleted with it |
| chunkIndex | INTEGER | 0-based position within the document |
| heading | TEXT (nullable) | Nearest Markdown heading above the chunk, used as context when embedding and shown with a search hit |
| content | TEXT | The chunk text; consecutive chunks overlap by design |
| embedding | BLOB (nullable) | Quantized embedding vector (see "Embedding BLOB format"). NULL between a content change and the next `HELP_DOC` embedding job |
| createdAt | TEXT (ISO 8601) | Creation timestamp |
| updatedAt | TEXT (ISO 8601) | Last update timestamp |

### memories

```sql
CREATE TABLE "memories" (
  "id" TEXT PRIMARY KEY,
  "characterId" TEXT NOT NULL,
  "aboutCharacterId" TEXT,
  "chatId" TEXT,
  "projectId" TEXT,
  "content" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "keywords" TEXT DEFAULT '[]',
  "tags" TEXT DEFAULT '[]',
  "importance" REAL DEFAULT 0.5,
  "embedding" BLOB,
  "source" TEXT DEFAULT 'MANUAL',
  "sourceMessageId" TEXT,
  "lastAccessedAt" TEXT,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL,
  "reinforcementCount" INTEGER DEFAULT 1,
  "lastReinforcedAt" TEXT DEFAULT NULL,
  "relatedMemoryIds" TEXT DEFAULT '[]',
  "reinforcedImportance" REAL DEFAULT 0.5,
  "witnessedContext" TEXT DEFAULT NULL,  -- added in 4.6 (add-autonomous-rooms-fields-v1): 'user_present' | 'autonomous_room' | 'manual'. NULL on legacy rows.
  "occurredAt" TEXT DEFAULT NULL,        -- added in 4.9 (add-episodic-memory-fields-v1): ISO wall-clock EVENT time (vs createdAt, the write clock). Backfilled from the source message's createdAt, else the memory's own createdAt.
  "narrativeTime" TEXT DEFAULT NULL,     -- added in 4.9: free-text in-story time for fictional-timeline chats ("the third night at sea")
  "entities" TEXT DEFAULT '[]',          -- added in 4.9: JSON string[] of the episode's proper nouns (places, people, named things)
  "kind" TEXT DEFAULT 'semantic'         -- added in 4.9: 'semantic' (standing fact) | 'episodic' (specific dated occurrence)
);

CREATE INDEX "idx_memories_characterId" ON "memories" ("characterId");
CREATE INDEX "idx_memories_chatId" ON "memories" ("chatId");
CREATE INDEX "idx_memories_createdAt" ON "memories" ("createdAt" DESC);
CREATE INDEX "idx_memories_occurredAt" ON "memories" ("occurredAt" DESC);  -- added in 4.9 (episodic spine)
CREATE INDEX "idx_memories_projectId" ON "memories" ("projectId");
CREATE INDEX "idx_memories_reinforcedImportance" ON "memories" ("reinforcedImportance" DESC);
```

`aboutCharacterId` semantics: the character the memory is *about*. Three buckets are valid:

- `aboutCharacterId === characterId` — self-referential memory (the holder's own knowledge of themselves; produced by the character-extraction pass in `lib/memory/memory-processor.ts`).
- `aboutCharacterId !== characterId` — inter-character memory (the holder remembers something about another character — including a user-controlled persona, in which case `characters.controlledBy === 'user'` for the about-target).
- `aboutCharacterId IS NULL` — legacy / ambiguous. New auto-extracted memories should not produce nulls; the `align-about-character-id-v1` migration (v4.4.0) backfilled existing nulls per the name-presence rule.

`createMemoryWithGate` (the chokepoint for AUTO writes) applies a name-presence safety net before insert: when `aboutCharacterId` differs from the holder, the about-character's `name + aliases` (plus `user` / `the user` for `controlledBy: 'user'` characters) must appear in `summary + content`; otherwise `aboutCharacterId` is collapsed to the holder. Manual memories bypass the safety net.

### prompt_templates

```sql
CREATE TABLE "prompt_templates" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT,
  "name" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "description" TEXT,
  "isBuiltIn" INTEGER DEFAULT 0,
  "category" TEXT,
  "modelHint" TEXT,
  "tags" TEXT DEFAULT '[]',
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);

CREATE INDEX "idx_prompt_templates_createdAt" ON "prompt_templates" ("createdAt" DESC);
CREATE INDEX "idx_prompt_templates_userId" ON "prompt_templates" ("userId");
```

### roleplay_templates

```sql
CREATE TABLE "roleplay_templates" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "systemPrompt" TEXT NOT NULL,
  "isBuiltIn" INTEGER DEFAULT 0,
  "tags" TEXT DEFAULT '[]',
  "delimiters" TEXT DEFAULT '[]',
  "renderingPatterns" TEXT DEFAULT '[]',
  "dialogueDetection" TEXT,
  "narrationDelimiters" TEXT DEFAULT '"*"',
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);

CREATE INDEX "idx_roleplay_templates_createdAt" ON "roleplay_templates" ("createdAt" DESC);
CREATE INDEX "idx_roleplay_templates_userId" ON "roleplay_templates" ("userId");
```

> **`delimiters` JSON shape (since `rp-delimiter-kinds-v1`):** each entry is a
> discriminated union on `kind`: `{ kind: 'wrap', name, buttonName, delimiters, style }`
> (string or `[open, close]`), `{ kind: 'linePrefix', name, buttonName, marker, style }`,
> or `{ kind: 'tagPrefix', name, buttonName, open, close, tokenPattern?, style }`. Legacy
> entries with no `kind` are read as `wrap`. Every kind also accepts two optional fields:
> `hideDelimiter` (boolean — strip the delimiter/prefix from rendered output) and
> `addOns` (`{ bold, italic, reverse, underline: 'none'|'single'|'double', border:
> 'none'|'solid'|'dashed', font: ''|'sans'|'serif'|'mono'|'display'|'script' }`). Both are
> absent on legacy/built-in entries (treated as off). `renderingPatterns` entries may carry
> an optional `scope: 'inline' | 'line'` (absent ⇒ `inline`) and an optional `hideDelimiters`
> boolean (the renderer then emits the pattern's `rpBody` capture group instead of the full
> match); add-ons are baked into the pattern's `className`. `linePrefix`/`tagPrefix` rules are
> `line`-scoped (the class lands on the whole block, not an inline span).

### tags

```sql
CREATE TABLE "tags" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "nameLower" TEXT NOT NULL,
  "quickHide" INTEGER DEFAULT 0,
  "visualStyle" TEXT,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL,
  UNIQUE("userId", "nameLower")
);

CREATE INDEX "idx_tags_createdAt" ON "tags" ("createdAt" DESC);
CREATE INDEX "idx_tags_userId" ON "tags" ("userId");
```

### background_jobs

```sql
CREATE TABLE "background_jobs" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "status" TEXT DEFAULT 'PENDING',
  "payload" TEXT DEFAULT '{}',
  "priority" INTEGER DEFAULT 0,
  "attempts" INTEGER DEFAULT 0,
  "maxAttempts" INTEGER DEFAULT 3,
  "lastError" TEXT,
  "scheduledAt" TEXT NOT NULL,
  "startedAt" TEXT,
  "completedAt" TEXT,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);

CREATE INDEX "idx_background_jobs_createdAt" ON "background_jobs" ("createdAt" DESC);
CREATE INDEX "idx_background_jobs_scheduledAt" ON "background_jobs" ("scheduledAt");
CREATE INDEX "idx_background_jobs_status" ON "background_jobs" ("status");
CREATE INDEX "idx_background_jobs_userId" ON "background_jobs" ("userId");
```

### embedding_profiles

```sql
CREATE TABLE "embedding_profiles" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "apiKeyId" TEXT,
  "baseUrl" TEXT,
  "modelName" TEXT NOT NULL,
  "dimensions" INTEGER,
  "truncateToDimensions" INTEGER DEFAULT NULL,
  "normalizeL2" INTEGER DEFAULT 1,
  "isDefault" INTEGER DEFAULT 0,
  "tags" TEXT DEFAULT '[]',
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);

CREATE INDEX "idx_embedding_profiles_createdAt" ON "embedding_profiles" ("createdAt" DESC);
CREATE INDEX "idx_embedding_profiles_userId" ON "embedding_profiles" ("userId");
```

### embedding_status

```sql
CREATE TABLE "embedding_status" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "profileId" TEXT NOT NULL,
  "status" TEXT DEFAULT 'PENDING',
  "embeddedAt" TEXT,
  "error" TEXT,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL,
  UNIQUE("entityType", "entityId", "profileId")
);

CREATE INDEX "idx_embedding_status_createdAt" ON "embedding_status" ("createdAt" DESC);
CREATE INDEX "idx_embedding_status_entityType_entityId" ON "embedding_status" ("entityType", "entityId");
CREATE INDEX "idx_embedding_status_status" ON "embedding_status" ("status");
CREATE INDEX "idx_embedding_status_userId" ON "embedding_status" ("userId");
```

### image_profiles

```sql
CREATE TABLE "image_profiles" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "apiKeyId" TEXT,
  "baseUrl" TEXT,
  "modelName" TEXT NOT NULL,
  "parameters" TEXT DEFAULT '{}',
  "isDefault" INTEGER DEFAULT 0,
  "tags" TEXT DEFAULT '[]',
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL,
  "isDangerousCompatible" INTEGER DEFAULT 0
);

CREATE INDEX "idx_image_profiles_createdAt" ON "image_profiles" ("createdAt" DESC);
CREATE INDEX "idx_image_profiles_userId" ON "image_profiles" ("userId");
```

### provider_models

```sql
CREATE TABLE "provider_models" (
  "id" TEXT PRIMARY KEY,
  "provider" TEXT NOT NULL,
  "modelId" TEXT NOT NULL,
  "modelType" TEXT DEFAULT 'chat',
  "displayName" TEXT NOT NULL,
  "baseUrl" TEXT,
  "contextWindow" INTEGER,
  "maxOutputTokens" INTEGER,
  "deprecated" INTEGER DEFAULT 0,
  "experimental" INTEGER DEFAULT 0,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);

CREATE INDEX "idx_provider_models_createdAt" ON "provider_models" ("createdAt" DESC);
CREATE INDEX "idx_provider_models_modelType" ON "provider_models" ("modelType");
CREATE INDEX "idx_provider_models_provider" ON "provider_models" ("provider");
```

### plugin_configs

```sql
CREATE TABLE "plugin_configs" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "pluginName" TEXT NOT NULL,
  "config" TEXT NOT NULL,
  "enabled" INTEGER,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL,
  UNIQUE("userId", "pluginName")
);

CREATE INDEX "idx_plugin_configs_createdAt" ON "plugin_configs" ("createdAt" DESC);
CREATE INDEX "idx_plugin_configs_pluginName" ON "plugin_configs" ("pluginName");
CREATE INDEX "idx_plugin_configs_userId" ON "plugin_configs" ("userId");
```

### tfidf_vocabularies

```sql
CREATE TABLE "tfidf_vocabularies" (
  "id" TEXT PRIMARY KEY,
  "profileId" TEXT NOT NULL UNIQUE,
  "userId" TEXT NOT NULL,
  "vocabulary" TEXT NOT NULL,
  "idf" TEXT NOT NULL,
  "avgDocLength" REAL NOT NULL,
  "vocabularySize" INTEGER NOT NULL,
  "includeBigrams" INTEGER DEFAULT 1,
  "fittedAt" TEXT NOT NULL,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL,
  FOREIGN KEY ("profileId") REFERENCES "embedding_profiles"("id") ON DELETE CASCADE
);

CREATE INDEX "idx_tfidf_vocabularies_createdAt" ON "tfidf_vocabularies" ("createdAt" DESC);
CREATE INDEX "idx_tfidf_vocabularies_profileId" ON "tfidf_vocabularies" ("profileId");
CREATE INDEX "idx_tfidf_vocabularies_userId" ON "tfidf_vocabularies" ("userId");
```

### vector_indices

```sql
CREATE TABLE "vector_indices" (
  "id" TEXT PRIMARY KEY,
  "characterId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "dimensions" INTEGER NOT NULL,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);

CREATE INDEX "idx_vector_indices_characterId" ON "vector_indices" ("characterId");
CREATE INDEX "idx_vector_indices_createdAt" ON "vector_indices" ("createdAt" DESC);
```

### vector_entries

```sql
CREATE TABLE "vector_entries" (
  "id" TEXT PRIMARY KEY,
  "characterId" TEXT NOT NULL,
  "embedding" BLOB NOT NULL,
  "createdAt" TEXT NOT NULL
);

CREATE INDEX "idx_vector_entries_characterId" ON "vector_entries" ("characterId");
CREATE INDEX "idx_vector_entries_createdAt" ON "vector_entries" ("createdAt" DESC);
```

### instance_settings

```sql
CREATE TABLE "instance_settings" (
  "key" TEXT PRIMARY KEY,
  "value" TEXT NOT NULL
);
```

Known keys (others may be present from migrations / startup hooks):
- `highest_app_version` — startup version guard (string).
- `wardrobe_folder_migrated_v1`, `wardrobe_json_refreshed_v1` — one-shot startup migration flags ("true").
- `maxConcurrentJobs` (4.7+) — integer 1–32, default 4. Global cap on how many background jobs of any type the dispatcher runs at once. Read fresh each claim cycle by `lib/background-jobs/host/job-dispatcher.ts` (`getMaxConcurrentJobs`), so a change applies within ~2 s without a restart; updated by `POST /api/v1/system/tools?action=job-concurrency` (surfaced as the "Simultaneous Labours" slider in the Tasks Queue card). Accessors in `lib/instance-settings/index.ts`.
- `memoryExtractionConcurrency` (4.4+) — integer 1–32. **DEPRECATED in 4.7**: the dispatcher unified to the global `maxConcurrentJobs` cap above; this key is no longer read at runtime (the `/api/v1/memories?action=extraction-concurrency` route still persists it for the `memory-diff` CLI). Was a per-instance MEMORY_EXTRACTION concurrency cap.
- `memoryExtractionLimits` (4.4+) — JSON: `{enabled, maxPerHour, softStartFraction, softFloor}`. Per-instance memory extraction rate limits. Read by `lib/background-jobs/handlers/memory-extraction.ts` and the dry-run extraction route; updated by `POST /api/v1/memories?action=extraction-limits-config`. Migrated from `chat_settings.memoryExtractionLimits` for SINGLE_USER_ID by `migrate-extraction-knobs-to-instance-settings-v1`.
- `memoryRecall` (4.7+) — JSON: `{scopePolicy: 'down-weight' | 'exclude', expandRelated: boolean}`. Per-instance Commonplace Book recall relevance settings. `scopePolicy` controls what happens to a `scope: narrow` memory whose `projectId` differs from the current chat's project (cross-project leakage): `down-weight` (default) applies a strong recall penalty, `exclude` filters it out entirely. `expandRelated` (default `false`, added in Phase 2) is the opt-in related-memory one-hop expansion toggle: when on, recall pulls each top hit's strongly-linked related memories in as extra candidates (capped at 3 per hit, 10 total), scores them against the same query embedding, and re-ranks the union. Read on the per-turn recall path (`lib/chat/context-manager.ts`, `lib/services/chat-message/pre-compute.service.ts`) via `getMemoryRecallSettings`; updated by `POST /api/v1/memories?action=recall-config`. No column on `chat_settings` (it is column-per-field; this knob lives instance-wide instead, like `memoryExtractionLimits`). Schema: `MemoryRecallSettingsSchema` in `lib/schemas/settings.types.ts`.
- `dataRetention` (4.8+) — JSON: `{staleChatDays: number}` (1–3650, default 30). Per-instance stale-chat retention window: how many days a chat must sit with no *played* message (participant character or human user; feature whispers don't count) before the daily maintenance sweep collapses its regenerable data — superseded generated images, `chats.compressionCache`/`renderedMarkdown`, the discardable `chat_messages` columns (`rawResponse`, `reasoningContent`, `reasoningSegments`, `renderedHtml`, `debugMemoryLogs`), and cold-tiered `conversation_chunks.embedding`. Resolved by `resolveStaleChatDays()` (`lib/background-jobs/maintenance/retention-constants.ts`); accessors in `lib/instance-settings`; updated by `PUT /api/v1/settings/data-retention` (Settings → Chat → Data Retention). Schema: `DataRetentionSettingsSchema` in `lib/schemas/settings.types.ts`.
- `taboo` (4.8+) — JSON: `{phrases: string[]}` (each 1–200 chars after trim, at most 500 entries, default `[]`). Per-instance list of phrases characters must never say. Normalized on write (trim, drop empties, case-insensitive dedupe, **user order preserved** — the rendering sits in the cacheable system-prompt prefix, so order is deliberately not sorted). Read once per turn by `buildContext()` (`lib/chat/context-manager.ts`) via `getTabooSettings` and rendered by `renderTabooSection` (`lib/chat/context/system-prompt-builder.ts`) between the universal math-formatting note and the per-turn tool instructions; an empty list renders no section at all. Updated by `PUT /api/v1/settings/taboo` (Settings → Chat → Taboo). Accessors in `lib/instance-settings`. Schema: `TabooSettingsSchema` in `lib/schemas/settings.types.ts`.
- `lastMaintenanceSweepAt` (4.7+) — ISO 8601 timestamp of the last completed scheduled-maintenance pass. Written/read by `lib/background-jobs/scheduled-maintenance.ts` to skip the startup tick when a sweep ran within the last 20 h (dev-restart friendliness). Internal; not exported.
- `lanternBackgroundsMountPointId` (4.3+) — UUID of the global "Lantern Backgrounds" database-backed mount point in `quilltap-mount-index.db`. Read by `lib/file-storage/lantern-store-bridge.ts`; written by `provision-lantern-backgrounds-mount-v1`. Used to land story-background job output and generic `generate_image` tool output when no project context is available.
- `userUploadsMountPointId` (4.4+) — UUID of the global "Quilltap Uploads" database-backed mount point in `quilltap-mount-index.db`. Read by `lib/file-storage/user-uploads-bridge.ts`; written by `provision-user-uploads-mount-v1`. Used for every project-less file write: chat attachments, paste/drag-drop images, the Files-tab uploader, capabilities-report exports, and backup-restore replay of project-less files. Replaces the legacy `<filesDir>/_general/` namespace as the catch-all destination.
- `generalMountPointId` (4.4+) — UUID of the global "Quilltap General" database-backed mount point in `quilltap-mount-index.db`. Read by `lib/mount-index/general-scenarios.ts` / `lib/mount-index/general-state.ts`; written by `provision-general-mount-v1`. Houses the instance-wide `Scenarios/` folder offered alongside project- and character-specific scenarios in every non-help New Chat dialog (managed via `/api/v1/scenarios` and the `/scenarios` page), **and** a root **`state.json`** — the **general tier** of the four-tier state cascade (chat → project → group → general). The `state.json` document is seeded idempotently at startup by `ensureGeneralStateFile()` (instrumentation PHASE 3.4b, right after `ensureGeneralScenariosFolder()`): a `{}` file is created when absent and never healed if the user has edited it (mirrors `ensureCharacterMetadataFile`). Read/written via `readGeneralState()` / `writeGeneralState()` (both `{}`-graceful and warn-on-corrupt), exposed at `GET/PUT/DELETE /api/v1/settings/general-state` and edited from Settings → Chat → General State. No migration and no `instance_settings` row of its own — the state lives as a mount document, not a column.

**Portability (4.8+).** The `instance-settings` `.qtap` export type dumps this
whole table minus `NON_PORTABLE_INSTANCE_SETTING_KEYS`
(`lib/instance-settings/index.ts`), so **a newly added key is portable by
default** — add it to that constant if it must not travel. Currently withheld:
the three mount-point pointers above (instance-local UUIDs into *this*
instance's `quilltap-mount-index.db`), `lastMaintenanceSweepAt` (local timing
state), and `highest_app_version` (the version guard's downgrade tripwire — an
imported value could lock a healthy instance out of its own database). Import
upserts by key, overwriting the receiving instance's values; that is the point
of the type. Backup/restore is separate and carries every key, remapping the
mount-point pointers in `new-account` mode (`MOUNT_POINT_SETTING_KEYS`,
`lib/backup/restore/uuid-remap.ts`).

### quilltap_meta

```sql
CREATE TABLE quilltap_meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);
```

### migrations_state

```sql
CREATE TABLE "migrations_state" (
  "id" TEXT PRIMARY KEY,
  "completedAt" TEXT NOT NULL,
  "quilltapVersion" TEXT NOT NULL,
  "itemsAffected" INTEGER NOT NULL DEFAULT 0,
  "message" TEXT
);
```

### migrations_metadata

```sql
CREATE TABLE "migrations_metadata" (
  "key" TEXT PRIMARY KEY,
  "value" TEXT NOT NULL
);
```

### SQLite statistics tables (auto-managed)

```sql
CREATE TABLE sqlite_stat1(tbl, idx, stat);
CREATE TABLE sqlite_stat4(tbl, idx, neq, nlt, ndlt, sample);
```

---

## LLM Logs Database Schema (`quilltap-llm-logs.db`)

This database uses the same encryption mechanism as the main database — the same pepper, unwrapped from the same `quilltap.dbkey`.

### llm_logs

```sql
CREATE TABLE "llm_logs" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "messageId" TEXT,
  "chatId" TEXT,
  "characterId" TEXT,
  "provider" TEXT NOT NULL,
  "modelName" TEXT NOT NULL,
  "request" TEXT NOT NULL,
  "response" TEXT NOT NULL,
  "usage" TEXT,
  "cacheUsage" TEXT,
  "rawProviderUsage" TEXT,
  "requestHashes" TEXT,
  "durationMs" INTEGER,
  "autonomousRunId" TEXT,
  "connectionProfileId" TEXT,
  "imageProfileId" TEXT,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);

CREATE INDEX "idx_llm_logs_chatId" ON "llm_logs" ("chatId");
CREATE INDEX "idx_llm_logs_createdAt" ON "llm_logs" ("createdAt" DESC);
CREATE INDEX "idx_llm_logs_type" ON "llm_logs" ("type");
CREATE INDEX "idx_llm_logs_userId" ON "llm_logs" ("userId");
CREATE INDEX "idx_llm_logs_autonomousRunId" ON "llm_logs" ("autonomousRunId");
CREATE INDEX "idx_llm_logs_connectionProfileId" ON "llm_logs" ("connectionProfileId");
CREATE INDEX "idx_llm_logs_imageProfileId" ON "llm_logs" ("imageProfileId");
```

`connectionProfileId` / `imageProfileId` are the profile-attribution columns added by `add-llm-logs-profile-columns-v1` (4.9). `provider` and `modelName` are flattened copies taken from the serving profile at call time — they *look* like profile attribution but cannot distinguish two profiles that share a provider/model pair, which is exactly what The Almanack's per-profile statistics need. Both are nullable: rows written before the columns landed carry NULL and are attributed by joining on `(provider, modelName)`, which the report labels "approximate". `connectionProfileId` is populated by the streaming path, the shared cheap-LLM path, auto-configure, the gatekeeper's LLM classifier, and the character optimizer; `imageProfileId` by the three image-generation call sites (tool handler, story background, character avatar), including the Concierge reroute's fallback profile.

`durationMs` is the wall-clock of the provider call. The shared cheap-LLM path (`lib/memory/cheap-llm-tasks/core-execution.ts`) and several service call sites did not populate it before 4.9; the character optimizer hardcoded `0`, which poisoned any average taken over the column. All of those now measure.

`autonomousRunId` is stamped on every LLM call made within an autonomous-room turn (the turn plus its agent-mode tool sub-calls), via an `AsyncLocalStorage` context the turn handler establishes. It is `NULL` for all non-autonomous calls. The autonomous-room turn handler sums `usage.totalTokens` for a run by this column to enforce the per-run token budget — superseding the older timestamp-window sum, which double-counted overlapping chat activity and background housekeeping. Added by migration `add-llm-logs-autonomous-run-id-column-v1`.

### SQLite statistics tables (auto-managed)

```sql
CREATE TABLE sqlite_stat1(tbl, idx, stat);
CREATE TABLE sqlite_stat4(tbl, idx, neq, nlt, ndlt, sample);
```

---

## Mount Index Database Schema (`quilltap-mount-index.db`)

This database uses the same encryption mechanism as the main database — the same pepper, unwrapped from the same `quilltap.dbkey`. Foreign keys are **enabled** (unlike the LLM logs DB).

Tables are auto-created on first access by their respective repositories via `CREATE TABLE IF NOT EXISTS`.

### doc_mount_points

```sql
CREATE TABLE IF NOT EXISTS "doc_mount_points" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "basePath" TEXT NOT NULL DEFAULT '',
  "mountType" TEXT NOT NULL DEFAULT 'filesystem',
  "storeType" TEXT NOT NULL DEFAULT 'documents',
  "includePatterns" TEXT NOT NULL DEFAULT '["*.md","*.txt","*.pdf","*.docx"]',
  "excludePatterns" TEXT NOT NULL DEFAULT '[".git","node_modules",".obsidian",".trash"]',
  "enabled" INTEGER NOT NULL DEFAULT 1,
  "lastScannedAt" TEXT,
  "scanStatus" TEXT NOT NULL DEFAULT 'idle',
  "lastScanError" TEXT,
  "conversionStatus" TEXT NOT NULL DEFAULT 'idle',
  "conversionError" TEXT,
  "fileCount" INTEGER NOT NULL DEFAULT 0,
  "chunkCount" INTEGER NOT NULL DEFAULT 0,
  "totalSizeBytes" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);
```

`mountType` is one of `'filesystem'`, `'obsidian'`, or `'database'`. For `'database'` stores the `basePath` column is empty — all document bytes live in `doc_mount_documents` and attached blobs in `doc_mount_blobs` within this same SQLCipher-encrypted database.

`storeType` is one of `'documents'` (default — general notes, references, research) or `'character'` (character sheets and related Aurora material). It classifies the store's content orthogonally to `mountType` so downstream features can treat character stores differently from general-purpose document stores. The column is added by in-repo `ALTER TABLE` on first access for legacy databases that predate this feature.

`conversionStatus` is one of `'idle'`, `'converting'`, `'deconverting'`, or `'error'`, and tracks the Convert / Deconvert action that moves a store between filesystem- and database-backed storage (see `POST /api/v1/mount-points/:id?action=convert` / `?action=deconvert`). Distinct from the file-level `doc_mount_files.conversionStatus`, which tracks pdf/docx→text extraction. `conversionError` holds the failure message when `conversionStatus = 'error'`. Both columns are added by in-repo `ALTER TABLE` on first access for legacy databases that predate this feature.

**`name` uniqueness (case-insensitive, app-level):** store names form one case-insensitive namespace — no two stores may share a name, even in different casing. There is deliberately no DB unique index (backup restore must be able to recreate legacy rows verbatim); enforcement lives at the write chokepoints (the mount-points create/rename routes return 409, `nextUniqueMountPointName` suffixes ` (N)` for auto-provisioned stores and character vaults) plus `repairMountPointNameCollisions` in `lib/database/repositories/mount-index-case-repair.ts`, which runs on every table init and suffixes any surviving duplicates (keep-oldest wins).

### doc_mount_folders

```sql
CREATE TABLE IF NOT EXISTS "doc_mount_folders" (
  "id" TEXT PRIMARY KEY,
  "mountPointId" TEXT NOT NULL REFERENCES "doc_mount_points"("id"),
  "parentId" TEXT,
  "name" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_doc_mount_folders_mp_parent_name_nocase"
  ON "doc_mount_folders" ("mountPointId", COALESCE("parentId", ''), "name" COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS "idx_doc_mount_folders_mp_path"
  ON "doc_mount_folders" ("mountPointId", "path");
```

Folder rows are populated only for `database`-backed mount points. Filesystem-backed mounts continue to derive folder structure from the OS; their `folderId` column on `doc_mount_file_links` is always NULL. The unique index on (mountPointId, COALESCE(parentId, ''), name COLLATE NOCASE) enforces one folder per parent per name **case-insensitively** — sibling folders may never differ only by casing (the read paths already treat paths case-insensitively, so `Lore` and `lore` would be ambiguous). The COALESCE is required because SQLite treats each NULL as distinct in UNIQUE constraints. Folder resolution is case-preserving: `ensureFolderPath` / `ensureLinkFolderId` reuse an existing case-variant folder and continue under its stored casing. `ensureFolderNocaseUniqueIndex` (`lib/database/repositories/mount-index-case-repair.ts`) runs on every table init — effectively every startup — as a double-check against out-of-band edits: it scans for case-colliding siblings unconditionally (renaming the newer with a ` (N)` suffix, subtree paths and link rows repaired with it) and recreates the index unless a genuine `UNIQUE … NOCASE` definition is already present under that name (existence alone is not trusted — a hand-made stand-in with the right name but the wrong definition is replaced). NOCASE folds ASCII only — non-ASCII case-variants slip past the index but are folded by the JS scan, so they are repaired at the next startup and blocked at the write chokepoints.

### doc_mount_files

```sql
CREATE TABLE IF NOT EXISTS "doc_mount_files" (
  "id" TEXT PRIMARY KEY,
  "sha256" TEXT NOT NULL,
  "fileSizeBytes" INTEGER NOT NULL,
  "fileType" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'filesystem',
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_doc_mount_files_sha256" ON "doc_mount_files" ("sha256");
```

A `doc_mount_files` row is the **content identity** for a set of bytes — one row per file's bytes, regardless of how many mount points reference them. Per-mount metadata (relativePath, fileName, folderId, conversion lifecycle, extracted text) lives on `doc_mount_file_links`; bytes for database-backed files live in `doc_mount_documents` (text) or `doc_mount_blobs` (binary), keyed by `fileId`.

`fileType` is one of `'pdf'`, `'docx'`, `'markdown'`, `'txt'`, `'json'`, `'jsonl'`, or `'blob'`. `'blob'` is the catch-all for arbitrary binaries with no extracted text representation (images, audio, archives, etc.) — their bytes live in `doc_mount_blobs`. `source` is `'filesystem'` when the bytes live on disk (one link per file enforced at the repo layer) or `'database'` when they live in `doc_mount_documents` / `doc_mount_blobs` (any number of links allowed — hard-linkable).

Writers call `findOrCreateByContent(sha256, ...)` rather than `create` directly: if a content row with the matching sha already exists, its UUID is reused so any existing links continue to resolve correctly. The `sha256` INDEX is not UNIQUE because pre-refactor databases may carry duplicate sha rows from the days when every (mountPoint, relativePath) was its own file row; the migration deliberately leaves them in place rather than collapsing. `findBySha256` returns the first match.

**Invariant (enforced at write time):** `sha256` equals the SHA-256 of the stored bytes. New content rows are minted by `linkBlobContent` in `doc-mount-file-links.repository`, which recomputes the sha from the actual bytes rather than trusting the caller. Any caller-supplied sha that diverges from the actual bytes hash triggers a warning log; the recomputed value wins. The `repair-mount-blob-sha256-from-bytes-v1` migration corrects pre-existing drifted rows. Note: `files.sha256` in the *main* DB is the input-bytes hash and is intentionally different — it is load-bearing for upload dedup and is not rewritten here.

### doc_mount_file_links

```sql
CREATE TABLE IF NOT EXISTS "doc_mount_file_links" (
  "id" TEXT PRIMARY KEY,
  "fileId" TEXT NOT NULL REFERENCES "doc_mount_files"("id") ON DELETE CASCADE,
  "linkGroupId" TEXT DEFAULT NULL,       -- added in 4.8 (add-doc-mount-link-groups-v1): deliberate hard-link group
  "mountPointId" TEXT NOT NULL REFERENCES "doc_mount_points"("id") ON DELETE CASCADE,
  "relativePath" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "folderId" TEXT,
  "originalFileName" TEXT,
  "originalMimeType" TEXT,
  "description" TEXT NOT NULL DEFAULT '',
  "descriptionUpdatedAt" TEXT,
  "conversionStatus" TEXT NOT NULL DEFAULT 'pending',
  "conversionError" TEXT,
  "plainTextLength" INTEGER,
  "extractedText" TEXT,
  "extractedTextSha256" TEXT,
  "extractionStatus" TEXT NOT NULL DEFAULT 'none',
  "extractionError" TEXT,
  "chunkCount" INTEGER NOT NULL DEFAULT 0,
  "allowEmbed" INTEGER NOT NULL DEFAULT 1,
  "allowCharacterRead" INTEGER NOT NULL DEFAULT 1,
  "allowCharacterWrite" INTEGER NOT NULL DEFAULT 1,
  "lastModified" TEXT NOT NULL,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_doc_mount_file_links_mp_path_nocase"
  ON "doc_mount_file_links" ("mountPointId", "relativePath" COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS "idx_doc_mount_file_links_fileId"
  ON "doc_mount_file_links" ("fileId");
CREATE INDEX IF NOT EXISTS "idx_doc_mount_file_links_mountPointId"
  ON "doc_mount_file_links" ("mountPointId");
CREATE INDEX IF NOT EXISTS "idx_doc_mount_file_links_linkGroupId"
  ON "doc_mount_file_links" ("linkGroupId") WHERE "linkGroupId" IS NOT NULL;
```

One row per visible location of a file (i.e. the hard link). Multiple link rows may point at the same `doc_mount_files` row, meaning the same bytes appear at multiple `(mountPointId, relativePath)` tuples. Per-consumer extraction state (conversion lifecycle, extracted text, chunk count) lives here so two consumers hard-linking the same content can re-extract or re-caption independently.

**`linkGroupId` is what makes a hard link a hard link — a shared `fileId` is not.** Content rows are addressed by sha256, so two *unrelated* documents with byte-identical content (an empty file, a boilerplate header) land on one `doc_mount_files` row by coincidence; in the field a single row was shared by 36 character vaults. A write must fork those apart, and it does: `linkDocumentContent` / `linkBlobContent` find-or-create a content row for the new sha and repoint the written link at it. Links carrying the same non-null `linkGroupId` were instead linked *deliberately* (`docs link` → `linkFile` → `bindLinkGroup`), and for those the same write fans the new `fileId` out to every group member (`fanOutGroupFileId`), giving POSIX write-through: edit either path, both change. `docs copy` deliberately does **not** bind a group — a copy shares a deduped content row until the first write and then goes its own way. Per-link metadata (`description`, `extractedText`) is never fanned out; only the bytes are shared. Chunks are keyed by `linkId`, so `reindexLinkGroupSiblings` (`lib/mount-index/link-groups.ts`) rebuilds each sibling's chunk set on the parent process after the write commits. `deleteWithGC` NULLs the group once a single member is left — a group of one is not a link.

Whenever a write repoints a link, the content row it abandoned is collected if nothing else references it (`gcOrphanedFileRow`, shared with `deleteWithGC`). The payload rows in `doc_mount_documents` / `doc_mount_blobs` are deleted explicitly rather than left to `ON DELETE CASCADE`, because that FK only exists on databases whose tables came from `add-doc-mount-file-links-v1` — tables generated from the Zod schema carry no foreign keys at all. Before this landed the abandoned rows were never collected on the write path, and the `add-doc-mount-link-groups-v1` migration sweeps up the backlog.

The UNIQUE index on `(mountPointId, relativePath COLLATE NOCASE)` enforces "one file per location" **case-insensitively** — `Notes.md` and `notes.md` are the same location, matching the `LOWER()`-based path lookups. Upserts are case-preserving: a database-store write addressed in a different casing updates the existing row and keeps its stored `relativePath`/`fileName`; filesystem-scan writes (`linkFilesystemFile`) instead adopt the on-disk casing, since disk is the source of truth there. `ensureLinkNocaseUniqueIndex` (`lib/database/repositories/mount-index-case-repair.ts`) runs on every table init — effectively every startup — as a double-check against out-of-band edits: it scans for case-colliding rows unconditionally (the newer is renamed `stem (N).ext`) and recreates the index unless a genuine `UNIQUE … NOCASE` definition is already present under that name; the legacy case-sensitive `idx_doc_mount_file_links_mp_path` is dropped on the way. Same ASCII-only NOCASE caveat as the folders index: non-ASCII case-variants are caught by the JS scan at startup and by the write chokepoints, not by the index. Deleting a link via `DocMountFileLinksRepository.deleteWithGC` cascades to chunks (FK), and if it was the last link for its file the file row and its payload get dropped. `sweepOrphanedFiles()` is the defense-in-depth GC for writers that bypass the helper.

The three `allow*` columns are the per-document policy, derived from a markdown document's YAML frontmatter at index time (positive sense: `1` == permissive == the frontmatter default of `true`). `allowEmbed` (frontmatter `embed`) gates inclusion in the embedding pipeline — `0` skips embedding and NULLs any existing chunk vectors. `allowCharacterRead` (`character_read`) gates whether LLM characters may read/list/grep/RAG the document — `0` makes it invisible to them (the human operator is unaffected). `allowCharacterWrite` (`character_write`) gates character-initiated mutation. `character_read` is the master gate: the coercion in `lib/doc-edit/document-policy.ts` forces `allowEmbed` and `allowCharacterWrite` to `0` whenever `allowCharacterRead` is `0`, so the stored columns are the *effective* policy (a row with `allowCharacterRead = 0, allowEmbed = 1` should never be written by the normal path). Non-markdown links keep the permissive defaults (no frontmatter to parse). The columns are re-derived on every reindex, so editing the frontmatter (operator or on-disk) is the control surface. See `lib/doc-edit/document-policy.ts` and the `add-doc-mount-file-policy-flags-v1` migration.

### doc_mount_chunks

```sql
CREATE TABLE IF NOT EXISTS "doc_mount_chunks" (
  "id" TEXT PRIMARY KEY,
  "linkId" TEXT NOT NULL REFERENCES "doc_mount_file_links"("id") ON DELETE CASCADE,
  "mountPointId" TEXT NOT NULL REFERENCES "doc_mount_points"("id"),
  "chunkIndex" INTEGER NOT NULL,
  "content" TEXT NOT NULL,
  "tokenCount" INTEGER NOT NULL,
  "headingContext" TEXT,
  "embedding" BLOB,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);
```

Chunks are keyed by **linkId**, not by fileId — every hard link to a file maintains its own chunk + embedding set so consumers can re-extract independently. The `embedding` column stores quantized vectors (see "Embedding BLOB format" in the main-DB section; same codec as `conversation_chunks.embedding`). `mountPointId` is denormalized off the link row for fast per-mount queries.

### project_doc_mount_links

```sql
CREATE TABLE IF NOT EXISTS "project_doc_mount_links" (
  "id" TEXT PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "mountPointId" TEXT NOT NULL REFERENCES "doc_mount_points"("id"),
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);
```

Note: `projectId` references the `projects` table in the main database. Cross-database foreign keys are not enforced by SQLite; referential integrity is maintained at the application layer.

### group_doc_mount_links

A group's *additional linked* stores (the official store is recorded on the
`groups` row as `officialMountPointId`, not here). Direct analogue of
`project_doc_mount_links`.

```sql
CREATE TABLE IF NOT EXISTS "group_doc_mount_links" (
  "id" TEXT PRIMARY KEY,
  "groupId" TEXT NOT NULL,
  "mountPointId" TEXT NOT NULL REFERENCES "doc_mount_points"("id"),
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);
-- UNIQUE(groupId, mountPointId) prevents duplicate links and serves
-- groupId-prefix lookups (so no separate groupId index is kept).
CREATE UNIQUE INDEX IF NOT EXISTS "idx_group_doc_mount_links_group_mount"
  ON "group_doc_mount_links" ("groupId", "mountPointId");
CREATE INDEX IF NOT EXISTS "idx_group_doc_mount_links_mountPointId"
  ON "group_doc_mount_links" ("mountPointId");
```

Note: `groupId` references the `groups` table in the main database. Cross-database foreign keys are not enforced by SQLite; referential integrity is maintained at the application layer.

### group_character_members

Many-to-many membership between characters and groups. `findByCharacterId` is the
hot path for per-responding-character tier resolution, so `characterId` is
indexed.

```sql
CREATE TABLE IF NOT EXISTS "group_character_members" (
  "id" TEXT PRIMARY KEY,
  "groupId" TEXT NOT NULL,
  "characterId" TEXT NOT NULL,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);
-- characterId is the hot path for per-responding-character tier resolution.
CREATE INDEX IF NOT EXISTS "idx_group_character_members_characterId"
  ON "group_character_members" ("characterId");
-- UNIQUE(groupId, characterId) prevents duplicate memberships and serves
-- groupId-prefix lookups (so no separate groupId index is kept).
CREATE UNIQUE INDEX IF NOT EXISTS "idx_group_character_members_group_char"
  ON "group_character_members" ("groupId", "characterId");
```

Note: both `groupId` and `characterId` reference tables in the main database (`groups`, `characters`). Cross-database foreign keys are not enforced by SQLite; referential integrity is maintained at the application layer.

### doc_mount_documents

```sql
CREATE TABLE IF NOT EXISTS "doc_mount_documents" (
  "id" TEXT PRIMARY KEY,
  "fileId" TEXT NOT NULL REFERENCES "doc_mount_files"("id") ON DELETE CASCADE,
  "content" TEXT NOT NULL,
  "contentSha256" TEXT NOT NULL,
  "plainTextLength" INTEGER NOT NULL,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_doc_mount_documents_fileId"
  ON "doc_mount_documents" ("fileId");
```

Text content for database-backed files. Content-addressable: one document row per `doc_mount_files` row (UNIQUE on `fileId`). Per-link metadata (relativePath, fileName, folderId, lastModified) lives on `doc_mount_file_links` — multiple hard links may reference the same document. Cascade off `doc_mount_files` reaps the document when the last link goes away. `contentSha256` mirrors `doc_mount_files.sha256` for sanity.

### doc_mount_blobs

```sql
CREATE TABLE IF NOT EXISTS "doc_mount_blobs" (
  "id" TEXT PRIMARY KEY,
  "fileId" TEXT NOT NULL REFERENCES "doc_mount_files"("id") ON DELETE CASCADE,
  "sha256" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "storedMimeType" TEXT NOT NULL,
  "data" BLOB NOT NULL,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_doc_mount_blobs_fileId"
  ON "doc_mount_blobs" ("fileId");
```

Binary assets for **any** mount point type. Content-addressable: one blob row per `doc_mount_files` row (UNIQUE on `fileId`). Per-link metadata (relativePath, originalFileName, originalMimeType, description, extractedText) lives on `doc_mount_file_links` so a hard-linked image can carry different descriptions or extraction results in two different mounts without disturbing the bytes themselves. Bitmap images are transcoded to WebP on upload using `sharp`; already-WebP uploads, SVG, and other MIME types are stored as-is. `storedMimeType` is what `data` actually contains.

Cascade off `doc_mount_files` reaps the blob row (and its bytes) when the last link goes away. The extraction lifecycle (`extractedText`, `extractedTextSha256`, `extractionStatus`, `extractionError`) is no longer on this table — it moved to `doc_mount_file_links` so each consumer can override.

**Invariant (enforced at write time):** `doc_mount_blobs.sha256` equals the SHA-256 of the `data` bytes stored in that row, recomputed by `linkBlobContent` in `doc-mount-file-links.repository` at write time. Callers supply a sha as a hint (used for the pre-write dedup check against `doc_mount_files.sha256`), but the value written to `doc_mount_blobs.sha256` is always the result of hashing the actual bytes. A mismatch between the caller's hint and the recomputed value is logged as a warning. The `repair-mount-blob-sha256-from-bytes-v1` migration corrects pre-existing drifted rows.

---

## Notes

- **No triggers or views** exist in any database.
- **No foreign key constraints** are defined between tables (referential integrity is enforced at the application layer), except `tfidf_vocabularies.profileId → embedding_profiles.id`, `conversation_annotations.chatId → chats.id`, and `conversation_chunks.chatId → chats.id` with `ON DELETE CASCADE`.
- All `TEXT DEFAULT '[]'` and `TEXT DEFAULT '{}'` columns store JSON. The application parses them with Zod schemas.
- All IDs are UUIDs stored as TEXT.
- All timestamps (`createdAt`, `updatedAt`) are ISO 8601 strings.
- Columns added by migrations appear after the original `CREATE TABLE` columns (SQLite `ALTER TABLE ADD COLUMN` appends to the end). `chat_messages.reasoningContent` / `reasoningSegments` were added by `add-chat-message-reasoning-columns-v1`.
- `chat_messages.reasoningContent` (full chain-of-thought) and `reasoningSegments` (JSON array of `{ anchorOffset, content, seq }` positioning blocks) hold reasoning models' "thinking". They are **DISPLAY ONLY** — surfaced in the Salon but never re-fed to any model as history, summary, or memory. The only in-request reuse of reasoning is the in-turn tool round-trip, which uses an in-memory value, not these columns.
- The `request` and `response` columns in `llm_logs` contain full JSON payloads of the LLM API calls; these can be large.

## Key source files

| File | Purpose |
|------|---------|
| `lib/database/backends/sqlite/client.ts` | Main DB connection, SQLCipher key, PRAGMAs |
| `lib/database/backends/sqlite/llm-logs-client.ts` | LLM logs DB connection |
| `lib/database/backends/sqlite/mount-index-client.ts` | Mount index DB connection |
| `lib/database/backends/sqlite/backend.ts` | Backend lifecycle, initialization |
| `lib/database/config.ts` | Config schema and path resolution |
| `lib/database/manager.ts` | Singleton database manager |
| `lib/startup/dbkey.ts` | Pepper lifecycle and `.dbkey` management |
| `lib/paths.ts` | Centralized path resolution |
| `migrations/` | All migration scripts |
| `docs/developer/DATABASE_ENCRYPTION.md` | Encryption architecture details |
