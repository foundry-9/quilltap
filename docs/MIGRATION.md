# Migration Guide: Prisma to JSON Store

## Overview

Quilltap has completed its migration from PostgreSQL + Prisma to a JSON-based file store. This guide explains what changed, why it happened, and how it affects existing users and deployments.

## What Changed

### Before (Prisma + PostgreSQL)
- Data stored in PostgreSQL 16 relational database
- Prisma ORM for data access
- Separate database service in Docker Compose
- Database migrations required (`npx prisma migrate`)
- Complex setup with docker-compose.yml containing both app and database services

### After (JSON Store)
- Data stored in JSON files in `data/` directory
- Custom JSON repositories for type-safe data access
- Single application container - no separate database needed
- No database setup or migrations required
- Simplified docker-compose.yml with only the app service

## Why the Change?

### Benefits of JSON Store

1. **Simpler Deployment**
   - Single container instead of app + database
   - No database setup required
   - Easier to run locally without Docker
   - Portable - data is just files

2. **Better Portability**
   - Easy to backup (just copy the `data/` directory)
   - Easy to migrate between servers (copy data folder)
   - Version control friendly (text-based data)
   - No database version compatibility issues

3. **Faster Development**
   - No database setup for new developers
   - Easier to write integration tests
   - Faster test execution
   - No need for database fixtures

4. **Improved Security**
   - No exposed database port
   - File-based access control
   - Atomic writes prevent corruption
   - JSONL append-only format for sensitive data

## Migration Path for Existing Users

### If You're Using the Old Version

**Important**: The old Prisma-based version is no longer maintained. You should migrate to the JSON store version.

### Export Your Data (Optional)

If you want to preserve your data from the old version:

```bash
# Before upgrading, backup your database
pg_dump -U postgres -d quilltap -F custom -f quilltap-backup.sql

# Or with docker-compose
docker-compose exec db pg_dump -U postgres -d quilltap > quilltap-backup.sql
```

Currently, there is no direct data importer from the old Prisma database to the new JSON store. You will need to recreate your data manually:

1. **Export characters** from the old version's JSON export
2. **Import them** into the new version
3. **Re-add API keys** to connection profiles
4. **Re-authenticate** with OAuth

### Fresh Installation (Recommended)

The easiest path is to start fresh with the new JSON store version:

```bash
# Clone latest version
git clone https://github.com/foundry-9/quilltap.git
cd quilltap

# Install and run
cp .env.example .env.local
# Configure .env.local with your values
docker-compose up -d
```

## Environment Variables

### Removed
- `DATABASE_URL` - No longer needed

### Added
- `DATA_BACKEND` - Controls which backend to use (defaults to `json`)

### All Variables

```env
# Authentication
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="your-secret-here"

# OAuth
GOOGLE_CLIENT_ID="your-client-id"
GOOGLE_CLIENT_SECRET="your-client-secret"

# Encryption
ENCRYPTION_MASTER_PEPPER="your-pepper-here"

# Optional
DATA_BACKEND="json"  # json is default
LOG_LEVEL="info"     # error, warn, info, debug
```

See `.env.example` for complete reference.

## Docker Compose Changes

### Old (Prisma)

```yaml
version: '3.8'

services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: quilltap
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: dev_password
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  app:
    build: .
    environment:
      DATABASE_URL: postgresql://postgres:dev_password@db:5432/quilltap
    ports:
      - "3000:3000"
    depends_on:
      - db

volumes:
  postgres_data:
```

### New (JSON Store)

```yaml
version: '3.8'

services:
  app:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/data
```

Much simpler! No database service needed.

## Data Storage Structure

All data is stored in the `data/` directory:

```
data/
├── characters/              # Character definitions
├── personas/               # User personas
├── chats/                 # Conversations
├── auth/                  # Authentication
├── settings/              # Configuration
└── binaries/              # Images
```

## API Compatibility

Good news: **The API hasn't changed!** All existing API endpoints work the same way:

```bash
# These all work exactly the same
POST /api/characters
GET /api/characters/:id
PUT /api/characters/:id
DELETE /api/characters/:id

POST /api/chats
GET /api/chats/:id/messages
```

Your client-side code doesn't need any changes.

## Database Queries

If you have custom code that used Prisma:

### Old Code (Prisma)

```typescript
import { prisma } from '@/lib/prisma'

const character = await prisma.character.findUnique({
  where: { id: charId },
})
```

### New Code (JSON Store)

```typescript
import { getRepositories } from '@/lib/json-store/repositories'

const { charactersRepo } = getRepositories()
const character = await charactersRepo.findById(charId)
```

The new repositories have compatible methods:
- `findById(id)`
- `findAll()`
- `create(data)`
- `update(id, data)`
- `delete(id)`

## Performance

### Query Performance

JSON store queries are generally **faster** than Prisma queries:
- Simple in-memory lookup: O(1) average
- List operations: O(n) but with in-memory caching
- No database network latency

### Limitations

Some complex operations are slower:
- Full text search: Not optimized
- Large aggregations: Load entire dataset into memory

These aren't common in Quilltap's use cases, so performance is typically better overall.

## Backup & Restore

The new JSON store makes backups much simpler:

### Backup
```bash
cp -r data/ data-backup-$(date +%Y%m%d)/
# Or use automated scripts (see BACKUP-RESTORE.md)
```

### Restore
```bash
rm -rf data/
cp -r data-backup-20250120/ data/
docker-compose restart app
```

No database dumps, no migrations, no compatibility checking!

See [Backup & Restore Guide](BACKUP-RESTORE.md) for detailed procedures.

## Troubleshooting

### Application won't start

```bash
# Check if data directory exists and is writable
ls -la data/
chmod 755 data/

# Check logs
docker-compose logs -f app
```

### Data not appearing

```bash
# Verify data files exist
ls -la data/characters/
ls -la data/auth/

# Check file format is valid JSON
python3 -m json.tool data/settings/general.json
```

### Can't import old database

Unfortunately, there's no automatic importer. You'll need to:

1. Export your characters from the old version as JSON
2. Import them into the new version through the web UI
3. Re-add your API keys

This ensures all data is properly validated and formatted.

### Performance issues

JSON store is fast, but if you have 1000+ chats, some operations might be slow:

```bash
# Check file sizes
du -sh data/chats/
du -sh data/

# If files are large, consider archiving old chats
# (Feature coming in v1.4)
```

## Development Guide

If you're developing Quilltap or want to understand the new architecture:

### Repository Pattern

All data access goes through repositories:

```typescript
import { getRepositories } from '@/lib/json-store/repositories'

export async function handler(req: NextRequest) {
  const { charactersRepo } = getRepositories()
  const character = await charactersRepo.findById(characterId)
  return NextResponse.json(character)
}
```

### Testing

Tests now use mock repositories instead of a test database:

```typescript
jest.mock('@/lib/json-store/repositories', () => ({
  getRepositories: jest.fn(() => ({
    charactersRepo: mockCharactersRepo,
  })),
}))
```

Much faster than spinning up a database!

### Adding New Features

To add a new entity type:

1. Add Zod schema to `lib/json-store/schemas/types.ts`
2. Create repository in `lib/json-store/repositories/your-entity.repository.ts`
3. Register in `lib/json-store/repositories/index.ts`
4. Use in your API route

See existing repositories for examples.

## Feature Support

### Fully Supported
- ✅ Character CRUD operations
- ✅ Persona management
- ✅ Chat history
- ✅ Message storage
- ✅ API key encryption
- ✅ OAuth authentication
- ✅ Image upload and storage
- ✅ SillyTavern import/export

### New Capabilities
- ✅ Simplified backup/restore
- ✅ Better portability
- ✅ Faster local development
- ✅ Single container deployment

### Future Enhancements
- 📝 Full-text search optimization
- 📝 Automatic chat archiving
- 📝 Data compression for large deployments
- 📝 SQLite backend option

## Rolling Back (Not Recommended)

If you absolutely need to go back to the Prisma version:

```bash
# Checkout old commit
git checkout v1.2.0  # Or whatever version you used

# Restore old database
psql -U postgres -d quilltap < quilltap-backup.sql

# Reinstall dependencies
npm install

# Start with old docker-compose
docker-compose up -d
```

However, we strongly recommend staying on the new version. The JSON store is more stable and has fewer operational issues.

## Support

For migration questions or issues:

1. Check [FAQ](../README.md#troubleshooting)
2. Open an [issue on GitHub](https://github.com/foundry-9/quilltap/issues)
3. Check existing [discussions](https://github.com/foundry-9/quilltap/discussions)

## Summary

| Aspect | Before (Prisma) | After (JSON) |
|--------|-----------------|--------------|
| Database | PostgreSQL 16 | JSON files |
| Setup | Complex | Simple |
| Backup | Database dumps | File copy |
| Containers | 2 (app + db) | 1 (app only) |
| Performance | Good | Better |
| Portability | Low | High |
| Development | Slow setup | Fast setup |

The migration makes Quilltap easier to deploy, maintain, and develop. We're confident you'll appreciate the improvements!

## Next Steps

1. **Update to latest version**: `git pull origin main`
2. **Backup your data**: See [Backup & Restore Guide](BACKUP-RESTORE.md)
3. **Configure environment**: Copy `.env.example` to `.env.local`
4. **Start the application**: `docker-compose up -d` or `npm run dev`
5. **Verify everything works**: Check [Troubleshooting](../README.md#troubleshooting)

Welcome to the new Quilltap!
