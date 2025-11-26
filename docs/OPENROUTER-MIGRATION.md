# OpenRouter Profile Auto-Migration

This document describes the automatic migration system for converting existing `OPENAI_COMPATIBLE` connection profiles that use OpenRouter endpoints to the native `OPENROUTER` provider.

## Overview

When the application starts, it automatically detects and converts any connection profiles that:
1. Use the `OPENAI_COMPATIBLE` provider type
2. Have a `baseUrl` pointing to `openrouter.ai` or any subdomain

These profiles are automatically migrated to use the native `@openrouter/sdk` instead of the OpenAI-compatible API.

## Components

### 1. Migration API Endpoint
**Location:** [`app/api/startup/migrate-openrouter/route.ts`](../app/api/startup/migrate-openrouter/route.ts)

- **POST /api/startup/migrate-openrouter** - Triggers the migration
- **GET /api/startup/migrate-openrouter** - Returns migration status

The endpoint runs once per server restart (idempotent).

### 2. Client-Side Trigger
**Location:** [`lib/startup/openrouter-migration.ts`](../lib/startup/openrouter-migration.ts)

Client-side function that calls the migration API when the app loads.

### 3. React Component
**Location:** [`components/startup/openrouter-migrator.tsx`](../components/startup/openrouter-migrator.tsx)

Invisible React component that triggers the migration on mount. Integrated into the root layout.

### 4. Migration Utilities
**Location:** [`lib/llm/convert-openrouter-profiles.ts`](../lib/llm/convert-openrouter-profiles.ts)

Core migration logic with three exported functions:

- `isOpenRouterEndpoint(baseUrl)` - Checks if a URL is an OpenRouter endpoint
- `convertOpenRouterProfiles(userId?)` - Converts profiles (optionally for a specific user)
- `checkOpenRouterProfiles(userId?)` - Dry-run preview of profiles to convert

### 5. Runtime Detection
**Location:** [`lib/llm/factory.ts`](../lib/llm/factory.ts)

The LLM provider factory automatically detects OpenRouter URLs in `OPENAI_COMPATIBLE` profiles and routes them to the native `OpenRouterProvider`.

## How It Works

### On Application Startup

1. **App loads** → Root layout renders
2. **`<OpenRouterMigrator />`** component mounts
3. **Client calls** `triggerOpenRouterMigration()`
4. **API endpoint** receives POST request to `/api/startup/migrate-openrouter`
5. **Server scans** all connection profiles
6. **Detects** profiles with `provider: 'OPENAI_COMPATIBLE'` and OpenRouter URLs
7. **Converts** matching profiles to `provider: 'OPENROUTER'`
8. **Logs results** to console

### Migration Process

For each matching profile:
```typescript
// Before
{
  provider: 'OPENAI_COMPATIBLE',
  baseUrl: 'https://openrouter.ai/api/v1',
  // ... other fields
}

// After
{
  provider: 'OPENROUTER',
  baseUrl: null, // Not needed for native provider
  // ... other fields preserved
}
```

### Runtime Fallback

Even if migration hasn't run or failed, the factory automatically detects OpenRouter URLs:

```typescript
// In lib/llm/factory.ts
case 'OPENAI_COMPATIBLE':
  if (isOpenRouterEndpoint(baseUrl)) {
    return new OpenRouterProvider() // ← Automatic routing
  }
  return new OpenAICompatibleProvider(baseUrl)
```

## URL Detection

The `isOpenRouterEndpoint()` function validates URLs as follows:

✅ **Accepted:**
- `https://openrouter.ai/api/v1`
- `http://openrouter.ai/api/v1`
- `https://api.openrouter.ai`
- Any subdomain of `openrouter.ai`

❌ **Rejected:**
- Non-HTTP protocols (e.g., `ftp://openrouter.ai`)
- URLs that just contain the string "openrouter.ai" but aren't actually the domain
- Invalid URLs
- null/undefined/empty strings

## Manual Migration

You can also trigger migration manually:

### Via API
```bash
# Trigger migration
curl -X POST http://localhost:3000/api/startup/migrate-openrouter

# Check status
curl http://localhost:3000/api/startup/migrate-openrouter
```

### Via Code
```typescript
import { convertOpenRouterProfiles, checkOpenRouterProfiles } from '@/lib/llm/convert-openrouter-profiles'

// Preview what would be converted
const toConvert = await checkOpenRouterProfiles()
console.log('Profiles to convert:', toConvert)

// Run conversion
const result = await convertOpenRouterProfiles()
console.log(`Converted: ${result.converted}, Errors: ${result.errors.length}`)

// Convert for specific user
const userResult = await convertOpenRouterProfiles('user-id-here')
```

## Logging

The migration system logs to the console:

```
Starting automatic OpenRouter profile migration...
Converted profile abc-123 (My OpenRouter Profile) from OPENAI_COMPATIBLE to OPENROUTER
OpenRouter migration complete: 3 profiles converted, 0 errors
```

Client-side logs appear in the browser console:
```
✓ OpenRouter migration: 3 profile(s) converted to native provider
```

## Benefits

1. **Zero User Action** - Automatic conversion on startup
2. **Better Performance** - Native SDK vs compatibility layer
3. **Type Safety** - Full TypeScript types from `@openrouter/sdk`
4. **API Compatibility** - All OpenRouter features properly supported
5. **Idempotent** - Safe to run multiple times
6. **Fallback Protection** - Runtime detection ensures old profiles still work

## Testing

Tests are located in:
- [`__tests__/unit/openrouter-migration.test.ts`](../__tests__/unit/openrouter-migration.test.ts) - URL detection tests
- [`__tests__/unit/llm-openrouter.test.ts`](../__tests__/unit/llm-openrouter.test.ts) - Provider tests

Run tests:
```bash
npm test -- openrouter
```

## Troubleshooting

### Migration Not Running

Check browser console for errors. The component should log migration results.

### Profiles Not Converting

1. Verify the profile has `provider: 'OPENAI_COMPATIBLE'`
2. Check that `baseUrl` includes `openrouter.ai`
3. Ensure the URL uses `http://` or `https://` protocol

### Manual Recovery

If automatic migration fails, manually edit the profile via the settings UI or database:
1. Change `provider` from `'OPENAI_COMPATIBLE'` to `'OPENROUTER'`
2. Clear the `baseUrl` field (set to `null`)

## Future Enhancements

Potential improvements:
- Add migration status UI in settings
- Track migration history
- Support rollback if needed
- Batch migrations with progress reporting
