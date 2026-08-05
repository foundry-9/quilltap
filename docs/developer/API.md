# Quilltap API Documentation

API reference for Quilltap v4.3 and later.

> **Freshness note (v4.3-dev):** The Scriptorium / Document Mode work, the Salon Staff (Librarian, Host, Concierge, Aurora, Lantern, Prospero) announcement system, and the Ariel terminal subsystem landed during 4.3-dev. The chat-actions list, the LLM-tools list, the terminals endpoints, and the message schema below reflect those changes; older subsections may still describe earlier shapes verbatim. When in doubt, the source of truth is `app/api/v1/`, `lib/schemas/`, and `lib/tools/`. Notable additions since v4.2:
>
> - **Mount Points** (`/api/v1/mount-points`) — Scriptorium document-store CRUD, files/folders/blobs operations, scan/convert/deconvert actions, and per-project linking
> - **Terminals** (`/api/v1/terminals`) — Ariel PTY session spawn, list, signal, write, and ring-buffer access
> - **Chat actions overhaul** — handlers under `app/api/v1/chats/[id]/actions/` were consolidated; current action set: `agent-mode`, `announcement`, `announcement-preview`, `avatars`, `bulk`, `danger-classification`, `documents`, `mailbox`, `memories`, `merge`, `outfit`, `participants`, `photo-albums`, `regenerate-avatar`, `render-conversation`, `rng`, `run-tool`, `send-mail`, `state`, `story-background`, `tags`, `title`, `toggle-avatar-generation`, `tools`, `turn`
> - **New built-in LLM tools** — `doc_*` family (read/write/grep/list/move/copy/str_replace/focus/open/close/insert_text/update_heading/read_heading/read_frontmatter/update_frontmatter/create_folder/delete_folder/delete_file, plus blob variants), `self_inventory`, `state`, `whisper`, `read_conversation`, `submit_final_response`, `upsert_annotation`, `delete_annotation`, and the `wardrobe_*` family (`wardrobe_list`/`wardrobe_read`/`wardrobe_wear`/`wardrobe_take_off`/`wardrobe_create`/`wardrobe_update`/`wardrobe_archive`). The unified search tool is now named `search` (was `search_memories`).
> - **Retired tools** — `file_management` and the file-write-permission infrastructure are gone; many `project_info` actions were trimmed.
> - **`systemSender` enum on messages** — `lantern`, `aurora`, `librarian`, `concierge`, `prospero`, `host`, `commonplaceBook`, `ariel`, `carina`, `suparna`. See `lib/schemas/chat.types.ts`.
> - **`systemTransparency` on characters** — per-character covenant toggle.
>
> **Freshness note (v4.7-dev):** Additions since v4.3:
>
> - **Brahma Console** (`/api/v1/brahma-console`) — a character-less, memory-free generic-LLM surface with its own collection/item/messages endpoints (see [Brahma Console](#brahma-console)).
> - **The Post Office** — inter-character mail. Two new chat actions: `POST /api/v1/chats/[id]?action=send-mail` (post a letter as a player-character) and `GET /api/v1/chats/[id]?action=mailbox&characterId=…` (list a player-character's mailbox). New LLM tools `send_mail` and `list_email`; deliveries are announced by the `suparna` Staff sender.
> - **Carina** — inline LLM queries via `@Name:` / `@Name?` markup and the `ask_carina` tool; answers post as `systemSender: 'carina'` rendered with the answerer's own avatar. `@Brahma` reaches the Brahma Console as a Carina answerer.
> - **New `systemSender` values** — `carina` (inline-query answers) and `suparna` (Post Office mail-delivery announcements).
> - **Scriptorium per-document policy flags** — mounted markdown may carry `embed` / `character_read` / `character_write` frontmatter flags (stored on `doc_mount_file_links`), governing characters only.

## Table of Contents

- [API Versioning](#api-versioning)
- [Authentication](#authentication)
- [Rate Limiting](#rate-limiting)
- [Error Handling](#error-handling)
- [Providers](#providers)
- [Endpoints](#endpoints)
  - [Providers (Endpoint)](#providers-endpoint)
  - [Health](#health)
  - [Session](#session-endpoint)
  - [User Profile](#user-profile)
  - [Chat Settings](#chat-settings)
  - [Text Replacement Rules](#text-replacement-rules)
  - [API Keys](#api-keys)
  - [Connection Profiles](#connection-profiles)
  - [Embedding Profiles](#embedding-profiles)
  - [Image Profiles](#image-profiles)
  - [Models](#models)
  - [Model Classes](#model-classes)
  - [Characters](#characters)
  - [Character System Prompts](#character-system-prompts)
  - [Character Scenarios](#character-scenarios)
  - [Character Plugin Data](#character-plugin-data)
  - [NPCs](#npcs)
  - [Wardrobe (Archetypes)](#wardrobe-archetypes)
  - [Character Wardrobe](#character-wardrobe)
  - [Outfit Presets](#outfit-presets)
  - [Character Photos](#character-photos)
  - [Chats](#chats)
  - [Brahma Console](#brahma-console)
  - [Chat Announcements](#chat-announcements)
  - [Chat Photo Albums](#chat-photo-albums)
  - [Photo Gallery](#photo-gallery)
  - [Chat Files](#chat-files)
  - [Chat File Operations](#chat-file-operations)
  - [Chat qtap:// Target](#chat-qtap-target)
  - [Chat Messages (Send & Stream)](#chat-messages-send--stream)
  - [Messages](#messages)
  - [Memories](#memories)
  - [Tags](#tags)
  - [Files](#files)
  - [Folders](#folders)
  - [Prompt Templates](#prompt-templates)
  - [Roleplay Templates](#roleplay-templates)
  - [Images](#images)
  - [Mount Points (Scriptorium)](#mount-points-scriptorium)
  - [Documents (Standalone Document Mode)](#documents-standalone-document-mode)
  - [Terminals (Ariel)](#terminals-ariel)
  - [System Backup & Restore](#system-backup--restore)
  - [System Data Directory](#system-data-directory)
  - [System Unlock](#system-unlock)
  - [System Migration Warnings](#system-migration-warnings)
  - [LLM Logs](#llm-logs)
  - [Theme Assets & Fonts](#theme-assets--fonts)
  - [Themes (v1)](#themes-v1)
  - [Search](#search)
  - [Search & Replace](#search--replace)
  - [Background Jobs](#background-jobs)
  - [LLM Tools](#llm-tools)
  - [Plugins (v1)](#plugins-v1)
  - [Projects](#projects)
  - [Groups](#groups)
  - [Scenarios](#scenarios)
  - [Help Docs](#help-docs)
  - [Help Chats](#help-chats)
  - [System Deployment](#system-deployment)
  - [System Home](#system-home)
  - [System Autonomous Rooms](#system-autonomous-rooms)
  - [System Browse Directory](#system-browse-directory)
  - [System Conversation Summaries](#system-conversation-summaries)
  - [System Image Aesthetics](#system-image-aesthetics)
  - [System Startup Status](#system-startup-status)
  - [System Plugin Initialization](#system-plugin-initialization)
  - [System Plugin Upgrades](#system-plugin-upgrades)
  - [System Pepper Vault (Deprecated)](#system-pepper-vault-deprecated)
  - [File Proxy](#file-proxy)

## API Versioning

As of v2.7+, all core API endpoints use the `/api/v1/` prefix. This enables future versioning as the API evolves.

### Route Structure

The API follows a clean REST pattern:
- **Collection endpoints**: `/api/v1/[entity]` (GET list, POST create)
- **Individual endpoints**: `/api/v1/[entity]/[id]` (GET, PUT, DELETE)
- **Actions via query param**: `POST /api/v1/[entity]/[id]?action=name`

### Action Parameters

Non-CRUD operations use the `?action=` query parameter:

```
POST /api/v1/characters/[id]?action=favorite  # Toggle favorite
POST /api/v1/chats/[id]?action=regenerate-title  # Regenerate title
GET /api/v1/characters/[id]?action=export  # Export character
```

### Legacy Routes Removed

As of v2.8, legacy routes (without `/v1/` prefix) have been removed. Only `/api/v1/` routes are supported.

A few non-v1 routes remain for specific purposes:
- `/api/health` - Health check endpoint
- `/api/plugin-routes/[...path]` - Plugin route dispatcher
- `/api/themes/*` - Theme asset serving

## Authentication

Quilltap operates in **single-user mode**. All API endpoints automatically use the single local user account - no login is required.

### Session Endpoint

#### `GET /api/v1/session`

Returns the current user session.

**Response**: `200 OK`

```json
{
  "user": {
    "id": "ffffffff-ffff-ffff-ffff-ffffffffffff",
    "email": "user@localhost.localdomain",
    "name": "Local User"
  },
  "expires": "2025-02-19T10:00:00.000Z"
}
```

### Including Credentials

For consistency, include credentials in requests:

```javascript
fetch('/api/characters', {
  credentials: 'include',
  headers: {
    'Content-Type': 'application/json',
  },
});
```

## Rate Limiting

Rate limits are enforced on all endpoints:

| Endpoint Type | Limit | Window |
|--------------|-------|--------|
| Chat streaming | 20 messages | 60 seconds |
| API endpoints | 100 requests | 10 seconds |
| General | 100 requests | 60 seconds |

### Rate Limit Headers

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1642584000
```

### Rate Limit Exceeded Response

```json
{
  "error": "Too many requests",
  "message": "Rate limit exceeded. Please try again later."
}
```

Status code: `429 Too Many Requests`

## Error Handling

### Error Response Format

```json
{
  "error": "Error Type",
  "message": "Human-readable error message",
  "details": {}
}
```

### Common HTTP Status Codes

- `200` - Success
- `201` - Created
- `400` - Bad Request
- `401` - Unauthorized
- `403` - Forbidden
- `404` - Not Found
- `429` - Too Many Requests
- `500` - Internal Server Error
- `503` - Service Unavailable

## Providers

Quilltap uses a plugin-based provider system. Available providers depend on which plugins are enabled via `SITE_PLUGINS_ENABLED`:

| Provider ID | Plugin | Capabilities |
|-------------|--------|--------------|
| `OPENAI` | qtap-plugin-openai | Chat, embeddings, image generation, tool calling |
| `ANTHROPIC` | qtap-plugin-anthropic | Chat, image understanding, tool calling, prompt caching |
| `GOOGLE` | qtap-plugin-google | Chat, image generation (Imagen 4), multimodal inputs |
| `GROK` | qtap-plugin-grok | Chat, image generation, web search, multimodal |
| `OLLAMA` | qtap-plugin-ollama | Chat, embeddings (local models) |
| `OPENROUTER` | qtap-plugin-openrouter | Chat, embeddings, image generation (200+ models) |
| `OPENAI_COMPATIBLE` | qtap-plugin-openai-compatible | Chat (any OpenAI-format API) |

## Endpoints

### Providers (Endpoint)

#### `GET /api/v1/providers`

List all available providers, including both LLM providers and search providers. The response combines both provider types into a single list, distinguished by the `type` field.

**Response**: `200 OK`

```json
{
  "providers": [
    {
      "id": "OPENAI",
      "name": "OPENAI",
      "displayName": "OpenAI",
      "description": "OpenAI LLM and image generation provider",
      "abbreviation": "OAI",
      "colors": {
        "bg": "bg-green-100",
        "text": "text-green-800",
        "icon": "text-green-600"
      },
      "type": "llm",
      "capabilities": {
        "chat": true,
        "embeddings": true,
        "imageGeneration": true,
        "toolCalling": true
      },
      "configRequirements": {
        "requiresApiKey": true,
        "requiresBaseUrl": false
      }
    },
    {
      "id": "SERPER",
      "name": "SERPER",
      "displayName": "Serper Web Search",
      "description": "Google search results via the Serper.dev API",
      "abbreviation": "SRP",
      "colors": {
        "bg": "bg-orange-100",
        "text": "text-orange-800",
        "icon": "text-orange-600"
      },
      "type": "search",
      "configRequirements": {
        "requiresApiKey": true,
        "requiresBaseUrl": false,
        "apiKeyLabel": "Serper API Key"
      }
    }
  ],
  "count": 2
}
```

**Provider Types:**

| Type | Description |
|------|-------------|
| `llm` | LLM providers for chat, embeddings, and image generation. Include `capabilities` describing supported features. |
| `search` | Search providers that power the `search_web` tool. Include `configRequirements` with `requiresApiKey`, `requiresBaseUrl`, and `apiKeyLabel`. |

---

### Health

#### `GET /api/health`

Check application health status.

**Authentication**: Not required

**Response**: `200 OK`

```json
{
  "status": "healthy",
  "timestamp": "2025-01-19T12:00:00.000Z",
  "uptime": 86400,
  "environment": "production",
  "database": "connected"
}
```

---

### User Profile

#### `GET /api/v1/user/profile`

Get current user's profile information.

**Response**: `200 OK`

```json
{
  "id": "user-uuid",
  "username": "localUser",
  "email": "user@localhost.localdomain",
  "name": "Local User",
  "image": "/api/v1/files/avatar-uuid",
  "createdAt": "2025-01-15T12:00:00.000Z",
  "updatedAt": "2025-01-19T10:00:00.000Z"
}
```

#### `PUT /api/v1/user/profile`

Update current user's profile.

**Request Body**:

```json
{
  "email": "newemail@example.com",
  "name": "New Name"
}
```

**Response**: `200 OK`

Returns updated profile (same format as GET).

#### `PATCH /api/v1/user/profile/avatar`

Set or clear user's profile avatar.

**Request Body**:

```json
{
  "imageId": "file-uuid-from-file-manager"
}
```

To clear avatar, set `imageId` to `null`.

**Response**: `200 OK`

Returns updated profile with avatar URL.

---

### Chat Settings

User-specific chat and UI settings.

#### `GET /api/v1/settings/chat`

Get chat settings for the current user.

**Response**: `200 OK`

```json
{
  "avatarDisplayMode": "ALWAYS",
  "avatarDisplayStyle": "CIRCULAR",
  "tagStyles": {},
  "cheapLLMSettings": {
    "strategy": "PROVIDER_CHEAPEST",
    "fallbackToLocal": true,
    "embeddingProvider": "OPENAI"
  },
  "imageDescriptionProfileId": null,
  "themePreference": {
    "activeThemeId": null,
    "colorMode": "system",
    "showNavThemeSelector": false
  },
  "defaultRoleplayTemplateId": null,
  "sidebarWidth": 320,
  "tokenDisplaySettings": {},
  "memoryCascadePreferences": {},
  "llmLoggingSettings": {},
  "autoDetectRng": true
}
```

#### `PUT /api/v1/settings/chat`

Update chat settings.

**Request Body** (all fields optional):

```json
{
  "avatarDisplayMode": "ALWAYS" | "GROUP_ONLY" | "NEVER",
  "avatarDisplayStyle": "CIRCULAR" | "RECTANGULAR",
  "tagStyles": {},
  "cheapLLMSettings": {
    "strategy": "USER_DEFINED" | "PROVIDER_CHEAPEST" | "LOCAL_FIRST",
    "fallbackToLocal": true,
    "embeddingProvider": "SAME_PROVIDER" | "OPENAI" | "LOCAL"
  },
  "imageDescriptionProfileId": "profile-uuid" | null,
  "themePreference": {
    "activeThemeId": "theme-id" | null,
    "colorMode": "light" | "dark" | "system"
  },
  "defaultRoleplayTemplateId": "template-uuid" | null,
  "sidebarWidth": 320,
  "memoryCascadePreferences": {
    "onMessageDelete": "DELETE_MEMORIES" | "KEEP_MEMORIES" | "ASK_EVERY_TIME",
    "onSwipeRegenerate": "DELETE_MEMORIES" | "KEEP_MEMORIES" | "REGENERATE_MEMORIES"
  },
  "llmLoggingSettings": {},
  "autoDetectRng": true
}
```

#### `GET /api/v1/settings/data-retention`

Read the instance-wide stale-chat retention window (`instance_settings['dataRetention']`, not a `chat_settings` column). Governs the daily maintenance sweep's cache collapse, generated-image collapse, and conversation-chunk cold-tiering.

**Response:**

```json
{
  "staleChatDays": 30
}
```

#### `PUT /api/v1/settings/data-retention`

Update the retention window. Merges with the current value and validates (integer, 1–3650 days).

**Request Body:**

```json
{
  "staleChatDays": 90
}
```

---

### Text Replacement Rules

Global, literal-string, word-boundary text replacements applied by the Lexical composer plugin on typed input. Rules are not user-scoped.

#### `GET /api/v1/settings/text-replacements`

List all replacement rules.

#### `POST /api/v1/settings/text-replacements`

Create a new rule.

#### `POST /api/v1/settings/text-replacements?action=bulk-replace`

Replace the entire rule list in one call.

#### `PATCH /api/v1/settings/text-replacements/[id]`

Update a single rule.

#### `DELETE /api/v1/settings/text-replacements/[id]`

Delete a single rule.

---

### API Keys

#### `GET /api/v1/api-keys`

List all API keys for authenticated user.

**Response**: `200 OK`

```json
{
  "apiKeys": [
    {
      "id": "key-uuid",
      "provider": "OPENAI",
      "label": "My OpenAI Key",
      "keyMasked": "sk-...1234",
      "isActive": true,
      "lastUsed": "2025-01-19T10:00:00.000Z",
      "createdAt": "2025-01-15T12:00:00.000Z"
    }
  ],
  "count": 1
}
```

#### `POST /api/v1/api-keys`

Create a new API key.

**Request Body**:

```json
{
  "provider": "OPENAI",
  "label": "My OpenAI Key",
  "apiKey": "sk-..."
}
```

**Validation**:
- `provider`: Required, provider ID from enabled plugins
- `label`: Required, 1-100 characters
- `apiKey`: Required, will be encrypted with AES-256-GCM

**Response**: `201 Created`

#### `GET /api/v1/api-keys/[id]`

Get a specific API key (masked).

#### `PUT /api/v1/api-keys/[id]`

Update an API key's label or active status.

#### `DELETE /api/v1/api-keys/[id]`

Delete an API key.

#### `POST /api/v1/api-keys/[id]?action=test`

Test an API key connection with the provider. Supports both LLM providers and search providers -- the endpoint automatically detects the provider type from the key's associated provider and routes the validation accordingly. For LLM providers, it calls the provider's `validateApiKey` method. For search providers, it calls the search provider's `validateApiKey` method (e.g., making a minimal test query to the search API).

**Request Body** (optional):

```json
{
  "baseUrl": "https://custom-endpoint.example.com"
}
```

**Response (valid)**: `200 OK`

```json
{
  "valid": true,
  "provider": "OPENAI",
  "message": "API key is valid"
}
```

**Response (invalid)**: `400 Bad Request`

```json
{
  "valid": false,
  "provider": "SERPER",
  "error": "API key validation failed"
}
```

#### `POST /api/v1/api-keys?action=auto-associate`

Auto-associate API keys with connection profiles based on provider.

#### `POST /api/v1/api-keys?action=export`

Export all API keys (encrypted bundle for backup/transfer).

#### `POST /api/v1/api-keys?action=import`

Import API keys from an encrypted bundle.

#### `POST /api/v1/api-keys?action=import-preview`

Preview what keys would be imported without applying changes.

---

### Connection Profiles

#### `GET /api/v1/connection-profiles`

List all LLM connection profiles.

**Query Parameters**:
- `sortByCharacter` - Sort profiles by matching tags with character
- `imageCapable=true` - Filter to image-capable providers only

**Response**: `200 OK`

```json
{
  "profiles": [
    {
      "id": "profile-uuid",
      "name": "GPT-4 Profile",
      "provider": "OPENAI",
      "apiKeyId": "key-uuid",
      "modelName": "gpt-4o",
      "parameters": {
        "temperature": 0.7,
        "max_tokens": 4096
      },
      "isDefault": true,
      "isCheap": false,
      "allowWebSearch": false,
      "useNativeWebSearch": false,
      "apiKey": {
        "id": "key-uuid",
        "label": "My OpenAI Key",
        "provider": "OPENAI",
        "isActive": true
      },
      "tags": [],
      "createdAt": "2025-01-15T12:00:00.000Z"
    }
  ],
  "count": 1
}
```

#### `POST /api/v1/connection-profiles`

Create a connection profile.

**Request Body**:

```json
{
  "name": "Claude Profile",
  "provider": "ANTHROPIC",
  "apiKeyId": "key-uuid",
  "modelName": "claude-sonnet-4-20250514",
  "parameters": {
    "temperature": 0.7,
    "max_tokens": 4096
  },
  "isDefault": false,
  "isCheap": false,
  "allowWebSearch": false,
  "useNativeWebSearch": false
}
```

#### `GET /api/v1/connection-profiles/[id]`

Get a specific profile.

#### `PUT /api/v1/connection-profiles/[id]`

Update a profile.

#### `DELETE /api/v1/connection-profiles/[id]`

Delete a profile.

#### `POST /api/v1/connection-profiles?action=test-connection`

Test a profile connection.

**Request Body**:

```json
{
  "provider": "OPENAI",
  "apiKeyId": "key-uuid",
  "baseUrl": "https://api.openai.com/v1"
}
```

#### `POST /api/v1/connection-profiles?action=test-message`

Send a test message using a profile.

**Request Body**:

```json
{
  "provider": "OPENAI",
  "apiKeyId": "key-uuid",
  "baseUrl": "https://api.openai.com/v1",
  "modelName": "gpt-4o",
  "parameters": {
    "temperature": 0.7,
    "max_tokens": 50
  }
}
```

#### `POST /api/v1/connection-profiles?action=reorder`

Bulk-update profile sort indices for custom ordering.

**Request Body**:

```json
{
  "order": [
    { "id": "profile-uuid-1", "sortIndex": 0 },
    { "id": "profile-uuid-2", "sortIndex": 1 },
    { "id": "profile-uuid-3", "sortIndex": 2 }
  ]
}
```

#### `POST /api/v1/connection-profiles?action=reset-sort`

Reset all profile sort indices to the default algorithm: default profile first, then non-cheap profiles alphabetically, then cheap profiles alphabetically.

**Request Body**: `{}`

---

### Embedding Profiles

#### `GET /api/v1/embedding-profiles`

List embedding profiles.

#### `POST /api/v1/embedding-profiles`

Create an embedding profile.

**Supported Providers**: `OPENAI`, `OLLAMA`, `OPENROUTER`

#### `GET /api/v1/embedding-profiles/[id]`

Get a specific embedding profile.

#### `PUT /api/v1/embedding-profiles/[id]`

Update an embedding profile. When the update changes what the default profile produces — the profile *becomes* the default, or a default profile's provider/model/dimensions change — all embeddings are invalidated and a full `EMBEDDING_REINDEX_ALL` is enqueued automatically (BUILTIN goes through refit). Changing only `truncateToDimensions` enqueues the local Matryoshka re-apply when narrowing, the full reindex when widening. The response's `reembeddingTriggered` flag reports whether any re-embed was queued.

#### `DELETE /api/v1/embedding-profiles/[id]`

Delete an embedding profile.

#### `GET /api/v1/embedding-profiles/models`

Get available embedding models for a provider.

---

### Image Profiles

#### `GET /api/v1/image-profiles`

List image generation profiles.

#### `POST /api/v1/image-profiles`

Create an image profile.

**Request Body**:

```json
{
  "name": "DALL-E Profile",
  "provider": "OPENAI",
  "apiKeyId": "key-uuid",
  "modelName": "gpt-image-1",
  "parameters": {
    "size": "1024x1024",
    "quality": "hd"
  },
  "isDefault": false
}
```

#### `GET /api/v1/image-profiles?action=list-providers`

List available image generation providers from the plugin registry.

**Response**:

```json
{
  "providers": [
    {
      "value": "OPENAI",
      "label": "OpenAI (DALL-E / GPT Image)",
      "defaultModels": ["gpt-image-1", "dall-e-3", "dall-e-2"],
      "apiKeyProvider": "OPENAI"
    },
    {
      "value": "ETERNAL_AI",
      "label": "Eternal AI",
      "defaultModels": ["black-forest-labs/FLUX.1-dev", "black-forest-labs/FLUX.1-schnell"],
      "apiKeyProvider": "ETERNAL_AI"
    }
  ],
  "count": 2
}
```

#### `GET /api/v1/image-profiles?action=list-models`

Get available image generation models for a provider.

**Query Parameters**:
- `provider` (required) - Provider name (e.g., "OPENAI", "ETERNAL_AI")
- `apiKeyId` - API key ID to fetch models dynamically (optional)

**Response**:

```json
{
  "provider": "OPENAI",
  "models": ["gpt-image-1", "dall-e-3", "dall-e-2"],
  "supportedModels": ["gpt-image-1", "dall-e-3", "dall-e-2"]
}
```

#### `POST /api/v1/image-profiles?action=validate-key`

Validate an API key for image generation.

**Request Body**:

```json
{
  "provider": "OPENAI",
  "apiKeyId": "key-uuid"
}
```

**Response**:

```json
{
  "valid": true,
  "message": "API key is valid",
  "modelCount": 3
}
```

#### `GET /api/v1/image-profiles/[id]`

Get a specific image profile.

#### `PUT /api/v1/image-profiles/[id]`

Update an image profile.

#### `DELETE /api/v1/image-profiles/[id]`

Delete an image profile.

---

### Models

Retrieve available LLM models from providers.

#### `GET /api/v1/models`

List cached models from the database.

**Query Parameters**:
- `provider` - Filter by provider (e.g., `openai`, `anthropic`)
- `hasVision` - Filter to vision-capable models (`true`)
- `hasStreaming` - Filter to streaming-capable models (`true`)

**Response**: `200 OK`

```json
{
  "models": [
    {
      "id": "model-uuid",
      "provider": "OPENAI",
      "modelId": "gpt-4o",
      "displayName": "GPT-4o",
      "contextWindow": 128000,
      "maxOutputTokens": 4096,
      "deprecated": false,
      "experimental": false
    }
  ],
  "count": 25,
  "filters": {
    "provider": "openai",
    "hasVision": false,
    "hasStreaming": false
  },
  "cached": true
}
```

#### `POST /api/v1/models`

Fetch models directly from a provider (live query, not cached).

**Request Body**:

```json
{
  "provider": "OPENAI",
  "apiKeyId": "key-uuid",
  "baseUrl": "https://api.openai.com/v1"
}
```

**Response**: `200 OK`

```json
{
  "provider": "OPENAI",
  "models": ["gpt-4o", "gpt-4-turbo", "gpt-3.5-turbo"],
  "modelsWithInfo": [
    {
      "id": "gpt-4o",
      "displayName": "GPT-4o",
      "deprecated": false,
      "experimental": false,
      "maxOutputTokens": 4096,
      "contextWindow": 128000
    }
  ],
  "count": 3
}
```

---

### Model Classes

#### `GET /api/v1/model-classes`

List all available model class definitions. Model classes define categories of models (e.g., "budget", "standard", "premium") with associated capabilities and pricing tiers.

**Response**: `200 OK`

```json
{
  "modelClasses": [...],
  "count": 5
}
```

---

### Characters

#### `GET /api/v1/characters`

List all characters.

**Query Parameters**:
- `npc=true|false` - Filter by NPC status (omit for regular characters)
- `controlledBy=llm|user` - Filter by control mode (LLM-controlled or user-controlled)
- `tagId` - Filter by tag

**Response**: `200 OK`

```json
{
  "characters": [
    {
      "id": "char-uuid",
      "name": "Alice",
      "title": "The Curious",
      "description": "A friendly AI assistant",
      "controlledBy": "llm",
      "npc": false,
      "isFavorite": true,
      "defaultImage": {
        "id": "file-uuid",
        "filepath": "/api/v1/files/file-uuid",
        "url": null
      },
      "_count": {
        "chats": 5
      },
      "createdAt": "2025-01-15T12:00:00.000Z"
    }
  ],
  "count": 1
}
```

#### `POST /api/v1/characters`

Create a character.

**Request Body**:

```json
{
  "name": "Alice",
  "title": "The Curious",
  "description": "A friendly AI assistant",
  "personality": "Helpful and kind",
  "scenario": "You're chatting with Alice",
  "firstMessage": "Hello! How can I help?",
  "exampleDialogues": "<START>\nUser: Hi\nAlice: Hello!\n<END>",
  "controlledBy": "llm",
  "systemPrompts": [
    {
      "name": "Default",
      "content": "You are Alice, a helpful assistant.",
      "isActive": true,
      "isDefault": true
    }
  ]
}
```

**Note**: Set `controlledBy` to `"user"` for user-controlled characters (replaces the legacy persona system).

#### `POST /api/v1/characters?action=import`

Import a SillyTavern character (JSON format only).

**Request**: `multipart/form-data`

```
file: <character.json>
```

**Note**: PNG character card format (JSON embedded in PNG) is not supported. Use JSON export format.

#### `POST /api/v1/characters?action=ai-wizard`

Use AI to generate character details from a brief description.

#### `POST /api/v1/characters?action=quick-create`

Quick-create a minimal character.

#### `GET /api/v1/characters/[id]`

Get a character with enriched data.

**Response**: `200 OK`

```json
{
  "character": {
    "id": "char-uuid",
    "name": "Alice",
    "defaultImage": {
      "id": "file-uuid",
      "filepath": "/api/v1/files/file-uuid",
      "url": null
    },
    "_count": {
      "chats": 5
    }
  }
}
```

#### `PUT /api/v1/characters/[id]`

Update a character.

#### `DELETE /api/v1/characters/[id]`

Delete a character.

**Query Parameters**:
- `cascadeChats=true` - Also delete exclusive chats
- `cascadeImages=true` - Also delete exclusive images

#### `GET /api/v1/characters/[id]?action=export`

Export character in SillyTavern-compatible format.

**Query Parameters**:
- `format=json|png` - Export format (JSON for data, PNG for character card image)

#### `POST /api/v1/characters/[id]?action=favorite`

Toggle character favorite status.

#### `POST /api/v1/characters/[id]?action=avatar`

Set or clear character avatar.

**Request Body**:

```json
{
  "imageId": "file-uuid"
}
```

To clear avatar, set `imageId` to `null`.

#### `POST /api/v1/characters/[id]?action=add-tag`

Add a tag to a character.

**Request Body**:

```json
{
  "tagId": "tag-uuid"
}
```

#### `POST /api/v1/characters/[id]?action=remove-tag`

Remove a tag from a character.

**Request Body**:

```json
{
  "tagId": "tag-uuid"
}
```

---

#### Character Plugin Data

Per-character per-plugin JSON metadata storage. Plugins can store arbitrary JSON data scoped to individual characters.

##### `GET /api/v1/characters/[id]/plugin-data`

Get all plugin data for a character.

**Response**: `200 OK`

```json
{
  "pluginData": {
    "my-plugin": { "key": "value" },
    "another-plugin": { "setting": true }
  }
}
```

##### `POST /api/v1/characters/[id]/plugin-data`

Create or upsert plugin data for a character.

**Request Body**:

```json
{
  "pluginName": "my-plugin",
  "data": { "key": "value" }
}
```

**Response**: `201 Created`

```json
{
  "pluginData": {
    "id": "uuid",
    "characterId": "char-uuid",
    "pluginName": "my-plugin",
    "data": { "key": "value" }
  }
}
```

##### `GET /api/v1/characters/[id]/plugin-data/[pluginName]`

Get plugin data for a specific plugin.

**Response**: `200 OK`

```json
{
  "pluginData": {
    "id": "uuid",
    "characterId": "char-uuid",
    "pluginName": "my-plugin",
    "data": { "key": "value" }
  }
}
```

##### `PUT /api/v1/characters/[id]/plugin-data/[pluginName]`

Replace entire plugin data object.

**Request Body**: Any valid JSON value.

**Response**: `200 OK` with updated plugin data object.

##### `DELETE /api/v1/characters/[id]/plugin-data/[pluginName]`

Delete plugin data for a specific plugin.

**Response**: `200 OK`

```json
{
  "success": true
}
```

---

### Character System Prompts

System prompts are named prompt templates stored on a character, used to configure LLM behavior.

#### `GET /api/v1/characters/[id]/prompts`

Get all system prompts for a character.

**Response**: `200 OK`

```json
{
  "prompts": [
    {
      "id": "prompt-uuid",
      "name": "Default",
      "content": "You are Alice, a helpful assistant.",
      "isDefault": true
    }
  ]
}
```

#### `POST /api/v1/characters/[id]/prompts`

Add a new system prompt to a character.

**Request Body**:

```json
{
  "name": "Custom Prompt",
  "content": "You are Alice, speaking formally.",
  "isDefault": false
}
```

**Validation**:
- `name`: Required, 1-100 characters
- `content`: Required, min 1 character
- `isDefault`: Optional boolean (defaults to false)

**Response**: `201 Created`

```json
{
  "prompt": { ... }
}
```

#### `GET /api/v1/characters/[id]/prompts/[promptId]`

Get a specific system prompt.

**Response**: `200 OK`

```json
{
  "prompt": { ... }
}
```

#### `PUT /api/v1/characters/[id]/prompts/[promptId]`

Update a system prompt. All fields are optional.

**Request Body**:

```json
{
  "name": "Updated Name",
  "content": "Updated content",
  "isDefault": true
}
```

**Response**: `200 OK`

```json
{
  "prompt": { ... }
}
```

#### `DELETE /api/v1/characters/[id]/prompts/[promptId]`

Delete a system prompt.

**Response**: `200 OK`

```json
{
  "success": true
}
```

---

### Character Scenarios

Scenarios are named narrative contexts that can be selected when starting a chat with a character.

#### `GET /api/v1/characters/[id]/scenarios`

Get all scenarios for a character.

**Response**: `200 OK`

```json
{
  "scenarios": [
    {
      "id": "scenario-uuid",
      "title": "Coffee Shop Meeting",
      "content": "You meet in a quiet coffee shop..."
    }
  ]
}
```

#### `POST /api/v1/characters/[id]/scenarios`

Add a new scenario.

**Request Body**:

```json
{
  "title": "Coffee Shop Meeting",
  "content": "You meet in a quiet coffee shop..."
}
```

**Validation**:
- `title`: Required, 1-200 characters
- `content`: Required, min 1 character

**Response**: `201 Created`

```json
{
  "scenario": { ... }
}
```

#### `PUT /api/v1/characters/[id]/scenarios?scenarioId=xxx`

Update a scenario. Requires `scenarioId` query parameter.

**Request Body**:

```json
{
  "title": "Updated Title",
  "content": "Updated content"
}
```

**Response**: `200 OK`

```json
{
  "scenario": { ... }
}
```

#### `DELETE /api/v1/characters/[id]/scenarios?scenarioId=xxx`

Remove a scenario. Requires `scenarioId` query parameter.

**Response**: `200 OK`

```json
{
  "message": "Scenario removed"
}
```

---

### NPCs

NPCs are characters with `npc: true`. They appear in Settings > NPCs and can be created directly from chat.

#### `GET /api/v1/characters?npc=true`

List all NPCs.

#### `POST /api/v1/characters` with `npc: true`

Create an NPC character.

---

### Wardrobe (Archetypes)

Global archetype wardrobe items that can be shared across characters.

#### `GET /api/v1/wardrobe`

List all archetype wardrobe items.

**Response**: `200 OK`

```json
{
  "wardrobeItems": [
    {
      "id": "item-uuid",
      "title": "Leather Jacket",
      "description": "A well-worn leather jacket...",
      "types": ["top"],
      "appropriateness": "casual",
      "isDefault": false,
      "characterId": null,
      "archivedAt": null
    }
  ]
}
```

#### `POST /api/v1/wardrobe`

Create a new archetype wardrobe item.

**Request Body**:

```json
{
  "title": "Leather Jacket",
  "description": "A well-worn leather jacket...",
  "types": ["top"],
  "appropriateness": "casual",
  "isDefault": false
}
```

**Response**: `201 Created`

#### `GET /api/v1/wardrobe/[itemId]`

Get a specific archetype wardrobe item.

#### `PUT /api/v1/wardrobe/[itemId]`

Update an archetype wardrobe item. All fields optional.

#### `DELETE /api/v1/wardrobe/[itemId]`

Delete an archetype wardrobe item. Cleans up all character references first.

#### `POST /api/v1/wardrobe/analyze-image`

Analyze an image using a vision LLM to suggest wardrobe items.

**Request Body**:

```json
{
  "image": "<base64-encoded image data, max 14MB>",
  "mimeType": "image/jpeg",
  "guidance": "Optional guidance for the analysis"
}
```

**Response**: `200 OK`

```json
{
  "proposedItems": [...],
  "provider": "OPENAI",
  "model": "gpt-4o"
}
```

#### `POST /api/v1/wardrobe/preview-avatar`

Generate a one-off character avatar against an arbitrary equipped-slot snapshot (the state a wardrobe dialog is currently showing). The result is saved as a regular generated image (downloadable from the dialog) but is **not** persisted onto the character's `avatarOverrides` or any chat's `characterAvatars` — out-of-chat avatars never overwrite the canonical character avatar.

**Request Body**: `{ characterId, equippedSlots, imageProfileId? }`

**Response**: `{ fileId, url, mimeType, prompt }`

#### `GET /api/v1/wardrobe/transfers`

Return the destination options for moving or copying a wardrobe item between tiers (character vault, project stores, Quilltap General).

#### `POST /api/v1/wardrobe/transfers`

Move or copy one wardrobe item between wardrobe tiers.

---

### Character Wardrobe

Per-character wardrobe items. Same schema as archetypes but scoped to a specific character.

#### `GET /api/v1/characters/[id]/wardrobe`

Get all wardrobe items for a character.

**Response**: `200 OK`

```json
{
  "wardrobeItems": [...]
}
```

#### `POST /api/v1/characters/[id]/wardrobe`

Create a new character-specific wardrobe item.

**Request Body**:

```json
{
  "title": "Evening Gown",
  "description": "A floor-length silk gown...",
  "types": ["top", "bottom"],
  "appropriateness": "formal",
  "isDefault": false
}
```

**Response**: `201 Created`

#### `GET /api/v1/characters/[id]/wardrobe/[itemId]`

Get a specific wardrobe item for a character.

#### `PUT /api/v1/characters/[id]/wardrobe/[itemId]`

Update a character wardrobe item. All fields optional.

#### `DELETE /api/v1/characters/[id]/wardrobe/[itemId]`

Delete a character wardrobe item.

---

### Outfit Presets

Named outfit combinations for characters. Each preset maps wardrobe items to equipment slots.

#### `GET /api/v1/characters/[id]/wardrobe/presets`

List outfit presets for a character.

**Response**: `200 OK`

```json
{
  "presets": [
    {
      "id": "preset-uuid",
      "characterId": "char-uuid",
      "name": "Casual Friday",
      "description": "Relaxed office attire",
      "slots": {
        "top": "item-uuid-1",
        "bottom": "item-uuid-2",
        "footwear": "item-uuid-3",
        "accessories": null
      }
    }
  ]
}
```

#### `POST /api/v1/characters/[id]/wardrobe/presets`

Create a new outfit preset.

**Request Body**:

```json
{
  "name": "Casual Friday",
  "description": "Relaxed office attire",
  "slots": {
    "top": "item-uuid-1",
    "bottom": "item-uuid-2",
    "footwear": "item-uuid-3",
    "accessories": null
  }
}
```

**Response**: `201 Created`

#### `GET /api/v1/characters/[id]/wardrobe/presets/[presetId]`

Get a specific outfit preset.

#### `PUT /api/v1/characters/[id]/wardrobe/presets/[presetId]`

Update an outfit preset. All fields optional.

#### `DELETE /api/v1/characters/[id]/wardrobe/presets/[presetId]`

Delete an outfit preset.

#### `POST /api/v1/characters/[id]/wardrobe/presets/[presetId]?action=apply`

Apply a preset outfit to a chat.

**Request Body**:

```json
{
  "chatId": "chat-uuid"
}
```

**Response**: `200 OK`

```json
{
  "equipped": {
    "top": "item-uuid-1",
    "bottom": "item-uuid-2",
    "footwear": "item-uuid-3",
    "accessories": null
  }
}
```

---

### Character Photos

A character's own photo gallery, stored in the character vault's `photos/` folder (distinct from per-chat photo albums). Backed by `lib/photos/character-gallery-service.ts`.

#### `GET /api/v1/characters/[id]/photos`

List the photos in the character's gallery.

#### `POST /api/v1/characters/[id]/photos`

Upload a new photo. `multipart/form-data`: `file` (required), plus optional `caption` and `tags`.

#### `DELETE /api/v1/characters/[id]/photos/[linkId]`

Remove a photo from the gallery. `[linkId]` is the `doc_mount_file_links.id` returned by the list/upload endpoints. If the removed photo was the character's `defaultImageId` (or appeared in any `avatarOverrides[].imageId`), those pointers are nulled too.

---

### Chats

#### `GET /api/v1/chats`

List all chats for authenticated user.

**Query Parameters**:
- `tagId` - Filter by tag

**Response**: `200 OK`

```json
{
  "chats": [
    {
      "id": "chat-uuid",
      "title": "Chat with Alice",
      "characterId": "char-uuid",
      "connectionProfileId": "profile-uuid",
      "participants": [
        {
          "id": "participant-uuid",
          "type": "CHARACTER",
          "characterId": "char-uuid",
          "controlledBy": "llm",
          "connectionProfileId": "profile-uuid"
        }
      ],
      "impersonatingParticipantIds": [],
      "activeTypingParticipantId": null,
      "allLLMPauseTurnCount": 0,
      "tags": [],
      "createdAt": "2025-01-19T10:00:00.000Z",
      "updatedAt": "2025-01-19T12:00:00.000Z"
    }
  ],
  "count": 1
}
```

#### `POST /api/v1/chats`

Create a new chat.

**Request Body**:

```json
{
  "characterId": "char-uuid",
  "connectionProfileId": "profile-uuid",
  "userCharacterId": "user-char-uuid",
  "title": "Chat with Alice",
  "scenario": "Optional custom scenario"
}
```

**Note**: `userCharacterId` is optional - provide a user-controlled character ID to "play as" that character in the chat.

**Note**: `roleplayTemplateId` is optional and tri-state. Omit the key to fall back to the default chain (project default > user/global default > none). Send a template UUID to force that template, or send an explicit `null` for "no template" — both beat the defaults. A UUID that doesn't resolve returns `400 Roleplay template not found`.

**Note**: `progressId` is optional — a client-generated UUID. When present, the handler publishes creation progress (setup milestones and per-character LLM wardrobe choices) to an in-memory bus keyed by that id, which the "Green Room" status dialog subscribes to via `GET /api/v1/chats/creation-progress?id=…` (below). Omit it and creation behaves exactly as before, returning the same JSON.

To create an autonomous room, include `chatType: "autonomous"` and autonomous-room fields:

```json
{
  "characterId": "char-uuid",
  "connectionProfileId": "profile-uuid",
  "chatType": "autonomous",
  "scheduleCron": "0 2 * * *",
  "scheduleFreshnessWindowMs": 43200000,
  "budgetMaxTurns": 50,
  "budgetMaxTokens": 500000,
  "budgetMaxWallClockMs": null,
  "budgetEstimatedSpendCapUSD": null,
  "budgetExcludeCacheHits": true,
  "runVisibility": "owner_only",
  "runDestructiveToolsAllowed": false
}
```

#### `POST /api/v1/chats?action=import`

Import a SillyTavern chat (JSONL format).

**Request Body**:

```json
{
  "chatData": {
    "messages": [],
    "chat_metadata": {},
    "character_name": "Alice",
    "user_name": "User",
    "create_date": 1234567890
  },
  "mappings": [],
  "defaultConnectionProfileId": "profile-uuid",
  "triggerTitleGeneration": true,
  "createMemories": false
}
```

#### `GET /api/v1/chats/creation-progress?id=<progressId>`

Server-Sent Events stream for the chat-creation status dialog ("The Green Room"). The client opens this just before `POST /api/v1/chats` (carrying the same `progressId`) and relays each event to the blocking status dialog. The in-memory bus buffers events per id and replays the backlog on connect, so a subscriber that attaches a beat late loses nothing (including a terminal `done`/`error`, which closes the stream).

Each SSE frame is `data: <json>\n\n` where the payload is one of:

```
{ "kind": "status", "message": "Consulting the wardrobe…", "ts": 0 }
{ "kind": "log", "message": "…", "level": "info|warn|error", "ts": 0 }
{ "kind": "wardrobe-start", "characterId": "…", "characterName": "…", "ts": 0 }
{ "kind": "wardrobe-result", "characterId": "…", "characterName": "…",
  "slots": { "top": [{ "id": "…", "title": "…", "isComposite": false }], "bottom": [], "footwear": [], "accessories": [] }, "ts": 0 }
{ "kind": "done", "ts": 0 }
{ "kind": "error", "message": "…", "ts": 0 }
```

#### `GET /api/v1/chats/[id]`

Get a chat with full message history. The response includes `chatType` (e.g. `"standard"`, `"autonomous"`).

#### `PUT /api/v1/chats/[id]`

Update chat metadata.

#### `DELETE /api/v1/chats/[id]`

Delete a chat (cascades to messages).

#### `GET /api/v1/chats/[id]?action=export`

Export chat as SillyTavern JSONL format.

#### `GET /api/v1/chats/[id]?action=export-markdown`

Export the chat as a single deterministic Markdown transcript (`text/markdown`, served as an attachment named after the chat title). The readable record of the conversation: the opening scenario, participant and user messages (active swipe only), Pascal roll announcements, Carina/Brahma answers, user-authored announcements, and the Host's continuation/merge notices. Each message renders under a `## Speaker — timestamp` heading, with timestamps on the chat's own clock (fictional time when configured, in the chat's resolved timezone and format). Excludes SYSTEM/TOOL messages, Staff housekeeping chatter, and anything sent to LLMs as prompts.

#### `GET /api/v1/chats/[id]?action=cost`

Get detailed cost breakdown for a chat.

**Response**: `200 OK`

```json
{
  "chatId": "chat-uuid",
  "costs": [
    {
      "participantId": "participant-uuid",
      "characterId": "char-uuid",
      "characterName": "Alice",
      "provider": "ANTHROPIC",
      "modelName": "claude-sonnet-4-20250514",
      "totalPromptTokens": 15000,
      "totalCompletionTokens": 5000,
      "messageCount": 25
    }
  ],
  "totalMessages": 50,
  "totalPromptTokens": 30000,
  "totalCompletionTokens": 10000
}
```

#### `POST /api/v1/chats/[id]?action=regenerate-title`

Regenerate chat title using AI.

#### `POST /api/v1/chats/[id]?action=add-tag`

Add a tag to a chat.

**Request Body**:

```json
{
  "tagId": "tag-uuid"
}
```

#### `POST /api/v1/chats/[id]?action=remove-tag`

Remove a tag from a chat.

**Request Body**:

```json
{
  "tagId": "tag-uuid"
}
```

#### `POST /api/v1/chats/[id]?action=add-participant`

Add a character to the chat.

**Request Body**:

```json
{
  "type": "CHARACTER",
  "characterId": "char-uuid",
  "connectionProfileId": "profile-uuid",
  "controlledBy": "llm",
  "hasHistoryAccess": false,
  "joinScenario": "Optional entrance description",
  "outfitSelection": {
    "characterId": "char-uuid",
    "mode": "default"
  }
}
```

**Notes**:

- `controlledBy` accepts `"llm"` (default) or `"user"` (user-impersonated). `connectionProfileId` is required for LLM control and ignored for user control.
- `hasHistoryAccess` (default `false`) controls whether the new participant sees messages from before they joined.
- `joinScenario` is optional context describing how the character entered; surfaced as a Host announcement targeted at the new participant when `hasHistoryAccess` is false.
- `outfitSelection` is optional. Modes: `default`, `manual` (provide a `slots` object), `llm_choose` (cheap LLM picks), `none` (start undressed). Omitting it on a fresh add defaults to `mode: "default"` so the new arrival is dressed; on reactivation of a previously-removed participant, omitting it preserves their previous outfit.
- `mode: "llm_choose"` consults a cheap LLM per character. Consults for all characters in one request run concurrently; each is bounded by a 60s timeout. The model may return `"deliberate": true` alongside empty slots to dress the character in nothing on purpose; an all-empty response *without* that flag, a failure, or a timeout falls back to `default`.
- `mode: "default"` resolves across **all three wardrobe tiers** — the character's own vault, the project stores linked to the chat's project, and Quilltap General. Items marked `isDefault` in any tier are equipped and **layer** in the same slot (ordered by `createdAt` ascending). Tiers are merged before the `isDefault` filter, so a character's own copy of a shared item shadows it by id: a personal `isDefault: false` override means the shared default is not worn. `llm_choose` draws its candidate list from that same merged pool.

#### `POST /api/v1/chats/[id]?action=update-participant`

Update a participant's settings.

**Request Body**:

```json
{
  "participantId": "participant-uuid",
  "connectionProfileId": "profile-uuid",
  "imageProfileId": "image-profile-uuid",
  "embeddingProfileId": "embedding-profile-uuid"
}
```

#### `POST /api/v1/chats/[id]?action=remove-participant`

Remove a participant from the chat.

**Request Body**:

```json
{
  "participantId": "participant-uuid"
}
```

#### `POST /api/v1/chats/[id]?action=merge-conversation`

Fold another conversation's characters and summary into **this** chat (the inverse of "Continue Elsewhere"). `[id]` is the merge target.

**Request Body**:

```json
{
  "sourceChatId": "source-chat-uuid",
  "characterIds": ["char-uuid"],
  "outfitSelections": [
    { "characterId": "char-uuid", "mode": "previous_chat" }
  ]
}
```

**Notes**:

- Adds the source chat's present characters that aren't already in the target as **LLM-controlled** participants (a source user-controlled character is converted to LLM-driven; the target keeps its own user character). Characters already present are excluded server-side.
- `characterIds` is an optional allowlist gating exactly which source characters come across (still minus any already present). Omitted → every eligible source character merges. An explicit empty array returns `400` ("select at least one").
- `outfitSelections` is optional and mirrors `add-participant`'s `outfitSelection` modes per character; omitted characters default to `previous_chat` (carry their worn outfit forward from the source chat).
- Posts a Host recap (`systemKind: "merge-from"`) at the tail of the target carrying the source's summary and a link back, plus a back-link (`systemKind: "merge-to"`) in the source chat. Existing turns are **not** replayed and the target's turn state is untouched.
- Returns `400` when `sourceChatId` equals `[id]` or when every source character is already present (no side effects in the latter case).

#### `POST /api/v1/chats/[id]?action=bulk-reattribute`

Re-attribute multiple messages from one participant to another in a single operation. All memories associated with the affected messages are permanently deleted.

**Request Body**:

```json
{
  "sourceParticipantId": "participant-uuid" | null,  // null = unassigned messages
  "targetParticipantId": "participant-uuid",
  "roleFilter": "ASSISTANT" | "USER" | "both"  // Default: "both"
}
```

**Response**: `200 OK`

```json
{
  "success": true,
  "messagesUpdated": 42,
  "memoriesDeleted": 7
}
```

#### `POST /api/v1/chats/[id]?action=turn`

Update turn state for multi-character chat, or query the next speaker.

**Request Body** (for `nudge`, `queue`, `dequeue`):

```json
{
  "action": "nudge" | "queue" | "dequeue",
  "participantId": "participant-uuid"
}
```

**Request Body** (for `query` — read-only, does not modify state):

```json
{
  "action": "query"
}
```

**Response**: `200 OK`

```json
{
  "success": true,
  "action": "queue",
  "turn": {
    "nextSpeakerId": "participant-uuid" | null,
    "nextSpeakerName": "Alice" | null,
    "nextSpeakerControlledBy": "llm" | "user" | null,
    "reason": "queue" | "weighted_selection" | "only_character" | "user_turn" | "cycle_complete",
    "explanation": "Selected from queue",
    "cycleComplete": false,
    "isUsersTurn": false
  },
  "state": {
    "queue": ["participant-uuid-1", "participant-uuid-2"]
  },
  "participant": {
    "id": "participant-uuid",
    "name": "Alice",
    "queuePosition": 1
  }
}
```

---

### Impersonation

Impersonation allows users to take control of LLM-controlled characters mid-chat.

#### `POST /api/v1/chats/[id]?action=impersonate`

Start impersonating a character in the chat.

**Request Body**:

```json
{
  "participantId": "participant-uuid"
}
```

**Response**: `200 OK`

Returns updated chat metadata with `impersonatingParticipantIds` including the new participant.

#### `POST /api/v1/chats/[id]?action=stop-impersonate`

Stop impersonating a character.

**Request Body**:

```json
{
  "participantId": "participant-uuid",
  "newConnectionProfileId": "profile-uuid"
}
```

**Note**: `newConnectionProfileId` is required when the character doesn't have a default connection profile. This assigns the LLM profile that will control the character after you stop impersonating.

#### `POST /api/v1/chats/[id]?action=set-active-speaker`

Set the active speaker when impersonating multiple characters.

**Request Body**:

```json
{
  "participantId": "participant-uuid"
}
```

---

### Chat Avatars

#### `GET /api/v1/chats/[id]?action=get-avatars`

Get all avatar overrides for characters in this chat.

**Response**: `200 OK`

```json
{
  "data": [
    {
      "chatId": "chat-uuid",
      "characterId": "char-uuid",
      "imageId": "file-uuid",
      "character": { "id": "char-uuid", "name": "Alice" },
      "image": { "id": "file-uuid", "filepath": "/api/v1/files/file-uuid", "url": null }
    }
  ]
}
```

#### `POST /api/v1/chats/[id]?action=set-avatar`

Set avatar override for a character in a chat.

**Request Body**:

```json
{
  "characterId": "char-uuid",
  "imageId": "file-uuid"
}
```

#### `POST /api/v1/chats/[id]?action=remove-avatar`

Remove avatar override for a character in a chat.

**Request Body**:

```json
{
  "characterId": "char-uuid"
}
```

#### `POST /api/v1/chats/[id]?action=toggle-avatar-generation`

Toggle per-conversation AI avatar generation. When enabling, queues generation for all LLM characters.

**Response**: `200 OK`

```json
{
  "avatarGenerationEnabled": true
}
```

#### `POST /api/v1/chats/[id]?action=regenerate-avatar`

Queue avatar regeneration for a specific character in this chat.

**Request Body**:

```json
{
  "characterId": "char-uuid"
}
```

**Response**: `200 OK`

```json
{
  "message": "Avatar regeneration queued",
  "queued": true
}
```

---

### Chat State

#### `GET /api/v1/chats/[id]?action=get-state`

Get the merged **four-tier cascade** state (chat → project → group → general; narrower tiers win). The group tier uses the **participants-union** scope — the union across the chat's active character participants (`type === 'CHARACTER' && status !== 'removed'`) — and only merges when exactly one group applies.

**Response**: `200 OK`

```json
{
  "success": true,
  "state": {},
  "chatState": {},
  "projectState": {},
  "groupState": {},
  "generalState": {},
  "groupTier": { "status": "single", "candidates": [{ "id": "group-uuid", "name": "Alpha" }], "appliedGroupId": "group-uuid" },
  "projectId": "project-uuid"
}
```

`projectState`, `groupState`, and `generalState` are **omitted when empty** (the "undefined when empty" convention). `groupTier.status` is `none` (no groups), `single` (exactly one — merged, `appliedGroupId` set), or `ambiguous` (two or more — the tier is skipped from the merged view and must be edited per group).

#### `PUT /api/v1/chats/[id]?action=set-state`

Replace the entire **chat-tier** state only.

**Request Body**:

```json
{
  "state": { "hp": 100, "gold": 50 }
}
```

#### `DELETE /api/v1/chats/[id]?action=reset-state`

Reset chat state to empty object. Returns previous state.

---

### Group State

Groups are instance-global (existence-only check, no ownership). `handleGetState` returns the group's own state with no parent tier — the cascade merge happens on the chat get-state route.

#### `GET /api/v1/groups/[id]?action=get-state`

Get a single group's own state.

**Response**: `200 OK`

```json
{ "success": true, "state": {} }
```

#### `PUT /api/v1/groups/[id]?action=set-state`

Replace the group's entire state. Body `{ "state": { ... } }`.

#### `DELETE /api/v1/groups/[id]?action=reset-state`

Reset the group's state to `{}`. Returns `{ "success": true, "previousState": { ... } }`.

---

### General State (instance-wide)

The bottom tier of the state cascade. No entity row — it lives as a `state.json` document at the root of the singleton "Quilltap General" mount (`instance_settings.generalMountPointId`), seeded idempotently at startup.

#### `GET /api/v1/settings/general-state`

Read instance-wide general state. Returns `{ "success": true, "state": {} }` (empty `{}` when the mount is not yet provisioned).

#### `PUT /api/v1/settings/general-state`

Replace general state. Body `{ "state": { ... } }` (validated by `stateBodySchema`).

#### `DELETE /api/v1/settings/general-state`

Reset general state to `{}`. Returns `{ "success": true, "previousState": { ... } }`.

---

### Chat Wardrobe & Outfits

#### `GET /api/v1/chats/[id]?action=outfit`

Get full equipped outfit state for all characters in this chat.

**Response**: `200 OK`

```json
{
  "equippedOutfit": {
    "char-uuid-1": { "top": "item-uuid", "bottom": null, "footwear": null, "accessories": null },
    "char-uuid-2": { "top": null, "bottom": null, "footwear": null, "accessories": null }
  }
}
```

#### `POST /api/v1/chats/[id]?action=equip`

Mutate a character's equipped outfit. Dispatches on `mode`:

- `wear` — wear `itemId` across every slot it covers, honoring the item's `replace` flag (layer when off, replace when on).
- `replace` — force-swap: clear every slot `itemId` covers, then wear it (ignores the flag).
- `add_to_slot` — append `itemId` to a single `slot` (layering).
- `remove_from_slot` — remove `itemId` from `slot` (omit `itemId` to clear the slot).
- `clear_slot` — empty `slot`.
- `set_all` — replace the whole equipped state atomically with a `slots` object.

`equip` is accepted as a deprecated alias for `wear`.

**Request Body** (wear / replace):

```json
{
  "characterId": "char-uuid",
  "mode": "wear",
  "itemId": "item-uuid"
}
```

---

### Chat Tools & Automation

#### `POST /api/v1/chats/[id]?action=add-tool-result`

Add a tool result as a TOOL message to the chat.

**Request Body**:

```json
{
  "tool": "dice_roll",
  "initiatedBy": "user",
  "prompt": "Roll 2d6",
  "result": { "rolls": [3, 5], "sum": 8 },
  "images": []
}
```

#### `POST /api/v1/chats/[id]?action=run-tool`

Execute an arbitrary tool and add the result as a message.

**Request Body**:

```json
{
  "toolName": "dice_roll",
  "arguments": { "sides": 20 },
  "characterId": "char-uuid"
}
```

#### `POST /api/v1/chats/[id]?action=rng`

Execute an RNG operation (dice, coin flip, spin the bottle) and add result as a message.

**Request Body**:

```json
{
  "type": 20,
  "rolls": 1,
  "preview": false
}
```

`type` accepts a number (2–1000 for dice sides), `"flip_coin"`, or `"spin_the_bottle"`. Set `preview: true` to get the result without adding a message.

#### `POST /api/v1/chats/[id]?action=queue-memories`

Queue memory extraction jobs for message pairs.

**Request Body**:

```json
{
  "characterId": "char-uuid",
  "characterName": "Alice",
  "messagePairs": [
    {
      "userMessageId": "msg-uuid-1",
      "assistantMessageId": "msg-uuid-2",
      "userContent": "...",
      "assistantContent": "..."
    }
  ]
}
```

#### `POST /api/v1/chats/[id]?action=recall-replay`

Episodic-recall tuning harness (wrapped by `quilltap recall-replay`). Reconstructs the per-turn recall distillation for a turn and runs the memory search twice — episodic signals inert (pre-overhaul path) vs. live (retrospective flip, time window, entity anchors, multi-probe) — returning both candidate tables with cosine, ranking blend, multipliers fired, final score, and head selection per row. Read-only. The distillation clock is anchored to the replayed turn's own timestamp.

**Request Body** (all optional):

```json
{
  "turnIndex": 42,
  "characterId": "char-uuid",
  "limit": 25
}
```

`turnIndex` is the 1-based interchange to replay at (default: last); `characterId` defaults to the first LLM-controlled participant; `limit` caps candidate rows per path (max 100).

#### `POST /api/v1/chats/[id]?action=toggle-agent-mode`

Toggle agent mode for this chat, or set to inherit from project/character.

**Request Body**:

```json
{
  "enabled": true
}
```

Set `enabled` to `null` to inherit from project or character settings.

#### `POST /api/v1/chats/[id]?action=reclassify-danger`

Clear danger classification and re-queue classification job for messages in this chat.

#### `GET /api/v1/chats/[id]?action=get-background`

Get the current story background for the chat.

#### `POST /api/v1/chats/[id]?action=regenerate-background`

Queue a story background regeneration job.

**Response**: `200 OK`

```json
{
  "message": "Background regeneration queued",
  "queued": true,
  "jobId": "job-uuid"
}
```

---

### Custom Tools (Pascal the Croupier)

The operator's surface for user-authored pseudo-tools (`Tools/*.tool.json` in any document store). Characters reach for the same definitions via the `run_custom` LLM tool; these endpoints are the composer run dialog's route in.

The roster is resolved **fresh on every request** — never cached — so a definition the user just edited is live on the next time the dialog opens.

**The roll spec and outcome table are never returned.** The dialog does not show the odds; `definitionPath` + `mountName` let the UI link to the user's own file instead.

**`references` is vocabulary, not odds.** Each listing carries what its definition actually *quotes* — derived by `collectToolVocabulary` in `lib/pascal/tool-vocabulary.ts`. Every field is an **occurrence**, not an availability: `dice` is true only if some rendered string writes `{{dice}}`, not merely because the roll is dice; `params` lists only the declared parameters some message or prompt quotes back. Sources are outcome messages, the `llm` prompt, `when.metadata` keys, and `$state` references anywhere in the definition. It names what a tool reads and says; it never says what the tool concludes from it.

#### `GET /api/v1/chats/[id]/custom-tools`

List the roster for the run dialog. Because a character-tier store shadows farther tiers, the roster is resolved once per character participant and merged: a tool that resolves identically for everyone is listed once; a tool whose definition differs per character is listed once **per variant**, each labelled with that character's name. `asCharacterId` records whose perspective produced the entry and is replayed by the run action.

**Whose perspective the single-variant row records.** It decides no variant, but the run action reads that character's fact sheet for `when.metadata` and their groups for `$state`, so it is not arbitrary: it is the operator's own played character — the participant named by `activeTypingParticipantId`, else the first present `controlledBy: 'user'` participant. When none of theirs is a candidate (an all-LLM chat, or an `availableWhen`/`withheldWhen` gate their character did not pass) it falls back to participant order **and carries a `characterLabel`**, so the caller can see whose sheet the run will consult.

**Response**: `200 OK`

```json
{
  "tools": [
    {
      "name": "unlock",
      "description": "Try the lock with whatever is to hand.",
      "parameters": {
        "bonus": { "type": "integer", "default": 0, "description": "Anything helping the attempt.", "min": -5, "max": 5 }
      },
      "references": {
        "value": true,
        "roll": true,
        "dice": true,
        "llm": false,
        "params": ["bonus"],
        "metadata": ["hasAnsibleAccess"],
        "state": ["player.health"]
      },
      "defaultVisibility": "public",
      "sourceTier": "character",
      "characterLabel": "Miss Ashcroft",
      "asCharacterId": "character-uuid",
      "definitionPath": "Tools/unlock.tool.json",
      "mountPointId": "mount-uuid",
      "mountName": "Ashcroft's Vault"
    }
  ],
  "errors": [
    {
      "definitionPath": "Tools/broken.tool.json",
      "mountPointId": "mount-uuid",
      "mountName": "Quilltap General",
      "tier": "global",
      "reason": "is not valid JSON: Unexpected token }"
    }
  ],
  "droppedForCap": ["spare_tool"]
}
```

`characterLabel` is present on variant rows, and on a single-variant row that fell back off the operator's own character (above). `droppedForCap` is present only when the roster hit its size cap. `sourceTier` is one of `character`, `participant`, `group`, `project`, `global`. `references` is always present, all-false with empty lists for a tool that quotes nothing.

#### `POST /api/v1/chats/[id]/custom-tools?action=run`

Run one tool at the operator's behest. Posts **one** message: Pascal's outcome (`systemSender: 'pascal'`, `systemKind: 'custom-tool-result'`), identical to the one a character's own roll produces. The transcript does not record that the operator reached for the tool, nor what figures they set — a companion USER-role invocation line used to publish exactly that, and was removed.

A failed run posts **no Pascal message** — the failure is announced by Prospero (`systemKind: 'custom-tool-error'`) and returns `400`.

**Request Body**:

```json
{
  "tool": "unlock",
  "parameters": { "bonus": 2 },
  "private": false,
  "asCharacterId": "character-uuid"
}
```

`parameters` and `asCharacterId` are optional/nullable. Omitting `asCharacterId` resolves the roster from the operator's own character where there is one (the same preference `GET` uses), falling back to participant order — but the run then consults **no** fact sheet and **no** group state: metadata is `{}` and the `$state` group tier is skipped, rather than borrowing an arbitrary participant's. `private: true` whispers the outcome to the operator alone — no character sees it.

**Response**: `200 OK`

```json
{
  "messages": [ { "role": "ASSISTANT", "systemSender": "pascal" } ],
  "result": {
    "tool": "unlock",
    "value": 14,
    "state": "success",
    "message": "The wards give with a sigh.",
    "whispered": false
  }
}
```

**Errors**: `400` for an unknown tool (the response lists the available names), a rejected parameter, or a definition that will not run. `404` when the chat does not exist.

---

#### `GET /api/v1/custom-tools`

Pascal's Workbench library: **every** definition in **every** enabled store — no per-invoker shadowing, no roster cap, broken files included. Resolved fresh per request.

**Response**: `200 OK`

```json
{
  "tools": [
    {
      "valid": true,
      "name": "unlock",
      "title": "Force the Lock",
      "description": "Try the lock with whatever is to hand.",
      "disabled": false,
      "defaultVisibility": "public",
      "rollForm": "range",
      "parameterCount": 1,
      "outcomeCount": 3,
      "mountPointId": "mount-uuid",
      "mountName": "Ashcroft's Vault",
      "definitionPath": "Tools/unlock.tool.json",
      "attachments": [{ "kind": "character", "id": "character-uuid", "label": "Miss Ashcroft" }]
    }
  ],
  "errors": [
    {
      "valid": false,
      "definitionPath": "Tools/broken.tool.json",
      "mountPointId": "mount-uuid",
      "mountName": "Quilltap General",
      "reason": "is not valid JSON: Unexpected token }",
      "attachments": [{ "kind": "general", "label": "General" }]
    }
  ]
}
```

`attachments[].kind` is one of `general`, `project`, `group`, `character`, `unattached`; a store may carry several.

#### `GET /api/v1/custom-tools?action=destinations`

The Workbench save-target list: every enabled store grouped by what it is attached to, with the tool names each store already carries (a same-store duplicate `name` is a load-time rejection, so the picker warns before writing).

**Response**: `200 OK`

```json
{
  "general": { "mountPointId": "mount-uuid", "mountName": "Quilltap General", "existingToolNames": ["unlock"] },
  "projects": [
    { "projectId": "project-uuid", "projectName": "Ashfall Chronicle", "stores": [{ "mountPointId": "mount-uuid", "mountName": "Ashfall Docs", "existingToolNames": [] }] }
  ],
  "groups": [
    { "groupId": "group-uuid", "groupName": "The Night Shift", "stores": [{ "mountPointId": "mount-uuid", "mountName": "Night Shift Files", "official": true, "existingToolNames": [] }] }
  ],
  "characters": [
    { "characterId": "character-uuid", "characterName": "Miss Ashcroft", "mountPointId": "mount-uuid", "mountName": "Ashcroft's Vault", "existingToolNames": [] }
  ],
  "other": [{ "mountPointId": "mount-uuid", "mountName": "Loose Papers", "existingToolNames": [] }]
}
```

`general` is `null` when the General store is unprovisioned. Characters without a vault are omitted.

#### `POST /api/v1/custom-tools?action=preview`

Dry-run a definition through the same `executeCustomTool` core live chats use. **Posts nothing, writes nothing** — pure computation with the crypto RNG kept server-side.

**Request Body**:

```json
{
  "definition": { "name": "unlock", "description": "…", "outcomes": [{ "when": true, "message": "…", "state": "info" }] },
  "params": { "bonus": 2 },
  "private": false,
  "metadata": { "hasSkeletonKey": true }
}
```

`metadata` may instead be `{ "characterId": "uuid" }`, in which case the server hydrates that character and uses their real `metadata.json` (404 for an unknown id; a broken vault returns 422 with the reason).

**Response**: `200 OK` — the full run result (`tool`, `params`, `rollForm`, `raw`, `value`, `state`, `outcomeIndex`, rendered `message`, `diceBreakdown`, `visibility`, and `metadataTested` when the winning row consulted the sheet). An invalid definition returns 400 with the loader's rejection sentence; a run-time refusal (e.g. an inverted range after `$param` substitution) returns 422.

#### `POST /api/v1/custom-tools?action=audit`

Monte Carlo table audit: 10,000 draws with roll + outcome matching only (no template rendering). Body is the preview body without `private`; `metadata` resolves the same way and is threaded into the match subjects so metadata-gated rows can fire.

**Response**: `200 OK`

```json
{
  "runs": 10000,
  "outcomes": [
    { "index": 0, "hits": 4012, "share": 0.4012 },
    { "index": 1, "hits": 5988, "share": 0.5988 }
  ],
  "valueMin": 0.0001,
  "valueMax": 0.9998,
  "valueMean": 0.5003
}
```

### Autonomous Room Control

Run-control and settings surface for `chatType: 'autonomous'` chats (autonomous rooms / enclaves). All endpoints require the chat to have `chatType === 'autonomous'`; non-autonomous chats return `400`.

#### `GET /api/v1/chats/[id]/autonomous-room`

Read the run status snapshot for the management UI.

**Response**: `200 OK`

```json
{
  "chatId": "chat-uuid",
  "chatType": "autonomous",
  "runState": "running",
  "currentRunId": "run-uuid",
  "runStateMessage": null,
  "runStartedAt": "2026-06-05T02:00:00.000Z",
  "runEndedAt": null,
  "runPausedAccumMs": 0,
  "runTurnsConsumed": 12,
  "runTokensConsumed": 45000,
  "scheduleCron": "0 2 * * *",
  "scheduleNextRunAt": "2026-06-06T02:00:00.000Z",
  "scheduleLastRunAt": "2026-06-05T02:00:00.000Z",
  "scheduleFreshnessWindowMs": 43200000,
  "budgetMaxTurns": 50,
  "budgetMaxTokens": 500000,
  "budgetMaxWallClockMs": null,
  "budgetEstimatedSpendCapUSD": null,
  "budgetExcludeCacheHits": 1,
  "runDestructiveToolsAllowed": 0,
  "runVisibility": "owner_only"
}
```

#### `POST /api/v1/chats/[id]/autonomous-room?action=start`

Manually start a new run. Refuses when `runState === 'running'`.

**Response**: `200 OK` with `{ runId, jobId }`.

#### `POST /api/v1/chats/[id]/autonomous-room?action=pause`

Pause the current run. The next scheduled tick re-evaluates.

**Response**: `200 OK` with `{ paused: true }`.

#### `POST /api/v1/chats/[id]/autonomous-room?action=stop`

Stop the current run. Bumps `currentRunId` so any queued turn job exits via the stale-run guard.

**Response**: `200 OK` with `{ stopped: true }`.

#### `POST /api/v1/chats/[id]/autonomous-room?action=resume`

Resume a paused run, preserving turn/token counters and the existing `currentRunId`.

**Response**: `200 OK` with `{ runId, jobId }`.

#### `POST /api/v1/chats/[id]/autonomous-room?action=update-settings`

Edit the room's schedule, budget caps, visibility, destructive-tool authorization, title, and cache-hit counting toggle. Changes apply to a running run on its next turn. Recomputes `scheduleNextRunAt` when the cron changes; rejects an invalid cron with `400`.

**Request Body** (all fields optional; `null` clears a previously-set value):

```json
{
  "title": "Evening Salon",
  "scheduleCron": "0 22 * * *",
  "scheduleFreshnessWindowMs": 43200000,
  "budgetMaxTurns": 100,
  "budgetMaxTokens": 1000000,
  "budgetMaxWallClockMs": 3600000,
  "budgetEstimatedSpendCapUSD": 2.50,
  "runVisibility": "owner_only",
  "runDestructiveToolsAllowed": false,
  "budgetExcludeCacheHits": true
}
```

**Response**: `200 OK` with `{ updated: true, clampedDestructive: false }`. `clampedDestructive` is `true` when the user-level destructive-tool policy forced the per-room flag to `false`.

---

### The Post Office

Inter-character mail. A player-character can post a letter to another character; delivered mail lands in the recipient's vault `Mail/` folder and is announced by the `suparna` Staff sender. Characters also reach this through the `send_mail` and `list_email` LLM tools.

#### `POST /api/v1/chats/[id]?action=send-mail`

Post a letter as a player-character. Anti-hijack safeguards apply in multi-character chats so a character can only send as itself.

**Response**: `200 OK` with the delivered-letter result.

#### `GET /api/v1/chats/[id]?action=mailbox&characterId=…`

List the letters in a player-character's `Mail/` folder.

**Response**: `200 OK` with the character's mailbox letters.

---

### Brahma Console

A character-less, memory-free generic-LLM surface (`chatType: 'brahma'`). It forms no memories and is never moderated by the Concierge. Reachable from a Salon as the `@Brahma` Carina answerer; see `lib/services/brahma-console/`.

#### `GET /api/v1/brahma-console`

List the user's Brahma Console chats (most-recent first).

#### `POST /api/v1/brahma-console`

Create a new Brahma Console chat. Body: `{ connectionProfileId? }` (defaults to the user's default profile). Requires at least one connection profile to exist.

**Response**: `201 Created` with the new chat.

#### `GET /api/v1/brahma-console/[id]`

Get chat details.

#### `PATCH /api/v1/brahma-console/[id]`

Rename the chat. With `?action=set-model`, switch the model and continue the same chat. (There is no `update-context` action — the console is not page-aware.)

#### `DELETE /api/v1/brahma-console/[id]`

Delete the chat.

#### `POST /api/v1/brahma-console/[id]/messages`

Send a message; returns an SSE stream. Body: `{ content }`.

#### `GET /api/v1/brahma-console/[id]/messages`

Load the chat's messages.

---

### Chat Announcements

Ad-hoc announcement messages — system or character bubbles inserted into the chat via the Salon's "Insert Announcement" composer.

#### `POST /api/v1/chats/[id]?action=announcement`

Post an ad-hoc announcement bubble, publicly or whispered to named participants.

**Request Body**:

```json
{
  "contentMarkdown": "**Aurora:** The wardrobe has been updated.",
  "sender": {
    "kind": "character",
    "characterId": "char-uuid"
  },
  "targetParticipantIds": ["participant-uuid"]
}
```

`sender.kind` is one of `"system"`, `"character"`, or a `systemSender` value (e.g. `"lantern"`, `"host"`). For `character` senders the referenced character must exist.

`targetParticipantIds` is optional. Omitted, `null`, or empty posts a public announcement (the default). Otherwise the announcement is persisted as a whisper: only those participants' LLM contexts include it. The ids are **chat participant ids, not character ids**, and each is re-verified against the chat's current participants — a removed participant or an id from another chat is rejected.

**Response**: `201 Created` — `{ success: true, message: {...} }`. `400` when any target is not a current participant of this chat.

#### `POST /api/v1/chats/[id]?action=announcement-preview`

Generate an in-character rewrite of a seed announcement for an off-scene character. Does not persist — the caller (the Insert Announcement dialog) displays the proposal for operator approval, edit, or regenerate, and only the approved text is posted via `?action=announcement`.

**Request Body**:

```json
{
  "characterId": "char-uuid",
  "connectionProfileId": "profile-uuid",
  "systemPromptId": "prompt-uuid",
  "seedMarkdown": "Aurora announces the wardrobe refresh.",
  "targetParticipantIds": ["participant-uuid"]
}
```

`targetParticipantIds` carries the audience the operator has chosen for the eventual post. When present, the character is told the remark is private and is given those names in place of the room's roster, so the rewrite is phrased as an aside rather than a proclamation. Unresolvable ids are ignored here (nothing is persisted); the post action is the gate that rejects them.

**Response**: `200 OK`

```json
{
  "success": true,
  "proposedMarkdown": "Aurora steps from behind the gilded screen..."
}
```

---

### Chat Photo Albums

#### `GET /api/v1/chats/[id]?action=photo-albums`

Returns the list of photo-album targets the Salon's Save-Image dialog can offer for a given chat: each chat participant with a character vault, the project's own mount point (`officialMountPointId`) if any, every document store linked to the project, and the instance-wide "Quilltap General" mount point. Exactly one option is flagged `isDefault: true` (preference order: active impersonated user character → first user-controlled participant with a vault → Quilltap General).

**Response**: `200 OK`

```json
{
  "albums": [
    {
      "mountPointId": "mp-uuid",
      "name": "Alice",
      "kind": "character",
      "characterId": "char-uuid",
      "participantId": "participant-uuid",
      "isUserCharacter": true,
      "isDefault": true
    },
    {
      "mountPointId": "mp-uuid-2",
      "name": "Project Notes",
      "kind": "project"
    },
    {
      "mountPointId": "mp-uuid-3",
      "name": "World Bible",
      "kind": "document-store"
    },
    {
      "mountPointId": "mp-uuid-4",
      "name": "Quilltap General",
      "kind": "general"
    }
  ]
}
```

`kind` is one of `"character"`, `"project"`, `"document-store"`, or `"general"`.

---

### Photo Gallery

The user's personal image gallery, stored at `<userUploadsMountPointId>/photos/` and deduped by SHA-256. Backed by `lib/photos/user-gallery-service.ts`.

#### `GET /api/v1/photos`

List the user's gallery. Supports optional `query`, `tags`, and pagination parameters.

#### `POST /api/v1/photos`

Save an image (by image-v2 `FileEntry` id) to the gallery. Saving the same image twice is rejected with a clear error (SHA-256 dedupe).

#### `GET /api/v1/photos/[id]`

Get a single gallery entry with its link summary. `[id]` is a `doc_mount_file_links.id` (the `linkId` returned by list/save).

#### `DELETE /api/v1/photos/[id]`

Remove a gallery entry. Cascades to chunks; garbage collection drops the underlying file row if this was its last link.

---

### Chat Files

Upload and list files associated with a chat.

#### `GET /api/v1/chats/[id]/files`

List files for a chat, including both uploaded attachments and generated images. Files are sorted by creation time, newest first.

**Response**: `200 OK`

```json
{
  "files": [
    {
      "id": "file-uuid",
      "filename": "document.pdf",
      "filepath": "/api/v1/files/file-uuid",
      "mimeType": "application/pdf",
      "size": 12345,
      "url": "/api/v1/files/file-uuid",
      "createdAt": "2026-01-15T12:00:00.000Z",
      "type": "chatFile"
    }
  ]
}
```

**File Types**:
- `chatFile` - User-uploaded attachment
- `generatedImage` - AI-generated image

#### `POST /api/v1/chats/[id]/files`

Upload a file for a chat. Uses `multipart/form-data`.

**Request**: `multipart/form-data`
- `file` (required) - The file to upload
- `resolution` (optional) - Conflict resolution: `"replace"`, `"rename"`, `"skip"`
- `conflictingFileId` (optional) - ID of the conflicting file when resolving duplicates

**Response (success)**: `200 OK`

```json
{
  "file": {
    "id": "file-uuid",
    "filename": "document.pdf",
    "filepath": "/api/v1/files/file-uuid",
    "mimeType": "application/pdf",
    "size": 12345,
    "url": "/api/v1/files/file-uuid"
  }
}
```

**Response (duplicate detected)**: `200 OK`

```json
{
  "duplicate": true,
  "conflictType": "exact_match",
  "existingFile": { ... },
  "newFile": { ... }
}
```

---

### Chat File Operations

Operations on individual chat file entries.

#### `POST /api/v1/chat-files/[id]?action=tag`

Tag a chat file with a character association.

**Request Body**:

```json
{
  "tagType": "CHARACTER",
  "tagId": "character-uuid"
}
```

**Response**: `200 OK`

```json
{
  "data": {
    "fileId": "file-uuid",
    "tagType": "CHARACTER",
    "tagId": "character-uuid"
  }
}
```

#### `DELETE /api/v1/chat-files/[id]`

Delete a chat file and its physical storage.

**Response**: `200 OK`

```json
{
  "success": true
}
```

---

### Chat qtap:// Target

#### `GET /api/v1/chats/[id]/qtap-target`

Resolves a `qtap://` address through the same chat access rules as the Salon's Document Mode, then streams the raw bytes. Used by global `qtap://` image links so non-Salon surfaces (e.g. the fullscreen image viewer) can reuse chat-scoped document resolution.

**Query Parameters**:

| Parameter | Description |
|-----------|-------------|
| `scope` | The doc-edit scope the address resolves within |
| `filePath` | The target file path inside the resolved store |
| `mountPoint` | The mount point / store the address targets |

**Response**: `200 OK` — the raw file bytes with the resolved content type. `404` if the target does not resolve.

---

### Chat Messages (Send & Stream)

Chat-scoped message send and per-message actions. (The collection read/edit endpoints are under [Messages](#messages) below.)

#### `POST /api/v1/chats/[id]/messages`

Send a message and receive the streaming LLM response. Returns `text/event-stream` (SSE). HTTP concerns only — the business logic is delegated to the chat message orchestrator service.

#### `POST /api/v1/chats/[id]/messages/[messageId]?action=override-danger-flag`

Override the Concierge danger flags on a message.

#### `POST /api/v1/chats/[id]/messages/[messageId]?action=resolve-external-turn`

Resolve a Courier (manual / clipboard) placeholder turn by attaching the pasted reply.

#### `POST /api/v1/chats/[id]/messages/[messageId]?action=cancel-external-turn`

Cancel a Courier placeholder turn: delete the message and unpause the chat.

#### `POST /api/v1/chats/[id]/messages/[messageId]?action=save-image`

Save an image attached to the message into a chosen photo album.

---

### Messages

#### `GET /api/v1/messages?chatId=[id]`

Get messages for a chat.

**Query Parameters**:
- `chatId` (required) - Chat ID

**Response**: `200 OK`

```json
{
  "messages": [
    {
      "id": "msg-uuid",
      "chatId": "chat-uuid",
      "role": "assistant",
      "content": "Hello! How can I help?",
      "participantId": "participant-uuid",
      "attachments": [],
      "createdAt": "2025-01-19T10:00:00.000Z"
    }
  ],
  "count": 1
}
```

#### `POST /api/v1/messages?chatId=[id]`

Send a message and get streaming response.

**Query Parameters**:
- `chatId` (required) - Chat ID

**Request Body**:

```json
{
  "content": "Hello, how are you?",
  "attachments": []
}
```

**Response**: Server-Sent Events (text/event-stream)

```
data: {"type":"start"}

data: {"type":"token","content":"I"}

data: {"type":"token","content":"'m doing well"}

data: {"type":"done","messageId":"msg-uuid"}
```

**Tool Calls**:

When tools are called (image generation, memory search, web search):

```
data: {"type":"tool_call","name":"generate_image","arguments":{...}}

data: {"type":"tool_result","name":"generate_image","result":{...}}
```

#### `GET /api/v1/messages/[id]`

Get a specific message.

#### `PUT /api/v1/messages/[id]`

Edit a message.

**Request Body**:

```json
{
  "content": "Updated message content"
}
```

#### `DELETE /api/v1/messages/[id]`

Delete a message.

**Query Parameters**:
- `deleteMemories=true` - Also delete associated memories

#### `POST /api/v1/messages/[id]?action=swipe`

Generate alternative response (swipe).

#### `POST /api/v1/messages/[id]?action=reattribute`

Reattribute a message to a different participant.

**Request Body**:

```json
{
  "newParticipantId": "participant-uuid"
}
```

---

### Memories

Memories are accessed via query parameters to filter by character, chat, or message.

#### `GET /api/v1/memories`

Get memories with filtering.

**Query Parameters** (at least one required):
- `characterId` - Filter by character
- `chatId` - Filter by chat
- `messageId` - Filter by message

**Response**: `200 OK`

```json
{
  "memories": [
    {
      "id": "memory-uuid",
      "characterId": "char-uuid",
      "content": "Alice likes tea",
      "summary": "Preference for tea",
      "importance": 0.8,
      "hasEmbedding": true,
      "createdAt": "2025-01-19T10:00:00.000Z"
    }
  ],
  "count": 1
}
```

#### `POST /api/v1/memories`

Create a memory.

**Query Parameters**:
- `characterId` (required) - Character to create memory for

**Request Body**:

```json
{
  "content": "Alice likes tea",
  "summary": "Preference for tea",
  "importance": 0.8
}
```

#### `GET /api/v1/memories/[id]`

Get a specific memory.

#### `PUT /api/v1/memories/[id]`

Update a memory.

**Request Body**:

```json
{
  "content": "Alice loves tea",
  "summary": "Strong preference for tea",
  "importance": 0.9
}
```

#### `DELETE /api/v1/memories/[id]`

Delete a memory.

#### `POST /api/v1/memories?action=search`

Search memories (uses embeddings if available, falls back to keyword).

**Query Parameters**:
- `characterId` (required) - Character to search memories for

**Request Body**:

```json
{
  "query": "what does Alice like",
  "limit": 5
}
```

**Response**: `200 OK`

```json
{
  "results": [
    {
      "memory": { ... },
      "score": 0.95
    }
  ]
}
```

#### `GET /api/v1/memories?action=housekeep`

Preview housekeeping actions (dry run).

**Query Parameters**:
- `characterId` (required) - Character to preview housekeeping for
- `maxMemories` - Maximum memories to keep (default: 1000)
- `maxAgeMonths` - Maximum age in months (default: 6)
- `minImportance` - Minimum importance threshold (default: 0.3)
- `mergeSimilar` - Whether to merge similar memories (default: false)

#### `POST /api/v1/memories?action=housekeep`

Run housekeeping (deduplication, summarization) on memories.

**Query Parameters**:
- `characterId` (required) - Character to housekeep memories for

**Request Body**:

```json
{
  "maxMemories": 1000,
  "maxAgeMonths": 6,
  "minImportance": 0.3,
  "mergeSimilar": true
}
```

#### `POST /api/v1/memories?action=embeddings`

Generate embeddings for memories missing them.

**Query Parameters**:
- `characterId` (required) - Character to generate embeddings for

---

### Tags

#### `GET /api/v1/tags`

List all tags.

#### `POST /api/v1/tags`

Create a tag.

**Request Body**:

```json
{
  "name": "Fantasy",
  "color": "#ff6b6b",
  "quickHide": false
}
```

#### `GET /api/v1/tags/[id]`

Get a specific tag.

#### `PUT /api/v1/tags/[id]`

Update a tag.

#### `DELETE /api/v1/tags/[id]`

Delete a tag.

---

### Files

Modern file management API (v1).

#### `GET /api/v1/files`

List files for the authenticated user.

**Query Parameters**:
- `projectId` - Filter by project ID
- `folderPath` - Filter by folder path
- `filter=general` - Return only files without a project

**Response**: `200 OK`

```json
{
  "files": [
    {
      "id": "file-uuid",
      "userId": "user-uuid",
      "originalFilename": "document.pdf",
      "filename": "document.pdf",
      "filepath": "/api/v1/files/file-uuid",
      "mimeType": "application/pdf",
      "size": 12345,
      "category": "DOCUMENT",
      "description": null,
      "projectId": "project-uuid",
      "folderPath": "/documents/",
      "width": null,
      "height": null,
      "createdAt": "2026-01-15T12:00:00.000Z",
      "updatedAt": "2026-01-15T12:00:00.000Z"
    }
  ]
}
```

#### `POST /api/v1/files?action=write`

Create a file from text content. Requires file write permission. If a file with the same name already exists in the same scope (user + project + folder), the existing file is overwritten and the original file ID is preserved.

**Request Body**:

```json
{
  "filename": "notes.txt",
  "content": "File content here",
  "mimeType": "text/plain",
  "projectId": "project-uuid",
  "folderPath": "/documents/"
}
```

**Response**: `201 Created` (new file) or `200 OK` (overwrite)

#### `POST /api/v1/files?action=upload`

Upload a file via multipart/form-data. If a file with the same name already exists in the same scope (user + project + folder), the existing file is overwritten and the original file ID is preserved.

**Request**: `multipart/form-data`
- `file` (required) - The file to upload
- `projectId` (optional) - Project to associate with
- `folderPath` (optional) - Folder path within project
- `tags` (optional) - JSON array of tag associations

**Response**: `201 Created` (new file) or `200 OK` (overwrite)

#### `POST /api/v1/files?action=generate-thumbnails`

Batch pre-generate thumbnails for image files. Processes with bounded concurrency (3 concurrent Sharp operations) to avoid overwhelming the server.

**Request Body**:

```json
{
  "fileIds": ["file-uuid-1", "file-uuid-2"],
  "size": 150
}
```

- `fileIds` (required) - Array of file UUIDs (max 100)
- `size` (optional) - Thumbnail size in pixels (default 150, max 300)

**Response**: `200 OK`

```json
{
  "total": 10,
  "generated": 7,
  "cached": 2,
  "errors": 1
}
```

#### `POST /api/v1/files?action=cleanup-stale`

Scan for and optionally delete stale file records — database entries whose backing files no longer exist in storage. Defaults to dry-run mode for safety.

**Request Body**:

```json
{
  "dryRun": true
}
```

- `dryRun` (optional) - If `true` (default), only report stale records without deleting. Set to `false` to delete stale DB records and clean up their cached thumbnails.

**Response**: `200 OK`

```json
{
  "total": 50,
  "stale": 3,
  "deleted": 0,
  "dryRun": true,
  "staleFiles": [
    { "id": "file-uuid-1", "filename": "lost-image.png" },
    { "id": "file-uuid-2", "filename": "missing-doc.pdf" }
  ]
}
```

#### `POST /api/v1/files?action=cleanup-orphans`

Analyze and clean up orphaned files — files found on disk with no prior database record (shown as "untracked" in the file browser). Supports two modes: move unique files to an `/orphans/` folder, or delete everything. Duplicate orphans (matching SHA-256 of a tracked file) are always deleted.

**Request Body**:

```json
{
  "mode": "move",
  "dryRun": true
}
```

- `mode` - `"move"` (relocate unique orphans to `/orphans/` folder, delete duplicates) or `"delete"` (delete all orphans)
- `dryRun` (optional) - If `true` (default), only report stats without acting. Set to `false` to execute.

**Response (dry run)**: `200 OK`

```json
{
  "orphanedCount": 15,
  "duplicateCount": 8,
  "uniqueCount": 7,
  "totalSize": 45000000,
  "duplicateSize": 24000000,
  "uniqueSize": 21000000,
  "dryRun": true
}
```

**Response (execute)**: `200 OK`

```json
{
  "orphanedCount": 15,
  "duplicateCount": 8,
  "uniqueCount": 7,
  "totalSize": 45000000,
  "deleted": 8,
  "moved": 7,
  "dryRun": false,
  "mode": "move"
}
```

#### `GET /api/v1/files/[id]`

Download a file by ID. Returns the file content with appropriate headers.

**Query Parameters**:
- `action=thumbnail` - Get thumbnail for images
- `size` - Thumbnail size (default 150, max 300)

**Response**: File binary with `Content-Type` and `Content-Disposition` headers.

#### `DELETE /api/v1/files/[id]`

Delete a file.

**Query Parameters**:
- `force=true` - Delete even if file is linked to other entities
- `dissociate=true` - Remove all associations before deleting

**Response**: `200 OK`

```json
{
  "success": true
}
```

**Error Response** (if file has associations):

```json
{
  "error": "Bad Request",
  "message": "File is linked to other items",
  "details": {
    "code": "FILE_HAS_ASSOCIATIONS",
    "associations": {
      "characters": [...],
      "messages": [...]
    }
  }
}
```

#### `POST /api/v1/files/[id]?action=move`

Move or rename a file.

**Request Body**:

```json
{
  "folderPath": "/new-folder/",
  "filename": "new-name.txt",
  "projectId": "project-uuid"
}
```

#### `POST /api/v1/files/[id]?action=promote`

Promote an attachment to general or project files.

**Request Body**:

```json
{
  "targetProjectId": "project-uuid",
  "folderPath": "/documents/"
}
```

#### `POST /api/v1/files?action=sync`

Trigger filesystem reconciliation — scans the file storage directory and synchronizes the database to match what's on disk.

**Response**:

```json
{
  "success": true,
  "data": {
    "message": "Filesystem sync completed"
  }
}
```

---

### Folders

Manage folder entities for file organization. Folders are first-class entities stored in the database.

#### `GET /api/v1/files/folders`

List all folders for the authenticated user.

**Query Parameters**:
- `projectId` (optional) - Filter by project ID, or omit for general files

**Response**:

```json
{
  "folders": [
    {
      "id": "folder-uuid",
      "path": "/documents/reports/",
      "name": "reports",
      "parentFolderId": "parent-folder-uuid",
      "projectId": "project-uuid",
      "createdAt": "2025-01-10T12:00:00.000Z",
      "updatedAt": "2025-01-10T12:00:00.000Z"
    }
  ],
  "count": 1
}
```

#### `POST /api/v1/files/folders`

Create a new folder.

**Request Body**:

```json
{
  "path": "/documents/reports/",
  "projectId": "project-uuid"
}
```

**Response**:

```json
{
  "success": true,
  "folder": {
    "id": "folder-uuid",
    "path": "/documents/reports/",
    "name": "reports",
    "parentFolderId": "parent-folder-uuid",
    "projectId": "project-uuid"
  },
  "alreadyExists": false,
  "message": "Folder created successfully"
}
```

#### `PATCH /api/v1/files/folders`

Rename a folder. Updates the folder entity and all affected file paths.

**Request Body**:

```json
{
  "path": "/documents/reports/",
  "newName": "archived-reports",
  "projectId": "project-uuid"
}
```

**Response**:

```json
{
  "success": true,
  "oldPath": "/documents/reports/",
  "newPath": "/documents/archived-reports/",
  "foldersUpdated": 3,
  "filesUpdated": 15
}
```

#### `DELETE /api/v1/files/folders`

Delete an empty folder. Returns error if folder contains files or subfolders.

**Query Parameters**:
- `path` (required) - Folder path to delete
- `projectId` (optional) - Project ID if folder is in a project

**Response**:

```json
{
  "success": true,
  "message": "Folder deleted successfully",
  "path": "/documents/reports/"
}
```

**Error Response** (if folder not empty):

```json
{
  "error": "Bad Request",
  "message": "Folder contains 5 file(s) and cannot be deleted"
}
```

---

### Prompt Templates

User-created system prompt templates.

- `GET /api/v1/prompt-templates` - List templates
- `POST /api/v1/prompt-templates` - Create template
- `GET /api/v1/prompt-templates/[id]` - Get template
- `PUT /api/v1/prompt-templates/[id]` - Update template
- `DELETE /api/v1/prompt-templates/[id]` - Delete template

---

### Roleplay Templates

Per-chat roleplay formatting templates.

- `GET /api/v1/roleplay-templates` - List templates
- `POST /api/v1/roleplay-templates` - Create template
- `GET /api/v1/roleplay-templates/[id]` - Get template
- `PUT /api/v1/roleplay-templates/[id]` - Update template
- `DELETE /api/v1/roleplay-templates/[id]` - Delete template

---

### Images

Image management endpoints for uploads, AI generation, and tagging.

#### `GET /api/v1/images`

List all images.

**Query Parameters**:
- `tagId` - Filter by tag

**Response**: `200 OK`

```json
{
  "data": [
    {
      "id": "file-uuid",
      "filename": "portrait.webp",
      "filepath": "/api/v1/files/file-uuid",
      "url": null,
      "mimeType": "image/webp",
      "size": 45678,
      "width": 1024,
      "height": 1024,
      "source": "generated",
      "generationPrompt": "A portrait of...",
      "generationModel": "dall-e-3",
      "createdAt": "2026-01-15T12:00:00.000Z",
      "tags": [],
      "_count": {
        "charactersUsingAsDefault": 1,
        "chatAvatarOverrides": 0
      }
    }
  ]
}
```

#### `POST /api/v1/images`

Upload an image file or import from URL.

**Request** (upload): `multipart/form-data` with `file` field and optional `tags` JSON string.

**Request** (import from URL):

```json
{
  "url": "https://example.com/image.png",
  "tags": [{ "tagType": "CHARACTER", "tagId": "char-uuid" }]
}
```

**Response**: `201 Created`

#### `POST /api/v1/images?action=generate`

Generate images using an LLM image provider.

**Request Body**:

```json
{
  "prompt": "A portrait of a character in a garden",
  "profileId": "image-profile-uuid",
  "tags": [{ "tagType": "CHARACTER", "tagId": "char-uuid" }],
  "options": {
    "n": 1,
    "quality": "hd",
    "style": "vivid",
    "aspectRatio": "1:1"
  }
}
```

**Response**: `201 Created`

```json
{
  "data": [{ "id": "file-uuid", "filepath": "...", "..." : "..." }],
  "metadata": {
    "prompt": "A portrait of...",
    "provider": "OPENAI",
    "model": "dall-e-3",
    "count": 1
  }
}
```

#### `GET /api/v1/images/[id]`

Get a specific image with usage counts.

#### `DELETE /api/v1/images/[id]`

Delete an image. Fails if the image is in use as a default avatar or chat avatar override.

#### `POST /api/v1/images/[id]?action=add-tag`

Add a tag to an image.

**Request Body**:

```json
{
  "tagType": "CHARACTER",
  "tagId": "char-uuid"
}
```

#### `POST /api/v1/images/[id]?action=remove-tag`

Remove a tag from an image.

**Request Body**:

```json
{
  "tagId": "char-uuid"
}
```

---

### Mount Points (Scriptorium)

Mount points are the storage units of the Scriptorium document-store system. Each mount point is one of three kinds:

- **`filesystem`** — backed by a directory on the host filesystem (watcher tracks changes).
- **`obsidian`** — filesystem variant tuned for an Obsidian vault (skips `.obsidian/`, `.trash/` by default).
- **`database`** — bytes live entirely inside `quilltap-mount-index.db`; no `basePath` required.

Mount points have a `storeType` of `documents` (general-purpose) or `character` (a character's private vault — see [Character Vault](../characters.md)).

#### `GET /api/v1/mount-points`

List all mount points, enriched with `embeddedChunkCount`.

**Response**: `200 OK`

```json
{
  "mountPoints": [
    {
      "id": "mp-uuid",
      "name": "Project Notes",
      "basePath": "/Users/me/notes",
      "mountType": "filesystem",
      "storeType": "documents",
      "includePatterns": ["*.md", "*.txt", "*.pdf", "*.docx"],
      "excludePatterns": [".git", "node_modules", ".obsidian", ".trash"],
      "enabled": true,
      "scanStatus": "idle",
      "conversionStatus": "idle",
      "fileCount": 42,
      "chunkCount": 137,
      "totalSizeBytes": 921384,
      "embeddedChunkCount": 137,
      "createdAt": "2026-01-15T12:00:00.000Z"
    }
  ]
}
```

#### `POST /api/v1/mount-points`

Create a mount point. The body is validated: `basePath` is required for `filesystem` and `obsidian` types but ignored for `database`.

**Request Body**:

```json
{
  "name": "Project Notes",
  "basePath": "/Users/me/notes",
  "mountType": "filesystem",
  "storeType": "documents",
  "includePatterns": ["*.md", "*.txt"],
  "excludePatterns": [".git"],
  "enabled": true
}
```

**Response**: `201 Created` — `{ mountPoint: {...} }`, optionally with `warning` if the `basePath` is not currently accessible. Watchers attach asynchronously after creation. Character-scoped database mounts are scaffolded with a preset folder layout.

#### `GET /api/v1/mount-points/[id]`

Get a single mount point with computed `embeddedChunkCount` and a derived `capabilities` block.

The `capabilities` object is computed server-side (`deriveMountCapabilities`, `lib/mount-index/capabilities.ts`) from the mount's `mountType` + `conversionStatus` + `enabled` + `scanStatus` — it is **not persisted**. A file-manager UI should gate which verbs it offers off this block rather than re-deriving the rules client-side. A mount is "quiescent" when `enabled` and not mid-conversion; all mutating flags require quiescence, and `canConvert` additionally requires no scan in progress.

```json
{
  "mountPoint": {
    "...": "…DocMountPoint fields…",
    "embeddedChunkCount": 137,
    "capabilities": {
      "canWrite": true,
      "canDelete": true,
      "canCreateFolder": true,
      "canMoveIn": true,
      "canMoveOut": true,
      "canConvert": true
    }
  }
}
```

#### `PATCH /api/v1/mount-points/[id]`

Update fields on a mount point. Flipping `storeType` to `character` on a database-backed mount triggers preset scaffolding (missing folders only — existing files are untouched). The watcher is refreshed after the update.

**Request Body** (all fields optional):

```json
{
  "name": "Renamed",
  "basePath": "/new/path",
  "mountType": "filesystem",
  "storeType": "documents",
  "includePatterns": ["*.md"],
  "excludePatterns": [".git"],
  "enabled": true
}
```

#### `DELETE /api/v1/mount-points/[id]`

Detach the watcher and delete the mount point along with its chunks, files, database-backed documents/blobs, and project links.

**Response**: `200 OK` — `{ success: true, message: "Mount point deleted successfully" }`

#### `POST /api/v1/mount-points/[id]?action=scan`

Run a full scan of the mount point and enqueue embedding jobs for any new or modified chunks.

**Response**: `200 OK`

```json
{
  "success": true,
  "scanResult": {
    "filesScanned": 42,
    "filesNew": 3,
    "filesModified": 1,
    "filesDeleted": 0,
    "chunksCreated": 9,
    "errors": []
  },
  "embeddingJobsEnqueued": 9
}
```

#### `POST /api/v1/mount-points/[id]?action=convert`

Convert a `filesystem` or `obsidian` mount to `database`-backed storage. Migrates all files into `doc_mount_documents` / `doc_mount_blobs`, detaches the watcher, and clears `basePath`. The conversion status is tracked on the mount point (`converting` → `idle` or `error`).

**Response**: `200 OK` — `{ success: true, mountPoint: {...}, convertResult: { filesMigrated, documentsWritten, blobsWritten, filesSkipped, errors }, previousBasePath }`.

#### `POST /api/v1/mount-points/[id]?action=deconvert`

Convert a `database` mount back to `filesystem`-backed storage at a chosen `targetPath`. The target directory must exist and be empty.

**Request Body**:

```json
{
  "targetPath": "/Users/me/notes-extracted"
}
```

**Response**: `200 OK` — `{ success: true, mountPoint: {...}, deconvertResult: { filesWritten, blobsWritten, bytesWritten, errors } }`.

#### `GET /api/v1/mount-points/[id]/files`

List indexed files plus the folder structure for a mount point.

**Response**: `200 OK`

```json
{
  "files": [...],
  "folders": ["images", "notes", "notes/2026"]
}
```

For filesystem/obsidian mounts the folder list is augmented with on-disk directories (so empty folders show up too). For database-backed mounts it comes from `doc_mount_folders`.

#### `GET /api/v1/mount-points/[id]/files/[...path]`

Read a single file's content. This is the canonical per-file read for the CLI and the Scriptorium file browser/editor; it resolves text documents, database blobs, and on-disk files uniformly.

**Query Parameters**:
- `encoding` — `utf-8` (default for text-like files) or `base64` (default for binary). Any file can be read as `base64`.
- `offset`, `limit` — line window (UTF-8 reads only), mirroring `doc_read_file`.
- `raw=1` (or `Accept: application/octet-stream`) — stream the raw bytes instead of a JSON envelope (used as an `<img>`/download source). Response headers include `Content-Type`, `Content-Length`, and `X-File-Sha256`.

**Response** (JSON envelope): `200 OK`

```json
{
  "mountPointId": "mp-uuid",
  "relativePath": "notes/intro.md",
  "encoding": "utf-8",
  "content": "# Intro\n…",
  "mtime": 1737000000000,
  "sha256": "…",
  "sizeBytes": 1234,
  "mimeType": "text/markdown; charset=utf-8",
  "fileType": "markdown",
  "totalLines": 42,
  "truncated": false
}
```

#### `PUT /api/v1/mount-points/[id]/files/[...path]`

Write (create or overwrite) a single file. Routes through the canonical ingest pipeline (`storeMountFile`): native text lands in `doc_mount_documents`, binary in `doc_mount_blobs` (with image→WebP transcode and PDF/DOCX text extraction) on database mounts, or on disk for filesystem mounts.

**Request Body** (JSON):

```json
{ "content": "…", "encoding": "utf-8", "expected_mtime": 1737000000000, "force": false }
```

`encoding` is `utf-8` or `base64` (base64 lets you write any binary file as JSON). `expected_mtime` enables optimistic concurrency — a mismatch returns `409 Conflict` (code `CONFLICT`) so an editor can prompt to reload. Alternatively send `multipart/form-data` with a `file` field (plus optional `expected_mtime`/`force`) for large binaries.

**Response**: `200 OK` — `{ mountPointId, relativePath, kind, fileType, sha256, sizeBytes, mimeType, mtime }`.

#### `DELETE /api/v1/mount-points/[id]/files/[...path]`

Delete a single file. `200 OK` with `{ deleted, mountPointId, path }`, or `404` when the path doesn't exist.

#### `PATCH /api/v1/mount-points/[id]/files/[...path]`

Update file metadata: `rename` (same-mount move) and/or `description` (binary blobs only).

**Request Body** (at least one field required):

```json
{ "rename": "notes/renamed.md", "description": "Cover art" }
```

#### `POST /api/v1/mount-points/[id]/folders`

Create a folder inside a mount point. The path is normalised and validated to prevent traversal or invalid filesystem segments.

**Request Body**:

```json
{
  "path": "notes/2026"
}
```

**Response**: `200 OK` — `{ success: true, path: "notes/2026" }`.

#### `GET /api/v1/mount-points/[id]/blobs`

List blob metadata (no bytes) for a mount point.

**Query Parameters**:
- `folder` (optional) — filter to a specific folder

**Response**: `200 OK` — `{ blobs: [{ id, mountPointId, relativePath, storedMimeType, sizeBytes, sha256, description, ... }] }`

#### `POST /api/v1/mount-points/[id]/blobs`

Upload a blob via `multipart/form-data`. Thin adapter over the canonical `storeMountFile` ingest pipeline (`assetStorage: 'database'`, so blob bytes stay in the mount-index DB even for filesystem mounts — keeping persisted `<img>` URLs resolvable). Image bitmaps are transcoded to WebP via `sharp`; WebP, SVG, and other MIME types are stored as-is. PDF and DOCX uploads have their text extracted into `doc_mount_blobs.extractedText` and are chunked for embedding so they become searchable. For new clients prefer the canonical `PUT .../files/[...path]` item route above.

**Form fields**:
- `file` (required) — the binary
- `path` (required) — relative path inside the mount point
- `description` (optional)

**Response**: `201 Created` — `{ blob: {...} }`.

#### `GET /api/v1/mount-points/[id]/blobs/[...path]`

Stream blob bytes. The catch-all `[...path]` segment carries the blob's `relativePath` so Markdown references like `![alt](images/avatar.webp)` resolve directly against this URL. If no blob matches, the endpoint falls back to `doc_mount_documents` so text documents (Markdown, txt, JSON, JSONL) can also be served from the same path.

Response headers include `Content-Type`, `Content-Length`, `Cache-Control: private, max-age=3600`, and `X-Blob-Sha256`.

#### `PATCH /api/v1/mount-points/[id]/blobs/[...path]`

Update the blob's `description`.

**Request Body**:

```json
{
  "description": "New description"
}
```

#### `DELETE /api/v1/mount-points/[id]/blobs/[...path]`

Delete the blob. If no blob is found at that path, the endpoint falls back to deleting the matching text document (and its chunks and `doc_mount_files` row).

#### File & folder operations (action dispatch)

Cross-mount and folder operations live on the `[id]` action-dispatch route (they take a destination mount or are mount-scoped, so they don't fit a single item path). All share the error-code → HTTP mapping in `lib/mount-index/file-op-status.ts` (404 not-found, 409 `DEST_EXISTS`/`CONFLICT`/`NOT_EMPTY`, 400 `INVALID_PATH`/`UNSUPPORTED`, 500 `VERIFY_FAILED`).

- `POST /api/v1/mount-points/[id]?action=write-file` — multipart `file`/`path`/`force` write (legacy; prefer `PUT .../files/[...path]`).
- `POST /api/v1/mount-points/[id]?action=delete-file` — JSON `{ path }`.
- `POST /api/v1/mount-points/[id]?action=move-file` — JSON `{ sourcePath, destMountPointId, destPath }`. Cross-mount move (rename / byte-copy / hard-link strategy chosen automatically). Returns `{ strategy, sourceSha256, destSha256, sizeBytes, ... }`.
- `POST /api/v1/mount-points/[id]?action=copy-file` — JSON `{ sourcePath, destMountPointId, destPath, force? }`. Copies. The result is an **independent** document: it shares a content-addressed row with the source until either side is written and then forks. `force` skips the shared-content path and writes bytes for real; the end state is the same.
- `POST /api/v1/mount-points/[id]?action=link-file` — JSON `{ sourcePath, destMountPointId, destPath }`. Creates a **true hard link** (db→db link row or POSIX `fs.link`); never byte-copies. Both ends are enrolled in a `linkGroupId` (see DDL), so a later write through *either* path repoints both and re-chunks the sibling — unlike `copy-file`, which forks. Cross-storage or cross-device links return `400 UNSUPPORTED`. Never overwrites (`409 DEST_EXISTS`).
- `POST /api/v1/mount-points/[id]?action=delete-folder` — JSON `{ path }`. Empty folders only (`409 NOT_EMPTY` otherwise).
- `POST /api/v1/mount-points/[id]?action=move-folder` — JSON `{ fromPath, toPath }`. Moves the folder and everything under it (database rows or `fs.rename` + link-row reconciliation).

> **Mount-point files vs. the file library (`/api/v1/files`).** These mount-point endpoints address content by **(mount, relative path)** and are the one surface for Scriptorium file CRUD. `/api/v1/files` is a separate **library** layer that addresses by **file id** and carries domain metadata the mount index has no columns for (category, generation prompt/model, `linkedTo` associations, tags, image dimensions, thumbnails, avatar back-references). Its uploads already persist bytes into mount stores via the storage bridges (which now funnel through `storeMountFile`), and `GET /api/v1/files/[id]` plus `/api/v1/files/proxy/[...key]` remain the stable, persisted read URLs for library assets. Use the mount-point routes for raw file content; use `/api/v1/files` for the library/metadata layer.

---

### Documents (Standalone Document Mode)

Chat-less Document Mode operations for the left rail's standalone document tabs. These reuse the same shared core as the chat-scoped document actions (`lib/documents/operator-doc-actions.ts`) but create **no `chat_documents` rows and post no Librarian announcements** — no conversation is attached, so nothing is notified of edits. All actions resolve paths with the operator override (any enabled store is reachable). The `project` scope is not accepted here (no chat means no project context); project files are reachable through their project's official document store by mount name.

- `GET /api/v1/documents?action=accessible-stores` — every enabled store (the picker's chat-less "look everywhere"). Returns `{ stores, projectLibrary: null }`; character vaults are labelled by their owning character.
- `POST /api/v1/documents?action=recent-documents` — recently-opened documents across all chats (sourced from `chat_documents` history), deduped by file identity, `project`-scoped rows filtered out. Returns `{ documents }`.
- `POST /api/v1/documents?action=open-document` — JSON `{ filePath?, title?, scope? ('document_store' | 'general', default 'general'), mountPoint?, targetFolder? }`. Reads an existing file, or (no `filePath`) creates a collision-safe "Untitled Document.md" in `targetFolder`. Returns `{ document: { filePath, scope, mountPoint, displayTitle }, content, mtime, isNew }`. `404` if a named file is missing.
- `POST /api/v1/documents?action=read-document` — JSON `{ filePath, scope?, mountPoint? }`. Returns `{ content, mtime }`.
- `POST /api/v1/documents?action=write-document` — JSON `{ filePath, scope?, mountPoint?, content, mtime? }`. Mtime-checked write (`409` on conflict); document-store writes schedule re-index + embedding + stats refresh. Returns `{ success, mtime }`.
- `POST /api/v1/documents?action=rename-document` — JSON `{ filePath, scope?, mountPoint?, newTitle }`. Same basename semantics as the chat route (directory preserved, old extension inherited, separators rejected). `409` if the destination exists. Returns `{ document }`.
- `POST /api/v1/documents?action=delete-document` — JSON `{ filePath, scope?, mountPoint? }`. Returns `{ success }`.

---

### Terminals (Ariel)

The Terminals API spawns and manages PTY sessions attached to a chat, used by the Ariel terminal subsystem. Each session is broadcast in the Salon via a synthetic `ariel` `systemSender` announcement when it opens or closes.

#### `POST /api/v1/terminals`

Spawn a new terminal session and post an open-announcement to the chat.

**Request Body**:

```json
{
  "chatId": "chat-uuid",
  "label": "build server",
  "shell": "/bin/zsh",
  "cwd": "/Users/me/project",
  "cols": 120,
  "rows": 40
}
```

Only `chatId` is required.

**Response**: `201 Created` — `{ success: true, session: { id, chatId, label, shell, cwd, cols, rows, ... } }`.

#### `GET /api/v1/terminals?chatId=<id>`

List terminal sessions for a chat. Returns historical sessions from the database (live and exited).

**Response**: `200 OK` — `{ success: true, sessions: [...] }`.

#### `GET /api/v1/terminals/[id]`

Get a session's metadata along with the in-memory ring buffer (recent output). If the session is no longer tracked in memory (server restart, natural exit), the endpoint falls back to the database row so callers can distinguish "exited" from "never existed" — `ringBuffer` is `null` in that case.

**Response**: `200 OK` — `{ success: true, session: {...}, ringBuffer: string | null }`.

#### `POST /api/v1/terminals/[id]?action=kill`

Send `SIGTERM` to the session.

**Response**: `200 OK` — `{ success: true, ok: true }`.

#### `POST /api/v1/terminals/[id]?action=signal`

Send a custom signal.

**Request Body**:

```json
{
  "signal": "SIGINT"
}
```

Allowed signals: `SIGINT`, `SIGTERM`, `SIGHUP`.

#### `POST /api/v1/terminals/[id]?action=write`

Write input bytes to the session. This is the HTTP fallback for environments where the WebSocket channel is unavailable.

**Request Body**:

```json
{
  "data": "ls -la\n"
}
```

#### `DELETE /api/v1/terminals/[id]`

Kill the session (which triggers the close-announcement with the real exit code via the `onExit` handler) and delete the database row.

---

### System Backup & Restore

Modern backup and restore API (v1).

#### `POST /api/v1/system/backup`

Create a new backup for download. Returns a temporary backup ID.

**Response**: `201 Created`

```json
{
  "success": true,
  "backupId": "uuid",
  "manifest": {
    "version": "2.9.0",
    "createdAt": "2026-01-15T12:00:00.000Z",
    "counts": {
      "characters": 10,
      "chats": 25,
      "messages": 500,
      "memories": 100,
      "files": 50
    }
  }
}
```

#### `GET /api/v1/system/backup/[id]`

Download a temporary backup by ID. The backup is a ZIP file containing all user data.

**Response**: `200 OK` (application/zip)

Returns the backup ZIP file for download. Backup expires after 30 minutes.

#### `POST /api/v1/system/restore`

Restore data from a backup file.

**Request**: `multipart/form-data`
- `file` (required) - The backup ZIP file
- `mode` (required) - `"replace"` (overwrite existing data) or `"new-account"` (import as new)
- `preview` (optional) - Set to `"true"` for preview mode

**Response**: `200 OK`

```json
{
  "success": true,
  "summary": {
    "characters": 10,
    "chats": 25,
    "messages": 500,
    "memories": 100,
    "files": 50,
    "tags": 5,
    "warnings": []
  }
}
```

#### `POST /api/v1/system/restore?action=preview`

Preview backup contents without restoring.

**Request**: `multipart/form-data`
- `file` (required) - The backup ZIP file

**Response**: `200 OK`

```json
{
  "success": true,
  "preview": {
    "version": "2.9.0",
    "counts": {
      "characters": 10,
      "chats": 25,
      "files": 50
    }
  }
}
```

---

### System Data Directory

Information about the Quilltap data directory location.

#### `GET /api/v1/system/data-dir`

Get data directory information.

**Response**: `200 OK`

```json
{
  "path": "/Users/user/Library/Application Support/Quilltap",
  "source": "platform-default",
  "sourceDescription": "Using macOS default location",
  "platform": "darwin",
  "isDocker": false,
  "canOpen": true
}
```

| Field | Description |
|-------|-------------|
| `path` | Absolute path to the data directory |
| `source` | `"environment"` (from env var) or `"platform-default"` |
| `platform` | `"darwin"`, `"linux"`, `"win32"` |
| `isDocker` | Whether running in Docker container |
| `canOpen` | Whether "open" action is supported |

#### `POST /api/v1/system/data-dir?action=open`

Open the data directory in the system file browser (not available in Docker).

**Response**: `200 OK`

```json
{
  "message": "Data directory opened in file browser",
  "path": "/Users/user/Library/Application Support/Quilltap"
}
```

---

### System Unlock

Database encryption key management. These endpoints are unauthenticated because they must be accessible before the app is fully operational (during locked mode and initial setup).

#### `GET /api/v1/system/unlock`

Returns the current database key state.

**Response**: `200 OK`

```json
{
  "state": "resolved"
}
```

| State | Description |
|-------|-------------|
| `needs-setup` | No encryption key exists yet (first run) |
| `needs-passphrase` | Key file is passphrase-protected and locked |
| `needs-vault-storage` | Env var pepper needs to be stored in .dbkey file |
| `resolved` | Key is available, database is accessible |

#### `POST /api/v1/system/unlock?action=setup`

First-run setup: generates encryption pepper, writes `.dbkey` file, and encrypts any existing plaintext databases.

**Request Body**:

```json
{
  "passphrase": "optional-passphrase"
}
```

**Response**: `200 OK`

```json
{
  "success": true,
  "pepper": "hex-encoded-pepper-value",
  "message": "Encryption key generated and stored. Save this value — it will not be displayed again."
}
```

#### `POST /api/v1/system/unlock?action=unlock`

Unlock database with passphrase. Supports both current `.dbkey` format and legacy pepper vault migration.

**Request Body**:

```json
{
  "passphrase": "your-passphrase"
}
```

**Response**: `200 OK`

```json
{
  "success": true
}
```

#### `POST /api/v1/system/unlock?action=store`

Store an existing environment variable pepper into the `.dbkey` file.

**Request Body**:

```json
{
  "passphrase": "optional-passphrase"
}
```

**Response**: `200 OK`

```json
{
  "success": true
}
```

#### `POST /api/v1/system/unlock?action=change-passphrase`

Change the passphrase protecting the `.dbkey` file. Requires the app to be in `resolved` state.

**Request Body**:

```json
{
  "oldPassphrase": "current-passphrase",
  "newPassphrase": "new-passphrase"
}
```

**Response**: `200 OK`

```json
{
  "success": true
}
```

---

### System Migration Warnings

Migration warning notifications generated during server startup (e.g., unrecoverable API keys after column migration). Unauthenticated as it runs during startup.

#### `GET /api/v1/system/migration-warnings`

Returns pending migration warning notifications. Returns empty array if already notified or none occurred.

**Response**: `200 OK`

```json
{
  "success": true,
  "ready": true,
  "warnings": [
    {
      "type": "unrecoverable-api-keys",
      "message": "Some API keys could not be decrypted after migration",
      "details": {}
    }
  ]
}
```

#### `POST /api/v1/system/migration-warnings`

Marks migration warnings as acknowledged. Call after displaying notifications to prevent re-notification.

**Response**: `200 OK`

```json
{
  "success": true,
  "message": "Migration warnings marked as notified"
}
```

---

### LLM Logs

#### `GET /api/v1/llm-logs`

List LLM logs with filters.

**Query Parameters**:
- `messageId` - Filter by message ID
- `chatId` - Filter by chat ID
- `characterId` - Filter by character ID
- `type` - Filter by log type (CHAT_MESSAGE, TOOL_CONTINUATION, MEMORY_EXTRACTION, CHARACTER_WIZARD, etc.)
- `standalone` - Set to 'true' for logs without entity associations
- `limit` - Max results (default 50, max 100)
- `offset` - Pagination offset

**Response**: `200 OK`

```json
{
  "logs": [
    {
      "id": "log-uuid",
      "type": "CHAT_MESSAGE",
      "messageId": "msg-uuid",
      "chatId": "chat-uuid",
      "characterId": "char-uuid",
      "request": {
        "model": "gpt-4",
        "messages": [...],
        "temperature": 0.8
      },
      "response": {
        "choices": [
          {
            "message": {
              "role": "assistant",
              "content": "Response text"
            }
          }
        ],
        "usage": {
          "prompt_tokens": 100,
          "completion_tokens": 50,
          "total_tokens": 150
        }
      },
      "timestamp": "2026-01-23T10:00:00.000Z",
      "durationMs": 1500
    }
  ],
  "count": 1,
  "total": 50,
  "limit": 50,
  "offset": 0
}
```

#### `GET /api/v1/llm-logs/[id]`

Get a single log entry by ID.

**Response**: `200 OK`

```json
{
  "id": "log-uuid",
  "type": "CHAT_MESSAGE",
  "messageId": "msg-uuid",
  "chatId": "chat-uuid",
  "characterId": "char-uuid",
  "request": {...},
  "response": {...},
  "timestamp": "2026-01-23T10:00:00.000Z",
  "durationMs": 1500
}
```

#### `DELETE /api/v1/llm-logs/[id]`

Delete a log entry by ID.

**Response**: `200 OK`

```json
{
  "message": "Log deleted"
}
```

---

### Theme Assets & Fonts

Static asset routes used by both plugin and bundle themes. These sit outside `/api/v1/` because they are unauthenticated asset endpoints.

#### `GET /api/themes/assets/[...path]`

Serve theme assets (CSS overrides, images, etc.).

#### `GET /api/themes/fonts/[...path]`

Serve theme fonts.

---

### Themes (v1)

Modern theme management API with bundle support and registry integration.

#### `GET /api/v1/themes`

List all installed themes with statistics.

**Authentication**: Not required (runs before auth is available)

**Response**: `200 OK`

```json
{
  "themes": [...],
  "stats": {
    "total": 6,
    "withDarkMode": 4,
    "withCssOverrides": 5
  }
}
```

#### `GET /api/v1/themes?action=registry`

Browse themes from all enabled registry sources.

**Query Parameters**:
- `q` (optional) - Search query to filter registry themes

**Response**: `200 OK`

```json
{
  "themes": [...]
}
```

#### `GET /api/v1/themes?action=registry-sources`

List configured theme registry sources.

**Response**: `200 OK`

```json
{
  "sources": [...]
}
```

#### `GET /api/v1/themes?action=updates`

Check for available theme updates across installed bundle themes.

**Response**: `200 OK`

```json
{
  "updates": [...]
}
```

#### `POST /api/v1/themes?action=install`

Install a `.qtap-theme` bundle via multipart upload.

**Request**: `multipart/form-data`
- `theme` (required) - The `.qtap-theme` file

**Response**: `201 Created`

```json
{
  "message": "Theme installed successfully",
  "themeId": "my-theme",
  "version": "1.0.0"
}
```

#### `POST /api/v1/themes?action=install-from-url`

Install a `.qtap-theme` bundle from a URL.

**Request Body**:

```json
{
  "url": "https://example.com/my-theme.qtap-theme"
}
```

**Response**: `201 Created`

```json
{
  "message": "Theme installed successfully",
  "themeId": "my-theme",
  "version": "1.0.0"
}
```

#### `POST /api/v1/themes?action=add-source`

Add a theme registry source.

**Request Body**:

```json
{
  "name": "My Registry",
  "url": "https://registry.example.com/themes.json",
  "publicKey": "optional-ed25519-public-key"
}
```

**Response**: `201 Created`

```json
{
  "message": "Registry source added",
  "source": { ... }
}
```

#### `POST /api/v1/themes?action=remove-source`

Remove a theme registry source.

**Request Body**:

```json
{
  "name": "My Registry"
}
```

**Response**: `200 OK`

```json
{
  "message": "Registry source \"My Registry\" removed"
}
```

#### `POST /api/v1/themes?action=refresh`

Refresh all registry indexes.

**Response**: `200 OK`

```json
{
  "message": "Refreshed registries, found 12 themes",
  "themeCount": 12
}
```

#### `POST /api/v1/themes?action=install-registry`

Install a theme from a registry source.

**Request Body**:

```json
{
  "themeId": "theme-id",
  "registryUrl": "https://registry.example.com/themes.json"
}
```

**Response**: `201 Created`

```json
{
  "message": "Theme installed from registry",
  "themeId": "theme-id",
  "version": "1.0.0"
}
```

#### `GET /api/v1/themes/[themeId]`

Get metadata for a single theme.

#### `GET /api/v1/themes/[themeId]?action=tokens`

Get the resolved design tokens for the theme.

#### `GET /api/v1/themes/[themeId]?action=export`

Export the theme as a downloadable `.qtap-theme` bundle.

#### `DELETE /api/v1/themes/[themeId]`

Uninstall a bundle theme.

---

### Search

#### `GET /api/v1/ui/search?q=query`

Global search across characters and chats.

**Query Parameters**:
- `q` - Search query (required)
- `type` - Filter by type: `characters`, `chats`

---

### Search & Replace

Bulk search-and-replace across chat messages and memories.

#### `POST /api/v1/search-replace?action=execute`

Execute a search/replace operation.

**Request Body**:

```json
{
  "scope": { "type": "chat", "chatId": "chat-uuid" },
  "searchText": "old name",
  "replaceText": "new name",
  "includeMessages": true,
  "includeMemories": true
}
```

**Scope Options**:
- `{ "type": "chat", "chatId": "uuid" }` - Scope to a specific chat
- `{ "type": "character", "characterId": "uuid" }` - Scope to a specific character

**Response**: `200 OK`

Returns execution results with counts of replacements made.

#### `POST /api/v1/search-replace?action=preview`

Preview counts for a search/replace operation without executing.

**Request Body**: Same as `execute`.

**Response**: `200 OK`

Returns preview counts of matches found.

**Note**: A POST with no action parameter returns `400 Bad Request` with message "Action parameter required: execute or preview".

---

### Background Jobs

#### `GET /api/v1/system/jobs`

Get queue status and jobs.

**Response**: `200 OK`

```json
{
  "stats": {
    "pending": 5,
    "processing": 1,
    "completed": 100,
    "failed": 2,
    "activeTotal": 6
  },
  "jobs": [
    {
      "id": "job-uuid",
      "type": "MEMORY_EXTRACTION",
      "status": "pending",
      "priority": 1,
      "estimatedTokens": 1500,
      "createdAt": "2025-01-19T10:00:00.000Z"
    }
  ],
  "totalEstimatedTokens": 15000
}
```

#### `GET /api/v1/system/jobs/[id]`

Get job details.

#### `DELETE /api/v1/system/jobs/[id]`

Delete a job.

#### `POST /api/v1/system/jobs/[id]?action=pause`

Pause a job.

#### `POST /api/v1/system/jobs/[id]?action=resume`

Resume a paused job.

#### `GET /api/v1/system/tools?action=tasks-queue`

Get tasks queue status. The response includes `maxConcurrentJobs` — the current global background-job concurrency cap.

#### `GET /api/v1/system/tools?action=job-concurrency`

Get the global background-job concurrency cap (how many jobs of any type the dispatcher runs at once).

**Response:**
```json
{ "success": true, "concurrency": 4 }
```

#### `POST /api/v1/system/tools?action=job-concurrency`

Set the global background-job concurrency cap. Applies within ~2 s without a restart.

**Body:**
```json
{ "concurrency": 8 }
```

`concurrency` is an integer in the range 1–32. Returns `{ "success": true, "concurrency": 8 }`.

#### `GET /api/v1/system/tools?action=export-entities`

List the entities of one export type, for the export wizard's selection step.

**Query Parameters:**
- `type` (required) — an `ExportEntityType`: `characters`, `chats`, `roleplay-templates`, `prompt-templates`, `connection-profiles`, `image-profiles`, `embedding-profiles`, `tags`, `projects`, `groups`, `document-stores`, `files`, `provider-models`, `plugin-configs`, `instance-settings`.

**Response:**
```json
{
  "success": true,
  "entities": [{ "id": "…", "name": "…", "memoryCount": 12 }],
  "totalMemoryCount": 12
}
```

`memoryCount` / `totalMemoryCount` are present only for `characters` and `chats`.

Scoping notes, because they are not uniform:

- `document-stores` and `provider-models` are **instance-scoped** — they come from the global repositories, not the user-scoped ones.
- `prompt-templates` and `roleplay-templates` exclude built-ins (`isBuiltIn`), which are seeded from `prompts/` on every instance.
- `files` excludes backup files (`category === 'BACKUP'` or `folderPath === '/backups'`), mirroring the backup service's own rule.
- `instance-settings` is keyed by **setting key**, not a UUID — the table has no id column — and omits the keys that only make sense inside the exporting instance (the three mount-point pointers, `lastMaintenanceSweepAt`, `highest_app_version`).

An unknown `type` returns 400.

#### `POST /api/v1/system/backup`

Create a backup and stage it for download.

**Body (optional):**
```json
{ "compact": true }
```

`compact` defaults to `false`. When true the archive omits every embedding-derived payload — memory embeddings are nulled and `conversation-chunks.json`, `vector-entries.json`, `vector-index-metas.json`, `tfidf-vocabularies.json`, `embedding-status.json`, and `doc-mount-chunks.json` are not written at all — and the manifest records `compact: true`. Restore keys off that flag to enqueue a full `EMBEDDING_REINDEX_ALL`. A malformed body is treated as absent rather than rejected.

**Response:** `201` with `{ "success": true, "backupId": "…", "manifest": { … } }`.

---

### LLM Tools

Endpoints for managing LLM tools available during chat conversations.

#### `GET /api/v1/tools`

List all available LLM tools that can be enabled/disabled per chat.

**Query Parameters:**
- `chatId` (optional) - Chat ID to check tool availability in context

**Response:**
```json
{
  "tools": [
    {
      "id": "generate_image",
      "name": "Generate Image",
      "description": "Generate images using AI image generation providers",
      "source": "built-in",
      "category": "media",
      "available": true
    },
    {
      "id": "search",
      "name": "Search",
      "description": "Search across the Scriptorium — character memories, past conversations, and document stores",
      "source": "built-in",
      "category": "memory",
      "available": true
    },
    {
      "id": "web_search",
      "name": "Web Search",
      "description": "Search the web for current information",
      "source": "built-in",
      "category": "search",
      "available": false,
      "unavailableReason": "Web search must be enabled in the connection profile"
    },
    {
      "id": "project_info",
      "name": "Project Info",
      "description": "Access project information and files (trimmed actions in v4.3)",
      "source": "built-in",
      "category": "project",
      "available": false,
      "unavailableReason": "Chat must be associated with a project"
    },
    {
      "id": "doc_read_file",
      "name": "Doc: Read File",
      "description": "Read a file from a document store (Scriptorium)",
      "source": "built-in",
      "category": "documents",
      "available": true
    },
    {
      "id": "self_inventory",
      "name": "Self Inventory",
      "description": "Introspect character: loaded memories, wardrobe, vault access, current outfit",
      "source": "built-in",
      "category": "self",
      "available": true
    },
    {
      "id": "help_search",
      "name": "Help Search",
      "description": "Search Quilltap help documentation for features, settings, and usage guidance",
      "source": "built-in",
      "category": "help",
      "available": true
    }
  ],
  "count": 6
}
```

**Built-in Tools (v4.3):**

The full list lives in `lib/tools/*-tool.ts`. Highlights:

| Tool ID | Description | Context Requirements |
|---------|-------------|---------------------|
| `generate_image` | AI image generation (Lantern) | Requires image profile on character |
| `search` | Unified search over memories, conversations, and Scriptorium documents (renamed from `search_memories`; the old name still works as a parser alias) | Always available |
| `web_search` | Web search via the configured search provider plugin | Requires web search enabled in connection profile |
| `help_search` / `help_navigate` / `help_settings` | Search and navigate the in-app help system | Always available |
| `project_info` | Project file access (trimmed action set in v4.3) | Chat must be in a project |
| `doc_read_file` / `doc_write_file` / `doc_str_replace` / `doc_grep` / `doc_list_files` / `doc_open_document` / `doc_close_document` / `doc_focus` / `doc_create_folder` / `doc_delete_folder` / `doc_delete_file` / `doc_move_file` / `doc_move_folder` / `doc_copy_file` / `doc_insert_text` / `doc_read_heading` / `doc_update_heading` / `doc_read_frontmatter` / `doc_update_frontmatter` / `doc_read_blob` / `doc_write_blob` / `doc_list_blobs` / `doc_delete_blob` | Document-store (Scriptorium) read/write tools — replaces the old `file_management` tool | Document store available; some require Document Mode |
| `self_inventory` | Character introspection (loaded memories, wardrobe, vault access) | Always available |
| `state` | Persistent chat state (Pascal: inventory, stats, counters) | Always available |
| `rng` | Dice / coin / random rolls (Pascal) | Always available |
| `whisper` | Send a private message to a specific character | Multi-character chats |
| `read_conversation` | Read prior conversation history with filters | Always available |
| `upsert_annotation` / `delete_annotation` | Manage conversation annotations | Always available |
| `wardrobe_list` / `wardrobe_read` / `wardrobe_wear` / `wardrobe_take_off` | Browse/inspect/wear/remove wardrobe items (own + project + Quilltap General) | `canDressThemselves` |
| `wardrobe_create` / `wardrobe_update` / `wardrobe_archive` | Author/edit/retire wardrobe items (own items only for edit/archive) | `canCreateOutfits` |
| `submit_final_response` | Agent-mode wrap-up | Agent mode only |
| `request_full_context` | Request full context expansion | Context compression enabled |

**Notes:**
- When `chatId` is provided, the response includes `available` and `unavailableReason` fields
- Plugin-provided tools are also included with `source: "plugin"`
- The `request_full_context` tool is intentionally excluded (always available when context compression is enabled)

---

### Plugins (v1)

Modern plugin management API under `/api/v1/`.

#### `GET /api/v1/plugins`

List all registered plugins with system stats.

**Query Parameters**:
- `filter=installed` - List only enabled/installed plugins

**Response**: `200 OK`

```json
{
  "plugins": [...],
  "stats": {
    "total": 15,
    "enabled": 14,
    "disabled": 1,
    "errors": 0,
    "initialized": true
  },
  "errors": [],
  "count": 15
}
```

#### `GET /api/v1/plugins?action=check-upgrades`

Check for available plugin upgrades with enhanced metadata including breaking change detection.

**Response**: `200 OK`

```json
{
  "upgrades": [
    {
      "packageName": "qtap-plugin-example",
      "currentVersion": "1.0.0",
      "latestVersion": "1.1.0",
      "isNonBreaking": true
    }
  ],
  "lastChecked": "2026-01-15T12:00:00.000Z",
  "count": 1
}
```

#### `POST /api/v1/plugins?action=search`

Search the npm registry for Quilltap plugins.

**Request Body**:

```json
{
  "query": "openai",
  "type": "all"
}
```

**Validation**:
- `query`: Required, min 1 character
- `type`: Optional, one of `"provider"`, `"theme"`, `"tool"`, `"all"` (default: `"all"`)

**Response**: `200 OK`

```json
{
  "results": [
    {
      "name": "qtap-plugin-openai",
      "version": "1.0.5",
      "description": "OpenAI provider plugin",
      "author": "Foundry 9",
      "keywords": ["quilltap", "plugin", "openai"],
      "updated": "2026-01-15",
      "score": 0.95,
      "links": { ... }
    }
  ],
  "count": 1
}
```

#### `POST /api/v1/plugins?action=install`

Install a plugin from npm.

**Request Body**:

```json
{
  "packageName": "qtap-plugin-example",
  "version": "1.0.0"
}
```

**Response**: `201 Created`

```json
{
  "success": true,
  "message": "Plugin installed successfully",
  "plugin": {
    "name": "qtap-plugin-example",
    "version": "1.0.0",
    "manifest": { ... }
  }
}
```

#### `POST /api/v1/plugins?action=uninstall`

Uninstall a plugin.

**Request Body**:

```json
{
  "packageName": "qtap-plugin-example"
}
```

**Response**: `200 OK`

```json
{
  "success": true,
  "message": "Plugin uninstalled successfully"
}
```

#### `GET /api/v1/plugins/[name]`

Get details for a single plugin.

#### `GET /api/v1/plugins/[name]?action=get-config`

Get the plugin's current configuration.

#### `PUT /api/v1/plugins/[name]`

Enable or disable the plugin.

#### `POST /api/v1/plugins/[name]?action=set-config`

Update the plugin's configuration.

---

### Projects

Project management endpoints for organizing chats, files, and characters.

#### `GET /api/v1/projects`

List all projects for the current user.

#### `POST /api/v1/projects`

Create a new project.

**Request Body:**
```json
{
  "name": "My Project",
  "description": "Optional description",
  "instructions": "Optional system prompt instructions",
  "allowAnyCharacter": false
}
```

#### `GET /api/v1/projects/[id]`

Get project details with enriched character roster and counts.

#### `PUT /api/v1/projects/[id]`

Update project properties.

**Request Body:**
```json
{
  "name": "Updated Name",
  "description": "Updated description",
  "instructions": "Updated instructions",
  "allowAnyCharacter": true,
  "color": "#3b82f6",
  "icon": "folder"
}
```

#### `DELETE /api/v1/projects/[id]`

Delete a project. Chats and files are disassociated (not deleted).

#### `POST /api/v1/projects/[id]?action=add-character`

Add a character to the project roster.

**Request Body:**
```json
{
  "characterId": "uuid"
}
```

#### `DELETE /api/v1/projects/[id]?action=remove-character`

Remove a character from the project roster.

**Request Body:**
```json
{
  "characterId": "uuid"
}
```

#### `GET /api/v1/projects/[id]?action=list-chats`

List chats in the project with pagination.

**Query Parameters:**
- `limit` - Number of chats to return (default: 20)
- `offset` - Offset for pagination (default: 0)

#### `POST /api/v1/projects/[id]?action=add-chat`

Associate a chat with the project.

**Request Body:**
```json
{
  "chatId": "uuid"
}
```

#### `DELETE /api/v1/projects/[id]?action=remove-chat`

Remove a chat from the project.

**Request Body:**
```json
{
  "chatId": "uuid"
}
```

#### `POST /api/v1/projects/[id]?action=update-tool-settings`

Update default tool settings for new chats in the project.

**Request Body:**
```json
{
  "defaultDisabledTools": ["tool_id_1", "tool_id_2"],
  "defaultDisabledToolGroups": ["plugin:mcp"]
}
```

**Response:**
```json
{
  "success": true,
  "defaultDisabledTools": ["tool_id_1", "tool_id_2"],
  "defaultDisabledToolGroups": ["plugin:mcp"]
}
```

When a new chat is created within a project, it inherits these default tool settings. Existing chats are not affected.

#### `GET /api/v1/projects/[id]/mount-points`

List the mount points (document stores) linked to a project.

#### `POST /api/v1/projects/[id]/mount-points`

Link a mount point to the project. Body: `{ mountPointId }`.

#### `DELETE /api/v1/projects/[id]/mount-points`

Unlink a mount point from the project. Body: `{ mountPointId }`.

#### `GET /api/v1/projects/[id]/wardrobe`

List the project's wardrobe items (the project tier of the tri-tier wardrobe model: character vault + project stores + Quilltap General), read from the project's `Wardrobe/` folder.

#### `POST /api/v1/projects/[id]/wardrobe`

Create a project wardrobe item. Body: `{ title, description?, types, appropriateness?, isDefault?, componentItemIds?, replace? }`.

#### `GET /api/v1/projects/[id]/wardrobe/[itemId]`

Fetch one project wardrobe item.

#### `PUT /api/v1/projects/[id]/wardrobe/[itemId]`

Update one project wardrobe item.

#### `DELETE /api/v1/projects/[id]/wardrobe/[itemId]`

Delete one project wardrobe item.

---

### Groups

Character groups bundle several characters and their shared document stores. Group **state** is documented separately under [Group State](#group-state); these endpoints cover the group itself, its membership, and its linked stores.

#### `GET /api/v1/groups`

List all groups.

#### `POST /api/v1/groups`

Create a new group.

#### `GET /api/v1/groups/[id]`

Get group details.

#### `PUT /api/v1/groups/[id]`

Update a group.

#### `DELETE /api/v1/groups/[id]`

Delete a group.

#### `GET /api/v1/groups/[id]?action=members`

List the group's member characters.

#### `POST /api/v1/groups/[id]?action=addMember`

Add a character to the group.

#### `DELETE /api/v1/groups/[id]?action=removeMember`

Remove a character from the group.

#### `GET /api/v1/groups/[id]?action=stores`

List the document stores linked to the group.

#### `POST /api/v1/groups/[id]?action=linkStore`

Link a document store to the group.

#### `DELETE /api/v1/groups/[id]?action=unlinkStore`

Unlink a document store from the group.

#### `GET /api/v1/groups/[id]/mount-points`

List the mount points linked to a group.

#### `POST /api/v1/groups/[id]/mount-points`

Link a mount point to the group. Body: `{ mountPointId }`.

#### `DELETE /api/v1/groups/[id]/mount-points`

Unlink a mount point from the group. Body: `{ mountPointId }`.

---

### Scenarios

Scenarios are Markdown files (with frontmatter: `name`, `description`, `isDefault`, body) kept in a `Scenarios/` folder. They exist at three tiers — **general** (instance-wide "Quilltap General" store), **project**, and **group** — that share an identical endpoint shape. Each collection endpoint ensures the backing store and its `Scenarios/` folder exist first, so callers don't wait for the next startup heal pass. Frontmatter is parsed and default-conflict resolution is applied on read.

For the single-scenario endpoints, `[scenarioPath]` is the URL-encoded filename relative to `Scenarios/`; the bare filename (with or without `.md`) is accepted and the `Scenarios/` prefix is applied server-side. `..` segments are rejected.

**General tier**

- `GET /api/v1/scenarios` — list general scenarios. Tolerates the pre-migration race (returns an empty list with `mountPointId: null`).
- `POST /api/v1/scenarios` — create a general scenario. Body: `{ filename, name?, description?, isDefault?, body }`. Rejects writes during the pre-migration window.
- `GET /api/v1/scenarios/[scenarioPath]` — read one.
- `PUT /api/v1/scenarios/[scenarioPath]` — update content + frontmatter.
- `POST /api/v1/scenarios/[scenarioPath]?action=rename` — rename the file.
- `DELETE /api/v1/scenarios/[scenarioPath]` — delete the file.

**Project tier**

- `GET /api/v1/projects/[id]/scenarios` · `POST /api/v1/projects/[id]/scenarios`
- `GET`/`PUT`/`DELETE /api/v1/projects/[id]/scenarios/[scenarioPath]` · `POST …?action=rename`

**Group tier**

- `GET /api/v1/groups/[id]/scenarios` · `POST /api/v1/groups/[id]/scenarios`
- `GET`/`PUT`/`DELETE /api/v1/groups/[id]/scenarios/[scenarioPath]` · `POST …?action=rename`

#### `GET /api/v1/groups/scenarios?characterIds=<id,id,...>`

The New Chat dialog's participant-union aggregation: for every group that **any** of the supplied prospective participants belongs to, returns that group's `Scenarios/` entries grouped under the group's name. This is the one sanctioned exception to a group's otherwise strict per-responding-character isolation — scenarios are a chat-creation-time menu, not a per-turn access grant, so this route must never feed the per-turn tier resolver.

---

### Help Docs

Help documentation endpoints for in-app help system.

#### `GET /api/v1/help-docs`

List all help documents (metadata only). Loads and caches the help bundle on first request.

**Response**: `200 OK`

```json
{
  "documents": [...]
}
```

#### `GET /api/v1/help-docs?action=chat-count`

Get the count of salon chats (non-help chats) for the current user.

**Response**: `200 OK`

```json
{
  "count": 42
}
```

#### `GET /api/v1/help-docs/[id]`

Get a single help document, including its rendered content.

---

### Help Chats

Help chat system for in-app character-assisted help with tool use and streaming responses.

#### `GET /api/v1/help-chats`

List help chats for the current user, sorted by most recently updated.

**Response**: `200 OK`

```json
{
  "chats": [
    {
      "id": "chat-uuid",
      "title": "Help: Alice",
      "updatedAt": "2026-01-15T12:00:00.000Z",
      "participants": [...],
      "messageCount": 5,
      "helpPageUrl": "/settings?tab=chat"
    }
  ]
}
```

#### `GET /api/v1/help-chats?action=eligibility`

Check which characters are eligible for help chats (have help tools enabled and tool-capable connection profiles).

**Response**: `200 OK`

```json
{
  "eligible": true,
  "characters": [
    {
      "id": "char-uuid",
      "name": "Alice",
      "avatarUrl": "/api/v1/files/file-uuid",
      "defaultHelpToolsEnabled": true,
      "connectionProfileId": "profile-uuid",
      "hasToolCapableProfile": true
    }
  ],
  "reasons": []
}
```

#### `POST /api/v1/help-chats`

Create a new help chat.

**Request Body**:

```json
{
  "characterIds": ["char-uuid-1"],
  "pageUrl": "/settings?tab=chat"
}
```

**Validation**:
- `characterIds`: Required, array of UUIDs, min 1 character
- `pageUrl`: Required string
- At least one character must have `defaultHelpToolsEnabled: true`

**Response**: `201 Created`

```json
{
  "chat": { ... }
}
```

#### `GET /api/v1/help-chats/[id]`

Get help chat details with enriched participants and message count.

**Response**: `200 OK`

```json
{
  "chat": { ... }
}
```

#### `PATCH /api/v1/help-chats/[id]`

Rename a help chat.

**Request Body**:

```json
{
  "title": "New Title"
}
```

**Response**: `200 OK`

```json
{
  "chat": { ... }
}
```

#### `PATCH /api/v1/help-chats/[id]?action=update-context`

Update the page context for a help chat. Injects a system message noting the navigation.

**Request Body**:

```json
{
  "pageUrl": "/settings?tab=system"
}
```

**Response**: `200 OK`

```json
{
  "chat": { ... }
}
```

#### `DELETE /api/v1/help-chats/[id]`

Delete a help chat.

**Response**: `200 OK`

```json
{
  "message": "Help chat deleted successfully"
}
```

#### `GET /api/v1/help-chats/[id]/messages`

Load messages for a help chat.

**Response**: `200 OK`

```json
{
  "messages": [...]
}
```

#### `POST /api/v1/help-chats/[id]/messages`

Send a message to a help chat and receive a streaming response.

**Request Body**:

```json
{
  "content": "How do I configure a connection profile?",
  "fileIds": ["file-uuid"]
}
```

**Response**: Server-Sent Events (`text/event-stream`)

Streams the help character's response in real-time, including tool calls (help search, file management, etc.).

---

### System Deployment

#### `GET /api/v1/system/deployment`

Returns deployment information. This endpoint is unauthenticated as it is needed during app initialization.

**Authentication**: Not required

**Response**: `200 OK`

```json
{
  "isUserManaged": true,
  "isHosted": false
}
```

| Field | Description |
|-------|-------------|
| `isUserManaged` | `true` for self-hosted deployments |
| `isHosted` | `true` for hosted/cloud deployments (inverse of `isUserManaged`) |

---

### System Home

#### `GET /api/v1/system/home`

Returns the home dashboard payload for the client-rendered workspace home tab: greeting name, the "continue last" chat id, recent chats, active projects, and characters. The server-rendered `/` route computes the same payload directly through the shared `home-data` service, so this endpoint exists for the workspace tab to fetch it client-side. See `docs/developer/features/tabbed-workspace.md`.

**Response**: `200 OK` — the home dashboard data object.

---

### System Autonomous Rooms

#### `GET /api/v1/system/autonomous-rooms`

List every autonomous room owned by the authenticated user, with enough context for the Settings → System management surface to render `runState` badges, last/next run, budgets consumed, and to route into a transcript on demand. (Per-room control lives under [Autonomous Room Control](#autonomous-room-control).)

---

### System Browse Directory

#### `GET /api/v1/system/browse-directory?path=/some/path`

List the immediate subdirectories of the given path for the directory-picker UI. Returns the resolved path and its subdirectories. With no `path`, lists the user's home directory.

---

### System Conversation Summaries

Backfill utility for the Commonplace Book's relevant-conversations retrieval.

#### `POST /api/v1/system/conversation-summaries?action=regenerate`

Enqueue a background job that re-mirrors every summarized chat's context summary into its participant character vaults (the files the retrieval reads). Returns immediately; the work runs in the background.

#### `GET /api/v1/system/conversation-summaries?action=regenerate`

Report whether a regeneration is currently in flight.

---

### System Image Aesthetics

Read/write the instance-wide "Default Aesthetic" files behind the two editors on the Images settings tab. The doc-store file is the source of truth; the editors are views over it. Single tier — no fallback.

#### `GET /api/v1/system/image-aesthetics?kind=lantern|aurora`

Read the Quilltap General store's aesthetic file. `kind=lantern` → `lantern-aesthetics.md` (general/scene look); `kind=aurora` → `aurora-aesthetics.md` (how people and outfits are depicted).

#### `PUT /api/v1/system/image-aesthetics?kind=lantern|aurora`

Write that file — or, when the body is empty, delete it.

---

### System Startup Status

#### `GET /api/v1/system/startup-status`

Return the live state of server startup — coarse phase plus the event stream, current label, and sub-progress — to drive the loading-screen UI.

**Authentication**: Not required. The loading screen runs before any session exists; the only data exposed is generic "what the server is doing right now," so no user data leaks.

---

### System Plugin Initialization

#### `GET /api/v1/system/plugins/initialize`

Returns the current plugin initialization status without triggering initialization.

**Authentication**: Not required (runs during startup before auth is available)

**Response**: `200 OK`

```json
{
  "success": true,
  "state": { ... }
}
```

#### `POST /api/v1/system/plugins/initialize`

Triggers plugin system initialization. Scans and loads all plugins. This endpoint is idempotent.

**Authentication**: Not required (runs during startup before auth is available)

**Response**: `200 OK`

```json
{
  "success": true,
  "result": {
    "success": true,
    "warnings": [],
    "errors": []
  }
}
```

---

### System Plugin Upgrades

Plugin upgrade notification management. Unauthenticated as it runs during startup.

#### `GET /api/v1/system/plugins/upgrades`

Returns pending upgrade notifications from server startup. Returns null results if already notified or no upgrades occurred.

**Authentication**: Not required

**Response**: `200 OK`

```json
{
  "success": true,
  "ready": true,
  "results": {
    "upgraded": [
      {
        "name": "qtap-plugin-openai",
        "from": "1.0.4",
        "to": "1.0.5"
      }
    ],
    "failed": []
  }
}
```

| Field | Description |
|-------|-------------|
| `ready` | `false` if server startup is not yet complete |
| `results` | `null` if no un-notified upgrades exist |

#### `POST /api/v1/system/plugins/upgrades`

Mark upgrade notifications as acknowledged. Call this after showing toast notifications to prevent re-notification.

**Authentication**: Not required

**Response**: `200 OK`

```json
{
  "success": true,
  "message": "Upgrades marked as notified"
}
```

---

### System Pepper Vault (Deprecated)

> **Deprecated**: This endpoint has been replaced by `/api/v1/system/unlock`. All methods return `410 Gone`.

#### `GET /api/v1/system/pepper-vault`

**Response**: `410 Gone`

```json
{
  "error": "Gone",
  "message": "The pepper-vault endpoint has been replaced by /api/v1/system/unlock",
  "replacement": "/api/v1/system/unlock"
}
```

#### `POST /api/v1/system/pepper-vault`

**Response**: `410 Gone` (same body as GET)

---

### File Proxy

Serves files stored in the local filesystem through the API with authentication and ownership verification.

#### `GET /api/v1/files/proxy/[...key]`

Download a file by storage key. The key is the path segments of the file's storage key.

**Response**: File binary with appropriate headers:
- `Content-Type` - File MIME type
- `Content-Length` - File size
- `Content-Disposition` - Inline with filename (supports RFC 5987 for Unicode filenames)
- `Cache-Control` - `public, max-age=31536000, immutable`

**Error Responses**:
- `404 Not Found` - File not found in database or storage key not provided
- `403 Forbidden` - File does not belong to the authenticated user

---

## SDK Examples

### JavaScript/TypeScript

```typescript
// Send message with streaming
async function sendMessage(chatId: string, content: string) {
  const response = await fetch(`/api/v1/messages?chatId=${chatId}`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ content }),
  });

  const reader = response.body?.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader!.read();
    if (done) break;

    const chunk = decoder.decode(value);
    const lines = chunk.split('\n\n');

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = JSON.parse(line.slice(6));

        if (data.type === 'token') {
          process.stdout.write(data.content);
        } else if (data.type === 'tool_call') {
          console.log('Tool called:', data.name);
        } else if (data.type === 'done') {
          console.log('\nMessage ID:', data.messageId);
        }
      }
    }
  }
}

// Toggle character favorite
async function toggleFavorite(characterId: string) {
  const response = await fetch(`/api/v1/characters/${characterId}?action=favorite`, {
    method: 'POST',
    credentials: 'include',
  });
  return response.json();
}
```

### Python

```python
import requests

# List characters
response = requests.get(
    'https://yourdomain.com/api/v1/characters',
    cookies={'quilltap-session': 'your-session-cookie'}
)
data = response.json()
characters = data['characters']
```

## Versioning

Current API version: **v4.3-dev**

All core endpoints use the `/api/v1/` prefix. Legacy routes (without prefix) were removed in v2.8.

The API follows semantic versioning. Breaking changes are avoided where possible.

## Support

- Report issues: https://github.com/foundry-9/quilltap-server/issues
- Documentation: https://github.com/foundry-9/quilltap-server/tree/main/docs
