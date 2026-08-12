# Changelog

All notable changes to @quilltap/plugin-utils will be documented in this file.

## [2.2.19] - 2026-08-03

### Fixed

- `PLUGIN_UTILS_VERSION` no longer drifts from the published version. The constant was a hand-written literal and had been stale since 2.2.1 while the package shipped 2.2.18, so any consumer using it for a runtime compatibility check got a wrong answer. It is now generated into `src/version.generated.ts` from the `version` field in package.json by `scripts/generate-version.mjs`, which runs from `prebuild` and `pretypecheck` — bumping package.json is the only step. Both the runtime value and the literal type in `dist/index.d.ts` follow automatically.

## [2.2.0] - 2026-04-09

### Removed

- **Breaking:** Removed roleplay template utilities from main exports — `createRoleplayTemplatePlugin`, `createSingleTemplatePlugin`, `validateTemplateConfig`, `validateRoleplayTemplatePlugin` are no longer exported
- Removed `./roleplay-templates` export path from package.json
- Roleplay templates are now native first-class entities in Quilltap v4.2.0, no plugin needed
- Updated `@quilltap/plugin-types` dependency to `^2.2.0`

## [1.4.0] - 2026-02-25

### Added

- **Host URL Rewriting Utilities**
  - `isVMEnvironment()` - Check if running in a VM/container environment (Docker, Lima, WSL2)
  - `resolveHostGateway()` - Resolve the host gateway address with multi-strategy fallback
  - `rewriteLocalhostUrl()` - Transparently rewrite localhost URLs to point at the host gateway
  - Self-contained environment detection (no dependency on Quilltap core `lib/paths`)
  - Uses `createPluginLogger` for consistent logging within the plugin ecosystem
  - New export path: `@quilltap/plugin-utils/host-rewrite`

## [1.3.0] - 2026-01-30

### Added

- **Built-in Tool Names for Collision Detection**
  - Added `BUILTIN_TOOL_NAMES` constant with names of Quilltap's built-in tools
  - Added `getBuiltinToolNames()` function for dynamic access to the set
  - Enables plugins (like MCP connectors) to avoid shadowing built-in functionality
  - Built-in tools: `generate_image`, `search_memories`, `search_web`, `project_info`, `file_management`, `request_full_context`

## [1.2.5] - 2026-01-25

### Fixed

- **Environment Variable Typo**
  - Fixed spelling of environment variable from QUIL-T-T-AP to QUIL-L-T-AP (correct: `QUILLTAP_LOG_LEVEL`)
- **Unused Variable Cleanup**
  - Removed unused `finalFinishReason` variable in OpenAI-compatible provider streaming
  - Removed unused `enableLogging` functionality in roleplay template builder (option retained in API for future use)

## [1.2.4] - 2026-01-21

### Fixed

- **Graceful Handling of Incomplete Tool Call Arguments During Streaming**
  - `parseOpenAIToolCalls()` now checks if JSON arguments look complete before parsing
  - Skips tool calls with incomplete JSON (common during streaming) instead of throwing errors
  - Eliminates noisy "Unterminated string in JSON" errors during streaming tool calls
  - Tool calls are correctly parsed when the final complete response is received

## [1.2.2] - 2026-01-09

### Fixed

- **Tool Call Parsing for Streaming Responses**
  - `parseOpenAIToolCalls()` now checks `choices[0].delta.toolCalls` for streaming responses (OpenRouter SDK uses this structure)
  - Added support for camelCase `toolCalls` in addition to snake_case `tool_calls` (SDK format varies)
  - `detectToolCallFormat()` updated to detect tool calls in delta for streaming responses
  - Fixes tool calls not being detected when using OpenRouter with streaming enabled

## [1.2.0] - 2025-12-31

### Added

- **Roleplay Template Plugin Utilities**
  - `createRoleplayTemplatePlugin()` - Create roleplay template plugins with full control
  - `createSingleTemplatePlugin()` - Simplified helper for single-template plugins
  - `validateTemplateConfig()` - Validate individual template configurations
  - `validateRoleplayTemplatePlugin()` - Validate complete roleplay template plugins
  - `CreateRoleplayTemplatePluginOptions` - Options interface for full control
  - `CreateSingleTemplatePluginOptions` - Simplified options for single templates

- **New Export Path**
  - `@quilltap/plugin-utils/roleplay-templates` - Direct import path for roleplay template utilities

## [1.1.0] - 2025-12-30

### Added

- **OpenAI-Compatible Provider Base Class**
  - `OpenAICompatibleProvider` - Reusable base class for OpenAI-compatible LLM providers
  - `OpenAICompatibleProviderConfig` - Configuration interface for customizing providers
  - Supports streaming and non-streaming chat completions
  - Configurable API key requirements (`requireApiKey` option)
  - Customizable provider name for logging (`providerName` option)
  - Customizable attachment error messages (`attachmentErrorMessage` option)
  - Includes API key validation and model listing
  - Uses the plugin logger bridge for consistent logging
  - Peer dependency on `openai` package (optional, only needed if using this provider)

- **New Export Path**
  - `@quilltap/plugin-utils/providers` - Direct import path for provider base classes

## [1.0.0] - 2025-12-30

### Added

- Initial release of @quilltap/plugin-utils
- **Tool Parsing Utilities**
  - `parseToolCalls()` - Parse tool calls with auto-detection or explicit format
  - `parseOpenAIToolCalls()` - Parse OpenAI/Grok format tool calls
  - `parseAnthropicToolCalls()` - Parse Anthropic format tool calls
  - `parseGoogleToolCalls()` - Parse Google Gemini format tool calls
  - `detectToolCallFormat()` - Detect the format of a response
  - `hasToolCalls()` - Quick check if a response contains tool calls

- **Tool Conversion Utilities**
  - `convertToAnthropicFormat()` - Convert universal tool to Anthropic format
  - `convertToGoogleFormat()` - Convert universal tool to Google format
  - `convertFromAnthropicFormat()` - Convert Anthropic tool to universal format
  - `convertFromGoogleFormat()` - Convert Google tool to universal format
  - `convertToolTo()` - Convert a tool to any supported format
  - `convertToolsTo()` - Convert multiple tools to any format
  - `applyDescriptionLimit()` - Truncate tool description if too long

- **Logger Bridge**
  - `createPluginLogger()` - Create a logger that bridges to Quilltap core
  - `hasCoreLogger()` - Check if running inside Quilltap
  - `getLogLevelFromEnv()` - Get log level from environment variables
  - Support for child loggers with context inheritance
  - Automatic fallback to console logging when running standalone
