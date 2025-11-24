# Scaffold Phase - JSON Database Migration

**Phase Start Date**: 2025-11-22
**Phase Status**: Completed
**Previous Phase**: [Inventory Phase](./INVENTORY-PHASE.md)
**Next Phase**: Dual-Write Layer (Day 3-6)

## Overview

The Scaffold phase (Day 1-3) establishes the foundational infrastructure for JSON-based data storage. This includes:

1. Complete file system structure
2. Zod schemas for type-safe validation
3. Core JsonStore service for file I/O
4. Repository pattern implementations
5. Baseline empty files

## Completed Tasks

### 1. Data Directory Structure

Created complete directory hierarchy under `data/`:

```
data/
├── settings/                      # User and connection settings
│   ├── general.json              # User, ChatSettings (merged)
│   └── connection-profiles.json   # ApiKeys, LLM profiles
├── characters/                    # One file per character
├── personas/                      # One file per persona
├── chats/                         # Chat metadata and logs
│   ├── index.jsonl               # Chat metadata index
│   └── [chatId].jsonl            # Per-chat message logs
├── binaries/                      # Media assets
│   ├── index.jsonl               # Binary metadata index
│   └── [sha256]/                 # Binary content (deduplicated)
├── auth/                          # Authentication data
│   ├── accounts.json             # OAuth accounts
│   ├── sessions.jsonl            # NextAuth sessions
│   └── verification-tokens.jsonl # Reset tokens
├── tags/                          # Global tag catalog
│   └── tags.json
├── image-profiles/                # Image generation profiles
│   └── image-profiles.json
└── cache/                         # Optional metadata/locks
    └── (for future use)
```

### 2. Zod Schemas (`lib/json-store/schemas/types.ts`)

Defined all 23 entity types with full validation:

**Enums**: Provider, ImageProvider, Role, ImageTagType, AvatarDisplayMode

**Core Types**:
- User + ChatSettings
- Account, Session, VerificationToken
- ApiKey, ConnectionProfile
- Character, Persona
- Chat, Message events (JSONL)
- Image, BinaryIndexEntry
- Tag, ImageProfile

**Features**:
- Type-safe validation with Zod
- Encryption field types (AES-256-GCM)
- JSON-typed fields for flexibility
- Timestamp normalization (ISO-8601)
- Optional/nullable field support

### 3. JsonStore Core Service (`lib/json-store/core/json-store.ts`)

**Capabilities**:
- **Atomic writes**: Temp file + rename pattern
- **File locking**: Advisory locks for concurrent access
- **JSONL support**: Line-delimited JSON append operations
- **Path resolution**: Configurable `DATA_DIR` environment variable
- **Caching**: Optional in-memory caching for hot data
- **Error handling**: Proper error messages and recovery

**API**:
```typescript
readJson<T>(filePath: string): Promise<T>
writeJson<T>(filePath: string, data: T): Promise<void>
readJsonl<T>(filePath: string): Promise<T[]>
appendJsonl<T>(filePath: string, items: T[]): Promise<void>
resolvePath(...segments: string[]): string
ensureDir(dirPath: string): Promise<void>
exists(filePath: string): boolean
listDir(dirPath: string): Promise<string[]>
deleteFile(filePath: string): Promise<void>
```

### 4. Repository Pattern (`lib/json-store/repositories/`)

**Base Repository** (`base.repository.ts`):
- Abstract CRUD interface
- Schema validation
- ID generation (UUID v4)
- Timestamp management

**CharactersRepository** (`characters.repository.ts`):
- Full CRUD operations
- Find by user, by tag, by ID
- Persona link management
- Tag management
- Favorite status

**Repository Factory** (`repositories/index.ts`):
- Singleton container
- Lazy initialization
- Testable reset mechanism

**Planned repositories** (scaffolded, to be implemented):
- PersonasRepository
- ChatsRepository
- TagsRepository
- UsersRepository
- ConnectionProfilesRepository
- ImagesRepository

### 5. Baseline Empty Files

**Settings**:
- `data/settings/general.json` - Single-user settings template
- `data/settings/connection-profiles.json` - LLM profiles template

**Auth**:
- `data/auth/accounts.json` - OAuth accounts template
- `data/auth/sessions.jsonl` - NextAuth sessions (empty)
- `data/auth/verification-tokens.jsonl` - Reset tokens (empty)

**Organization**:
- `data/tags/tags.json` - Global tags template
- `data/image-profiles/image-profiles.json` - Image gen profiles template

**Indexes**:
- `data/chats/index.jsonl` - Chat metadata index (empty)
- `data/binaries/index.jsonl` - Binary asset index (empty)

**Markers**:
- `data/.gitkeep` - Ensures directory is tracked by git

All files use correct schema structure with version, timestamps, and empty collections.

## Architecture

### Data Flow

```
┌─────────────────────┐
│ Application Code    │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Repositories        │  (CharactersRepository, etc.)
│ (Business Logic)    │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ JsonStore Service   │  (File I/O, Locking, Caching)
│ (Core Infrastructure)
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ File System         │  (JSON, JSONL files)
│ (data/)             │
└─────────────────────┘
```

### Key Design Patterns

1. **Repository Pattern**: Each entity type has a dedicated repository
2. **Atomic Writes**: Temp file + atomic rename prevents corruption
3. **Advisory Locking**: File locks prevent concurrent write conflicts
4. **Schema Validation**: Zod ensures data integrity on read/write
5. **Singleton Pattern**: JsonStore and repositories are singletons
6. **Type Safety**: Full TypeScript typing through the stack

## Usage Examples

### Using JsonStore Directly

```typescript
import { getJsonStore } from '@/lib/json-store/core/json-store';

const jsonStore = getJsonStore();

// Read JSON file
const settings = await jsonStore.readJson('settings/general.json');

// Write JSON file (atomic)
await jsonStore.writeJson('settings/general.json', updatedSettings);

// Append to JSONL file
await jsonStore.appendJsonl('chats/index.jsonl', [chatMetadata]);

// Read JSONL file
const chats = await jsonStore.readJsonl('chats/index.jsonl');
```

### Using Repositories

```typescript
import { getRepositories } from '@/lib/json-store/repositories';

const repos = getRepositories();

// Create a character
const character = await repos.characters.create({
  userId: 'user-123',
  name: 'Alice',
  description: '...',
  // ... other fields
});

// Find character by ID
const found = await repos.characters.findById(character.id);

// Find by user
const userCharacters = await repos.characters.findByUserId('user-123');

// Update
const updated = await repos.characters.update(character.id, {
  name: 'Alice Updated'
});

// Add tag
await repos.characters.addTag(character.id, 'tag-123');

// Delete
await repos.characters.delete(character.id);
```

## Configuration

### Environment Variables

```bash
# Set custom data directory (defaults to ./data)
DATA_DIR=/path/to/data

# Set backend (defaults to prisma)
DATA_BACKEND=json
```

### JsonStore Options

```typescript
const jsonStore = new JsonStore({
  dataDir: './data',           // Custom data directory
  enableCache: true,           // In-memory caching (default)
  lockTimeout: 5000,          // Lock wait timeout in ms
  fsyncInterval: 10,          // JSONL batch fsync count
});
```

## Testing

### Unit Testing Repositories

```typescript
import { JsonStore } from '@/lib/json-store/core/json-store';
import { CharactersRepository } from '@/lib/json-store/repositories/characters.repository';
import * as tempfile from 'temp';

describe('CharactersRepository', () => {
  let repo: CharactersRepository;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await tempfile.mkdir('json-store-test');
    const jsonStore = new JsonStore({ dataDir: tempDir });
    repo = new CharactersRepository(jsonStore);
  });

  it('should create a character', async () => {
    const character = await repo.create({
      userId: 'user-123',
      name: 'Test Character',
      description: 'Test',
      personality: 'Test',
      scenario: 'Test',
      firstMessage: 'Test',
    });

    expect(character.id).toBeDefined();
    expect(character.name).toBe('Test Character');
  });

  it('should find character by ID', async () => {
    const created = await repo.create({...});
    const found = await repo.findById(created.id);
    expect(found?.id).toBe(created.id);
  });
});
```

## File Locking

JsonStore uses advisory file locks to prevent concurrent write issues:

- Lock file created at `{filePath}.lock`
- Automatically released after write
- Stale locks (30+ seconds old) are cleaned up
- Lock timeout: 5000ms (configurable)

Example with concurrent writes:

```typescript
// Process A
const promise1 = jsonStore.writeJson('data.json', dataA);

// Process B (will wait for Process A)
const promise2 = jsonStore.writeJson('data.json', dataB);

await Promise.all([promise1, promise2]);
// Process B succeeds after A completes
```

## Performance Considerations

### Caching

In-memory caching is enabled by default for frequently accessed files:
- Settings files (general.json, connection-profiles.json)
- Tag catalog (tags.json)
- Image profiles

```typescript
const stats = jsonStore.getCacheStats();
console.log(`Cache size: ${stats.size}, enabled: ${stats.enabled}`);

// Clear cache if needed
jsonStore.clearCache();
```

### JSONL Optimization

For append-heavy operations (chat logs), use batch appends:

```typescript
// Batch: More efficient
const events = [event1, event2, event3];
await jsonStore.appendJsonl('chats/chat-123.jsonl', events);

// Individual: Less efficient
await jsonStore.appendJsonl('chats/chat-123.jsonl', [event1]);
await jsonStore.appendJsonl('chats/chat-123.jsonl', [event2]);
await jsonStore.appendJsonl('chats/chat-123.jsonl', [event3]);
```

### Directory Scanning

Finding all items requires directory scanning (no central index):

```typescript
// Efficient for small datasets
const allCharacters = await repos.characters.findAll();

// For large datasets, consider:
// 1. Adding a manifest file
// 2. Using the repository cache
// 3. Implementing incremental loading
```

## What's Next: Dual-Write Layer

The next phase will:

1. **Modify existing Prisma repositories** to also write to JSON
2. **Add verification mode** to compare Prisma vs JSON results
3. **Build validation tests** for data consistency
4. **Create export command** to populate JSON from Prisma

This allows testing JSON store without removing Prisma.

## File Inventory

```
lib/json-store/
├── schemas/
│   └── types.ts              (23 entity types, validation)
├── core/
│   └── json-store.ts         (File I/O, locking, caching)
└── repositories/
    ├── base.repository.ts    (Abstract CRUD base)
    ├── characters.repository.ts  (Character CRUD + helpers)
    └── index.ts              (Factory & exports)

data/
├── settings/
│   ├── general.json          (User + ChatSettings)
│   └── connection-profiles.json
├── characters/               (One file per character)
├── personas/                 (One file per persona)
├── chats/
│   ├── index.jsonl          (Chat metadata index)
│   └── [chatId].jsonl       (Per-chat logs)
├── binaries/
│   ├── index.jsonl          (Binary metadata)
│   └── [sha256]/            (Binary content)
├── auth/
│   ├── accounts.json        (OAuth accounts)
│   ├── sessions.jsonl       (NextAuth sessions)
│   └── verification-tokens.jsonl
├── tags/
│   └── tags.json
├── image-profiles/
│   └── image-profiles.json
└── cache/                   (Future: locks, indexes)
```

## Success Criteria Met

✅ Complete directory structure created
✅ All 23 entity types defined with Zod schemas
✅ JsonStore core service implemented
✅ Atomic write pattern with file locking
✅ JSONL append support
✅ Repository base class + CharactersRepository
✅ Factory pattern for repository container
✅ Baseline empty files with correct structure
✅ Comprehensive documentation
✅ Type-safe throughout

## Known Limitations (To Address in Dual-Write Phase)

- No multi-user support yet (single user in general.json)
- CharactersRepository implemented; others are stubs
- No circular relationship handling (personas ↔ characters)
- No batch operations optimized for large datasets
- Cache invalidation is global (could be per-file)

## Status

Scaffold Phase: ✅ COMPLETE
Ready for: Dual-Write Layer Phase
