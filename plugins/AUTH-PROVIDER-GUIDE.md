# Authentication Provider Plugin Development Guide

This guide covers everything you need to create a new authentication provider plugin for Quilltap.

## Overview

Authentication provider plugins enable Quilltap to support new OAuth providers for user login. Each auth plugin implements a standard interface that handles:

- OAuth configuration (required)
- Environment variable validation (required)
- Configuration status reporting (required)
- UI button styling (optional)

## Architecture

Quilltap uses NextAuth.js for authentication with a **lazy initialization pattern**:

1. Plugins register during app startup via the auth provider registry
2. Auth options are built asynchronously when first needed
3. NextAuth route handlers wait for plugin initialization
4. All `getServerSession()` calls use the same cached configuration

This ensures auth provider plugins are fully loaded before any authentication occurs.

## Quick Start

### 1. Create the Plugin Directory

```bash
mkdir -p plugins/dist/qtap-plugin-auth-myprovider
cd plugins/dist/qtap-plugin-auth-myprovider
```

### 2. Create manifest.json

```json
{
  "$schema": "../qtap-plugin-template/schemas/plugin-manifest.schema.json",
  "name": "qtap-plugin-auth-myprovider",
  "title": "MyProvider OAuth",
  "description": "MyProvider OAuth authentication for Quilltap",
  "version": "1.0.0",
  "author": {
    "name": "Your Name",
    "email": "you@example.com"
  },
  "license": "MIT",
  "compatibility": {
    "quilltapVersion": ">=1.8.0",
    "nodeVersion": ">=18.0.0"
  },
  "capabilities": ["AUTH_METHODS"],
  "category": "AUTHENTICATION",
  "main": "index.js",
  "typescript": true,
  "frontend": "REACT",
  "styling": "TAILWIND",
  "enabledByDefault": true,
  "status": "STABLE",
  "keywords": ["myprovider", "oauth", "authentication", "login"],
  "authProviderConfig": {
    "providerId": "myprovider",
    "displayName": "MyProvider",
    "requiredEnvVars": ["MYPROVIDER_CLIENT_ID", "MYPROVIDER_CLIENT_SECRET"],
    "buttonColor": "bg-blue-500 hover:bg-blue-600",
    "buttonTextColor": "text-white"
  },
  "permissions": {
    "network": ["auth.myprovider.com", "api.myprovider.com"],
    "userData": false,
    "database": false
  }
}
```

### 3. Create index.ts

```typescript
/**
 * MyProvider OAuth Authentication Provider Plugin
 */

// ============================================================================
// TYPES (duplicated to avoid import issues in standalone plugin)
// ============================================================================

interface AuthProviderConfig {
  providerId: string;
  displayName: string;
  icon?: string;
  requiredEnvVars: string[];
  optionalEnvVars?: string[];
  buttonColor?: string;
  buttonTextColor?: string;
}

interface ProviderConfigStatus {
  isConfigured: boolean;
  missingVars: string[];
}

// ============================================================================
// CONFIGURATION
// ============================================================================

const REQUIRED_ENV_VARS = ['MYPROVIDER_CLIENT_ID', 'MYPROVIDER_CLIENT_SECRET'];

const config: AuthProviderConfig = {
  providerId: 'myprovider',
  displayName: 'MyProvider',
  icon: 'myprovider',
  requiredEnvVars: REQUIRED_ENV_VARS,
  buttonColor: 'bg-blue-500 hover:bg-blue-600',
  buttonTextColor: 'text-white',
};

// ============================================================================
// HELPERS
// ============================================================================

function checkEnvVars(requiredVars: string[]): ProviderConfigStatus {
  const missingVars = requiredVars.filter(varName => !process.env[varName]);
  return {
    isConfigured: missingVars.length === 0,
    missingVars,
  };
}

// ============================================================================
// PROVIDER FUNCTIONS
// ============================================================================

/**
 * Check if the provider is properly configured
 */
function isConfigured(): boolean {
  const status = getConfigStatus();
  return status.isConfigured;
}

/**
 * Get detailed configuration status
 */
function getConfigStatus(): ProviderConfigStatus {
  return checkEnvVars(REQUIRED_ENV_VARS);
}

// ============================================================================
// PLUGIN EXPORT
// ============================================================================

module.exports = {
  config,
  isConfigured,
  getConfigStatus,
  // Note: createProvider is handled by lib/auth.ts using next-auth providers
  // to avoid dependency issues. The plugin provides configuration only.
};
```

### 4. Create package.json

```json
{
  "name": "qtap-plugin-auth-myprovider",
  "version": "1.0.0",
  "description": "MyProvider OAuth plugin for Quilltap",
  "main": "index.js",
  "types": "index.ts",
  "license": "MIT"
}
```

### 5. Add Provider Support to lib/auth.ts

For your OAuth provider to work, you need to add support in `lib/auth.ts`. The auth module maps plugin configurations to actual NextAuth providers:

```typescript
// In lib/auth.ts, add to createOAuthProvider function:

import MyProviderProvider from 'next-auth/providers/myprovider';
// Or for custom OAuth:
// import { OAuthConfig } from 'next-auth/providers/oauth';

function createOAuthProvider(providerId: string): OAuthProvider | null {
  switch (providerId) {
    case 'google':
      // existing...

    case 'myprovider':
      if (process.env.MYPROVIDER_CLIENT_ID && process.env.MYPROVIDER_CLIENT_SECRET) {
        return MyProviderProvider({
          clientId: process.env.MYPROVIDER_CLIENT_ID,
          clientSecret: process.env.MYPROVIDER_CLIENT_SECRET,
        });
      }
      return null;

    default:
      logger.warn('Unknown OAuth provider ID', { context: 'createOAuthProvider', providerId });
      return null;
  }
}
```

## Plugin Interface

Auth provider plugins must export the following:

```typescript
interface AuthProviderPluginExport {
  /** Provider configuration metadata */
  config: AuthProviderConfig;

  /** Check if the provider is properly configured */
  isConfigured: () => boolean;

  /** Get detailed configuration status */
  getConfigStatus: () => ProviderConfigStatus;
}
```

### AuthProviderConfig

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `providerId` | string | Yes | Lowercase identifier (e.g., 'google', 'github') |
| `displayName` | string | Yes | Human-readable name for UI |
| `requiredEnvVars` | string[] | Yes | Environment variables that must be set |
| `optionalEnvVars` | string[] | No | Additional optional environment variables |
| `buttonColor` | string | No | Tailwind classes for sign-in button background |
| `buttonTextColor` | string | No | Tailwind classes for sign-in button text |
| `icon` | string | No | Icon identifier or SVG name |

### ProviderConfigStatus

| Field | Type | Description |
|-------|------|-------------|
| `isConfigured` | boolean | True if all required env vars are set |
| `missingVars` | string[] | List of missing environment variable names |

## Manifest Schema

The `authProviderConfig` section in manifest.json is validated against this schema:

```typescript
{
  providerId: string;      // Must match pattern /^[a-z][a-z0-9-]*$/
  displayName: string;     // 1-100 characters
  requiredEnvVars: string[]; // At least one required
  optionalEnvVars?: string[];
  buttonColor?: string;    // Tailwind classes
  buttonTextColor?: string; // Tailwind classes
  icon?: string;
}
```

## How It Works

### Registration Flow

1. **Plugin Discovery**: During startup, Quilltap scans `plugins/dist/` for plugins
2. **Manifest Validation**: Each plugin's `manifest.json` is validated
3. **Auth Plugin Detection**: Plugins with `AUTH_METHODS` capability are identified
4. **Registration**: The auth provider registry loads and registers the plugin
5. **Configuration Check**: `isConfigured()` is called to check env vars

### Authentication Flow

1. **User visits sign-in page**: The UI shows buttons for configured providers
2. **Lazy initialization**: `buildAuthOptionsAsync()` waits for plugins if needed
3. **Provider creation**: `createOAuthProvider()` is called with the provider ID
4. **NextAuth handling**: NextAuth handles the OAuth flow with the provider
5. **Session creation**: A database session is created for the authenticated user

### Session Access

All routes use `getServerSession()` from `lib/auth/session.ts`:

```typescript
import { getServerSession } from '@/lib/auth/session';

export async function GET() {
  const session = await getServerSession();

  if (!session?.user?.id) {
    return new Response('Unauthorized', { status: 401 });
  }

  // User is authenticated
  return Response.json({ userId: session.user.id });
}
```

## Built-in Providers

### Google OAuth (qtap-plugin-auth-google)

Reference implementation for OAuth providers:

- **Provider ID**: `google`
- **Required Env Vars**: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- **NextAuth Provider**: `next-auth/providers/google`

## Adding Custom OAuth Providers

For providers not built into NextAuth, create a custom OAuth configuration:

```typescript
// In lib/auth.ts

import type { OAuthConfig } from 'next-auth/providers/oauth';

function createOAuthProvider(providerId: string): OAuthConfig<unknown> | null {
  switch (providerId) {
    case 'custom':
      if (process.env.CUSTOM_CLIENT_ID && process.env.CUSTOM_CLIENT_SECRET) {
        return {
          id: 'custom',
          name: 'Custom Provider',
          type: 'oauth',
          authorization: {
            url: 'https://auth.custom.com/oauth/authorize',
            params: { scope: 'openid email profile' },
          },
          token: 'https://auth.custom.com/oauth/token',
          userinfo: 'https://api.custom.com/userinfo',
          clientId: process.env.CUSTOM_CLIENT_ID,
          clientSecret: process.env.CUSTOM_CLIENT_SECRET,
          profile(profile) {
            return {
              id: profile.sub,
              name: profile.name,
              email: profile.email,
              image: profile.picture,
            };
          },
        };
      }
      return null;

    // ...
  }
}
```

## Best Practices

### 1. Environment Variable Validation

Always validate required environment variables:

```typescript
function isConfigured(): boolean {
  return REQUIRED_ENV_VARS.every(varName => {
    const value = process.env[varName];
    return value && value.length > 0;
  });
}
```

### 2. Provide Detailed Status

Help users troubleshoot configuration issues:

```typescript
function getConfigStatus(): ProviderConfigStatus {
  const missingVars = REQUIRED_ENV_VARS.filter(varName => !process.env[varName]);
  return {
    isConfigured: missingVars.length === 0,
    missingVars,
  };
}
```

### 3. Use Consistent Styling

Follow Quilltap's button conventions:

```json
{
  "buttonColor": "bg-white hover:bg-gray-50 border border-gray-300",
  "buttonTextColor": "text-gray-700"
}
```

### 4. Document Required Setup

In your plugin's README, document:

- How to obtain OAuth credentials from the provider
- Required redirect URI format
- Any provider-specific configuration

## Debugging

Enable debug logging to troubleshoot auth issues:

```bash
LOG_LEVEL=debug npm run dev
```

Look for these log messages:

- `Auth provider registered` - Plugin successfully registered
- `Building authentication providers` - Auth options being built
- `OAuth provider added from plugin` - Provider successfully created

## Common Issues

### Provider Not Appearing

1. Check that `manifest.json` is valid (run build to check)
2. Verify `capabilities` includes `AUTH_METHODS`
3. Check that required env vars are set
4. Look for error logs during startup

### OAuth Callback Errors

1. Verify redirect URI matches exactly in provider console
2. Check `NEXTAUTH_URL` is set correctly
3. Ensure `NEXTAUTH_SECRET` is set

### Session Errors

1. Clear browser cookies and try again
2. Check database session storage (`data/auth/sessions.jsonl`)
3. Verify the adapter is configured correctly

## Directory Structure

```text
plugins/dist/qtap-plugin-auth-myprovider/
├── manifest.json     # Plugin metadata (required)
├── package.json      # NPM package config (required)
├── index.ts          # Main entry point (required)
├── index.js          # Transpiled entry (auto-generated)
└── README.md         # Documentation (recommended)
```

## Checklist

Before releasing your plugin:

- [ ] `manifest.json` has valid `authProviderConfig`
- [ ] `capabilities` includes `AUTH_METHODS`
- [ ] `category` is set to `AUTHENTICATION`
- [ ] Plugin exports `config`, `isConfigured`, `getConfigStatus`
- [ ] Provider mapping added to `lib/auth.ts`
- [ ] Required env vars are documented
- [ ] OAuth redirect URIs are documented
- [ ] Button styling looks appropriate

## See Also

- [Plugin Developer Guide](./README.md) - General plugin development
- [LLM Provider Guide](./LLM-PROVIDER-GUIDE.md) - LLM provider plugins
- [Auth Provider Interface](../lib/plugins/interfaces/auth-provider-plugin.ts) - TypeScript interface
- [Auth Provider Registry](../lib/plugins/auth-provider-registry.ts) - Registration system
- [NextAuth Documentation](https://next-auth.js.org/providers/) - NextAuth provider docs
