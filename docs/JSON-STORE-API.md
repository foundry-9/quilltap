# JsonStore API Reference

Complete API documentation for the JSON Store infrastructure.

## Table of Contents

1. [JsonStore Core](#jsonstore-core)
2. [Repositories](#repositories)
3. [Schemas](#schemas)
4. [Type Definitions](#type-definitions)
5. [Error Handling](#error-handling)
6. [Examples](#examples)

---

## JsonStore Core

### Class: JsonStore

The core file I/O service managing all JSON and JSONL operations.

#### Constructor

```typescript
constructor(config: JsonStoreConfig = {})
```

**Configuration**:
```typescript
interface JsonStoreConfig {
  dataDir?: string;        // Data directory (default: './data')
  enableCache?: boolean;   // Enable in-memory caching (default: true)
  lockTimeout?: number;    // Lock timeout in ms (default: 5000)
  fsyncInterval?: number;  // JSONL batch size (default: 10)
}
```

#### Methods

##### getDataDir()

```typescript
getDataDir(): string
```

Returns the configured data directory path.

**Example**:
```typescript
const dataDir = jsonStore.getDataDir();
// => './data'
```

##### resolvePath()

```typescript
resolvePath(...segments: string[]): string
```

Resolve a path relative to the data directory.

**Example**:
```typescript
const path = jsonStore.resolvePath('characters', 'abc-123.json');
// => './data/characters/abc-123.json'
```

##### ensureDir()

```typescript
async ensureDir(dirPath: string): Promise<void>
```

Ensure a directory exists, creating it if necessary.

**Example**:
```typescript
await jsonStore.ensureDir('data/custom');
```

##### readJson()

```typescript
async readJson<T>(filePath: string): Promise<T>
```

Read and parse a JSON file. Automatically cached if caching is enabled.

**Parameters**:
- `filePath` - Path relative to data directory

**Returns**: Parsed JSON data

**Throws**: Error if file doesn't exist or JSON is invalid

**Example**:
```typescript
const character = await jsonStore.readJson<Character>(
  'characters/abc-123.json'
);
```

##### writeJson()

```typescript
async writeJson<T>(filePath: string, data: T): Promise<void>
```

Write data to a JSON file atomically (temp file + rename).

**Parameters**:
- `filePath` - Path relative to data directory
- `data` - Data to write

**Features**:
- Atomic write (no corruption on crash)
- Automatic directory creation
- File locking for concurrent safety
- Cache invalidation

**Example**:
```typescript
await jsonStore.writeJson('characters/abc-123.json', character);
```

##### readJsonl()

```typescript
async readJsonl<T>(filePath: string): Promise<T[]>
```

Read a line-delimited JSON file.

**Parameters**:
- `filePath` - Path to .jsonl file

**Returns**: Array of parsed JSON objects

**Note**: Returns empty array if file doesn't exist

**Example**:
```typescript
const sessions = await jsonStore.readJsonl<Session>(
  'auth/sessions.jsonl'
);
// => [Session, Session, ...]
```

##### appendJsonl()

```typescript
async appendJsonl<T>(filePath: string, items: T[]): Promise<void>
```

Append objects to a line-delimited JSON file.

**Parameters**:
- `filePath` - Path to .jsonl file
- `items` - Array of objects to append

**Features**:
- Creates file if it doesn't exist
- Atomic append with file locking
- Automatic directory creation
- Cache invalidation

**Example**:
```typescript
const message: Message = {
  type: 'message',
  id: 'msg-123',
  role: 'USER',
  content: 'Hello!',
  createdAt: new Date().toISOString(),
};

await jsonStore.appendJsonl('chats/chat-123.jsonl', [message]);
```

##### getFileSize()

```typescript
async getFileSize(filePath: string): Promise<number>
```

Get file size in bytes.

**Returns**: File size, or 0 if file doesn't exist

**Example**:
```typescript
const size = await jsonStore.getFileSize('chats/chat-123.jsonl');
console.log(`Chat log: ${size} bytes`);
```

##### exists()

```typescript
exists(filePath: string): boolean
```

Check if a file exists (synchronous).

**Example**:
```typescript
if (jsonStore.exists('settings/general.json')) {
  // File exists
}
```

##### listDir()

```typescript
async listDir(dirPath: string): Promise<string[]>
```

List files in a directory.

**Returns**: Array of filenames (not full paths)

**Note**: Returns empty array if directory doesn't exist

**Example**:
```typescript
const files = await jsonStore.listDir('characters');
// => ['abc-123.json', 'def-456.json']
```

##### deleteFile()

```typescript
async deleteFile(filePath: string): Promise<void>
```

Delete a file. Silently succeeds if file doesn't exist.

**Example**:
```typescript
await jsonStore.deleteFile('characters/abc-123.json');
```

##### clearCache()

```typescript
clearCache(): void
```

Clear all in-memory cached data.

**Example**:
```typescript
jsonStore.clearCache();
```

##### getCacheStats()

```typescript
getCacheStats(): { size: number; enabled: boolean }
```

Get cache statistics.

**Example**:
```typescript
const stats = jsonStore.getCacheStats();
console.log(`${stats.size} items cached`);
```

---

## Repositories

### Class: BaseRepository<T>

Abstract base class for all repositories. Provides common CRUD patterns.

#### Methods

##### findById()

```typescript
abstract findById(id: string): Promise<T | null>
```

Find an entity by ID.

##### findAll()

```typescript
abstract findAll(): Promise<T[]>
```

Get all entities.

##### create()

```typescript
abstract create(
  data: Omit<T, 'id' | 'createdAt' | 'updatedAt'>
): Promise<T>
```

Create a new entity.

##### update()

```typescript
abstract update(
  id: string,
  data: Partial<T>
): Promise<T | null>
```

Update an existing entity.

##### delete()

```typescript
abstract delete(id: string): Promise<boolean>
```

Delete an entity.

### Class: CharactersRepository extends BaseRepository<Character>

Repository for Character entities.

#### Methods

##### findById(id)

```typescript
async findById(id: string): Promise<Character | null>
```

Find a character by ID.

**Example**:
```typescript
const char = await repo.characters.findById('abc-123');
```

##### findAll()

```typescript
async findAll(): Promise<Character[]>
```

Get all characters.

**Example**:
```typescript
const all = await repo.characters.findAll();
```

##### findByUserId(userId)

```typescript
async findByUserId(userId: string): Promise<Character[]>
```

Find all characters for a user.

**Example**:
```typescript
const userChars = await repo.characters.findByUserId('user-123');
```

##### findByTag(tagId)

```typescript
async findByTag(tagId: string): Promise<Character[]>
```

Find all characters with a specific tag.

**Example**:
```typescript
const tagged = await repo.characters.findByTag('tag-123');
```

##### create(data)

```typescript
async create(
  data: Omit<Character, 'id' | 'createdAt' | 'updatedAt'>
): Promise<Character>
```

Create a new character.

**Example**:
```typescript
const newChar = await repo.characters.create({
  userId: 'user-123',
  name: 'Alice',
  title: 'Protagonist',
  description: 'A young adventurer...',
  personality: 'Brave and curious',
  scenario: 'Fantasy world',
  firstMessage: 'Hello!',
});
```

##### update(id, data)

```typescript
async update(
  id: string,
  data: Partial<Character>
): Promise<Character | null>
```

Update a character.

**Example**:
```typescript
const updated = await repo.characters.update('abc-123', {
  name: 'Alice Updated',
  isFavorite: true,
});
```

##### delete(id)

```typescript
async delete(id: string): Promise<boolean>
```

Delete a character.

**Example**:
```typescript
const success = await repo.characters.delete('abc-123');
```

##### addTag(characterId, tagId)

```typescript
async addTag(
  characterId: string,
  tagId: string
): Promise<Character | null>
```

Add a tag to a character.

**Example**:
```typescript
const char = await repo.characters.addTag('char-123', 'tag-456');
```

##### removeTag(characterId, tagId)

```typescript
async removeTag(
  characterId: string,
  tagId: string
): Promise<Character | null>
```

Remove a tag from a character.

##### addPersona(characterId, personaId, isDefault?)

```typescript
async addPersona(
  characterId: string,
  personaId: string,
  isDefault?: boolean
): Promise<Character | null>
```

Add a persona to a character.

**Example**:
```typescript
const char = await repo.characters.addPersona(
  'char-123',
  'persona-456',
  true // Set as default
);
```

##### removePersona(characterId, personaId)

```typescript
async removePersona(
  characterId: string,
  personaId: string
): Promise<Character | null>
```

Remove a persona from a character.

##### setFavorite(characterId, isFavorite)

```typescript
async setFavorite(
  characterId: string,
  isFavorite: boolean
): Promise<Character | null>
```

Set favorite status.

**Example**:
```typescript
await repo.characters.setFavorite('char-123', true);
```

---

## Schemas

All schemas are defined in `lib/json-store/schemas/types.ts`.

### Enums

```typescript
type Provider =
  | 'OPENAI'
  | 'ANTHROPIC'
  | 'OLLAMA'
  | 'OPENROUTER'
  | 'OPENAI_COMPATIBLE'
  | 'GROK'
  | 'GAB_AI';

type ImageProvider = 'OPENAI' | 'GROK' | 'GOOGLE_IMAGEN';

type Role = 'SYSTEM' | 'USER' | 'ASSISTANT' | 'TOOL';

type ImageTagType = 'CHARACTER' | 'PERSONA' | 'CHAT' | 'THEME';

type AvatarDisplayMode = 'ALWAYS' | 'GROUP_ONLY' | 'NEVER';
```

### Common Schemas

#### EncryptedField

```typescript
interface EncryptedField {
  ciphertext: string;  // Base64-encoded AES-256-GCM ciphertext
  iv: string;          // Base64-encoded initialization vector
  authTag: string;     // Base64-encoded authentication tag
}
```

#### User

```typescript
interface User {
  id: string;                    // UUID
  email: string;
  name?: string | null;
  image?: string | null;
  emailVerified?: string | null; // ISO-8601 timestamp
  passwordHash?: string | null;  // bcrypt hash
  totp?: TOTPSecret;             // TOTP configuration
  backupCodes?: BackupCodes;     // Encrypted backup codes
  createdAt: string;             // ISO-8601
  updatedAt: string;             // ISO-8601
}
```

#### Character

```typescript
interface Character {
  id: string;                    // UUID
  userId: string;                // UUID
  name: string;
  title?: string | null;
  description: string;
  personality: string;
  scenario: string;
  firstMessage: string;
  exampleDialogues?: string | null;
  systemPrompt?: string | null;
  avatarUrl?: string | null;     // Legacy
  defaultImageId?: string | null;
  sillyTavernData?: Record<string, any> | null;
  isFavorite: boolean;
  personaLinks: Array<{
    personaId: string;
    isDefault: boolean;
  }>;
  tags: string[];                // Tag IDs
  avatarOverrides: Array<{
    chatId: string;
    imageId: string;
  }>;
  createdAt: string;             // ISO-8601
  updatedAt: string;             // ISO-8601
}
```

#### MessageEvent

```typescript
interface MessageEvent {
  type: 'message';
  id: string;                    // UUID
  role: Role;
  content: string;
  rawResponse?: Record<string, any> | null;
  tokenCount?: number | null;
  swipeGroupId?: string | null;
  swipeIndex?: number | null;
  attachments: string[];         // File IDs
  createdAt: string;             // ISO-8601
}
```

---

## Type Definitions

### Using Zod Schemas

All entities are validated using Zod schemas:

```typescript
import { Character, CharacterSchema } from '@/lib/json-store/schemas/types';

// Type-safe parsing
const character = CharacterSchema.parse(data);

// Safe parsing with error info
const result = CharacterSchema.safeParse(data);
if (!result.success) {
  console.error(result.error.errors);
}
```

### Importing Types

```typescript
// Import types for TypeScript
import type {
  User,
  Character,
  Persona,
  Chat,
  Message,
  Tag,
  // ... all others
} from '@/lib/json-store/schemas/types';

// Import enums
import { ProviderEnum, RoleEnum } from '@/lib/json-store/schemas/types';
```

---

## Error Handling

### JsonStore Errors

```typescript
try {
  const data = await jsonStore.readJson('missing.json');
} catch (error) {
  if (error instanceof Error) {
    if (error.message.includes('not found')) {
      // File doesn't exist
    }
  }
}
```

### Repository Errors

```typescript
try {
  const char = await repo.characters.create({
    // ... required fields missing
  });
} catch (error) {
  // Zod validation error
  console.error(error.message);
}
```

### Lock Timeout

```typescript
try {
  await jsonStore.writeJson('data.json', data);
} catch (error) {
  if (error instanceof Error && error.message.includes('lock')) {
    // Failed to acquire lock within timeout
  }
}
```

---

## Examples

### Complete CRUD Example

```typescript
import { getRepositories } from '@/lib/json-store/repositories';

async function characterDemo() {
  const repos = getRepositories();

  // CREATE
  const newChar = await repos.characters.create({
    userId: 'user-123',
    name: 'Alice',
    description: 'A young adventurer',
    personality: 'Brave',
    scenario: 'Fantasy',
    firstMessage: 'Hello!',
  });
  console.log(`Created: ${newChar.id}`);

  // READ
  const found = await repos.characters.findById(newChar.id);
  console.log(`Found: ${found?.name}`);

  // UPDATE
  const updated = await repos.characters.update(newChar.id, {
    name: 'Alice (Updated)',
    isFavorite: true,
  });
  console.log(`Updated: ${updated?.name}`);

  // ADD TAG
  const tagged = await repos.characters.addTag(newChar.id, 'tag-id');
  console.log(`Tags: ${tagged?.tags}`);

  // DELETE
  const deleted = await repos.characters.delete(newChar.id);
  console.log(`Deleted: ${deleted}`);

  // FIND ALL
  const all = await repos.characters.findAll();
  console.log(`Total characters: ${all.length}`);
}
```

### Working with JSONL

```typescript
import { getJsonStore } from '@/lib/json-store/core/json-store';
import { type MessageEvent } from '@/lib/json-store/schemas/types';

async function chatDemo() {
  const jsonStore = getJsonStore();

  // Create chat log file
  const chatId = 'chat-123';
  const chatPath = `chats/${chatId}.jsonl`;

  // Append messages
  const messages: MessageEvent[] = [
    {
      type: 'message',
      id: 'msg-1',
      role: 'USER',
      content: 'Hello!',
      createdAt: new Date().toISOString(),
    },
    {
      type: 'message',
      id: 'msg-2',
      role: 'ASSISTANT',
      content: 'Hi there!',
      createdAt: new Date().toISOString(),
    },
  ];

  await jsonStore.appendJsonl(chatPath, messages);

  // Read all messages
  const all = await jsonStore.readJsonl<MessageEvent>(chatPath);
  console.log(`Chat has ${all.length} messages`);
}
```

### Error Handling Pattern

```typescript
async function safeCharacterUpdate(charId: string) {
  const repos = getRepositories();

  try {
    const updated = await repos.characters.update(charId, {
      name: 'New Name',
    });

    if (!updated) {
      console.log('Character not found');
      return null;
    }

    return updated;
  } catch (error) {
    console.error('Update failed:', error);
    return null;
  }
}
```

---

## Configuration

### Environment Variables

```bash
# Custom data directory
DATA_DIR=/var/lib/quilltap/data

# Enable/disable caching
JSON_STORE_CACHE=true

# Lock timeout in milliseconds
JSON_STORE_LOCK_TIMEOUT=5000
```

### Programmatic Configuration

```typescript
import { JsonStore } from '@/lib/json-store/core/json-store';

const jsonStore = new JsonStore({
  dataDir: '/custom/path',
  enableCache: true,
  lockTimeout: 10000,
});
```

---

## Performance Tips

1. **Batch writes**: Append multiple items at once to JSONL files
2. **Use caching**: Keep enabled for frequently accessed files
3. **Async operations**: Always await file operations
4. **Directory scanning**: Cache results of `listDir()` if called frequently
5. **Large files**: Consider splitting very large files (>10MB)

---

**Status**: Documentation complete for Scaffold Phase
**Next**: Dual-Write Layer Phase documentation
