# Quilltap Provider Plugin Development Guide

This guide walks you through creating a Quilltap LLM provider plugin from scratch, from an empty directory to publishing on npm. Provider plugins integrate external AI services (chat, image generation, embeddings) into Quilltap.

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Project Setup](#project-setup)
4. [Required Files](#required-files)
5. [Plugin Manifest](#plugin-manifest)
6. [Implementing Your Provider](#implementing-your-provider)
7. [Building Your Plugin](#building-your-plugin)
8. [Testing Your Provider](#testing-your-provider)
9. [Publishing to npm](#publishing-to-npm)
10. [Complete Example](#complete-example)

---

## Overview

Provider plugins extend Quilltap by integrating external AI services. They can provide:

- **Chat completions**: Text generation via LLM APIs
- **Image generation**: Text-to-image services
- **Embeddings**: Vector embeddings for semantic search
- **Web search**: Grounded responses with web results

Common use cases:

- Integrating a new LLM provider (e.g., a custom API)
- Adding image generation services (e.g., Stable Diffusion, DALL-E alternatives)
- Supporting local/self-hosted models
- Connecting to enterprise AI services

---

## Prerequisites

Before starting, ensure you have:

- **Node.js** 18 or higher
- **npm** 8 or higher
- An npm account (for publishing)
- Basic knowledge of TypeScript and React
- API documentation for the provider you're integrating

---

## Project Setup

### Step 1: Create Your Project Directory

Provider plugin names must follow the pattern `qtap-plugin-<name>`. Choose a descriptive name.

```bash
mkdir qtap-plugin-myai
cd qtap-plugin-myai
```

### Step 2: Initialize npm Package

```bash
npm init -y
```

### Step 3: Install Dependencies

```bash
# Quilltap packages for types and utilities
npm install @quilltap/plugin-types @quilltap/plugin-utils

# Build tools
npm install --save-dev esbuild typescript @types/react

# React (peer dependency for icon rendering)
npm install react
```

### Step 4: Configure package.json

Edit your `package.json`:

```json
{
  "name": "qtap-plugin-myai",
  "version": "1.0.0",
  "description": "MyAI provider integration for Quilltap",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "files": [
    "dist",
    "manifest.json",
    "README.md"
  ],
  "scripts": {
    "build": "node esbuild.config.mjs && npm run copy-manifest",
    "copy-manifest": "cp manifest.json dist/",
    "prepublishOnly": "npm run build"
  },
  "keywords": [
    "quilltap",
    "quilltap-plugin",
    "llm",
    "ai",
    "provider"
  ],
  "author": "Your Name <you@example.com>",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/yourusername/qtap-plugin-myai"
  },
  "peerDependencies": {
    "react": ">=18.0.0"
  }
}
```

### Step 5: Create TypeScript Configuration

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "node",
    "declaration": true,
    "declarationDir": "./dist",
    "outDir": "./dist",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "jsx": "react-jsx",
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

> **Plugins bundled in this repo** (`plugins/dist/*`) use a shorter form instead —
> they extend the shared bar in `plugins/tsconfig.base.json`:
>
> ```json
> {
>   "extends": "../../tsconfig.base.json",
>   "include": ["*.ts"],
>   "exclude": ["node_modules"]
> }
> ```
>
> Pair it with a `"typecheck": "tsc -p tsconfig.json"` script. `npm run build:plugins`
> runs that before esbuild and fails the build on any type error. This matters because
> the root `tsconfig.json` excludes `plugins/` and esbuild strips types without checking
> them, so without it a plugin's TypeScript is never verified anywhere.
>
> Note `include`/`exclude` stay in the per-plugin file: TypeScript resolves them
> relative to whichever config declares them, so inheriting them from the base would
> point every plugin at the wrong directory.

### Step 6: Create Build Configuration

Create `esbuild.config.mjs`:

```javascript
import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',  // CRITICAL: Must be 'cjs' or 'esm', NOT 'iife'
  outfile: 'dist/index.js',
  external: [
    '@quilltap/plugin-types',
    '@quilltap/plugin-utils',
    'react',
    'react-dom',
  ],
  sourcemap: false,
  minify: false,
});

console.log('Build complete: dist/index.js');
```

> **CRITICAL: Module Format**
>
> The `format` option **must** be `'cjs'` (CommonJS) or `'esm'` (ES Modules).
>
> **Do NOT use `format: 'iife'`** - this wraps your code in an Immediately Invoked Function Expression that doesn't export anything at the module level. Quilltap uses Node.js `require()` to load plugins, and IIFE-bundled code will appear as an empty object with no exports.
>
> If your plugin isn't loading correctly, check your build output - it should have `module.exports` or `exports` statements, not be wrapped in `(() => { ... })()`.

---

## Required Files

Your provider plugin needs these files:

```
qtap-plugin-myai/
├── package.json          # npm package configuration
├── manifest.json         # Quilltap plugin manifest (REQUIRED)
├── tsconfig.json         # TypeScript configuration
├── esbuild.config.mjs    # Build configuration
├── src/
│   ├── index.ts          # Plugin entry point (REQUIRED)
│   ├── provider.ts       # LLM provider implementation
│   ├── image-provider.ts # Image provider (if applicable)
│   └── icon.tsx          # Provider icon component
└── README.md             # Documentation
```

---

## Plugin Manifest

Create `manifest.json` - this tells Quilltap about your provider:

```json
{
  "$schema": "https://quilltap.io/schemas/plugin-manifest.json",
  "name": "qtap-plugin-myai",
  "title": "MyAI",
  "description": "Integration with MyAI for chat completions and image generation",
  "version": "1.0.0",
  "author": {
    "name": "Your Name",
    "email": "you@example.com",
    "url": "https://your-website.com"
  },
  "license": "MIT",
  "main": "dist/index.js",
  "compatibility": {
    "quilltapVersion": ">=1.7.0",
    "nodeVersion": ">=18.0.0"
  },
  "capabilities": ["LLM_PROVIDER"],
  "category": "PROVIDER",
  "typescript": true,
  "frontend": "REACT",
  "styling": "TAILWIND",
  "enabledByDefault": true,
  "status": "STABLE",
  "keywords": ["myai", "llm", "chat", "ai"],
  "providerConfig": {
    "providerName": "MYAI",
    "displayName": "MyAI",
    "description": "Chat completions and image generation via MyAI",
    "abbreviation": "MAI",
    "colors": {
      "bg": "bg-blue-100",
      "text": "text-blue-800",
      "icon": "text-blue-600"
    },
    "requiresApiKey": true,
    "requiresBaseUrl": false,
    "apiKeyLabel": "MyAI API Key",
    "capabilities": {
      "chat": true,
      "imageGeneration": false,
      "embeddings": false,
      "webSearch": false
    },
    "attachmentSupport": {
      "supported": true,
      "mimeTypes": ["image/jpeg", "image/png", "image/gif", "image/webp"],
      "description": "Images (JPEG, PNG, GIF, WebP)"
    }
  },
  "permissions": {
    "network": ["api.myai.com"],
    "userData": false,
    "database": false
  }
}
```

> **IMPORTANT: Provider Capability Types in TypeScript**
>
> The published `@quilltap/plugin-types` TypeScript package **only exports `LLM_PROVIDER`** as a plugin capability. However, the internal schema supports `IMAGE_PROVIDER` and `EMBEDDING_PROVIDER` capabilities.
>
> **For TypeScript plugin development:**
> - Always use `"LLM_PROVIDER"` in your manifest's `capabilities` array
> - Indicate image/embedding support via `providerConfig.capabilities.imageGeneration` and `providerConfig.capabilities.embeddings` fields
> - Implement the optional `createImageProvider()` and `createEmbeddingProvider()` methods in your plugin object (see [Image Generation Provider](#image-generation-provider-optional) and [Embedding Provider](#embedding-provider-optional) sections)
>
> Quilltap will automatically discover these capabilities at runtime based on which factory methods you implement, so you don't need separate capability declarations.

### Key Manifest Fields

| Field | Description |
|-------|-------------|
| `capabilities` | Must include `"LLM_PROVIDER"` |
| `providerConfig.providerName` | Unique identifier (uppercase, used in API key storage) |
| `providerConfig.requiresApiKey` | Whether users **must** provide an API key |
| `providerConfig.acceptsApiKey` | Optional. Whether users **may** provide one — it gates the Add-New-API-Key dropdown and the profile form's key field. Omitted, it follows `requiresApiKey`; set it only for an endpoint that spans authenticated and unauthenticated services, as `OPENAI_COMPATIBLE` does |
| `providerConfig.requiresBaseUrl` | For self-hosted/custom endpoints (e.g., Ollama) |
| `providerConfig.capabilities` | Which features your provider supports |
| `providerConfig.attachmentSupport` | File attachment capabilities |
| `permissions.network` | Domains your plugin will connect to |

---

## Implementing Your Provider

### Main Entry Point (src/index.ts)

```typescript
import type { LLMProviderPlugin } from '@quilltap/plugin-types';
import { MyAIProvider } from './provider';
import { MyAIIcon } from './icon';

export const plugin: LLMProviderPlugin = {
  // Required metadata
  metadata: {
    providerName: 'MYAI',
    displayName: 'MyAI',
    description: 'Chat completions via MyAI API',
    abbreviation: 'MAI',
    colors: {
      bg: 'bg-blue-100',
      text: 'text-blue-800',
      icon: 'text-blue-600',
    },
  },

  // Configuration requirements
  config: {
    requiresApiKey: true,
    requiresBaseUrl: false,
    apiKeyLabel: 'MyAI API Key',
  },

  // Provider capabilities
  capabilities: {
    chat: true,
    imageGeneration: false,
    embeddings: false,
    webSearch: false,
  },

  // Attachment support
  attachmentSupport: {
    supportsAttachments: true,
    supportedMimeTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
    description: 'Images (JPEG, PNG, GIF, WebP)',
    maxBase64Size: 20 * 1024 * 1024, // 20MB
  },

  // Factory method - creates the LLM provider instance
  createProvider: (baseUrl?: string) => {
    return new MyAIProvider(baseUrl);
  },

  // List available models (called when user opens model selector)
  getAvailableModels: async (apiKey: string, baseUrl?: string) => {
    try {
      const response = await fetch('https://api.myai.com/v1/models', {
        headers: { 'Authorization': `Bearer ${apiKey}` },
      });
      if (!response.ok) return [];
      const data = await response.json();
      return data.models.map((m: any) => m.id);
    } catch {
      return [];
    }
  },

  // Validate API key (called when user saves a new key)
  validateApiKey: async (apiKey: string, baseUrl?: string) => {
    try {
      const response = await fetch('https://api.myai.com/v1/models', {
        headers: { 'Authorization': `Bearer ${apiKey}` },
      });
      return response.ok;
    } catch {
      return false;
    }
  },

  // Static model info (no API call needed)
  getModelInfo: () => [
    {
      id: 'myai-large',
      name: 'MyAI Large',
      contextWindow: 128000,
      maxOutputTokens: 4096,
      supportsImages: true,
      supportsTools: true,
      // Two separate facts. `supportsThinking` is a capability;
      // `thinksByDefault` says the model reasons even when the profile never
      // asked it to, which is what tells the host to skip the `[Name]` prefill.
      supportsThinking: true,
      thinksByDefault: false,
      pricing: { input: 5.0, output: 15.0 }, // per 1M tokens
    },
    {
      id: 'myai-small',
      name: 'MyAI Small',
      contextWindow: 32000,
      maxOutputTokens: 2048,
      supportsImages: false,
      supportsTools: true,
      pricing: { input: 0.5, output: 1.5 },
    },
  ],

  // Provider icon (SVG data - no React required)
  icon: {
    viewBox: '0 0 24 24',
    paths: [{ d: 'M12 2L2 7l10 5 10-5-10-5z', fill: 'currentColor' }],
  },

  // Optional: Tool format (default is 'openai')
  toolFormat: 'openai',

  // Optional: Characters per token for estimation
  charsPerToken: 4,

  // Optional: Recommended cheap models for background tasks
  cheapModels: {
    defaultModel: 'myai-small',
    recommendedModels: ['myai-small'],
  },

  // Optional: Default context window when model is unknown
  defaultContextWindow: 32000,

  // Optional: Message format support for multi-character chats
  messageFormat: {
    supportsNameField: true,
    supportedRoles: ['user', 'assistant'],
    maxNameLength: 64,
  },
};

export default plugin;
```

### LLM Provider Implementation (src/provider.ts)

Your provider must implement the `LLMProvider` interface:

```typescript
import type {
  LLMProvider,
  ChatMessage,
  ChatCompletionOptions,
  ChatCompletionResult,
  StreamCallback
} from '@quilltap/plugin-types';
import { createPluginLogger } from '@quilltap/plugin-utils';

const logger = createPluginLogger('qtap-plugin-myai');

export class MyAIProvider implements LLMProvider {
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || 'https://api.myai.com';
  }

  async chatCompletion(
    messages: ChatMessage[],
    options: ChatCompletionOptions
  ): Promise<ChatCompletionResult> {
    const { apiKey, model, maxTokens, temperature, tools } = options;

    logger.debug('Starting chat completion', { model, messageCount: messages.length });

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: this.formatMessages(messages),
        max_tokens: maxTokens,
        temperature,
        tools: tools?.length ? tools : undefined,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      logger.error('Chat completion failed', { status: response.status, error });
      throw new Error(`MyAI API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    const choice = data.choices[0];

    return {
      content: choice.message.content || '',
      toolCalls: choice.message.tool_calls,
      finishReason: choice.finish_reason,
      usage: {
        promptTokens: data.usage?.prompt_tokens,
        completionTokens: data.usage?.completion_tokens,
        totalTokens: data.usage?.total_tokens,
      },
    };
  }

  async streamChatCompletion(
    messages: ChatMessage[],
    options: ChatCompletionOptions,
    onChunk: StreamCallback
  ): Promise<void> {
    const { apiKey, model, maxTokens, temperature } = options;

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: this.formatMessages(messages),
        max_tokens: maxTokens,
        temperature,
        stream: true,
      }),
    });

    if (!response.ok) {
      throw new Error(`MyAI API error: ${response.status}`);
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
          if (data === '[DONE]') return;

          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices[0]?.delta?.content;
            if (delta) {
              onChunk({ content: delta });
            }
          } catch {
            // Skip invalid JSON
          }
        }
      }
    }
  }

  private formatMessages(messages: ChatMessage[]): any[] {
    return messages.map(msg => ({
      role: msg.role,
      content: msg.content,
      name: msg.name,
      // Handle image attachments if your provider supports them
      ...(msg.images?.length && {
        content: [
          { type: 'text', text: msg.content },
          ...msg.images.map(img => ({
            type: 'image_url',
            image_url: { url: img.url || `data:${img.mimeType};base64,${img.base64}` }
          }))
        ]
      })
    }));
  }
}
```

### The attachment contract (read this before declaring `supportsAttachments`)

`attachmentSupport` in your manifest is a **promise the host relies on**, and
breaking it fails silently in the worst possible way. Bug 91 was exactly this:
a plugin declared one thing, did another, and models spent months writing
confident descriptions of images they had never received.

The host asks two separate questions before an image reaches you:

1. **Can the model read pictures?** — the connection profile's
   `supportsImageUpload` flag, set by the operator.
2. **Can your plugin put one on the wire?** — your manifest's
   `attachmentSupport`, read through `providerCanTransportImages`
   (`lib/llm/image-transport.ts`).

If **either** answer is no, the host substitutes a written description and your
plugin never sees the bytes. So:

- **If you serialise image attachments**, declare `supportsAttachments: true`
  with the image MIME types you accept — and actually emit them in every code
  path that builds a request, streaming and non-streaming alike.
- **If you do not**, declare `supportsAttachments: false`. This is a perfectly
  respectable answer: the host will describe images in text for you and your
  users keep working. What you must not do is declare `true` and then drop
  them.
- **Report honestly in `attachmentResults`.** `sent` is what went on the wire;
  `failed` carries an error string per attachment, which the Salon shows the
  user as a warning toast. Do not report success for bytes you discarded.

**Do not keep your own list of which models have vision** if your provider is a
router fronting many upstreams. It goes stale, and the host has already made
that decision — an attachment reaching you means the operator asserted the
model reads images. `plugins/dist/qtap-plugin-nanogpt/provider.ts` is the
worked example.

### Provider Icon (src/icon.tsx)

```tsx
import React from 'react';

interface IconProps {
  className?: string;
}

export function MyAIIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      {/* Your SVG path here */}
      <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
    </svg>
  );
}
```

---

## Image Generation Provider (Optional)

If your provider supports image generation, set `providerConfig.capabilities.imageGeneration` to `true` and implement the factory method below. Do **not** add `IMAGE_PROVIDER` to the manifest `capabilities` array (see the note in [Plugin Manifest](#plugin-manifest) section):

```typescript
// In src/index.ts, add to plugin object:
createImageProvider: (baseUrl?: string) => {
  return new MyAIImageProvider(baseUrl);
},

getImageProviderConstraints: () => ({
  // Basic constraints
  maxPromptBytes: 4000,
  promptConstraintWarning: 'Prompts limited to 4000 bytes',
  maxImagesPerRequest: 4,
  supportedSizes: ['1024x1024', '512x512', '256x256'],
  supportedStyles: ['vivid', 'natural'],

  // Optional: Prompting guidance for the chat LLM
  // This text is included in the image generation tool description
  // to help the LLM write better prompts for your provider
  promptingGuidance: `For best results with MyAI:
- Start with the subject, then describe style and mood
- Include lighting and color palette details
- Avoid negative phrasing; use positive descriptions instead`,

  // Optional: Style/LoRA information with trigger phrases
  // When a style is selected, the trigger phrase is automatically
  // incorporated into the final image prompt
  styleInfo: {
    'vivid': {
      name: 'Vivid',
      loraId: 'vivid-v1',
      description: 'Dramatic, hyper-real images with vibrant colors',
      triggerPhrase: null, // No trigger phrase needed
    },
    'anime': {
      name: 'Anime Style',
      loraId: 'anime-lora-v2',
      description: 'Japanese anime-inspired artwork',
      triggerPhrase: 'anime style illustration of', // Required for this style
    },
  },
}),
```

```typescript
// src/image-provider.ts
import type { ImageGenProvider, ImageGenerationParams, ImageGenerationResult } from '@quilltap/plugin-types';

export class MyAIImageProvider implements ImageGenProvider {
  provider = 'MYAI';
  supportedModels = ['myai-image-v1'];

  async generateImage(
    params: ImageGenerationParams,
    apiKey: string
  ): Promise<ImageGenerationResult> {
    const response = await fetch('https://api.myai.com/v1/images/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        prompt: params.prompt,
        negative_prompt: params.negativePrompt,
        size: params.size || '1024x1024',
        n: params.count || 1,
      }),
    });

    if (!response.ok) {
      throw new Error(`Image generation failed: ${response.status}`);
    }

    const data = await response.json();

    return {
      images: data.data.map((img: any) => ({
        url: img.url,
        revisedPrompt: img.revised_prompt,
      })),
      raw: data,
    };
  }

  async validateApiKey(apiKey: string): Promise<boolean> {
    // Reuse the main provider's validation
    return true;
  }

  async getAvailableModels(apiKey: string): Promise<string[]> {
    return this.supportedModels;
  }
}
```

---

## Embedding Provider (Optional)

If your provider supports text embeddings, set `providerConfig.capabilities.embeddings` to `true` and implement an embedding provider. Do **not** add `EMBEDDING_PROVIDER` to the manifest `capabilities` array (see the note in [Plugin Manifest](#plugin-manifest) section).

### Embedding Provider Interface

There are two types of embedding providers:

1. **API-based providers** (EmbeddingProvider): OpenAI, OpenRouter, Ollama - require API calls
2. **Local providers** (LocalEmbeddingProvider): Built-in TF-IDF - work entirely offline

Most providers will implement `EmbeddingProvider`:

```typescript
// In manifest.json providerConfig.capabilities:
"capabilities": {
  "chat": true,
  "imageGeneration": false,
  "embeddings": true,
  "webSearch": false
}
```

### Implementation

```typescript
// src/embedding-provider.ts
import type { EmbeddingProvider, EmbeddingResult, EmbeddingOptions } from '@quilltap/plugin-types';
import { createPluginLogger } from '@quilltap/plugin-utils';

const logger = createPluginLogger('qtap-plugin-myai');

export class MyAIEmbeddingProvider implements EmbeddingProvider {
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || 'https://api.myai.com';
  }

  /**
   * Generate an embedding for the given text
   *
   * @param text The text to embed
   * @param model The model to use (e.g., 'text-embedding-3-small')
   * @param apiKey The API key for authentication
   * @param options Optional configuration (dimensions)
   * @returns The embedding result
   */
  async generateEmbedding(
    text: string,
    model: string,
    apiKey: string,
    options?: EmbeddingOptions
  ): Promise<EmbeddingResult> {
    logger.debug('Generating embedding', { model, textLength: text.length });

    const response = await fetch(`${this.baseUrl}/v1/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: text,
        dimensions: options?.dimensions,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(`Embedding failed: ${error.error?.message || response.statusText}`);
    }

    const data = await response.json();
    const embedding = data.data[0].embedding;

    return {
      embedding,
      model,
      dimensions: embedding.length,
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens,
        totalTokens: data.usage.total_tokens,
      } : undefined,
    };
  }

  /**
   * Generate embeddings for multiple texts in a batch (optional)
   */
  async generateBatchEmbeddings(
    texts: string[],
    model: string,
    apiKey: string,
    options?: EmbeddingOptions
  ): Promise<EmbeddingResult[]> {
    // Can batch in single request if provider supports it
    const response = await fetch(`${this.baseUrl}/v1/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: texts,
        dimensions: options?.dimensions,
      }),
    });

    if (!response.ok) {
      throw new Error(`Batch embedding failed: ${response.statusText}`);
    }

    const data = await response.json();
    return data.data.map((item: any) => ({
      embedding: item.embedding,
      model,
      dimensions: item.embedding.length,
    }));
  }

  /**
   * Get available embedding models (optional)
   */
  async getAvailableModels(apiKey: string): Promise<string[]> {
    // Return list of embedding models
    return ['myai-embed-small', 'myai-embed-large'];
  }
}
```

### Adding to Plugin Entry Point

```typescript
// In src/index.ts, add to plugin object:
import { MyAIEmbeddingProvider } from './embedding-provider';

export const plugin: LLMProviderPlugin = {
  // ... other fields ...

  // Factory method for embedding provider
  createEmbeddingProvider: (baseUrl?: string) => {
    return new MyAIEmbeddingProvider(baseUrl);
  },

  // Static embedding model info (optional)
  getEmbeddingModels: () => [
    {
      id: 'myai-embed-small',
      name: 'MyAI Embed Small',
      dimensions: 768,
      description: 'Fast embedding model for general use',
    },
    {
      id: 'myai-embed-large',
      name: 'MyAI Embed Large',
      dimensions: 1536,
      description: 'High-quality embedding model for demanding applications',
    },
  ],
};
```

### Local Embedding Providers

For offline/local embedding providers (like TF-IDF), implement `LocalEmbeddingProvider`:

```typescript
import type { LocalEmbeddingProvider, EmbeddingResult, LocalEmbeddingProviderState } from '@quilltap/plugin-types';

export class MyLocalEmbeddingProvider implements LocalEmbeddingProvider {
  private vocabulary: Map<string, number> = new Map();
  private idf: number[] = [];

  // No API key required for local providers
  generateEmbedding(text: string): EmbeddingResult {
    if (!this.isFitted()) {
      throw new Error('Provider must be fitted before generating embeddings');
    }
    // Generate embedding using local algorithm
    const embedding = this.vectorize(text);
    return { embedding, model: 'local-embed', dimensions: embedding.length };
  }

  generateBatchEmbeddings(texts: string[]): EmbeddingResult[] {
    return texts.map(text => this.generateEmbedding(text));
  }

  // Fit on corpus of documents
  fitCorpus(documents: string[]): void {
    // Build vocabulary, compute IDF weights, etc.
  }

  isFitted(): boolean {
    return this.vocabulary.size > 0;
  }

  // For persistence
  loadState(state: LocalEmbeddingProviderState): void {
    this.vocabulary = new Map(state.vocabulary);
    this.idf = state.idf;
  }

  getState(): LocalEmbeddingProviderState | null {
    if (!this.isFitted()) return null;
    return {
      vocabulary: Array.from(this.vocabulary.entries()),
      idf: this.idf,
      avgDocLength: 0,
      vocabularySize: this.vocabulary.size,
      includeBigrams: false,
      fittedAt: new Date().toISOString(),
    };
  }

  getVocabularySize(): number {
    return this.vocabulary.size;
  }

  getDimensions(): number {
    return this.vocabulary.size;
  }
}
```

### Using Type Guards

Quilltap provides a type guard to distinguish between API and local providers:

```typescript
import { isLocalEmbeddingProvider } from '@quilltap/plugin-types';

const provider = createEmbeddingProvider('MYAI');

if (isLocalEmbeddingProvider(provider)) {
  // Local provider - load state from database, then generate
  provider.loadState(savedState);
  const result = provider.generateEmbedding(text);
} else {
  // API provider - needs apiKey parameter
  const result = await provider.generateEmbedding(text, model, apiKey, options);
}
```

---

## Tool Formatting (If Not OpenAI-Compatible)

If your provider uses a different tool format than OpenAI, implement `formatTools` and `parseToolCalls`:

```typescript
import { convertToAnthropicFormat, parseAnthropicToolCalls } from '@quilltap/plugin-utils';

// In plugin object:
toolFormat: 'anthropic', // or 'google', or custom

formatTools: (tools, options) => {
  // Convert from OpenAI format to your provider's format
  return convertToAnthropicFormat(tools);
},

parseToolCalls: (response) => {
  // Extract tool calls from your provider's response format
  return parseAnthropicToolCalls(response);
},
```

---

## Building Your Plugin

```bash
npm run build
```

Verify the output:

- `dist/index.js` should exist and contain `module.exports` or `exports`
- `dist/manifest.json` should be copied

Check the build output is NOT wrapped in an IIFE:

```bash
head -5 dist/index.js
```

Good output:

```javascript
"use strict";
var __defProp = Object.defineProperty;
// ... more CommonJS code
module.exports = ...
```

Bad output (IIFE - will not work):

```javascript
"use strict";
(() => {
  // ... code wrapped in function
})();
```

---

## Testing Your Provider

### Local Testing

1. Copy your built plugin to Quilltap's plugin directory:

   ```bash
   cp -r dist /path/to/quilltap/plugins/site/qtap-plugin-myai
   ```

2. Restart Quilltap

3. Go to Settings > Plugins and verify your plugin appears

4. Add an API key in Settings > API Keys

5. Create a connection profile using your provider

6. Test chat functionality

### Verify Provider Registration

Check the logs for:

```
Provider registered { name: 'MYAI', displayName: 'MyAI' }
```

If you see:

```
Provider plugin module does not export a valid plugin object { exports: [] }
```

Your build configuration is wrong - check that `format: 'cjs'` is set.

---

## Publishing to npm

### Prepare for Publishing

1. Update version in `package.json`
2. Ensure `manifest.json` version matches
3. Build: `npm run build`
4. Test locally one more time

### Publish

```bash
# Login to npm (first time only)
npm login

# Publish
npm publish
```

For scoped packages:

```bash
npm publish --access public
```

### After Publishing

Users can install your plugin via Quilltap's UI:

1. Go to Settings > Plugins
2. Search for your plugin name
3. Click Install

---

## Complete Example

See these plugins as reference implementations:

**Built-in plugins:**

- **OpenAI** (`plugins/dist/qtap-plugin-openai`): Full-featured with chat, images, tools
- **Anthropic** (`plugins/dist/qtap-plugin-anthropic`): Custom tool format, PDF support
- **Ollama** (`plugins/dist/qtap-plugin-ollama`): Self-hosted, requires base URL

**Third-party example:**

- **Gab AI** (`@quilltap/qtap-plugin-gab-ai` on npm): Community-published provider plugin

---

## Troubleshooting

### Plugin Not Loading

1. **Check build format**: Ensure `format: 'cjs'` in esbuild config
2. **Check exports**: Your `dist/index.js` must export `plugin` object
3. **Check manifest**: Validate against schema, ensure `main` points to correct file
4. **Check logs**: Look for errors in Quilltap's `logs/combined.log`

### Provider Not Appearing in API Key Dropdown

1. Ensure `capabilities` includes `"LLM_PROVIDER"`
2. Ensure `providerConfig.requiresApiKey` is `true`
3. Restart Quilltap after installation
4. Check that the plugin is enabled in Settings > Plugins

### API Key Validation Failing

1. Check your `validateApiKey` implementation
2. Verify the API endpoint is correct
3. Check network permissions in manifest

### Tool Calls Not Working

1. Verify `toolFormat` matches your provider's expectations
2. Implement `formatTools` and `parseToolCalls` if not OpenAI-compatible
3. Check that models support tools (`supportsTools: true` in model info)

---

## API Reference

### LLMProviderPlugin Interface

```typescript
interface LLMProviderPlugin {
  // Required
  metadata: ProviderMetadata;
  config: ProviderConfigRequirements;
  capabilities: ProviderCapabilities;
  attachmentSupport: AttachmentSupport;
  createProvider(baseUrl?: string): LLMProvider;
  getAvailableModels(apiKey: string, baseUrl?: string): Promise<string[]>;
  validateApiKey(apiKey: string, baseUrl?: string): Promise<boolean>;

  // Icon (recommended - no React required)
  icon?: PluginIconData;
  // Deprecated: use icon instead
  renderIcon?(props: { className?: string }): React.ReactNode;

  // Optional factories
  createImageProvider?(baseUrl?: string): ImageGenProvider;
  createEmbeddingProvider?(baseUrl?: string): EmbeddingProvider | LocalEmbeddingProvider;

  // Optional info methods
  getModelInfo?(): ModelInfo[];
  getEmbeddingModels?(): EmbeddingModelInfo[];
  getImageGenerationModels?(): ImageGenerationModelInfo[];
  getImageProviderConstraints?(): ImageProviderConstraints;

  // Optional tool handling
  formatTools?(tools: any, options?: ToolFormatOptions): any;
  parseToolCalls?(response: any): ToolCallRequest[];

  // Optional runtime config
  messageFormat?: MessageFormatSupport;
  charsPerToken?: number;
  toolFormat?: 'openai' | 'anthropic' | 'google';
  cheapModels?: CheapModelConfig;
  defaultContextWindow?: number;
  thinkingTurnRule?: ThinkingTurnRule;
}
```

See `@quilltap/plugin-types` for complete type definitions.

### Declaring how thinking is switched on

If your provider has a profile option that turns reasoning on or off, declare
`thinkingTurnRule` so the host can tell whether a given profile will run a
thinking turn:

```typescript
thinkingTurnRule: {
  optionKey: 'thinking',            // a field key from getProviderOptionsSchema()
  enabledValues: ['enabled'],
  disabledValues: ['disabled'],
},
```

It matters because a thinking turn changes what a request may look like. Quilltap
anchors a multi-character reply either by appending an assistant message
containing `[Character Name]` or by appending a prose instruction to the system
prompt, and the prefill route goes badly wrong on a reasoning model: DeepSeek
rejects the request outright (it wants the `reasoning_content` that produced the
assistant turn, which a synthetic prefill has none of), and Ollama's chat
template never opens the reasoning block behind a prefilled turn, so the
reasoning is lost entirely. A profile Quilltap knows to be thinking gets the
prose anchor by default; the user may still tick the box back on.

The rule is declarative rather than a predicate function because the
connection-profile editor runs in the browser and needs the same answer, so the
rule has to cross the wire. It answers only the explicit half — "has this
profile switched thinking on or off?". When the profile says nothing, the host
falls back to the selected model's `thinksByDefault` flag (see below). Omit the
rule entirely and only the model flag speaks.
