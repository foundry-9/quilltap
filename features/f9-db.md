# F9-DB Migration Plan

## Overview

This document outlines the plan to migrate Quilltap from a separate PostgreSQL database to using the [f9-db](https://github.com/foundry-9/f9-db) embedded database backend. The f9-db system provides a lightweight, file-backed, encrypted-capable database solution that eliminates external database dependencies while maintaining robust querying capabilities.

## Current State Analysis

### Existing PostgreSQL Schema
Quilltap currently uses Prisma ORM with PostgreSQL, consisting of:

- **Authentication Models**: User, Account, Session, VerificationToken
- **Security Features**: Password hashing, TOTP 2FA with encrypted secrets, backup codes
- **API Management**: ApiKey (encrypted with AES-256-GCM)
- **Connection Management**: ConnectionProfile
- **Content Models**: Character, Persona, Chat, Message
- **Media System**: Image, ImageTag, ChatAvatarOverride
- **Tagging System**: Tag, CharacterTag, PersonaTag, ChatTag, ConnectionProfileTag
- **Settings**: ChatSettings

**Key Technical Details**:
- Total of 17 main models + 4 join tables
- Extensive use of encrypted fields (API keys, TOTP secrets, backup codes)
- Relations include cascading deletes and foreign key constraints
- JSON fields for flexible data (sillyTavernData, parameters, metadata)
- Text search requirements for names and content
- User-scoped data isolation

## F9-DB Capabilities

### Core Features
- **Storage**: JSONL append-only logs with periodic snapshots
- **Indexing**: Inverted string indexes for text search
- **Query Operators**: SQL-like filters ($gt, $lt, $between, $like, $ilike)
- **Aggregations**: count, sum, average, min, max
- **Binary Storage**: SHA256-based blob deduplication
- **Relations**: Join operations with caching
- **Encryption**: Native support for encrypted storage (future feature)
- **Performance**: LRU caching, configurable fsync modes

### Limitations vs PostgreSQL
- No built-in foreign key constraints (must enforce in application)
- No database-level enum types (use string validation)
- No automatic cascading deletes (must handle in application)
- Single-writer architecture (suitable for single-user desktop app)
- No SQL compatibility (custom query API)

## Migration Strategy

### Phase 1: Setup & Infrastructure (2-3 days)

#### 1.1 Install f9-db
```bash
npm install @foundry-9/f9-db --save
```

#### 1.2 Create Database Initialization Module
**File**: `lib/db/f9db-client.ts`

```typescript
import { Database, Collection } from '@foundry-9/f9-db';
import path from 'path';

export class F9DbClient {
  private db: Database;

  constructor(dataDir?: string) {
    const dbPath = dataDir || path.join(process.cwd(), 'data');
    this.db = new Database({
      dataDir: dbPath,
      binaryDir: path.join(dbPath, 'blobs'),
      logDir: path.join(dbPath, 'logs')
    });
  }

  // Collection accessors
  get users() { return this.db.collection('users'); }
  get accounts() { return this.db.collection('accounts'); }
  get sessions() { return this.db.collection('sessions'); }
  get verificationTokens() { return this.db.collection('verification_tokens'); }
  get apiKeys() { return this.db.collection('api_keys'); }
  get connectionProfiles() { return this.db.collection('connection_profiles'); }
  get characters() { return this.db.collection('characters'); }
  get personas() { return this.db.collection('personas'); }
  get characterPersonas() { return this.db.collection('character_personas'); }
  get chats() { return this.db.collection('chats'); }
  get messages() { return this.db.collection('messages'); }
  get images() { return this.db.collection('images'); }
  get imageTags() { return this.db.collection('image_tags'); }
  get chatAvatarOverrides() { return this.db.collection('chat_avatar_overrides'); }
  get tags() { return this.db.collection('tags'); }
  get characterTags() { return this.db.collection('character_tags'); }
  get personaTags() { return this.db.collection('persona_tags'); }
  get chatTags() { return this.db.collection('chat_tags'); }
  get connectionProfileTags() { return this.db.collection('connection_profile_tags'); }
  get chatSettings() { return this.db.collection('chat_settings'); }

  async initialize() {
    // Create indexes for frequently queried fields
    await this.setupIndexes();
  }

  private async setupIndexes() {
    // User indexes
    await this.users.ensureIndex('email');

    // Session indexes
    await this.sessions.ensureIndex('sessionToken');
    await this.sessions.ensureIndex('userId');

    // Character/Persona indexes
    await this.characters.ensureIndex('userId');
    await this.characters.ensureIndex('name');
    await this.personas.ensureIndex('userId');
    await this.personas.ensureIndex('name');

    // Chat indexes
    await this.chats.ensureIndex('userId');
    await this.chats.ensureIndex('characterId');
    await this.messages.ensureIndex('chatId');

    // Tag indexes
    await this.tags.ensureIndex('userId');
    await this.tags.ensureIndex('nameLower');
  }
}

export const f9db = new F9DbClient();
```

#### 1.3 Update Environment Configuration
**File**: `lib/env.ts`

Add configuration for f9-db data directory:
```typescript
F9_DB_DATA_DIR: process.env.F9_DB_DATA_DIR || './data'
```

### Phase 2: Data Access Layer Abstraction (3-4 days)

#### 2.1 Create Database Adapter Interface
**File**: `lib/db/adapter.ts`

```typescript
export interface DatabaseAdapter {
  // User operations
  findUserByEmail(email: string): Promise<User | null>;
  findUserById(id: string): Promise<User | null>;
  createUser(data: CreateUserData): Promise<User>;
  updateUser(id: string, data: Partial<User>): Promise<User>;

  // Session operations
  findSession(sessionToken: string): Promise<Session | null>;
  createSession(data: CreateSessionData): Promise<Session>;
  deleteSession(sessionToken: string): Promise<void>;

  // Character operations
  findCharactersByUserId(userId: string): Promise<Character[]>;
  findCharacterById(id: string): Promise<Character | null>;
  createCharacter(data: CreateCharacterData): Promise<Character>;
  updateCharacter(id: string, data: Partial<Character>): Promise<Character>;
  deleteCharacter(id: string): Promise<void>;

  // ... (continue for all models)
}
```

#### 2.2 Implement Prisma Adapter (Current)
**File**: `lib/db/prisma-adapter.ts`

Wrap existing Prisma calls in the adapter interface:
```typescript
export class PrismaAdapter implements DatabaseAdapter {
  constructor(private prisma: PrismaClient) {}

  async findUserByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  // ... implement all interface methods
}
```

#### 2.3 Implement F9-DB Adapter
**File**: `lib/db/f9db-adapter.ts`

```typescript
import { f9db } from './f9db-client';
import { v4 as uuidv4 } from 'uuid';

export class F9DbAdapter implements DatabaseAdapter {
  async findUserByEmail(email: string): Promise<User | null> {
    const results = await f9db.users.find({ email });
    return results[0] || null;
  }

  async findUserById(id: string): Promise<User | null> {
    return await f9db.users.get(id);
  }

  async createUser(data: CreateUserData): Promise<User> {
    const user = {
      id: uuidv4(),
      ...data,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await f9db.users.insert(user);
    return user;
  }

  async updateUser(id: string, data: Partial<User>): Promise<User> {
    const updated = {
      ...data,
      updatedAt: new Date().toISOString(),
    };
    await f9db.users.update(id, updated);
    return await this.findUserById(id);
  }

  // Cascade delete implementation
  async deleteCharacter(id: string): Promise<void> {
    // f9-db doesn't have automatic cascade, so we implement it
    const character = await f9db.characters.get(id);
    if (!character) return;

    // Delete related chats
    const chats = await f9db.chats.find({ characterId: id });
    for (const chat of chats) {
      await this.deleteChat(chat.id);
    }

    // Delete character personas
    await f9db.characterPersonas.removeWhere({ characterId: id });

    // Delete character tags
    await f9db.characterTags.removeWhere({ characterId: id });

    // Delete avatar overrides
    await f9db.chatAvatarOverrides.removeWhere({ characterId: id });

    // Finally delete the character
    await f9db.characters.remove(id);
  }

  // ... implement all interface methods with cascade logic
}
```

### Phase 3: NextAuth Integration (2-3 days)

#### 3.1 Create F9-DB NextAuth Adapter
**File**: `lib/auth/f9db-next-auth-adapter.ts`

NextAuth expects a specific adapter interface. Create a custom adapter:

```typescript
import type { Adapter } from 'next-auth/adapters';
import { f9db } from '../db/f9db-client';
import { v4 as uuidv4 } from 'uuid';

export function F9DbAdapter(): Adapter {
  return {
    async createUser(user) {
      const newUser = {
        id: uuidv4(),
        ...user,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await f9db.users.insert(newUser);
      return newUser;
    },

    async getUser(id) {
      return await f9db.users.get(id);
    },

    async getUserByEmail(email) {
      const results = await f9db.users.find({ email });
      return results[0] || null;
    },

    async getUserByAccount({ providerAccountId, provider }) {
      const accounts = await f9db.accounts.find({
        provider,
        providerAccountId,
      });
      if (!accounts[0]) return null;
      return await f9db.users.get(accounts[0].userId);
    },

    async updateUser({ id, ...data }) {
      await f9db.users.update(id, {
        ...data,
        updatedAt: new Date().toISOString(),
      });
      return await f9db.users.get(id);
    },

    async deleteUser(userId) {
      await f9db.users.remove(userId);
    },

    async linkAccount(account) {
      const newAccount = {
        id: uuidv4(),
        ...account,
      };
      await f9db.accounts.insert(newAccount);
      return newAccount;
    },

    async unlinkAccount({ providerAccountId, provider }) {
      const accounts = await f9db.accounts.find({
        provider,
        providerAccountId,
      });
      if (accounts[0]) {
        await f9db.accounts.remove(accounts[0].id);
      }
    },

    async createSession(session) {
      const newSession = {
        id: uuidv4(),
        ...session,
        expires: session.expires.toISOString(),
      };
      await f9db.sessions.insert(newSession);
      return newSession;
    },

    async getSessionAndUser(sessionToken) {
      const sessions = await f9db.sessions.find({ sessionToken });
      if (!sessions[0]) return null;

      const session = sessions[0];
      const user = await f9db.users.get(session.userId);
      if (!user) return null;

      return {
        session: {
          ...session,
          expires: new Date(session.expires),
        },
        user,
      };
    },

    async updateSession({ sessionToken, ...data }) {
      const sessions = await f9db.sessions.find({ sessionToken });
      if (!sessions[0]) return null;

      const updates = {
        ...data,
        expires: data.expires?.toISOString(),
      };
      await f9db.sessions.update(sessions[0].id, updates);
      return await f9db.sessions.get(sessions[0].id);
    },

    async deleteSession(sessionToken) {
      const sessions = await f9db.sessions.find({ sessionToken });
      if (sessions[0]) {
        await f9db.sessions.remove(sessions[0].id);
      }
    },

    async createVerificationToken(verificationToken) {
      const token = {
        id: uuidv4(),
        ...verificationToken,
        expires: verificationToken.expires.toISOString(),
      };
      await f9db.verificationTokens.insert(token);
      return {
        identifier: token.identifier,
        expires: new Date(token.expires),
        token: token.token,
      };
    },

    async useVerificationToken({ identifier, token }) {
      const tokens = await f9db.verificationTokens.find({
        identifier,
        token,
      });
      if (!tokens[0]) return null;

      await f9db.verificationTokens.remove(tokens[0].id);
      return {
        identifier: tokens[0].identifier,
        expires: new Date(tokens[0].expires),
        token: tokens[0].token,
      };
    },
  };
}
```

#### 3.2 Update NextAuth Configuration
**File**: `lib/auth.ts`

```typescript
import { F9DbAdapter } from './auth/f9db-next-auth-adapter';

export const authOptions: NextAuthOptions = {
  adapter: F9DbAdapter(), // Replace PrismaAdapter
  // ... rest of config
};
```

### Phase 4: Update Application Code (4-5 days)

#### 4.1 Refactor API Routes
Replace all direct Prisma calls with adapter interface:

**Before** (e.g., `app/api/characters/route.ts`):
```typescript
const characters = await prisma.character.findMany({
  where: { userId: session.user.id },
});
```

**After**:
```typescript
const characters = await db.findCharactersByUserId(session.user.id);
```

#### 4.2 Add Enum Validation
Since f9-db doesn't have enum types, add Zod schemas:

**File**: `lib/db/schemas.ts`
```typescript
import { z } from 'zod';

export const ProviderSchema = z.enum([
  'OPENAI',
  'ANTHROPIC',
  'OLLAMA',
  'OPENROUTER',
  'OPENAI_COMPATIBLE',
  'GROK',
  'GAB_AI',
]);

export const RoleSchema = z.enum(['SYSTEM', 'USER', 'ASSISTANT']);

// Validate before insert/update
export function validateProvider(provider: string) {
  return ProviderSchema.parse(provider);
}
```

#### 4.3 Implement Referential Integrity Checks
Add validation for foreign keys:

```typescript
async createChat(data: CreateChatData) {
  // Verify references exist
  const user = await f9db.users.get(data.userId);
  if (!user) throw new Error('User not found');

  const character = await f9db.characters.get(data.characterId);
  if (!character) throw new Error('Character not found');

  if (data.personaId) {
    const persona = await f9db.personas.get(data.personaId);
    if (!persona) throw new Error('Persona not found');
  }

  // Proceed with creation
  const chat = {
    id: uuidv4(),
    ...data,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await f9db.chats.insert(chat);
  return chat;
}
```

#### 4.4 Update Unique Constraints
Implement unique constraint checking:

```typescript
async createTag(userId: string, name: string) {
  const nameLower = name.toLowerCase();

  // Check uniqueness
  const existing = await f9db.tags.find({ userId, nameLower });
  if (existing.length > 0) {
    throw new Error('Tag already exists');
  }

  const tag = {
    id: uuidv4(),
    userId,
    name,
    nameLower,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await f9db.tags.insert(tag);
  return tag;
}
```

### Phase 5: Data Migration (2-3 days)

#### 5.1 Create Migration Script
**File**: `scripts/migrate-postgres-to-f9db.ts`

```typescript
import { PrismaClient } from '@prisma/client';
import { f9db } from '../lib/db/f9db-client';

async function migrate() {
  const prisma = new PrismaClient();

  console.log('Starting migration...');

  try {
    // 1. Migrate Users
    console.log('Migrating users...');
    const users = await prisma.user.findMany();
    for (const user of users) {
      await f9db.users.insert({
        ...user,
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
        emailVerified: user.emailVerified?.toISOString() || null,
        totpVerifiedAt: user.totpVerifiedAt?.toISOString() || null,
      });
    }
    console.log(`Migrated ${users.length} users`);

    // 2. Migrate Accounts
    console.log('Migrating accounts...');
    const accounts = await prisma.account.findMany();
    for (const account of accounts) {
      await f9db.accounts.insert(account);
    }
    console.log(`Migrated ${accounts.length} accounts`);

    // 3. Migrate Sessions
    console.log('Migrating sessions...');
    const sessions = await prisma.session.findMany();
    for (const session of sessions) {
      await f9db.sessions.insert({
        ...session,
        expires: session.expires.toISOString(),
      });
    }
    console.log(`Migrated ${sessions.length} sessions`);

    // 4. Migrate API Keys
    console.log('Migrating API keys...');
    const apiKeys = await prisma.apiKey.findMany();
    for (const key of apiKeys) {
      await f9db.apiKeys.insert({
        ...key,
        lastUsed: key.lastUsed?.toISOString() || null,
        createdAt: key.createdAt.toISOString(),
        updatedAt: key.updatedAt.toISOString(),
      });
    }
    console.log(`Migrated ${apiKeys.length} API keys`);

    // 5. Migrate Connection Profiles
    console.log('Migrating connection profiles...');
    const profiles = await prisma.connectionProfile.findMany();
    for (const profile of profiles) {
      await f9db.connectionProfiles.insert({
        ...profile,
        createdAt: profile.createdAt.toISOString(),
        updatedAt: profile.updatedAt.toISOString(),
      });
    }
    console.log(`Migrated ${profiles.length} connection profiles`);

    // 6. Migrate Images
    console.log('Migrating images...');
    const images = await prisma.image.findMany();
    for (const image of images) {
      await f9db.images.insert({
        ...image,
        createdAt: image.createdAt.toISOString(),
        updatedAt: image.updatedAt.toISOString(),
      });
    }
    console.log(`Migrated ${images.length} images`);

    // 7. Migrate Characters
    console.log('Migrating characters...');
    const characters = await prisma.character.findMany();
    for (const character of characters) {
      await f9db.characters.insert({
        ...character,
        createdAt: character.createdAt.toISOString(),
        updatedAt: character.updatedAt.toISOString(),
      });
    }
    console.log(`Migrated ${characters.length} characters`);

    // 8. Migrate Personas
    console.log('Migrating personas...');
    const personas = await prisma.persona.findMany();
    for (const persona of personas) {
      await f9db.personas.insert({
        ...persona,
        createdAt: persona.createdAt.toISOString(),
        updatedAt: persona.updatedAt.toISOString(),
      });
    }
    console.log(`Migrated ${personas.length} personas`);

    // 9. Migrate Character Personas (join table)
    console.log('Migrating character-persona relationships...');
    const charPersonas = await prisma.characterPersona.findMany();
    for (const cp of charPersonas) {
      await f9db.characterPersonas.insert({
        id: `${cp.characterId}_${cp.personaId}`,
        ...cp,
      });
    }
    console.log(`Migrated ${charPersonas.length} character-persona relationships`);

    // 10. Migrate Chats
    console.log('Migrating chats...');
    const chats = await prisma.chat.findMany();
    for (const chat of chats) {
      await f9db.chats.insert({
        ...chat,
        createdAt: chat.createdAt.toISOString(),
        updatedAt: chat.updatedAt.toISOString(),
      });
    }
    console.log(`Migrated ${chats.length} chats`);

    // 11. Migrate Messages
    console.log('Migrating messages...');
    const messages = await prisma.message.findMany();
    for (const message of messages) {
      await f9db.messages.insert({
        ...message,
        createdAt: message.createdAt.toISOString(),
      });
    }
    console.log(`Migrated ${messages.length} messages`);

    // 12. Migrate Tags
    console.log('Migrating tags...');
    const tags = await prisma.tag.findMany();
    for (const tag of tags) {
      await f9db.tags.insert({
        ...tag,
        createdAt: tag.createdAt.toISOString(),
        updatedAt: tag.updatedAt.toISOString(),
      });
    }
    console.log(`Migrated ${tags.length} tags`);

    // 13. Migrate all tag relationships
    console.log('Migrating tag relationships...');
    const charTags = await prisma.characterTag.findMany();
    for (const ct of charTags) {
      await f9db.characterTags.insert({
        ...ct,
        createdAt: ct.createdAt.toISOString(),
      });
    }

    const personaTags = await prisma.personaTag.findMany();
    for (const pt of personaTags) {
      await f9db.personaTags.insert({
        ...pt,
        createdAt: pt.createdAt.toISOString(),
      });
    }

    const chatTags = await prisma.chatTag.findMany();
    for (const ct of chatTags) {
      await f9db.chatTags.insert({
        ...ct,
        createdAt: ct.createdAt.toISOString(),
      });
    }

    const profileTags = await prisma.connectionProfileTag.findMany();
    for (const pt of profileTags) {
      await f9db.connectionProfileTags.insert({
        ...pt,
        createdAt: pt.createdAt.toISOString(),
      });
    }
    console.log('Migrated all tag relationships');

    // 14. Migrate Image Tags
    console.log('Migrating image tags...');
    const imageTags = await prisma.imageTag.findMany();
    for (const it of imageTags) {
      await f9db.imageTags.insert({
        ...it,
        createdAt: it.createdAt.toISOString(),
      });
    }
    console.log(`Migrated ${imageTags.length} image tags`);

    // 15. Migrate Chat Avatar Overrides
    console.log('Migrating chat avatar overrides...');
    const avatarOverrides = await prisma.chatAvatarOverride.findMany();
    for (const override of avatarOverrides) {
      await f9db.chatAvatarOverrides.insert({
        ...override,
        createdAt: override.createdAt.toISOString(),
      });
    }
    console.log(`Migrated ${avatarOverrides.length} avatar overrides`);

    // 16. Migrate Chat Settings
    console.log('Migrating chat settings...');
    const chatSettings = await prisma.chatSettings.findMany();
    for (const settings of chatSettings) {
      await f9db.chatSettings.insert({
        ...settings,
        createdAt: settings.createdAt.toISOString(),
        updatedAt: settings.updatedAt.toISOString(),
      });
    }
    console.log(`Migrated ${chatSettings.length} chat settings`);

    console.log('Migration completed successfully!');
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

migrate();
```

#### 5.2 Add Migration Script to package.json
```json
{
  "scripts": {
    "migrate:postgres-to-f9db": "ts-node scripts/migrate-postgres-to-f9db.ts"
  }
}
```

### Phase 6: Testing & Validation (3-4 days)

#### 6.1 Create Parallel Testing Environment
Set up environment to test both databases side-by-side:

**File**: `.env.test`
```
USE_F9_DB=true
F9_DB_DATA_DIR=./data-test
DATABASE_URL=postgresql://... (keep for comparison)
```

#### 6.2 Write Integration Tests
**File**: `__tests__/db/f9db-adapter.test.ts`

```typescript
describe('F9DB Adapter', () => {
  test('user CRUD operations', async () => {
    const user = await db.createUser({
      email: 'test@example.com',
      name: 'Test User',
    });
    expect(user.id).toBeDefined();

    const found = await db.findUserByEmail('test@example.com');
    expect(found?.id).toBe(user.id);

    await db.updateUser(user.id, { name: 'Updated Name' });
    const updated = await db.findUserById(user.id);
    expect(updated?.name).toBe('Updated Name');
  });

  test('cascade delete for characters', async () => {
    // Create character with related data
    const character = await db.createCharacter({...});
    const chat = await db.createChat({ characterId: character.id, ... });

    // Delete character
    await db.deleteCharacter(character.id);

    // Verify cascades
    const deletedChat = await db.findChatById(chat.id);
    expect(deletedChat).toBeNull();
  });

  test('unique constraint enforcement', async () => {
    await db.createTag(userId, 'duplicate');

    await expect(
      db.createTag(userId, 'Duplicate')
    ).rejects.toThrow('Tag already exists');
  });
});
```

#### 6.3 Performance Testing
Compare query performance between Prisma and f9-db:

```typescript
// Benchmark common operations
const iterations = 1000;

// Character listing
const start = Date.now();
for (let i = 0; i < iterations; i++) {
  await db.findCharactersByUserId(userId);
}
console.log(`f9-db: ${Date.now() - start}ms`);
```

#### 6.4 Data Integrity Verification
Create verification script to ensure data consistency:

```typescript
async function verifyMigration() {
  const prisma = new PrismaClient();

  // Compare counts
  const prismaUserCount = await prisma.user.count();
  const f9dbUserCount = (await f9db.users.find({})).length;
  assert(prismaUserCount === f9dbUserCount, 'User count mismatch');

  // Spot check random records
  const randomUser = await prisma.user.findFirst();
  const f9dbUser = await f9db.users.get(randomUser.id);
  assert.deepEqual(
    normalizeForComparison(randomUser),
    normalizeForComparison(f9dbUser),
    'User data mismatch'
  );
}
```

### Phase 7: Deployment & Cutover (1-2 days)

#### 7.1 Feature Flag Implementation
Add gradual rollout capability:

```typescript
const USE_F9_DB = process.env.USE_F9_DB === 'true';

export const db: DatabaseAdapter = USE_F9_DB
  ? new F9DbAdapter()
  : new PrismaAdapter(prisma);
```

#### 7.2 Backup Strategy
```bash
# Backup PostgreSQL before cutover
pg_dump quilltap > backup_pre_migration_$(date +%Y%m%d).sql

# Backup f9-db data directory
tar -czf f9db_backup_$(date +%Y%m%d).tar.gz ./data
```

#### 7.3 Rollback Plan
Keep Prisma available for quick rollback:
```typescript
// Don't remove Prisma dependencies immediately
// Keep in devDependencies for 1-2 releases
```

#### 7.4 Update Documentation
- Update README with new database setup instructions
- Document data directory structure
- Add backup/restore procedures
- Update deployment guides

### Phase 8: Cleanup (1 day)

#### 8.1 Remove Prisma Dependencies
After stable cutover (2-4 weeks):
```bash
npm uninstall prisma @prisma/client @auth/prisma-adapter
```

#### 8.2 Remove PostgreSQL Configuration
Delete:
- `prisma/` directory
- Database migration files
- PostgreSQL connection strings from env files

#### 8.3 Archive Migration Scripts
Move to `scripts/archive/` for reference

## Timeline Summary

| Phase | Duration | Dependencies |
|-------|----------|--------------|
| 1. Setup & Infrastructure | 2-3 days | None |
| 2. Data Access Layer | 3-4 days | Phase 1 |
| 3. NextAuth Integration | 2-3 days | Phase 2 |
| 4. Application Code Updates | 4-5 days | Phase 2, 3 |
| 5. Data Migration | 2-3 days | Phase 1-4 |
| 6. Testing & Validation | 3-4 days | Phase 5 |
| 7. Deployment & Cutover | 1-2 days | Phase 6 |
| 8. Cleanup | 1 day | Phase 7 + 2-4 weeks |

**Total Development Time**: 18-25 days
**Total to Complete Cleanup**: 32-53 days (including stabilization period)

## Risk Mitigation

### Data Loss Prevention
- ✅ Run migration script multiple times in testing
- ✅ Keep PostgreSQL running in parallel during transition
- ✅ Implement comprehensive backup strategy
- ✅ Verify data integrity after each migration

### Performance Risks
- ✅ Profile critical queries before/after migration
- ✅ Optimize f9-db indexes based on access patterns
- ✅ Monitor query performance in production
- ✅ Keep feature flag for quick rollback

### Development Risks
- ✅ Use adapter pattern to minimize code changes
- ✅ Comprehensive test coverage before cutover
- ✅ Staged rollout using feature flags
- ✅ Document all manual steps (cascade deletes, unique constraints)

## Benefits of Migration

### Operational Benefits
- ✅ **No External Dependencies**: Eliminate PostgreSQL server management
- ✅ **Simplified Deployment**: Single executable with embedded data
- ✅ **Portable Data**: File-based storage easily backed up/transferred
- ✅ **Future Encryption**: Native support for encrypted storage (S3 integration planned)

### Development Benefits
- ✅ **Simpler Setup**: New developers don't need PostgreSQL
- ✅ **Easier Testing**: Test database is just a directory
- ✅ **Better Offline Support**: Works without network database
- ✅ **Transparent Storage**: JSONL files are human-readable

### Alignment Benefits
- ✅ **Strategic Direction**: Matches Quilltap's shift toward portable storage
- ✅ **Foundry-9 Ecosystem**: Using internal tooling
- ✅ **Multi-user Key Derivation**: Enables future advanced encryption features

## Considerations & Trade-offs

### When to Stick with PostgreSQL
Consider delaying migration if:
- Multi-user concurrent writes are required (f9-db is single-writer)
- Complex SQL queries are heavily used
- Existing PostgreSQL infrastructure is well-optimized
- Team lacks capacity for 3-4 week migration project

### When to Proceed with F9-DB
Proceed if:
- Single-user desktop/local application model fits use case
- Portability and offline support are priorities
- Future encrypted storage is a requirement
- Simplifying deployment dependencies is valuable
- Team is comfortable with the Foundry-9 ecosystem

## Post-Migration Optimization

### After 1 Month
- Review f9-db query patterns and add missing indexes
- Optimize snapshot compression settings
- Tune LRU cache sizes based on usage patterns

### After 3 Months
- Implement automated backup procedures
- Consider implementing f9-db's binary blob storage for images
- Evaluate snapshot compaction schedule
- Monitor disk space usage trends

### After 6 Months
- Assess encryption implementation status
- Consider S3 sync for backup/sync features
- Review and optimize join cache settings
- Evaluate overall performance vs PostgreSQL baseline

---

## Next Steps

1. **Decision Point**: Review this plan with team and decide to proceed or defer
2. **Resource Allocation**: Assign developers for 3-4 week migration project
3. **Environment Setup**: Create parallel testing environment
4. **Phase 1 Start**: Begin with f9-db installation and client setup
5. **Regular Check-ins**: Weekly review of migration progress

## References

- [f9-db GitHub Repository](https://github.com/foundry-9/f9-db)
- [Current Prisma Schema](../prisma/schema.prisma)
- [Quilltap Development Docs](../DEVELOPMENT.md)
- [NextAuth.js Adapter Documentation](https://next-auth.js.org/adapters/overview)
