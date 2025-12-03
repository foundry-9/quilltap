# Implementation Plan: Authentication & Multi-User Data Management

This plan covers the implementation of authentication improvements and multi-user data management for Quilltap v1.8.

## Overview of Changes

1. **No-Auth Option** - Allow running without authentication via environment variables
2. **Per-User Data Storage** - Move user data to `data/users/[login-uuid]/`
3. **Site-Wide Plugins** - Environment-controlled site-installed plugins in `plugins/`
4. **Per-User Plugins** - User-installed plugins in `plugins/users/[login-uuid]/`
5. **Complete Local Auth** - Finish email/password + TOTP/MFA implementation
6. **Google OAuth Plugin** - Convert hardcoded Google OAuth to plugin architecture

---

## Part 1: No-Auth Mode

### Objective
Allow Quilltap to run without requiring authentication, controlled by environment variables.

### Environment Variables
```env
# Enable no-auth mode (default: false)
AUTH_DISABLED=false

# When AUTH_DISABLED=true, create an anonymous user with this name
AUTH_ANONYMOUS_USER_NAME="Anonymous User"
```

### Implementation Steps

#### 1.1 Create Auth Configuration Module
**File:** `lib/auth/config.ts`
- Export `isAuthDisabled()` function that reads `AUTH_DISABLED` env var
- Export `getAnonymousUserName()` function for default user name
- Add debug logging for auth mode

#### 1.2 Update NextAuth Configuration
**File:** `lib/auth.ts`
- Check `isAuthDisabled()` before configuring providers
- When disabled, skip all providers
- Create/use a single anonymous session automatically

#### 1.3 Create Anonymous User Service
**File:** `lib/auth/anonymous-user.ts`
- Function to get or create the anonymous user
- Store in `data/settings/general.json` with a fixed UUID
- Auto-login on first request when auth is disabled

#### 1.4 Update Middleware
**File:** `middleware.ts` (create if not exists)
- When auth is disabled, auto-inject session for all requests
- Skip authentication checks entirely
- Still protect against CSRF for API routes

#### 1.5 Update .env.example
Add new auth-related environment variables with documentation.

---

## Part 2: Per-User Data Storage

### Current Structure
```
data/
├── auth/
├── settings/general.json     <- Single user
├── characters/               <- Shared
├── chats/                    <- Shared
├── personas/                 <- Shared
└── ...
```

### New Structure
```
data/
├── auth/                     <- Stays global (accounts, sessions)
├── users/
│   └── [user-uuid]/
│       ├── settings.json     <- User settings (was general.json)
│       ├── characters/
│       ├── chats/
│       ├── personas/
│       ├── tags/
│       ├── memories/
│       ├── files/
│       └── vector-indices/
├── settings/
│   └── connection-profiles.json  <- Could stay global or move
```

### Implementation Steps

#### 2.1 Create User Data Path Resolver
**File:** `lib/json-store/user-data-path.ts`
- Function `getUserDataPath(userId: string, subPath?: string): string`
- Handle path construction for user-specific data
- Ensure directory creation on first access
- Add migration flag to detect old vs new layout

#### 2.2 Create Data Migration Utility
**File:** `lib/json-store/migrations/migrate-to-user-dirs.ts`
- Detect existing single-user data in old locations
- Move data to new `data/users/[user-uuid]/` structure
- Update file references and paths
- Create backup before migration
- Log migration progress

#### 2.3 Update JsonStore Core
**File:** `lib/json-store/core/json-store.ts`
- Add `userId` context to all file operations
- Update path resolution to use user directories
- Maintain backward compatibility during migration period

#### 2.4 Update All Repositories
Update each repository to use user-scoped paths:
- `lib/json-store/repositories/users.repository.ts`
- `lib/json-store/repositories/characters.repository.ts`
- `lib/json-store/repositories/chats.repository.ts`
- `lib/json-store/repositories/personas.repository.ts`
- `lib/json-store/repositories/tags.repository.ts`
- `lib/json-store/repositories/files.repository.ts`
- `lib/json-store/repositories/memories.repository.ts`

#### 2.5 Update Auth Adapter
**File:** `lib/json-store/auth-adapter.ts`
- Keep accounts.json and sessions.jsonl at root `data/auth/`
- Create user directory on first login/signup

#### 2.6 Add Startup Migration Check
**File:** `lib/json-store/startup.ts` (or update existing)
- Check if migration is needed
- Run migration automatically or prompt user
- Set flag to indicate migration complete

---

## Part 3: Plugin System Updates

### 3.1 Site-Wide Plugins

#### Environment Variables
```env
# Comma-separated list of site plugins to enable
SITE_PLUGINS_ENABLED=qtap-plugin-openai,qtap-plugin-anthropic,qtap-plugin-google

# Or use "all" to enable all plugins in plugins/dist/
SITE_PLUGINS_ENABLED=all

# Plugins to explicitly disable (overrides SITE_PLUGINS_ENABLED)
SITE_PLUGINS_DISABLED=qtap-plugin-gab-ai
```

#### Implementation
**File:** `lib/plugins/site-plugins.ts`
- Read environment variables for plugin control
- Filter enabled plugins based on config
- Add debug logging for plugin enable/disable decisions

**Update:** `lib/plugins/manifest-loader.ts`
- Check site plugin enable/disable settings when scanning
- Apply environment-based filtering

### 3.2 Per-User Plugins

#### New Directory Structure
```
plugins/
├── dist/                     <- Site-wide plugins (existing)
│   ├── qtap-plugin-openai/
│   └── ...
└── users/
    └── [user-uuid]/
        ├── qtap-plugin-custom/
        └── ...
```

#### Implementation

**File:** `lib/plugins/user-plugins.ts`
- Function to get user plugin directory
- Scan and load user-specific plugins
- Merge with site plugins (user plugins can override)

**Update:** `lib/plugins/manifest-loader.ts`
- Add user-scoped plugin scanning
- Mark plugins with `source: 'site' | 'user'`

**Update:** `lib/plugins/registry.ts`
- Track plugin source (site vs user)
- Allow user to enable/disable plugins
- Store user plugin preferences in user data

---

## Part 4: Complete Local Authentication

### Current State (from LOCAL_USER_AUTH.md)
- Phase 1 (Password Auth): COMPLETED
- Phase 2 (TOTP 2FA): COMPLETED

### Remaining Work

#### 4.1 Fix Backup Codes Persistence
**File:** `lib/auth/totp.ts` (lines 101-103)
- Store encrypted backup codes in user object
- Update remaining codes after use
- Add backup code regeneration endpoint

#### 4.2 Add Password Change Flow
**New Files:**
- `app/api/auth/change-password/route.ts`
- Update `app/(authenticated)/settings/security/page.tsx`

Features:
- Require current password
- Validate new password strength
- Hash and store new password
- Invalidate existing sessions (optional)

#### 4.3 Add Password Reset Flow (Future)
**New Files:**
- `app/api/auth/reset-password/route.ts`
- `app/api/auth/reset-password/confirm/route.ts`
- `app/auth/reset-password/page.tsx`

Note: Requires email sending capability, may be deferred.

#### 4.4 Add Email Verification (Future)
Currently auto-verifying emails. For production:
- Send verification email on signup
- Require verification before full access
- Add resend verification endpoint

---

## Part 5: Google OAuth as Plugin

### Objective
Convert the hardcoded Google OAuth provider to a plugin, enabling:
- Optional installation
- Easy addition of other OAuth providers (Apple, GitHub, etc.)
- Per-installation configuration

### Plugin Structure
```
plugins/dist/qtap-plugin-auth-google/
├── manifest.json
├── package.json
├── index.ts
├── provider.ts           <- NextAuth provider configuration
├── callback-handler.ts   <- OAuth callback handling
└── README.md
```

### Implementation Steps

#### 5.1 Create Auth Provider Plugin Interface
**File:** `lib/plugins/interfaces/auth-provider-plugin.ts`
```typescript
export interface AuthProviderPlugin {
  // Provider identifier
  providerId: string;

  // Display info
  displayName: string;
  icon: string;  // SVG or component name

  // NextAuth provider factory
  createProvider(): AuthProvider;

  // Environment variables required
  requiredEnvVars: string[];

  // Check if configured
  isConfigured(): boolean;
}
```

#### 5.2 Create Auth Provider Registry
**File:** `lib/plugins/auth-provider-registry.ts`
- Register auth provider plugins
- Get configured providers
- Validate provider requirements

#### 5.3 Create Google OAuth Plugin
**Files in** `plugins/dist/qtap-plugin-auth-google/`:

`manifest.json`:
```json
{
  "name": "qtap-plugin-auth-google",
  "title": "Google OAuth",
  "description": "Google OAuth authentication provider",
  "version": "1.0.0",
  "capabilities": ["AUTH_METHODS"],
  "category": "AUTHENTICATION",
  "enabledByDefault": true,
  "authProviderConfig": {
    "providerId": "google",
    "displayName": "Google",
    "requiredEnvVars": ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]
  }
}
```

`provider.ts`:
```typescript
import GoogleProvider from "next-auth/providers/google";

export function createGoogleProvider() {
  return GoogleProvider({
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  });
}
```

#### 5.4 Update NextAuth Configuration
**File:** `lib/auth.ts`
- Import auth provider registry
- Dynamically load providers from plugins
- Keep credentials provider as built-in
- Log which providers are active

#### 5.5 Update Sign-In Page
**File:** `app/auth/signin/page.tsx`
- Query available OAuth providers from registry
- Dynamically render OAuth buttons
- Handle providers that aren't configured gracefully

---

## Implementation Order

### Phase 1: Foundation (Do First)
1. Part 1: No-Auth Mode - Simpler, foundational
2. Part 4.1: Fix backup codes - Bug fix in existing code

### Phase 2: Multi-User Infrastructure
3. Part 2: Per-User Data Storage - Major infrastructure change
4. Part 3: Plugin System Updates - Builds on Part 2

### Phase 3: Auth Improvements
5. Part 4.2-4.4: Complete Local Auth - Can parallel with Phase 2
6. Part 5: Google OAuth Plugin - Depends on Part 3

---

## Testing Strategy

### Unit Tests
- [ ] Auth config (isAuthDisabled, etc.)
- [ ] User data path resolution
- [ ] Plugin enable/disable logic
- [ ] Backup code encryption/decryption

### Integration Tests
- [ ] No-auth mode flow
- [ ] Data migration (old to new structure)
- [ ] User plugin loading
- [ ] OAuth plugin registration

### E2E Tests
- [ ] Anonymous access when auth disabled
- [ ] Multi-user data isolation
- [ ] Plugin enable/disable from UI
- [ ] OAuth flow with plugin

---

## Risk Assessment

### High Risk
- **Data migration**: Moving existing data could cause data loss
  - Mitigation: Backup before migration, dry-run option

- **Breaking changes**: Existing single-user setups
  - Mitigation: Migration path, backward compatibility period

### Medium Risk
- **OAuth plugin**: Changing auth system could lock users out
  - Mitigation: Keep credentials provider as fallback, thorough testing

### Low Risk
- **No-auth mode**: Additive feature
- **Backup code fix**: Contained change

---

## Environment Variables Summary

```env
# No-Auth Mode
AUTH_DISABLED=false
AUTH_ANONYMOUS_USER_NAME="Anonymous User"

# Site Plugin Control
SITE_PLUGINS_ENABLED=all
SITE_PLUGINS_DISABLED=

# OAuth (move to plugin but keep for compatibility)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

---

## Files to Create/Modify

### New Files
- `lib/auth/config.ts`
- `lib/auth/anonymous-user.ts`
- `middleware.ts`
- `lib/json-store/user-data-path.ts`
- `lib/json-store/migrations/migrate-to-user-dirs.ts`
- `lib/plugins/site-plugins.ts`
- `lib/plugins/user-plugins.ts`
- `lib/plugins/interfaces/auth-provider-plugin.ts`
- `lib/plugins/auth-provider-registry.ts`
- `plugins/dist/qtap-plugin-auth-google/` (full plugin)
- `app/api/auth/change-password/route.ts`

### Modified Files
- `lib/auth.ts`
- `lib/json-store/core/json-store.ts`
- `lib/json-store/auth-adapter.ts`
- All repository files in `lib/json-store/repositories/`
- `lib/plugins/manifest-loader.ts`
- `lib/plugins/registry.ts`
- `app/auth/signin/page.tsx`
- `app/(authenticated)/settings/security/page.tsx`
- `.env.example`

---

## Success Criteria

1. **No-Auth Mode**: Can start app with `AUTH_DISABLED=true` and use all features without login
2. **Per-User Data**: Multiple users can have separate data that doesn't interfere
3. **Site Plugins**: Admin can control which plugins are available site-wide
4. **User Plugins**: Users can install their own plugins (future: UI for this)
5. **Local Auth Complete**: Backup codes work, password change works
6. **OAuth Plugin**: Google OAuth works as a plugin, easy to add more providers

---

## Questions for Clarification

Before proceeding, please confirm:

1. **Migration Strategy**: Should the data migration be automatic on startup, or require manual trigger?

2. **Multi-User Scope**: Is this for self-hosted multi-user, or primarily for better data organization with single user first?

3. **OAuth Priority**: Should we prioritize making Google OAuth work as a plugin, or focus on local auth completion first?

4. **Plugin UI**: Should user plugin installation have a UI in v1.8, or is command-line installation acceptable for now?
