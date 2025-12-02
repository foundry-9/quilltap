# Plugin Manifest Schema Documentation

This document describes the complete schema for Quilltap plugin `manifest.json` files.

## Overview

Every Quilltap plugin must include a `manifest.json` file in its root directory. This file describes the plugin's metadata, capabilities, requirements, and configuration.

## Schema Location

The authoritative schema is defined in TypeScript using Zod at:

- **Schema**: `lib/json-store/schemas/plugin-manifest.ts`
- **Loader**: `lib/plugins/manifest-loader.ts`
- **JSON Schema**: `plugins/dist/qtap-plugin-template/schemas/plugin-manifest.schema.json`

## Validation

The manifest is validated at runtime using Zod schemas. Invalid manifests will prevent the plugin from loading.

## Required Fields

### `name` (string, required)

- **Format**: Must start with `qtap-plugin-` followed by lowercase letters, numbers, or hyphens
- **Example**: `"qtap-plugin-my-provider"`
- **Purpose**: Unique identifier for the plugin

### `title` (string, required)

- **Max length**: 100 characters
- **Example**: `"My Custom LLM Provider"`
- **Purpose**: Human-readable plugin name displayed in UI

### `description` (string, required)

- **Max length**: 500 characters
- **Example**: `"Integrates with CustomAI's API for text generation"`
- **Purpose**: Brief description of plugin functionality

### `version` (string, required)

- **Format**: Semantic versioning (semver) with optional pre-release and build metadata
- **Examples**:
  - `"1.0.0"`
  - `"2.1.3-beta.1"`
  - `"1.0.0-alpha+001"`
- **Purpose**: Plugin version for compatibility and update tracking

### `author` (string | object, required)

- **String format**: `"Name <email> (url)"`
- **Object format**:

  ```json
  {
    "name": "Author Name",
    "email": "author@example.com",
    "url": "https://example.com"
  }
  ```

- **Purpose**: Plugin author information

### `main` (string, required)

- **Default**: `"index.js"`
- **Example**: `"dist/plugin.js"`
- **Purpose**: Entry point file for the plugin

### `compatibility` (object, required)

- **Required fields**:
  - `quilltapVersion`: Minimum Quilltap version (e.g., `">=1.7.0"`)
  - `quilltapMaxVersion` (optional): Maximum Quilltap version (e.g., `"<=2.0.0"`)
  - `nodeVersion` (optional): Minimum Node.js version (e.g., `">=18.0.0"`)
- **Example**:

  ```json
  {
    "compatibility": {
      "quilltapVersion": ">=1.7.0",
      "quilttapMaxVersion": "<=2.0.0",
      "nodeVersion": ">=18.0.0"
    }
  }
  ```

## Optional Fields

### `license` (string, optional)

- **Default**: `"MIT"`
- **Format**: SPDX license identifier
- **Examples**: `"MIT"`, `"Apache-2.0"`, `"GPL-3.0"`, `"ISC"`

### `homepage` (string, optional)

- **Format**: Valid URL
- **Example**: `"https://github.com/user/qtap-plugin-example"`

### `repository` (string | object, optional)

- **String format**: Repository URL
- **Object format**:

  ```json
  {
    "type": "git",
    "url": "https://github.com/user/qtap-plugin-example.git"
  }
  ```

### `bugs` (string | object, optional)

- **String format**: Bug tracker URL
- **Object format**:

  ```json
  {
    "url": "https://github.com/user/qtap-plugin-example/issues",
    "email": "bugs@example.com"
  }
  ```

## Capabilities

### `capabilities` (array, optional)

- **Default**: `[]`
- **Purpose**: Declares what functionality the plugin provides
- **Available capabilities** (19 types):
  - `CHAT_COMMANDS` - Custom chat commands
  - `MESSAGE_PROCESSORS` - Message transformation
  - `UI_COMPONENTS` - React components
  - `DATA_STORAGE` - Database tables/storage
  - `API_ROUTES` - API endpoints
  - `AUTH_METHODS` - Authentication methods
  - `WEBHOOKS` - Webhook handlers
  - `BACKGROUND_TASKS` - Background jobs
  - `CUSTOM_MODELS` - Data models
  - `FILE_HANDLERS` - File operations
  - `NOTIFICATIONS` - Notification system
  - `BACKEND_INTEGRATIONS` - External service integrations
  - `LLM_PROVIDER` - LLM chat provider
  - `IMAGE_PROVIDER` - Image generation
  - `EMBEDDING_PROVIDER` - Embedding generation
  - `THEME` - UI theme
  - `DATABASE_BACKEND` - Database replacement/augmentation
  - `FILE_BACKEND` - File storage replacement/augmentation
  - `UPGRADE_MIGRATION` - Database migration runner

**Example**:

```json
{
  "capabilities": ["LLM_PROVIDER", "IMAGE_PROVIDER"]
}
```

### `functionality` (object, optional, deprecated)

Legacy boolean flags for capabilities. Use `capabilities` array instead.

## Provider Configuration

### `providerConfig` (object, optional)

For plugins with `LLM_PROVIDER` capability, this section defines provider-specific configuration.

**Schema**:

```json
{
  "providerConfig": {
    "providerName": "MY_PROVIDER",
    "displayName": "My Provider",
    "description": "Description of the provider",
    "abbreviation": "MYP",
    "colors": {
      "bg": "bg-blue-100",
      "text": "text-blue-800",
      "icon": "text-blue-600"
    },
    "requiresApiKey": true,
    "requiresBaseUrl": false,
    "apiKeyLabel": "API Key",
    "baseUrlLabel": "Base URL",
    "baseUrlDefault": "https://api.example.com",
    "baseUrlPlaceholder": "https://api.example.com/v1",
    "capabilities": {
      "chat": true,
      "imageGeneration": false,
      "embeddings": false,
      "webSearch": false
    },
    "attachmentSupport": {
      "supported": true,
      "mimeTypes": ["image/jpeg", "image/png", "application/pdf"],
      "description": "Images and PDFs supported"
    }
  }
}
```

**Fields**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `providerName` | string | Yes | Internal ID (e.g., 'OPENAI', 'ANTHROPIC') |
| `displayName` | string | Yes | Human-readable name for UI |
| `description` | string | No | Short description |
| `abbreviation` | string | Yes | 2-4 character abbreviation for icon |
| `colors.bg` | string | Yes | Tailwind background color class |
| `colors.text` | string | Yes | Tailwind text color class |
| `colors.icon` | string | Yes | Tailwind icon color class |
| `requiresApiKey` | boolean | Yes | Whether provider needs an API key |
| `requiresBaseUrl` | boolean | Yes | Whether provider needs a custom URL |
| `apiKeyLabel` | string | No | Custom label for API key field |
| `baseUrlLabel` | string | No | Custom label for base URL field |
| `baseUrlDefault` | string | No | Default base URL value |
| `baseUrlPlaceholder` | string | No | Placeholder for base URL input |
| `capabilities.chat` | boolean | Yes | Supports chat completions |
| `capabilities.imageGeneration` | boolean | Yes | Supports image generation |
| `capabilities.embeddings` | boolean | Yes | Supports text embeddings |
| `capabilities.webSearch` | boolean | Yes | Supports web search |
| `attachmentSupport.supported` | boolean | Yes | Supports file attachments |
| `attachmentSupport.mimeTypes` | string[] | Yes | Supported MIME types |
| `attachmentSupport.description` | string | No | Human-readable description |

## Technical Details

### `frontend` (string, optional)

- **Default**: `"REACT"`
- **Options**: `REACT`, `PREACT`, `VUE`, `SVELTE`, `NONE`

### `styling` (string, optional)

- **Default**: `"TAILWIND"`
- **Options**: `TAILWIND`, `BOOTSTRAP`, `MATERIAL_UI`, `CSS_MODULES`, `STYLED_COMPONENTS`, `NONE`

### `typescript` (boolean, optional)

- **Default**: `true`
- **Purpose**: Indicates if plugin is written in TypeScript

## Hooks

### `hooks` (array, optional)

Registers hooks to extend Quilltap's behavior.

**Schema**:

```json
{
  "hooks": [
    {
      "name": "chat.beforeSend",
      "handler": "./hooks/before-send.js",
      "priority": 50,
      "enabled": true
    }
  ]
}
```

**Fields**:

- `name` (string, required): Hook identifier
- `handler` (string, required): Path to handler file (relative to plugin root)
- `priority` (number, 0-100): Execution priority (lower runs first, default: 50)
- `enabled` (boolean): Whether hook is active (default: true)

## API Routes

### `apiRoutes` (array, optional)

Defines new API endpoints provided by the plugin.

**Schema**:

```json
{
  "apiRoutes": [
    {
      "path": "/api/plugin/my-endpoint",
      "methods": ["GET", "POST"],
      "handler": "./routes/my-endpoint.js",
      "requiresAuth": true,
      "description": "Custom endpoint"
    }
  ]
}
```

**Fields**:

- `path` (string, required): Route path (must start with `/api/`)
- `methods` (array, required): HTTP methods (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`)
- `handler` (string, required): Path to handler file
- `requiresAuth` (boolean): Requires authentication (default: true)
- `description` (string, optional): Route description

## UI Components

### `components` (array, optional)

Registers React components for use in Quilltap's UI.

**Schema**:

```json
{
  "components": [
    {
      "id": "my-component",
      "name": "My Component",
      "path": "./components/MyComponent.tsx",
      "slots": ["chat.sidebar", "settings.panel"],
      "propsSchema": {}
    }
  ]
}
```

**Fields**:

- `id` (string, required): Component identifier (lowercase, hyphens allowed)
- `name` (string, required): Display name
- `path` (string, required): Path to component file
- `slots` (array, optional): Where component can be used
- `propsSchema` (object, optional): JSON Schema for component props

## Database Models

### `models` (array, optional)

Defines database tables/models added by the plugin.

**Schema**:

```json
{
  "models": [
    {
      "name": "CustomData",
      "schemaPath": "./schemas/custom-data.ts",
      "collectionName": "custom-data",
      "description": "Stores custom plugin data"
    }
  ]
}
```

**Fields**:

- `name` (string, required): Model name (PascalCase)
- `schemaPath` (string, required): Path to Zod schema file
- `collectionName` (string, required): Database collection/table name (lowercase, hyphens/underscores)
- `description` (string, optional): Model description

## Configuration

### `configSchema` (array, optional)

Defines configuration fields exposed in the UI.

**Schema**:

```json
{
  "configSchema": [
    {
      "key": "apiKey",
      "label": "API Key",
      "type": "password",
      "default": "",
      "required": true,
      "description": "Your API key"
    },
    {
      "key": "maxRequests",
      "label": "Max Requests",
      "type": "number",
      "default": 100,
      "min": 1,
      "max": 1000,
      "description": "Maximum requests per hour"
    },
    {
      "key": "mode",
      "label": "Mode",
      "type": "select",
      "options": [
        { "label": "Fast", "value": "fast" },
        { "label": "Balanced", "value": "balanced" }
      ]
    }
  ]
}
```

**Field types**: `text`, `number`, `boolean`, `select`, `textarea`, `password`, `url`, `email`

### `defaultConfig` (object, optional)

Default configuration values.

## Permissions

### `permissions` (object, optional)

Declares required permissions.

**Schema**:

```json
{
  "permissions": {
    "fileSystem": ["user-data/plugins", "exports"],
    "network": ["api.example.com", "cdn.example.com"],
    "environment": ["API_KEY", "SECRET_TOKEN"],
    "database": true,
    "userData": true
  }
}
```

**Fields**:

- `fileSystem` (array): Allowed file system paths (relative to data directory)
- `network` (array): Allowed network domains/URLs
- `environment` (array): Required environment variables
- `database` (boolean): Requires database access
- `userData` (boolean): Requires user data access

### `sandboxed` (boolean, optional)

- **Default**: `true`
- **Purpose**: Whether plugin runs in sandboxed environment

## Metadata

### `keywords` (array, optional)

- **Default**: `[]`
- **Purpose**: Search/discovery keywords
- **Example**: `["ai", "llm", "provider", "openai"]`

### `icon` (string, optional)

- **Purpose**: Path to plugin icon (relative to plugin root)
- **Example**: `"assets/icon.png"`

### `screenshots` (array, optional)

- **Default**: `[]`
- **Purpose**: URLs or file paths to screenshots
- **Example**: `["screenshots/main.png", "screenshots/settings.png"]`

### `category` (string, optional)

- **Default**: `"OTHER"`
- **Options**: `PROVIDER`, `THEME`, `INTEGRATION`, `UTILITY`, `ENHANCEMENT`, `DATABASE`, `STORAGE`, `AUTHENTICATION`, `OTHER`

### `enabledByDefault` (boolean, optional)

- **Default**: `false`
- **Purpose**: Whether plugin is enabled when installed

### `status` (string, optional)

- **Default**: `"STABLE"`
- **Options**: `STABLE`, `BETA`, `ALPHA`, `DEPRECATED`

## Complete Example: LLM Provider Plugin

```json
{
  "$schema": "../qtap-plugin-template/schemas/plugin-manifest.schema.json",
  "name": "qtap-plugin-custom-llm",
  "title": "Custom LLM Provider",
  "description": "Integration with CustomAI's API for advanced text generation",
  "version": "1.2.3",
  "author": {
    "name": "Jane Developer",
    "email": "jane@example.com",
    "url": "https://example.com"
  },
  "license": "MIT",
  "main": "index.js",
  "homepage": "https://github.com/jane/qtap-plugin-custom-llm",
  "repository": {
    "type": "git",
    "url": "https://github.com/jane/qtap-plugin-custom-llm.git"
  },
  "compatibility": {
    "quilltapVersion": ">=1.7.0",
    "nodeVersion": ">=18.0.0"
  },
  "capabilities": ["LLM_PROVIDER"],
  "category": "PROVIDER",
  "frontend": "REACT",
  "styling": "TAILWIND",
  "typescript": true,
  "enabledByDefault": true,
  "status": "STABLE",
  "keywords": ["llm", "ai", "custom", "provider"],
  "providerConfig": {
    "providerName": "CUSTOM_AI",
    "displayName": "Custom AI",
    "description": "Custom AI provider for text generation",
    "abbreviation": "CAI",
    "colors": {
      "bg": "bg-indigo-100",
      "text": "text-indigo-800",
      "icon": "text-indigo-600"
    },
    "requiresApiKey": true,
    "requiresBaseUrl": false,
    "apiKeyLabel": "CustomAI API Key",
    "capabilities": {
      "chat": true,
      "imageGeneration": false,
      "embeddings": false,
      "webSearch": false
    },
    "attachmentSupport": {
      "supported": false,
      "mimeTypes": [],
      "description": "No file attachments supported"
    }
  },
  "permissions": {
    "network": ["api.customai.com"],
    "userData": false,
    "database": false
  }
}
```

## Complete Example: Upgrade Migration Plugin

```json
{
  "name": "qtap-plugin-upgrade",
  "title": "Quilltap Upgrade",
  "description": "Handles database migrations and upgrades between Quilltap versions",
  "version": "1.0.0",
  "author": {
    "name": "Foundry-9",
    "email": "charles@sebold.tech"
  },
  "license": "MIT",
  "main": "index.js",
  "compatibility": {
    "quilltapVersion": ">=1.7.0"
  },
  "capabilities": ["UPGRADE_MIGRATION"],
  "category": "UTILITY",
  "enabledByDefault": true,
  "status": "STABLE"
}
```

## Validation

Use the provided utilities to validate manifests:

```typescript
import { validatePluginManifest, safeValidatePluginManifest } from '@/lib/plugins';

// Throws on error
const manifest = validatePluginManifest(data);

// Returns result object
const result = safeValidatePluginManifest(data);
if (result.success) {
  console.log(result.data);
} else {
  console.error(result.errors);
}
```

## See Also

- [Plugin Developer Guide](../plugins/README.md)
- [LLM Provider Guide](../plugins/LLM-PROVIDER-GUIDE.md)
- [Plugin Initialization](./PLUGIN_INITIALIZATION.md)
- [Plugin Template](../plugins/dist/qtap-plugin-template/)
