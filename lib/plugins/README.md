# Quilltap Plugin System

This directory contains the core plugin system infrastructure for Quilltap.

## Overview

The Quilltap plugin system allows developers to extend Quilltap's functionality through a modular, sandboxed plugin architecture. Plugins can provide:

- LLM providers
- Image generation providers
- UI themes
- Custom components
- API endpoints
- Database models
- And more...

## Components

### Plugin Manifest Schema

**Location:** `lib/json-store/schemas/plugin-manifest.ts`

The manifest schema defines the structure of `manifest.json` files that all plugins must provide. It uses [Zod](https://zod.dev/) for runtime validation and TypeScript type generation.

#### Key Features:
- Strict validation of plugin metadata
- Version compatibility checking
- Capability declaration
- Permission requirements
- Configuration schema definition
- Security sandboxing options

### Manifest Loader

**Location:** `lib/plugins/manifest-loader.ts`

Utilities for loading, validating, and scanning plugins from the filesystem.

#### Key Functions:

- `scanPlugins()` - Scans the plugins directory and loads all valid plugins
- `loadPlugin(name)` - Loads a specific plugin by name
- `isPluginCompatible(manifest, version)` - Checks version compatibility
- `validatePluginSecurity(manifest)` - Validates security permissions

## Usage

### Backend: Loading Plugins

```typescript
import { scanPlugins, loadPlugin } from '@/lib/plugins';

// Scan all plugins
const { plugins, errors } = await scanPlugins();

// Load specific plugin
const plugin = await loadPlugin('qtap-plugin-example');
if (plugin) {
  console.log('Loaded:', plugin.manifest.title);
  console.log('Capabilities:', plugin.capabilities);
}
```

### Creating a Plugin

1. Create a directory under `plugins/` with the format `qtap-plugin-{name}`
2. Create a `manifest.json` file following the schema
3. Implement your plugin functionality

Example minimal manifest:

```json
{
  "name": "qtap-plugin-example",
  "title": "Example Plugin",
  "description": "An example plugin",
  "version": "1.0.0",
  "author": "Your Name",
  "license": "MIT",
  "main": "index.js",
  "compatibility": {
    "quilltapVersion": ">=1.7.0"
  },
  "capabilities": ["UI_COMPONENTS"],
  "sandboxed": true
}
```

### Manifest Validation

The schema automatically validates:

- **Name format**: Must start with `qtap-plugin-`
- **Version format**: Must follow semantic versioning (semver)
- **Compatibility**: Version ranges for Quilltap and Node.js
- **Capabilities**: Valid capability declarations
- **Security**: Proper permission declarations

### Capabilities

Plugins declare their capabilities using the `capabilities` array. Available capabilities:

- `CHAT_COMMANDS` - Provides custom chat commands
- `MESSAGE_PROCESSORS` - Processes/transforms messages
- `UI_COMPONENTS` - Provides React components
- `DATA_STORAGE` - Adds database tables/storage
- `API_ROUTES` - Adds new API endpoints
- `AUTH_METHODS` - Provides authentication methods
- `WEBHOOKS` - Handles webhooks
- `BACKGROUND_TASKS` - Runs background jobs
- `CUSTOM_MODELS` - Adds new data models
- `FILE_HANDLERS` - Handles file operations
- `NOTIFICATIONS` - Provides notification system
- `BACKEND_INTEGRATIONS` - Integrates with external services
- `LLM_PROVIDER` - Provides LLM integration
- `IMAGE_PROVIDER` - Provides image generation
- `EMBEDDING_PROVIDER` - Provides embedding generation
- `THEME` - Provides UI theme
- `DATABASE_BACKEND` - Replaces/augments database
- `FILE_BACKEND` - Replaces/augments file storage

### Permissions

Plugins must declare required permissions:

```json
{
  "permissions": {
    "fileSystem": ["user-data/plugins"],
    "network": ["api.example.com"],
    "environment": ["API_KEY"],
    "database": true,
    "userData": true
  }
}
```

### Configuration Schema

Plugins can define configuration options that will be exposed in the UI:

```json
{
  "configSchema": [
    {
      "key": "apiKey",
      "label": "API Key",
      "type": "password",
      "required": true,
      "description": "Your API key for the service"
    },
    {
      "key": "maxRequests",
      "label": "Max Requests",
      "type": "number",
      "default": 100,
      "min": 1,
      "max": 1000
    }
  ]
}
```

### Hooks

Plugins can register hooks to extend Quilltap's behavior:

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

### API Routes

Plugins can add new API endpoints:

```json
{
  "apiRoutes": [
    {
      "path": "/api/plugin/my-endpoint",
      "methods": ["GET", "POST"],
      "handler": "./routes/my-endpoint.js",
      "requiresAuth": true,
      "description": "Custom endpoint for plugin functionality"
    }
  ]
}
```

## Security

The plugin system implements several security measures:

1. **Sandboxing**: Plugins run in a sandboxed environment by default
2. **Permission System**: Explicit permission declarations required
3. **Validation**: Strict schema validation prevents malformed plugins
4. **Version Compatibility**: Ensures plugins only run on compatible versions

## Development Guidelines

When developing plugins:

1. Always use TypeScript for type safety
2. Follow the naming convention: `qtap-plugin-{name}`
3. Declare all capabilities and permissions explicitly
4. Provide comprehensive configuration schema
5. Document your plugin thoroughly
6. Test against the manifest schema before publishing

## Template Plugin

See `plugins/qtap-plugin-template/` for a complete example of a properly structured plugin.

## API Documentation

For detailed API documentation, see the inline TypeScript documentation in:
- `lib/json-store/schemas/plugin-manifest.ts`
- `lib/plugins/manifest-loader.ts`
