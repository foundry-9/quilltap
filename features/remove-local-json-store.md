# Plan: Remove Local JSON-Store and Local File Support

## Overview

This plan outlines the removal of all local JSON file storage and local filesystem image/file storage in favor of MongoDB and S3 as the only supported backends. The only exception is the migration plugin (`qtap-plugin-upgrade`) which will retain the ability to read from the old JSON-store system for data migration purposes.

## Current State Analysis

### Storage Backends

1. **Data Storage** (`DATA_BACKEND` env var):
   - `json` (default): Uses `lib/json-store/` - JSON files in `data/` directory
   - `mongodb`: Uses `lib/mongodb/` - MongoDB collections
   - `dual`: Hybrid mode (not fully implemented)

2. **File Storage** (`S3_MODE` env var):
   - `disabled` (default): Local filesystem at `public/data/files/storage/`
   - `external`: External S3-compatible service
   - `embedded`: Embedded MinIO

### Files Using JSON-Store

#### Core JSON-Store Implementation (`lib/json-store/`)

- `core/json-store.ts` - Core file I/O service
- `repositories/*.ts` - All entity repositories (characters, personas, chats, tags, users, connections, files, imageProfiles, embeddingProfiles, memories)
- `auth-adapter.ts` - NextAuth adapter for JSON backend
- `user-data-path.ts` - Per-user directory structure utilities
- `migrations/migrate-to-user-dirs.ts` - Legacy user directory migration

#### Repository Factory (`lib/repositories/factory.ts`)

- Switches between JSON and MongoDB backends based on `DATA_BACKEND`
- Provides `getJsonRepositories()` for direct JSON access (used by migrations)

#### File Manager (`lib/file-manager/index.ts`)

- Contains local file read/write operations
- Checks `s3Key` to decide between local vs S3 storage

#### API Routes Using Local Storage

- `app/api/files/[id]/route.ts` - File serving with local fallback
- `app/api/images/[id]/route.ts` - Image serving
- `app/api/characters/[id]/avatar/route.ts`
- `app/api/personas/[id]/avatar/route.ts`
- `app/api/chats/[id]/avatars/route.ts`
- Multiple other routes with same pattern

### Migration Plugin (Already Exists)

- `plugins/dist/qtap-plugin-upgrade/migrations/migrate-json-to-mongodb.ts`
- `plugins/dist/qtap-plugin-upgrade/migrations/migrate-files-to-s3.ts`

---

## Implementation Plan

### Phase 1: Move JSON-Store Support into Migration Plugin ✅ COMPLETED

#### 1.1 Copy JSON-Store Core to Migration Plugin

- [x] Create `plugins/dist/qtap-plugin-upgrade/lib/json-store/` directory
- [x] Copy `lib/json-store/core/json-store.ts` to plugin (self-contained version)
- [x] Copy `lib/json-store/repositories/*.ts` to plugin (all 12 repository files)
- [x] Copy `lib/json-store/auth-adapter.ts` to plugin
- [x] Copy `lib/json-store/user-data-path.ts` to plugin
- [x] Copy `lib/json-store/schemas/types.ts` to plugin (without plugin-manifest export)
- [x] Update imports in copied files to be self-contained (removed all @/lib/logger dependencies)

#### 1.2 Update Migration Scripts

- [x] Update `migrate-json-to-mongodb.ts` to use local json-store copy instead of `@/lib/json-store`
- [x] Update `migrate-files-to-s3.ts` to remove logger dependency (already uses main codebase for S3/file-manager)
- [x] Verified build compiles without errors

**Files created in plugin (17 total):**

```text
plugins/dist/qtap-plugin-upgrade/lib/json-store/
├── auth-adapter.ts
├── user-data-path.ts
├── core/
│   └── json-store.ts
├── repositories/
│   ├── index.ts
│   ├── base.repository.ts
│   ├── characters.repository.ts
│   ├── chats.repository.ts
│   ├── connection-profiles.repository.ts
│   ├── embedding-profiles.repository.ts
│   ├── files.repository.ts
│   ├── image-profiles.repository.ts
│   ├── images.repository.ts
│   ├── memories.repository.ts
│   ├── personas.repository.ts
│   ├── tags.repository.ts
│   └── users.repository.ts
└── schemas/
    └── types.ts
```

### Phase 2: Update Environment Configuration ✅ COMPLETED

#### 2.1 Change Defaults in `lib/env.ts`

- [x] Change `DATA_BACKEND` default from `'json'` to `'mongodb'`
- [x] Change `S3_MODE` default from `'disabled'` to `'embedded'` (embedded MinIO is the new default)
- [x] Remove `'dual'` option from `DATA_BACKEND` enum
- [x] Add validation that requires MongoDB URI when `DATA_BACKEND` is `'mongodb'`
- [x] Add validation that requires S3 configuration (endpoint, access key, secret key) when `S3_MODE` is `'external'`
- [x] Added deprecation notes for `'json'` DATA_BACKEND and `'disabled'` S3_MODE options

#### 2.2 Update `.env.example`

- [x] Add required MongoDB configuration as mandatory (MONGODB_URI, MONGODB_DATABASE)
- [x] Add required S3 configuration section with clear documentation
- [x] Remove `DATA_BACKEND=json` examples and document deprecation
- [x] Document that local storage is deprecated with migration instructions

### Phase 3: Remove JSON Backend from Repository Factory ✅ COMPLETED

#### 3.1 Update `lib/repositories/factory.ts`

- [x] Remove import of `@/lib/json-store/repositories`
- [x] Remove `getJsonRepositories()` function
- [x] Remove backend switching logic - always use MongoDB
- [x] Simplify `getRepositories()` to only return MongoDB repositories
- [x] Make `getDataBackend()` always return `'mongodb'` (kept for backwards compatibility with deprecation note)
- [x] Make `isMongoDBEnabled()` always return `true` (kept for backwards compatibility with deprecation note)

#### 3.2 Remove `isMongoDBEnabled()` Checks

- [x] Updated `lib/auth.ts` - removed JSON store imports and backend switching, now always uses MongoDB auth adapter
- [x] Updated `lib/embedding/vector-store.ts` - Removed FileCharacterVectorStore entirely, renamed MongoCharacterVectorStore to CharacterVectorStore, removed fs/path imports
- [x] Updated `lib/data-backend.ts` - now returns 'mongodb' and documents MongoDB as the only backend
- [x] Updated `lib/repositories/index.ts` - removed `getJsonRepositories` export
- [x] Removed JSON cache clearing code from `app/api/profiles/route.ts`
- [x] Added missing `findByIdForCharacter` method to MongoDB MemoriesRepository

### Phase 4: Remove Local File Storage Support ✅ COMPLETED

#### 4.1 Delete `lib/file-manager/` entirely

- [x] Deleted `lib/file-manager/index.ts`, `lib/file-manager/compat.ts`, `lib/file-manager/README.md`
- [x] Deleted `__tests__/unit/lib/file-manager.test.ts`
- [x] Copied necessary functions (`getAllFiles`, `updateFile`, `deleteFile`) to migration plugin at `plugins/dist/qtap-plugin-upgrade/lib/file-manager.ts`
- [x] Updated `plugins/dist/qtap-plugin-upgrade/migrations/migrate-files-to-s3.ts` to use local file-manager
- [x] Updated `app/api/chats/[id]/messages/route.ts` to use repository methods instead of file-manager imports

#### 4.2 Update `lib/s3/config.ts` - S3 is now required

- [x] Removed `'disabled'` from S3Mode type - only `'embedded'` and `'external'` are valid
- [x] Removed `isS3Enabled()` function entirely - S3 is always enabled
- [x] Updated `validateS3Config()` to error if S3_MODE is not 'embedded' or 'external'
- [x] Updated `testS3Connection()` to remove disabled mode check
- [x] Updated `lib/s3/client.ts` - removed `isS3Enabled` import and `s3Disabled` flag, `getS3Client()` now always returns S3Client (not null)
- [x] Updated `lib/s3/file-service.ts` - removed all `checkS3Enabled()` calls and the method itself

#### 4.3 Update API Routes

Files updated (removed local file fallback logic):

- [x] `app/api/files/[id]/route.ts` - Removed local filesystem fallback, S3-only
- [x] `app/api/files/test/route.ts` - Removed `isS3Enabled()` call, simplified stats
- [x] `app/api/images/[id]/route.ts` - Removed local file checks, simplified getFilePath
- [x] `app/api/characters/[id]/avatar/route.ts` - Simplified getFilePath to S3-only
- [x] `app/api/personas/[id]/avatar/route.ts` - Simplified getFilePath to S3-only
- [x] `app/api/chats/[id]/avatars/route.ts` - Simplified getFilePath to S3-only
- [x] `app/api/chat-files/[id]/route.ts` - Removed `isS3Enabled()` check, always delete from S3

#### 4.4 Update Image Utilities

- [x] `lib/images-v2.ts` - Removed local file operations, S3-only for create/read/delete
- [x] `lib/chat-files-v2.ts` - Removed local file operations, S3-only for all file ops
- [x] `lib/tools/handlers/image-generation-handler.ts` - Removed local storage fallback, S3-only for generated images

### Phase 5: Delete Obsolete Code ✅ COMPLETED

#### 5.1 Remove JSON-Store Library

- [x] Delete `lib/json-store/` directory entirely
- [x] Remove any imports of `@/lib/json-store` from main codebase
- [x] Move shared type definitions to `lib/schemas/types.ts`
- [x] Move plugin-manifest schema to `lib/schemas/plugin-manifest.ts`
- [x] Update all imports throughout codebase to use new locations

#### 5.2 Clean Up Related Files

- [x] Remove `public/data/` directory references in code (removed `LOCAL_STORAGE_DIR` from cascade-delete.ts)
- [x] Delete legacy migration scripts (`scripts/consolidate-images.ts`, `scripts/migrate-files.ts`)
- [x] Delete obsolete tests (`__tests__/integration/json-store.integration.test.ts`, `__tests__/unit/lib/json-store/`)
- [x] Update `lib/auth/anonymous-user.ts` to use MongoDB repository instead of JSON store
- [x] Update `lib/auth/totp.ts` to use MongoDB repository instead of JSON store
- [x] Update `app/api/auth/change-password/route.ts` to use MongoDB repository
- [x] Update plugin migration files to use local json-store copy instead of `@/lib/json-store`
- [x] Verified build passes with no errors

### Phase 6: Update Documentation

#### 6.1 Update README.md

- [ ] Remove references to JSON file storage
- [ ] Document MongoDB as the required data backend
- [ ] Document S3 as the required file storage backend
- [ ] Update architecture descriptions
- [ ] Update quick start guide with MongoDB/S3 setup steps
- [ ] Update "Data Management" section

#### 6.2 Update CLAUDE.md (if needed)

- [ ] Note that MongoDB and S3 are now required

#### 6.3 Update Deployment Docs

- [ ] `docs/DEPLOYMENT.md` - Add MongoDB and S3 setup requirements
- [ ] `docs/BACKUP-RESTORE.md` - Update for MongoDB/S3 backup procedures
- [ ] Update Docker Compose files if needed

### Phase 7: Testing

#### 7.1 Update Tests

- [ ] Update test mocks to use MongoDB by default
- [ ] Remove JSON-store related test utilities
- [ ] Update integration tests for S3-only file serving
- [ ] Add tests for migration plugin's JSON reading capability

#### 7.2 Migration Testing

- [ ] Test migration from JSON to MongoDB works with new plugin structure
- [ ] Test migration from local files to S3 works
- [ ] Test that fresh installs without JSON data work correctly

---

## Files to Modify (Summary)

### Files to DELETE from main codebase

```text
lib/json-store/                          # Entire directory
```

### Files to MODIFY

```text
# Core Configuration
lib/env.ts                               # Change defaults, remove json option
lib/repositories/factory.ts              # Remove JSON backend support

# File/Storage Operations
lib/file-manager/index.ts                # Remove local file operations
lib/s3/config.ts                         # Make S3 required
lib/images-v2.ts                         # Remove local paths
lib/chat-files-v2.ts                     # Remove local operations
lib/cascade-delete.ts                    # Update for S3-only deletion
lib/tools/handlers/image-generation-handler.ts  # Remove local file references

# API Routes (remove local fallback logic)
app/api/files/[id]/route.ts
app/api/files/test/route.ts
app/api/images/[id]/route.ts
app/api/characters/[id]/avatar/route.ts
app/api/characters/[id]/route.ts
app/api/characters/route.ts
app/api/personas/[id]/avatar/route.ts
app/api/personas/route.ts
app/api/chats/[id]/avatars/route.ts
app/api/chats/[id]/files/route.ts
app/api/chats/[id]/route.ts
app/api/chats/route.ts
app/api/chats/import/route.ts
app/api/profiles/route.ts

# Frontend Pages (may have local path references)
app/(authenticated)/chats/[id]/page.tsx
app/dashboard/page.tsx

# Tests
__tests__/unit/cascade-delete.test.ts
__tests__/unit/lib/embedding/embedding-service.test.ts

# Documentation
README.md                                # Update documentation
.env.example                             # Update with required vars
```

### Files to CREATE in migration plugin

```text
plugins/dist/qtap-plugin-upgrade/lib/json-store/
  core/json-store.ts                     # Copy from lib/json-store
  repositories/base.repository.ts
  repositories/characters.repository.ts
  repositories/chats.repository.ts
  repositories/connection-profiles.repository.ts
  repositories/embedding-profiles.repository.ts
  repositories/files.repository.ts
  repositories/image-profiles.repository.ts
  repositories/images.repository.ts
  repositories/index.ts
  repositories/memories.repository.ts
  repositories/personas.repository.ts
  repositories/tags.repository.ts
  repositories/users.repository.ts
  auth-adapter.ts
  user-data-path.ts
  schemas/types.ts
```

---

## Risk Assessment

### High Risk Items

1. **Breaking existing deployments** - Users with JSON-only setups will need to migrate before upgrading
2. **Data loss potential** - Must ensure migration is run before removing JSON support

### Mitigation

1. Add clear upgrade documentation
2. Add startup check that detects JSON data and warns/errors if MongoDB migration hasn't run
3. Consider a transition release that supports both but warns about deprecation

---

## Open Questions

1. Should we keep a "read-only" JSON mode for disaster recovery scenarios?
2. Should the migration plugin delete the JSON data after successful migration?
3. What's the minimum MongoDB version to support?
4. Should embedded MinIO remain as an option, or only support external S3?

---

## Estimated Scope

- **Files to modify**: ~30 files (API routes, lib files, tests, frontend pages)
- **Files to delete**: ~20 files (entire `lib/json-store/` directory)
- **Files to create**: ~15 files (copies in migration plugin)
- **Documentation updates**: 4-5 files
- **Test updates**: 2+ test files need mock updates

## Dependency Order

The implementation should follow this order to minimize breakage:

1. **Phase 1** (Migration Plugin) - Must be done first so migration still works
2. **Phase 2** (Environment) - Can be done alongside Phase 1
3. **Phase 3** (Repository Factory) - Depends on Phase 1 completion
4. **Phase 4** (File Storage) - Can be done in parallel with Phase 3
5. **Phase 5** (Delete Code) - Only after Phases 3 and 4 are verified working
6. **Phase 6** (Documentation) - Can be done throughout
7. **Phase 7** (Testing) - Throughout and at the end
