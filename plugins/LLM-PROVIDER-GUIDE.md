# LLM Provider Plugin Development Guide

This guide covers everything you need to create a new LLM provider plugin for Quilltap.

## Overview

LLM provider plugins enable Quilltap to connect to new AI services. Each provider plugin implements a standard interface that handles:

- Chat completions (required)
- Streaming responses (required)
- API key validation (required)
- Model listing (required)
- Image generation (optional)
- Text embeddings (optional)
- File attachments (optional)
- Tool/function calling (optional)

## Quick Start

### 1. Copy the Template

```bash
cp -r plugins/dist/qtap-plugin-template plugins/dist/qtap-plugin-myprovider
cd plugins/dist/qtap-plugin-myprovider
```

### 2. Update manifest.json

```json
{
  "$schema": "../qtap-plugin-template/schemas/plugin-manifest.schema.json",
  "name": "qtap-plugin-myprovider",
  "title": "My Provider",
  "description": "Integration with MyProvider's API",
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
    "description": "My custom AI provider",
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

### 3. Create the Provider Class

Create `provider.ts`:

```typescript
import type { LLMProvider, LLMParams, LLMResponse, StreamChunk } from './types';
import { logger } from '../../../lib/logger';

export class MyProvider implements LLMProvider {
  readonly supportsFileAttachments = false;
  readonly supportedMimeTypes: string[] = [];
  readonly supportsImageGeneration = false;
  readonly supportsWebSearch = false;

  private baseUrl = 'https://api.myprovider.com/v1';

  async sendMessage(params: LLMParams, apiKey: string): Promise<LLMResponse> {
    logger.debug('Sending message to MyProvider', {
      context: 'MyProvider.sendMessage',
      model: params.model,
    });

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: params.model,
        messages: params.messages.map(m => ({
          role: m.role,
          content: m.content,
        })),
        temperature: params.temperature ?? 0.7,
        max_tokens: params.maxTokens ?? 4096,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      logger.error('MyProvider API error', { context: 'MyProvider.sendMessage', error });
      throw new Error(`API error: ${response.status} - ${error}`);
    }

    const data = await response.json();

    return {
      content: data.choices[0].message.content,
      model: data.model,
      finishReason: data.choices[0].finish_reason,
      usage: {
        promptTokens: data.usage?.prompt_tokens,
        completionTokens: data.usage?.completion_tokens,
        totalTokens: data.usage?.total_tokens,
      },
    };
  }

  async *streamMessage(params: LLMParams, apiKey: string): AsyncGenerator<StreamChunk> {
    logger.debug('Starting stream from MyProvider', {
      context: 'MyProvider.streamMessage',
      model: params.model,
    });

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: params.model,
        messages: params.messages.map(m => ({
          role: m.role,
          content: m.content,
        })),
        temperature: params.temperature ?? 0.7,
        max_tokens: params.maxTokens ?? 4096,
        stream: true,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API error: ${response.status} - ${error}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') {
            yield { type: 'done' };
            return;
          }

          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices[0]?.delta?.content;
            if (content) {
              yield { type: 'content', content };
            }
          } catch {
            // Skip malformed JSON
          }
        }
      }
    }

    yield { type: 'done' };
  }

  async validateApiKey(apiKey: string): Promise<boolean> {
    logger.debug('Validating API key', { context: 'MyProvider.validateApiKey' });

    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async getAvailableModels(apiKey: string): Promise<string[]> {
    logger.debug('Fetching available models', { context: 'MyProvider.getAvailableModels' });

    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
      });

      if (!response.ok) return [];

      const data = await response.json();
      return data.data?.map((m: { id: string }) => m.id) || [];
    } catch {
      return [];
    }
  }

  async generateImage(): Promise<never> {
    throw new Error('Image generation not supported');
  }
}
```

### 4. Create the Types File

Create `types.ts`:

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

### 5. Create the Icon Component

Create `icon.tsx`:

```tsx
'use client';

interface IconProps {
  className?: string;
}

export function MyProviderIcon({ className = 'h-5 w-5' }: IconProps) {
  return (
    <svg
      className={`text-blue-600 ${className}`}
      fill="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="12" cy="12" r="12" />
      <text
        x="50%"
        y="50%"
        textAnchor="middle"
        dominantBaseline="middle"
        fill="white"
        fontSize="10"
        fontWeight="bold"
      >
        MYP
      </text>
    </svg>
  );
}

export default MyProviderIcon;
```

### 6. Create the Plugin Entry Point

Create `index.ts`:

```typescript
import type { LLMProviderPlugin } from './types';
import { MyProvider } from './provider';
import { MyProviderIcon } from './icon';
import { logger } from '../../../lib/logger';

const metadata = {
  providerName: 'MY_PROVIDER',
  displayName: 'My Provider',
  description: 'My custom AI provider',
  colors: {
    bg: 'bg-blue-100',
    text: 'text-blue-800',
    icon: 'text-blue-600',
  },
  abbreviation: 'MYP',
} as const;

const config = {
  requiresApiKey: true,
  requiresBaseUrl: false,
  apiKeyLabel: 'My Provider API Key',
} as const;

const capabilities = {
  chat: true,
  imageGeneration: false,
  embeddings: false,
  webSearch: false,
} as const;

const attachmentSupport = {
  supportsAttachments: false,
  supportedMimeTypes: [] as string[],
  description: 'No file attachments supported',
};

export const plugin: LLMProviderPlugin = {
  metadata,
  config,
  capabilities,
  attachmentSupport,

  createProvider: () => {
    logger.debug('Creating MyProvider instance', { context: 'plugin.createProvider' });
    return new MyProvider();
  },

  getAvailableModels: async (apiKey: string) => {
    const provider = new MyProvider();
    return provider.getAvailableModels(apiKey);
  },

  validateApiKey: async (apiKey: string) => {
    const provider = new MyProvider();
    return provider.validateApiKey(apiKey);
  },

  getModelInfo: () => [
    {
      id: 'my-model-1',
      name: 'My Model 1',
      contextWindow: 8192,
      maxOutputTokens: 4096,
      supportsImages: false,
      supportsTools: false,
    },
    {
      id: 'my-model-2',
      name: 'My Model 2',
      contextWindow: 32000,
      maxOutputTokens: 8192,
      supportsImages: false,
      supportsTools: true,
    },
  ],

  renderIcon: (props) => MyProviderIcon(props),
};

export default plugin;
```

### 7. Create package.json

```json
{
  "name": "qtap-plugin-myprovider",
  "version": "1.0.0",
  "description": "My Provider plugin for Quilltap",
  "main": "index.js",
  "types": "index.ts",
  "license": "MIT",
  "peerDependencies": {
    "react": "^19.0.0"
  }
}
```

### 8. Build and Test

The plugin system will automatically transpile your TypeScript on startup. To test:

1. Restart Quilltap or call `/api/startup/initialize-plugins`
2. Check the browser console for plugin loading messages
3. Your provider should appear in Settings > Connection Profiles

## Advanced Features

### Adding Image Generation

If your provider supports image generation:

1. Update `manifest.json`:

```json
{
  "providerConfig": {
    "capabilities": {
      "imageGeneration": true
    }
  }
}
```

2. Create `image-provider.ts`:

```typescript
import type { ImageGenProvider, ImageGenParams, ImageGenResponse } from './types';
import { logger } from '../../../lib/logger';

export class MyImageProvider implements ImageGenProvider {
  async generateImage(params: ImageGenParams, apiKey: string): Promise<ImageGenResponse> {
    logger.debug('Generating image', { context: 'MyImageProvider.generateImage' });

    const response = await fetch('https://api.myprovider.com/v1/images/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        prompt: params.prompt,
        n: params.count || 1,
        size: params.size || '1024x1024',
      }),
    });

    const data = await response.json();

    return {
      images: data.data.map((img: { url: string }) => ({
        url: img.url,
      })),
    };
  }

  async validateApiKey(apiKey: string): Promise<boolean> {
    // Use main provider validation
    return true;
  }

  async getAvailableModels(): Promise<string[]> {
    return ['my-image-model'];
  }
}
```

3. Update `index.ts` to include:

```typescript
import { MyImageProvider } from './image-provider';

export const plugin: LLMProviderPlugin = {
  // ...existing config...

  createImageProvider: () => new MyImageProvider(),

  getImageProviderConstraints: () => ({
    maxPromptBytes: 4000,
    promptConstraintWarning: 'Prompts limited to 4000 bytes',
    maxImagesPerRequest: 4,
    supportedSizes: ['1024x1024', '512x512'],
  }),
};
```

### Adding File Attachment Support

For providers that can process images or documents:

1. Update `manifest.json`:

```json
{
  "providerConfig": {
    "attachmentSupport": {
      "supported": true,
      "mimeTypes": ["image/jpeg", "image/png", "application/pdf"],
      "description": "Images (JPEG, PNG) and PDFs"
    }
  }
}
```

2. Update your provider class:

```typescript
export class MyProvider implements LLMProvider {
  readonly supportsFileAttachments = true;
  readonly supportedMimeTypes = ['image/jpeg', 'image/png', 'application/pdf'];

  async sendMessage(params: LLMParams, apiKey: string): Promise<LLMResponse> {
    // Handle attachments in params.files
    const messages = params.messages.map(m => {
      if (m.files && m.files.length > 0) {
        return {
          role: m.role,
          content: [
            { type: 'text', text: m.content },
            ...m.files.map(f => ({
              type: 'image_url',
              image_url: { url: `data:${f.mimeType};base64,${f.data}` },
            })),
          ],
        };
      }
      return { role: m.role, content: m.content };
    });

    // ... rest of implementation
  }
}
```

3. Update `index.ts`:

```typescript
const attachmentSupport = {
  supportsAttachments: true,
  supportedMimeTypes: ['image/jpeg', 'image/png', 'application/pdf'],
  description: 'Images (JPEG, PNG) and PDFs',
  notes: 'Images are processed using vision capabilities',
};
```

### Adding Tool/Function Calling

For providers with tool calling support:

1. Import the tool formatting utilities:

```typescript
import {
  convertOpenAIToProviderFormat,
  parseProviderToolCalls,
  type OpenAIToolDefinition,
  type ToolCallRequest,
} from '../../../lib/llm/tool-formatting-utils';
```

2. Add `formatTools` and `parseToolCalls` to your plugin:

```typescript
export const plugin: LLMProviderPlugin = {
  // ...existing config...

  formatTools: (tools: OpenAIToolDefinition[]): any[] => {
    logger.debug('Formatting tools', { context: 'plugin.formatTools', count: tools.length });

    // Convert OpenAI format to your provider's format
    return tools.map(tool => ({
      name: tool.function.name,
      description: tool.function.description,
      input_schema: tool.function.parameters,
    }));
  },

  parseToolCalls: (response: any): ToolCallRequest[] => {
    logger.debug('Parsing tool calls', { context: 'plugin.parseToolCalls' });

    // Extract tool calls from your provider's response format
    const toolCalls: ToolCallRequest[] = [];

    if (response.tool_calls) {
      for (const call of response.tool_calls) {
        toolCalls.push({
          name: call.name,
          arguments: JSON.parse(call.arguments),
        });
      }
    }

    return toolCalls;
  },
};
```

### Adding Embeddings Support

For providers with embedding capabilities:

1. Update `manifest.json`:

```json
{
  "providerConfig": {
    "capabilities": {
      "embeddings": true
    }
  }
}
```

2. Add `getEmbeddingModels` to your plugin:

```typescript
export const plugin: LLMProviderPlugin = {
  // ...existing config...

  createEmbeddingProvider: () => new MyEmbeddingProvider(),

  getEmbeddingModels: () => [
    {
      id: 'my-embedding-model',
      name: 'My Embedding Model',
      dimensions: 1536,
      description: 'General purpose text embeddings',
    },
  ],
};
```

### Adding Web Search Support

For providers with built-in web search:

1. Update `manifest.json`:

```json
{
  "providerConfig": {
    "capabilities": {
      "webSearch": true
    }
  }
}
```

2. Update your provider class:

```typescript
export class MyProvider implements LLMProvider {
  readonly supportsWebSearch = true;

  async sendMessage(params: LLMParams, apiKey: string): Promise<LLMResponse> {
    // Include web search parameter
    const body = {
      model: params.model,
      messages: params.messages,
      web_search: params.webSearch ?? false,  // Use if available
    };

    // ... rest of implementation
  }
}
```

## Logging Best Practices

Always use the Quilltap logger for debugging:

```typescript
import { logger } from '../../../lib/logger';

// Debug level for normal operations
logger.debug('Operation started', {
  context: 'MyProvider.methodName',
  model: params.model,
});

// Info level for significant events
logger.info('API key validated successfully', {
  context: 'MyProvider.validateApiKey',
});

// Error level for failures
logger.error('API request failed', {
  context: 'MyProvider.sendMessage',
  error: error.message,
  statusCode: response.status,
}, error instanceof Error ? error : undefined);
```

## Error Handling

Always handle errors gracefully:

```typescript
async sendMessage(params: LLMParams, apiKey: string): Promise<LLMResponse> {
  try {
    const response = await fetch(this.baseUrl, { /* ... */ });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('API error', {
        context: 'MyProvider.sendMessage',
        status: response.status,
        error: errorText,
      });

      // Throw descriptive errors
      if (response.status === 401) {
        throw new Error('Invalid API key');
      } else if (response.status === 429) {
        throw new Error('Rate limit exceeded');
      } else if (response.status === 503) {
        throw new Error('Service temporarily unavailable');
      }

      throw new Error(`API error: ${response.status}`);
    }

    return await this.parseResponse(response);
  } catch (error) {
    logger.error('Request failed', {
      context: 'MyProvider.sendMessage',
    }, error instanceof Error ? error : undefined);
    throw error;
  }
}
```

## Reference Implementations

Study these existing plugins for patterns:

| Plugin | Complexity | Features |
|--------|------------|----------|
| `qtap-plugin-gab-ai` | Simple | Text-only chat, minimal config |
| `qtap-plugin-ollama` | Simple | Local provider, requires base URL |
| `qtap-plugin-openai` | Full | Chat, images, attachments, tools |
| `qtap-plugin-anthropic` | Full | Chat, PDFs, vision, tools |
| `qtap-plugin-openrouter` | Advanced | Pricing sync, model aggregation |

## Testing Your Plugin

### Manual Testing

1. Place plugin in `plugins/dist/`
2. Restart Quilltap
3. Check console for: `Provider MY_PROVIDER registered`
4. Go to Settings > API Keys, add your key
5. Go to Settings > Connection Profiles, create a profile
6. Test with a chat

### Debugging

Enable debug logging:

```bash
LOG_LEVEL=debug npm run dev
```

Check for:

- Plugin loading messages
- Provider registration
- API call logging
- Error messages

## Plugin Directory Structure

```text
plugins/dist/qtap-plugin-myprovider/
├── manifest.json          # Plugin metadata (required)
├── package.json           # NPM package config (required)
├── index.ts               # Main entry point (required)
├── index.js               # Transpiled entry (auto-generated)
├── provider.ts            # LLM provider class (required)
├── types.ts               # Type re-exports (required)
├── icon.tsx               # React icon component (required)
├── image-provider.ts      # Image generation (optional)
├── embedding-provider.ts  # Embeddings (optional)
└── README.md              # Documentation (recommended)
```

## Checklist

Before releasing your plugin:

- [ ] `manifest.json` has all required fields
- [ ] `package.json` has correct name and version
- [ ] Provider implements `sendMessage` and `streamMessage`
- [ ] Provider implements `validateApiKey`
- [ ] Provider implements `getAvailableModels`
- [ ] Icon component renders correctly
- [ ] All API calls have error handling
- [ ] Debug logging is comprehensive
- [ ] README.md documents usage

## See Also

- [Plugin Developer Guide](./README.md) - General plugin development
- [Plugin Manifest Reference](../docs/PLUGIN_MANIFEST.md) - Complete manifest schema
- [Plugin Initialization](../docs/PLUGIN_INITIALIZATION.md) - How plugins are loaded
- [Provider Plugin Interface](../lib/plugins/interfaces/provider-plugin.ts) - TypeScript interface
