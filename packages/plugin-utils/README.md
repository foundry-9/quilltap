# @quilltap/plugin-utils

Utility functions for Quilltap plugin development. This package provides runtime utilities that complement the type definitions in `@quilltap/plugin-types`.

## Installation

```bash
npm install @quilltap/plugin-utils @quilltap/plugin-types
```

## Features

### Tool Parsing

Parse tool calls from any LLM provider's response format into a standardized `ToolCallRequest[]`:

```typescript
import { parseToolCalls, parseOpenAIToolCalls } from '@quilltap/plugin-utils';

// Auto-detect format
const toolCalls = parseToolCalls(response, 'auto');

// Or use provider-specific parsers
const openaiCalls = parseOpenAIToolCalls(response);
const anthropicCalls = parseAnthropicToolCalls(response);
const googleCalls = parseGoogleToolCalls(response);
```

### Tool Format Conversion

Convert between OpenAI, Anthropic, and Google tool formats:

```typescript
import {
  convertToAnthropicFormat,
  convertToGoogleFormat,
  convertToolsTo
} from '@quilltap/plugin-utils';

// Convert a single tool
const anthropicTool = convertToAnthropicFormat(universalTool);
const googleTool = convertToGoogleFormat(universalTool);

// Convert multiple tools
const anthropicTools = convertToolsTo(tools, 'anthropic');
```

### Logger Bridge

Create a logger that integrates with Quilltap's core logging system when running inside the host application, or falls back to console logging when running standalone:

```typescript
import { createPluginLogger } from '@quilltap/plugin-utils';

// Create a logger for your plugin
const logger = createPluginLogger('qtap-plugin-my-provider');

// Use it like any standard logger
logger.debug('Initializing provider', { version: '1.0.0' });
logger.info('Provider ready');
logger.warn('Rate limit approaching', { remaining: 10 });
logger.error('API call failed', { endpoint: '/chat' }, error);

// Create child loggers with additional context
const childLogger = logger.child({ component: 'auth' });
childLogger.info('Validating API key');
```

When running inside Quilltap:
- Logs are routed to Quilltap's core logging system
- Logs appear in `logs/combined.log` and console
- Each log is tagged with `{ plugin: 'your-plugin-name', module: 'plugin' }`

When running standalone:
- Logs are written to console with `[plugin-name]` prefix
- Respects `LOG_LEVEL` or `QUILLTAP_LOG_LEVEL` environment variables

## API Reference

### Tool Parsing

| Function | Description |
|----------|-------------|
| `parseToolCalls(response, format)` | Parse tool calls with auto-detection or explicit format |
| `parseOpenAIToolCalls(response)` | Parse OpenAI/Grok format tool calls |
| `parseAnthropicToolCalls(response)` | Parse Anthropic format tool calls |
| `parseGoogleToolCalls(response)` | Parse Google Gemini format tool calls |
| `detectToolCallFormat(response)` | Detect the format of a response |
| `hasToolCalls(response)` | Check if a response contains tool calls |

### Tool Conversion

| Function | Description |
|----------|-------------|
| `convertToAnthropicFormat(tool)` | Convert universal tool to Anthropic format |
| `convertToGoogleFormat(tool)` | Convert universal tool to Google format |
| `convertFromAnthropicFormat(tool)` | Convert Anthropic tool to universal format |
| `convertFromGoogleFormat(tool)` | Convert Google tool to universal format |
| `convertToolTo(tool, target)` | Convert a tool to any supported format |
| `convertToolsTo(tools, target)` | Convert multiple tools to any format |
| `applyDescriptionLimit(tool, maxBytes)` | Truncate tool description if too long |

### Logging

| Function | Description |
|----------|-------------|
| `createPluginLogger(name, minLevel?)` | Create a plugin logger with core bridge |
| `hasCoreLogger()` | Check if running inside Quilltap |
| `getLogLevelFromEnv()` | Get log level from environment variables |
| `createConsoleLogger(prefix, minLevel?)` | Create a standalone console logger |
| `createNoopLogger()` | Create a no-op logger |

### OpenAI-Compatible Provider Base Class

Create custom LLM providers for OpenAI-compatible APIs with minimal code:

```typescript
import { OpenAICompatibleProvider } from '@quilltap/plugin-utils';

// Create a provider for any OpenAI-compatible API
export class MyLLMProvider extends OpenAICompatibleProvider {
  constructor() {
    super({
      baseUrl: 'https://api.my-llm-service.com/v1',
      providerName: 'MyLLM',
      requireApiKey: true,
      attachmentErrorMessage: 'MyLLM does not support file attachments',
    });
  }
}
```

This gives you a complete `LLMProvider` implementation with:
- Streaming and non-streaming chat completions
- API key validation
- Model listing
- Proper error handling and logging

**Configuration Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `baseUrl` | `string` | (required) | API endpoint URL with version path |
| `providerName` | `string` | `'OpenAICompatible'` | Name used in log messages |
| `requireApiKey` | `boolean` | `false` | Whether API key is mandatory |
| `attachmentErrorMessage` | `string` | (default message) | Error shown for attachment failures |

**Note:** Requires `openai` as a peer dependency:
```bash
npm install openai
```

### Profile Parameters

A connection profile's `parameters` blob is free-form JSON, handed to the
provider as `LLMParams.profileParameters`. A provider that never reads it drops
every setting the user saved, in silence — so forwarding is opt-in but explicit,
and always allow-listed:

```typescript
import { applyProfileParameters } from '@quilltap/plugin-utils';

const MY_ALLOWLIST = ['top_k', 'min_p', 'reasoning_effort'] as const;

applyProfileParameters(body, params, MY_ALLOWLIST, (key, value, callParams, target) => {
  // Return the value to send, or `undefined` to omit the key.
  // Write into `target` to send it under a different key entirely.
  return value;
});
```

`undefined`, `null` and the empty string omit the key — the empty string is what
the schema-driven profile editor stores for "use the model default". Never
spread the blob: `model`, `messages`, `stream`, `stream_options` and `tools`
must stay unreachable from a profile.

Subclasses of `OpenAICompatibleProvider` get this by declaring
`profileParamAllowlist` (empty by default, so a subclass that declares nothing
is byte-identical on the wire) and optionally overriding `normalizeProfileParam`;
providers that implement `TextProvider` directly call the function themselves.
The keys must match whatever the plugin's `getProviderOptionsSchema()` renders,
or a field the editor draws goes nowhere.

### System Prompt Plugin Utilities

Create system prompt plugins that provide character prompt templates from `.md` files:

```typescript
import { createSystemPromptPlugin } from '@quilltap/plugin-utils';
import type { SystemPromptData } from '@quilltap/plugin-types';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

function loadPrompts(): SystemPromptData[] {
  const promptsDir = join(dirname(__filename), 'prompts');
  return readdirSync(promptsDir)
    .filter(f => f.endsWith('.md'))
    .map(file => {
      const name = file.replace(/\.md$/i, '');
      const parts = name.split('_');
      const category = parts.pop()!;
      const modelHint = parts.join('_');
      return {
        name,
        content: readFileSync(join(promptsDir, file), 'utf-8'),
        modelHint,
        category,
      };
    });
}

export const plugin = createSystemPromptPlugin({
  metadata: {
    pluginId: 'my-prompts',
    displayName: 'My System Prompts',
    version: '1.0.0',
  },
  prompts: loadPrompts(),
});
```

| Function | Description |
|----------|-------------|
| `createSystemPromptPlugin(options)` | Create a system prompt plugin with validation |
| `validateSystemPromptPlugin(plugin)` | Validate a complete system prompt plugin |

## Example: Complete Plugin Provider

```typescript
import { createPluginLogger, parseOpenAIToolCalls } from '@quilltap/plugin-utils';
import type { LLMProvider, LLMParams, LLMResponse, ToolCallRequest } from '@quilltap/plugin-types';
import OpenAI from 'openai';

const logger = createPluginLogger('qtap-plugin-my-provider');

export class MyProvider implements LLMProvider {
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
    logger.debug('Provider initialized');
  }

  async sendMessage(params: LLMParams, apiKey: string): Promise<LLMResponse> {
    logger.debug('Sending message', { model: params.model, messageCount: params.messages.length });

    try {
      const response = await this.client.chat.completions.create({
        model: params.model,
        messages: params.messages,
        tools: params.tools,
      });

      // Parse tool calls using the utility
      const toolCalls = parseOpenAIToolCalls(response);

      logger.info('Received response', {
        hasToolCalls: toolCalls.length > 0,
        tokens: response.usage?.total_tokens,
      });

      return {
        content: response.choices[0].message.content || '',
        toolCalls,
        usage: {
          promptTokens: response.usage?.prompt_tokens || 0,
          completionTokens: response.usage?.completion_tokens || 0,
          totalTokens: response.usage?.total_tokens || 0,
        },
      };
    } catch (error) {
      logger.error('Failed to send message', { model: params.model }, error as Error);
      throw error;
    }
  }
}
```

## License

MIT - Foundry-9 LLC
