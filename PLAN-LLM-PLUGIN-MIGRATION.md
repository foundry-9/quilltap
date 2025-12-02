# LLM Provider Plugin Migration Plan

**Status:** Complete - All Phases Finished
**Started:** 2025-12-02
**Last Updated:** 2025-12-02

This document tracks the migration of all LLM provider functionality into plugins.

## Overview

This refactoring effort moves all LLM-specific code into individual plugins under `plugins/dist/`, creating a modular architecture where:

1. Each LLM provider (OpenAI, Anthropic, Google, Grok, Gab AI, Ollama, OpenRouter) has its own plugin
2. An OpenAI-compatible plugin handles generic OpenAI-format APIs
3. The core app can delegate to plugin providers via a hybrid factory
4. All provider metadata (icons, names, colors) comes from plugins
5. API key types are provided by plugins
6. The plugin system is enhanced to support provider registration

## Current State

### Plugins Created ✅

| Plugin | Provider | Chat | Images | Attachments | Status |
|--------|----------|------|--------|-------------|--------|
| `qtap-plugin-openai` | OpenAI | ✅ | ✅ DALL-E | ✅ Images | ✅ Complete |
| `qtap-plugin-anthropic` | Anthropic | ✅ | ❌ | ✅ Images + PDF | ✅ Complete |
| `qtap-plugin-google` | Google Gemini | ✅ | ✅ Imagen | ✅ Images | ✅ Complete |
| `qtap-plugin-grok` | Grok/xAI | ✅ | ✅ | ✅ Images | ✅ Complete |
| `qtap-plugin-gab-ai` | Gab AI | ✅ | ❌ | ❌ | ✅ Complete |
| `qtap-plugin-ollama` | Ollama | ✅ | ❌ | ❌ | ✅ Complete |
| `qtap-plugin-openrouter` | OpenRouter | ✅ | ❌ | ❌ | ✅ Complete |
| `qtap-plugin-openai-compatible` | Generic | ✅ | ❌ | ❌ | ✅ Complete |

### Infrastructure Created ✅

| File | Purpose | Status |
|------|---------|--------|
| `lib/plugins/interfaces/provider-plugin.ts` | Provider plugin interface | ✅ Complete |
| `lib/plugins/interfaces/index.ts` | Interface exports | ✅ Complete |
| `lib/plugins/provider-registry.ts` | Provider registration and factory | ✅ Complete |
| `lib/llm/plugin-factory.ts` | Hybrid factory (plugin + builtin) | ✅ Complete |
| `lib/json-store/schemas/plugin-manifest.ts` | Updated with `providerConfig` | ✅ Complete |
| `lib/startup/plugin-initialization.ts` | Updated to load providers | ✅ Complete |
| `lib/plugins/index.ts` | Updated exports | ✅ Complete |
| `plugins/README.md` | Provider plugin development guide | ✅ Complete |

### Build & Tests ✅

- **Build:** Passes (with expected dynamic import warning)
- **Unit Tests:** 1364 passed
- **Integration Tests:** 76 passed

## Phase Status

### Phase 1: Plugin Infrastructure ✅ COMPLETE

- [x] Created provider plugin interface
- [x] Created provider registry
- [x] Updated manifest schema with `providerConfig`
- [x] Created hybrid factory (`lib/llm/plugin-factory.ts`)
- [x] Updated plugin initialization to register providers
- [x] Updated exports in `lib/plugins/index.ts`

### Phase 2: First Provider Plugin (OpenAI) ✅ COMPLETE

- [x] Created full plugin structure
- [x] Implemented LLM provider with streaming
- [x] Implemented image generation (DALL-E)
- [x] Added icon component
- [x] Created manifest and README
- [x] Build passes

### Phase 3: Remaining Provider Plugins ✅ COMPLETE

All 7 remaining provider plugins created:

- [x] Anthropic - Claude models with vision and PDF support
- [x] Google - Gemini models with Imagen image generation
- [x] Grok - xAI models with image generation
- [x] Gab AI - Text-only completions
- [x] Ollama - Local models (requires baseUrl)
- [x] OpenRouter - Multi-model gateway with pricing
- [x] OpenAI-Compatible - Generic connector (requires baseUrl)

### Phase 4: Core Cleanup ✅ COMPLETE

The legacy provider implementations have been removed and the application now uses the plugin-based provider registry exclusively:

- [x] Removed `lib/llm/openai.ts`
- [x] Removed `lib/llm/anthropic.ts`
- [x] Removed `lib/llm/google.ts`
- [x] Removed `lib/llm/grok.ts`
- [x] Removed `lib/llm/gab-ai.ts`
- [x] Removed `lib/llm/ollama.ts`
- [x] Removed `lib/llm/openrouter.ts`
- [x] Removed `lib/llm/openai-compatible.ts`
- [x] Removed `lib/llm/factory.ts`
- [x] Removed legacy image providers
- [x] Updated all API routes to use plugin registry
- [x] Created upgrade plugin for database migrations

### Phase 5: Documentation ✅ COMPLETE

- [x] Created `plugins/README.md` with:
  - Plugin directory structure
  - Provider plugin development guide
  - Required files and structure
  - Code examples
  - Best practices
  - Reference implementations

## Plugin Structure

Each provider plugin follows this structure:

```text
plugins/dist/qtap-plugin-{provider}/
├── manifest.json       # Plugin metadata and providerConfig
├── package.json        # NPM package config
├── README.md           # Plugin documentation
├── index.ts            # Main entry exporting LLMProviderPlugin
├── provider.ts         # LLM provider implementation
├── types.ts            # Type re-exports from core
├── icon.tsx            # React icon component
└── image-provider.ts   # Image generation (if supported)
```

## How It Works

### Plugin Loading Flow

1. App startup calls `initializePlugins()`
2. Plugin system scans `plugins/` and `plugins/dist/`
3. For plugins with `LLM_PROVIDER` capability:
   - Dynamic import loads the plugin module
   - Plugin's `plugin` export is registered with `providerRegistry`
4. When a provider is needed:
   - `plugin-factory.ts` checks if provider is in plugin registry
   - If yes, uses plugin's `createProvider()` method
   - If no, falls back to built-in provider

### Using Plugin Providers

```typescript
import { createLLMProvider } from '@/lib/llm/plugin-factory';

// Creates provider from plugin if available, else built-in
const provider = createLLMProvider('OPENAI');
```

### Checking Provider Source

```typescript
import { isProviderFromPlugin, getProviderSource } from '@/lib/llm/plugin-factory';

isProviderFromPlugin('OPENAI');  // true if plugin loaded
getProviderSource('OPENAI');     // 'plugin' | 'builtin' | 'unknown'
```

## Recovery Instructions

If work needs to continue:

1. Read this file for current status
2. All provider plugins are complete
3. To proceed with cleanup (Phase 4):
   - Switch factories to use plugin providers only
   - Remove duplicate code from `lib/llm/` and `lib/image-gen/`
   - Update components to use plugin metadata
4. Run `npm test` to verify no regressions

## Notes

- Built-in providers remain functional alongside plugin providers
- The hybrid factory ensures backward compatibility
- Existing connection profiles and API keys continue to work
- Plugin icons match the existing styling (colored circle with abbreviation)
- All plugins include comprehensive debug logging
