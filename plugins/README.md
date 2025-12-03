# Quilltap Plugins

This directory contains Quilltap plugins. Plugins extend Quilltap's functionality with new features, providers, themes, and integrations.

## Directory Structure

```text
plugins/
├── README.md                           # This file
├── LLM-PROVIDER-GUIDE.md               # Detailed guide for LLM providers
├── AUTH-PROVIDER-GUIDE.md              # Detailed guide for auth providers
├── dist/                               # Built-in plugins shipped with Quilltap
│   ├── qtap-plugin-template/           # Example plugin template
│   ├── qtap-plugin-openai/             # OpenAI provider
│   ├── qtap-plugin-anthropic/          # Anthropic provider
│   ├── qtap-plugin-google/             # Google Gemini provider
│   ├── qtap-plugin-grok/               # Grok/xAI provider
│   ├── qtap-plugin-gab-ai/             # Gab AI provider
│   ├── qtap-plugin-ollama/             # Ollama provider
│   ├── qtap-plugin-openrouter/         # OpenRouter provider
│   ├── qtap-plugin-openai-compatible/  # OpenAI-compatible provider
│   ├── qtap-plugin-auth-google/        # Google OAuth authentication
│   └── qtap-plugin-upgrade/            # Database migration utility
└── [user-plugins]/                     # User-installed plugins go here
```

## Plugin Types

### LLM Provider Plugins

Provider plugins add support for new LLM services. Each provider plugin includes:

- Chat completion functionality
- Streaming response support
- API key validation
- Model listing and information
- Optional image generation
- Optional embeddings support
- Optional file attachment support
- Provider-specific icon and branding

**Built-in providers:**

| Plugin | Provider | Capabilities |
|--------|----------|--------------|
| `qtap-plugin-openai` | OpenAI | Chat, DALL-E images, embeddings, file attachments |
| `qtap-plugin-anthropic` | Anthropic | Chat, image/PDF analysis, tool calling |
| `qtap-plugin-google` | Google Gemini | Chat, Imagen images, file attachments |
| `qtap-plugin-grok` | Grok/xAI | Chat, image generation, file attachments |
| `qtap-plugin-gab-ai` | Gab AI | Chat (text-only) |
| `qtap-plugin-ollama` | Ollama | Chat (local models) |
| `qtap-plugin-openrouter` | OpenRouter | Chat (100+ models), pricing sync |
| `qtap-plugin-openai-compatible` | Generic | Chat (any OpenAI-format API) |

### Authentication Provider Plugins

Auth plugins add support for OAuth authentication providers. Each auth plugin includes:

- OAuth provider configuration
- Environment variable validation
- Configuration status reporting
- Sign-in button styling

**Built-in auth providers:**

| Plugin | Provider | Required Env Vars |
|--------|----------|-------------------|
| `qtap-plugin-auth-google` | Google OAuth | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |

For detailed auth plugin development, see [AUTH-PROVIDER-GUIDE.md](./AUTH-PROVIDER-GUIDE.md).

### Upgrade Plugin

The `qtap-plugin-upgrade` plugin handles database migrations between Quilltap versions:

- OpenRouter profile format migration
- Provider plugin enablement
- Extensible migration runner

### Other Plugin Types (Planned)

- **Themes** - Custom UI themes and styling
- **Integrations** - External service connections
- **Storage Backends** - Alternative data storage (S3, etc.)
- **Database Backends** - Alternative databases (MongoDB, etc.)
- **More OAuth Providers** - GitHub, Apple, Microsoft, etc.

## Creating a Plugin

### Quick Start

1. Copy the template:

```bash
cp -r plugins/dist/qtap-plugin-template plugins/dist/qtap-plugin-myprovider
cd plugins/dist/qtap-plugin-myprovider
```

2. Update `manifest.json`:

```json
{
  "$schema": "../qtap-plugin-template/schemas/plugin-manifest.schema.json",
  "name": "qtap-plugin-myprovider",
  "title": "My Provider",
  "description": "Integration with My Provider's API",
  "version": "1.0.0",
  "author": {
    "name": "Your Name",
    "email": "you@example.com"
  },
  "license": "MIT",
  "main": "index.js",
  "compatibility": {
    "quilltapVersion": ">=1.7.0"
  },
  "capabilities": ["LLM_PROVIDER"],
  "category": "PROVIDER",
  "typescript": true,
  "enabledByDefault": true,
  "status": "STABLE",
  "providerConfig": {
    "providerName": "MY_PROVIDER",
    "displayName": "My Provider",
    "abbreviation": "MYP",
    "colors": {
      "bg": "bg-blue-100",
      "text": "text-blue-800",
      "icon": "text-blue-600"
    },
    "requiresApiKey": true,
    "requiresBaseUrl": false,
    "capabilities": {
      "chat": true,
      "imageGeneration": false,
      "embeddings": false,
      "webSearch": false
    },
    "attachmentSupport": {
      "supported": false,
      "mimeTypes": [],
      "description": "No file attachments"
    }
  },
  "permissions": {
    "network": ["api.myprovider.com"]
  }
}
```

1. Implement your provider (see [LLM Provider Guide](./LLM-PROVIDER-GUIDE.md))

2. Restart Quilltap to load your plugin

### Required Files

| File | Purpose |
|------|---------|
| `manifest.json` | Plugin metadata and configuration |
| `package.json` | NPM package configuration |
| `index.ts` | Main entry point exporting the plugin |
| `provider.ts` | LLM provider implementation |
| `types.ts` | Type re-exports from core |
| `icon.tsx` | React icon component |

### Optional Files

| File | Purpose |
|------|---------|
| `image-provider.ts` | Image generation implementation |
| `embedding-provider.ts` | Embedding generation implementation |
| `README.md` | Plugin documentation |

### Plugin Interface

All LLM provider plugins must implement the `LLMProviderPlugin` interface:

```typescript
interface LLMProviderPlugin {
  // Required properties
  metadata: ProviderMetadata;
  config: ProviderConfigRequirements;
  capabilities: ProviderCapabilities;
  attachmentSupport: AttachmentSupport;

  // Required methods
  createProvider(baseUrl?: string): LLMProvider;
  getAvailableModels(apiKey: string, baseUrl?: string): Promise<string[]>;
  validateApiKey(apiKey: string, baseUrl?: string): Promise<boolean>;
  renderIcon(props: { className?: string }): React.ReactNode;

  // Optional methods
  createImageProvider?(baseUrl?: string): ImageGenProvider;
  createEmbeddingProvider?(baseUrl?: string): unknown;
  getModelInfo?(): ModelInfo[];
  getEmbeddingModels?(): EmbeddingModelInfo[];
  formatTools?(tools: any[], options?: ToolFormatOptions): any[];
  parseToolCalls?(response: any): ToolCallRequest[];
  getImageProviderConstraints?(): ImageProviderConstraints;
}
```

### Type Re-exports

Your `types.ts` should re-export from Quilltap core:

```typescript
// Re-export types from core Quilltap library
export type {
  LLMProvider,
  LLMMessage,
  LLMParams,
  LLMResponse,
  StreamChunk,
  FileAttachment,
  ImageGenParams,
  ImageGenResponse,
} from '../../../lib/llm/base';

export type { ImageGenProvider } from '../../../lib/image-gen/base';

export type {
  LLMProviderPlugin,
  ProviderMetadata,
  ProviderCapabilities,
  AttachmentSupport,
  ProviderConfigRequirements,
  ModelInfo,
  EmbeddingModelInfo,
  ImageProviderConstraints,
  UniversalTool,
  ToolFormatOptions,
  ToolCallRequest,
} from '../../../lib/plugins/interfaces/provider-plugin';
```

## Logging

Always use the Quilltap logger:

```typescript
import { logger } from '../../../lib/logger';

logger.debug('Operation started', {
  context: 'MyProvider.methodName',
  model: params.model,
});

logger.error('Operation failed', {
  context: 'MyProvider.methodName',
}, error instanceof Error ? error : undefined);
```

## Plugin Initialization

Plugins are loaded automatically on Quilltap startup:

1. TypeScript plugins are transpiled to JavaScript
2. Plugin directories are scanned
3. Manifests are validated against the schema
4. Version compatibility is checked
5. Upgrade migrations are run
6. Provider plugins are registered

Check the browser console for plugin loading messages:

```text
✓ Plugin system initialized: 9 enabled, 0 disabled, 0 errors
```

## Testing Your Plugin

1. Place your plugin in `plugins/dist/` or `plugins/`
2. Restart Quilltap or call `POST /api/startup/initialize-plugins`
3. Check the console for loading messages
4. Your provider should appear in Settings > Connection Profiles
5. Add an API key in Settings > API Keys
6. Create a connection profile and test it

## Best Practices

1. **Comprehensive logging** - Use debug logs for normal operations, error logs for failures
2. **Graceful error handling** - Don't let provider errors crash the application
3. **Support streaming** - Users expect real-time responses
4. **Document models** - Include context windows and capability information
5. **Validate early** - Catch invalid API keys before they cause errors
6. **Follow existing patterns** - Study the built-in plugins

## Reference Implementations

| Plugin | Complexity | Best For |
|--------|------------|----------|
| `qtap-plugin-gab-ai` | Simple | Text-only providers |
| `qtap-plugin-ollama` | Simple | Providers requiring base URL |
| `qtap-plugin-openai` | Full | Providers with all capabilities |
| `qtap-plugin-anthropic` | Full | Providers with tool calling |
| `qtap-plugin-openrouter` | Advanced | Model aggregators |

## Documentation

- [LLM Provider Guide](./LLM-PROVIDER-GUIDE.md) - Detailed guide for LLM provider plugins
- [Auth Provider Guide](./AUTH-PROVIDER-GUIDE.md) - Detailed guide for auth provider plugins
- [Plugin Manifest Reference](../docs/PLUGIN_MANIFEST.md) - Complete manifest schema
- [Plugin Initialization](../docs/PLUGIN_INITIALIZATION.md) - How plugins are loaded
- [Plugin System Overview](../features/plugins.md) - Feature status and roadmap

## Support

- [GitHub Issues](https://github.com/foundry-9/quilltap/issues)
- [Plugin Template](./dist/qtap-plugin-template/)
