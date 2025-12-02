# Quilltap Upgrade Plugin

The upgrade plugin handles version upgrades and data migrations for Quilltap. It runs automatically at startup to ensure data compatibility across versions.

## Features

- **Automatic Migration**: Runs pending migrations on every startup
- **Dependency Ordering**: Migrations are sorted and run in dependency order
- **Tracking**: Completed migrations are recorded to prevent re-running
- **Provider Enablement**: Automatically enables provider plugins based on existing profiles

## Available Migrations

### convert-openrouter-profiles-v1
Converts OPENAI_COMPATIBLE profiles using OpenRouter endpoints to the native OPENROUTER provider.

### enable-provider-plugins-v1
Ensures that provider plugins are enabled for all providers currently in use by connection profiles, image profiles, and embedding profiles.

## How It Works

1. On startup, the plugin system loads all plugins including this one
2. This plugin is initialized early (before provider plugins are fully loaded)
3. The `runMigrations()` function is called
4. Each migration checks if it needs to run (`shouldRun()`)
5. Migrations run in dependency order
6. Completed migrations are recorded in `data/settings/migrations.json`
7. Subsequent startups skip already-completed migrations

## Adding New Migrations

1. Create a new file in `migrations/` (e.g., `migrations/my-migration.ts`)
2. Implement the `Migration` interface:
   ```typescript
   import type { Migration, MigrationResult } from '../migration-types';

   export const myMigration: Migration = {
     id: 'my-migration-v1',
     description: 'Description of what this migration does',
     introducedInVersion: '1.8.0',
     dependsOn: ['previous-migration-v1'], // Optional dependencies

     async shouldRun(): Promise<boolean> {
       // Return true if migration needs to run
       return true;
     },

     async run(): Promise<MigrationResult> {
       const startTime = Date.now();
       // ... migration logic ...
       return {
         id: 'my-migration-v1',
         success: true,
         itemsAffected: 0,
         message: 'Migration completed',
         durationMs: Date.now() - startTime,
         timestamp: new Date().toISOString(),
       };
     },
   };
   ```
3. Add the migration to `migrations/index.ts`

## Migration State File

Completed migrations are tracked in `data/settings/migrations.json`:

```json
{
  "completedMigrations": [
    {
      "id": "convert-openrouter-profiles-v1",
      "completedAt": "2024-01-15T10:30:00.000Z",
      "quilltapVersion": "1.7.0",
      "itemsAffected": 3,
      "message": "Successfully converted 3 OpenRouter profiles"
    }
  ],
  "lastChecked": "2024-01-15T10:30:00.000Z",
  "quilltapVersion": "1.7.0"
}
```

## Development

This plugin is always enabled and cannot be disabled through normal means. It runs before other plugins to ensure data compatibility.

## License

MIT License - Copyright (c) 2024 Foundry-9
