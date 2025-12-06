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

### Phase 2: Update Environment Configuration

#### 2.1 Change Defaults in `lib/env.ts`

- [ ] Change `DATA_BACKEND` default from `'json'` to `'mongodb'`
- [ ] Change `S3_MODE` default from `'disabled'` to error if not explicitly set (require configuration)
- [ ] Remove `'dual'` option from `DATA_BACKEND` enum
- [ ] Add validation that requires MongoDB URI when `DATA_BACKEND` is not explicitly set
- [ ] Add validation that requires S3 configuration when `S3_MODE` is not `'disabled'`

#### 2.2 Update `.env.example`

- [ ] Add required MongoDB configuration as mandatory
- [ ] Add required S3 configuration as mandatory
- [ ] Remove `DATA_BACKEND=json` examples
- [ ] Document that local storage is deprecated

### Phase 3: Remove JSON Backend from Repository Factory

#### 3.1 Update `lib/repositories/factory.ts`

- [ ] Remove import of `@/lib/json-store/repositories`
- [ ] Remove `getJsonRepositories()` function
- [ ] Remove backend switching logic - always use MongoDB
- [ ] Simplify `getRepositories()` to only return MongoDB repositories
- [ ] Remove `getDataBackend()` function or make it always return `'mongodb'`

#### 3.2 Remove `isMongoDBEnabled()` Checks

- [ ] Search for all uses of `isMongoDBEnabled()` in the codebase
- [ ] Remove conditional logic - assume MongoDB is always enabled
- [ ] Update any code paths that had JSON fallbacks

### Phase 4: Remove Local File Storage Support

#### 4.1 Update `lib/file-manager/index.ts`

- [ ] Remove local file read functions (`readFile` from fs)
- [ ] Remove local file write functions
- [ ] Remove local storage directory creation
- [ ] Make all operations go through S3

#### 4.2 Update `lib/s3/config.ts`

- [ ] Make S3 configuration required (not optional)
- [ ] Add startup validation that fails if S3 is not configured
- [ ] Remove `disabled` option from S3_MODE enum (or make it throw during startup)

#### 4.3 Update API Routes

Files to update (remove local file fallback logic):

- [ ] `app/api/files/[id]/route.ts`
- [ ] `app/api/images/[id]/route.ts`
- [ ] `app/api/characters/[id]/avatar/route.ts`
- [ ] `app/api/personas/[id]/avatar/route.ts`
- [ ] `app/api/chats/[id]/avatars/route.ts`
- [ ] Any other routes serving files

#### 4.4 Update Image Utilities

- [ ] `lib/images-v2.ts` - Remove local file path generation
- [ ] `lib/chat-files-v2.ts` - Remove local file operations

### Phase 5: Delete Obsolete Code

#### 5.1 Remove JSON-Store Library

- [ ] Delete `lib/json-store/` directory entirely
- [ ] Remove any imports of `@/lib/json-store` from main codebase

#### 5.2 Clean Up Related Files

- [ ] Remove `public/data/` directory references in code
- [ ] Update `.gitignore` to remove local data directory ignores (if appropriate)
- [ ] Remove local file path utilities that are no longer needed

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
