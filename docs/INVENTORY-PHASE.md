# Inventory Phase - JSON Database Migration

**Phase Start Date**: 2025-11-22
**Phase Status**: In Progress
**Migration Reference**: [JSON-DATABASE.md](../features/JSON-DATABASE.md)

## Overview

The Inventory phase (Day 0-1 of migration) establishes a snapshot of the current database schema and prepares the codebase for the transition from PostgreSQL/Prisma to a JSON file-based store.

## Objectives

1. ✅ Freeze current schema version in code
2. ✅ Create Prisma metadata dumping utility
3. ✅ Implement `DATA_BACKEND` feature flag
4. Document current database state for validation

## Completed Tasks

### 1. Schema Version Frozen
**File**: `lib/schema-version.ts`

Captures:
- Current schema phase: **0.7** (Tag System Complete)
- Complete list of 23 Prisma models
- All enums (Provider, ImageProvider, Role, ImageTagType, AvatarDisplayMode)
- Key relationships and cascading rules
- Encrypted fields (passwords, TOTP, API keys, backup codes)
- JSON-typed fields (parameters, responses, metadata)

This serves as the source of truth for migration validation.

### 2. Prisma Metadata Utility Created
**File**: `lib/data-migration/prisma-metadata.ts`

Provides:
- `generatePrismaMetadata()` - Queries database for record counts across all models
- `savePrismaMetadata()` - Persists metadata to `data/cache/` directory
- CLI entry point for manual execution

**Usage**:
```bash
npm run data:dump-metadata
```

This generates timestamped JSON reports like:
```
data/cache/prisma-metadata-2025-11-22.json
```

### 3. Feature Flag Infrastructure
**File**: `lib/data-backend.ts`

Provides runtime control via `DATA_BACKEND` environment variable:

- `DATA_BACKEND=prisma` (default) - Use Prisma only
- `DATA_BACKEND=json` - Use JSON store only (validation/testing)
- `DATA_BACKEND=dual` - Write to both (sync verification)

**Exported Functions**:
- `getDataBackend()` - Current backend mode
- `usePrisma()` - Whether to use Prisma
- `useJsonStore()` - Whether to use JSON store
- `isDualMode()` - In validation mode
- `isMigrationMode()` - In json or dual mode
- `logBackendConfig()` - Log current configuration

## Pending Tasks

### 4. Document Current Database State

This task will:

1. **Capture Schema Structure**:
   - Extract field types, constraints, and defaults from Prisma schema
   - Document all relationships (one-to-one, one-to-many, many-to-many)
   - Record cascade delete rules

2. **Generate Sample Metadata**:
   - Execute `generatePrismaMetadata()` against dev database
   - Save baseline counts for each model
   - Create comparison baseline for validation later

3. **Create Validation Checklist**:
   - List all 23 models that must be migrated
   - Field mapping from Prisma to JSON storage
   - Encryption requirements per field
   - Relationship integrity checks

## Next Steps (Scaffold Phase)

Once inventory is complete:

1. **Create directory structure** under `data/`:
   ```
   data/
   ├── settings/          (general.json, connection-profiles.json)
   ├── characters/        (one file per character)
   ├── personas/          (one file per persona)
   ├── chats/            (index.jsonl + per-chat files)
   ├── binaries/         (index.jsonl + content)
   ├── auth/             (accounts.json, sessions.jsonl, tokens.jsonl)
   ├── tags/             (tags.json)
   ├── image-profiles/   (image-profiles.json)
   └── cache/            (metadata, locks, version info)
   ```

2. **Define JSON schemas** using Zod:
   - General settings schema
   - Connection profiles schema
   - Character schema
   - Persona schema
   - Chat index and chat log schemas
   - Binary index schema
   - Auth schemas

3. **Implement JsonStore service**:
   - File discovery and path resolution
   - Atomic read-modify-write with advisory locks
   - JSONL append helpers
   - In-memory index caching

## Environment Variable Setup

Add to `.env.example`:
```
# Data Backend Configuration (Inventory Phase)
# Options: prisma (default), json (testing), dual (validation)
DATA_BACKEND=prisma
```

## Validation Checklist

Before proceeding to Scaffold phase:

- [ ] Schema version frozen in `lib/schema-version.ts`
- [ ] Prisma metadata utility tested and documented
- [ ] Feature flag infrastructure implemented
- [ ] `DATA_BACKEND` environment variable documented
- [ ] README updated with migration status
- [ ] Team briefed on current phase

## Schema Summary

| Model | Purpose | Record Target |
|-------|---------|--------------|
| User | User identity + auth secrets | `settings/general.json` |
| ChatSettings | UI preferences | `settings/general.json` |
| Account | OAuth provider linkage | `auth/accounts.json` |
| Session | NextAuth sessions | `auth/sessions.jsonl` |
| VerificationToken | Password reset tokens | `auth/verification-tokens.jsonl` |
| ApiKey | Encrypted API keys | `settings/connection-profiles.json` |
| ConnectionProfile | LLM connection config | `settings/connection-profiles.json` |
| ConnectionProfileTag | LLM profile tags | `settings/connection-profiles.json` |
| Character | Character definitions | `characters/<id>.json` |
| Persona | Persona definitions | `personas/<id>.json` |
| CharacterPersona | Character↔Persona relation | `characters/<id>.json` |
| CharacterTag | Character tags | `characters/<id>.json` |
| PersonaTag | Persona tags | `personas/<id>.json` |
| Chat | Chat metadata | `chats/index.jsonl` |
| Message | Chat messages | `chats/<id>.jsonl` |
| ChatFile | Chat attachments | `binaries/index.jsonl` |
| ChatTag | Chat tags | `chats/index.jsonl` |
| Image | Image assets | `binaries/index.jsonl` |
| ImageTag | Image tags | `binaries/index.jsonl` |
| ChatAvatarOverride | Per-chat avatars | `chats/index.jsonl` |
| ImageProfile | Image generation config | `image-profiles/image-profiles.json` |
| ImageProfileTag | Image profile tags | `image-profiles/image-profiles.json` |
| Tag | Global tag catalog | `tags/tags.json` |

## Encrypted Fields

Must be preserved during migration:

1. `User.passwordHash` - bcrypt password hash
2. `User.totpSecret` - TOTP encryption
3. `User.backupCodes` - TOTP backup codes encryption
4. `ApiKey.keyEncrypted` - LLM API key encryption (AES-256-GCM)

## Key Decision Points Resolved

✅ **Schema Phase**: 0.7 - Full schema is complete and stable
✅ **User Model**: Single-user on-device (per CLAUDE.md)
✅ **Encryption**: Preserve all encrypted fields using same algorithms
✅ **Relationships**: Maintain all cascade rules and foreign key integrity
✅ **Feature Parity**: 100% - All 23 models must be migrated

## Status

- Inventory Phase: **IN PROGRESS**
- Next Milestone: Scaffold File Store (Day 1-3)
