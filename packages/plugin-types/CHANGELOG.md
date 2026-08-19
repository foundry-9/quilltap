# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.5.7] - 2026-08-19

### Added

- `ProviderConfigRequirements.acceptsApiKey` — optional, and when omitted it means "same answer as `requiresApiKey`", so no existing plugin changes behaviour. `requiresApiKey` answers "must a key be supplied before the profile is valid?"; the new flag answers "may one be supplied?". OpenAI-Compatible is the provider that splits them — it spans an unauthenticated llama.cpp on localhost and a hosted endpoint behind a bearer token — and until it could say so, a hosted OpenAI-compatible endpoint was unconfigurable: the provider appeared in neither the Add-New-API-Key list nor the profile form's key field. (Quilltap bug 81.)

## [2.5.6] - 2026-08-13

### Fixed

- `DialogueDetection` JSDoc examples spelled the "straight and curly" quote pairs with ASCII `"` (U+0022) duplicated instead of the real curly code points, so a plugin author copying them got a detector that never matched curly dialogue. The examples on `RoleplayTemplateConfig.dialogueDetection` and the `openingChars` / `closingChars` field docs now spell the curly pair as `\u201c` / `\u201d` escapes, matching the host's own defaults. Documentation only — no type or runtime change. Same defect as Quilltap bug 62.

### Changed

- `PLUGIN_TYPES_VERSION` re-synced to the package version (was stale at `2.5.2`).

## [2.5.0] - 2026-05-27

### Added

- `reasoningContent?: string` field on `LLMMessage`, `LLMResponse`, and `StreamChunk` — carries chain-of-thought / reasoning content from thinking-mode providers (e.g. DeepSeek V4 Pro `reasoning_content`). Required on assistant turns with `toolCalls` for DeepSeek; ignored by providers that don't expose a separate reasoning channel.

## [2.4.0] - 2026-05-25

### Added

- `getProviderOptionsSchema?` optional method on `TextProviderPlugin` — lets a provider plugin describe the provider-specific configuration fields the host's connection-profile editor should render. Fields map directly to keys on the `parameters` blob the plugin already receives via `LLMParams.profileParameters`.
- `ProviderOptionsSchema`, `ProviderOptionGroup`, `ProviderOptionField`, `ProviderOptionEnumValue`, `ProviderOptionFieldType`, `ProviderOptionDirective`, `ProviderOptionShowIf`, `ProviderOptionsSchemaContext` exported from the root and `/plugins` entrypoints.
- `PLUGIN_TYPES_VERSION` constant updated to track package version (was stale at 2.2.1).

## [2.3.0] - 2026-04-15

### Added

- `modelSupportsPrefill` optional method on `TextProviderPlugin` — allows providers to declare per-model support for assistant message prefill (Claude 4.6 dropped prefill support)

## [2.2.0] - 2026-04-09

### Removed

- **Breaking:** Removed `ROLEPLAY_TEMPLATE` from `PluginCapability` type — roleplay templates are now native first-class entities in Quilltap v4.2.0
- Removed roleplay template type re-exports from `@quilltap/plugin-types/plugins` barrel
- Types in `./plugins/roleplay-template` are preserved but deprecated — import directly if backward compat is needed

## [1.15.1] - 2026-02-23

### Removed

- **Breaking:** Removed `FILE_BACKEND` / `STORAGE_BACKEND` plugin capability and `STORAGE` plugin category
- Removed all file-storage plugin types: `FileBackendCapabilities`, `FileBackendMetadata`, `FileMetadata`, `FileStorageBackend`, `FileStorageConfigField`, `FileStorageProviderPlugin`, `FileStoragePluginExport`
- Removed `FILE_BACKEND` from the `requiresRestart` inference list in `PluginManifest`

## [1.14.0] - 2026-02-10

### Added

- New `SEARCH_PROVIDER` plugin capability type for pluggable web search backends
- `SearchProviderPlugin` interface for implementing search provider plugins:
  - `SearchProviderMetadata` — providerName, displayName, description, abbreviation, colors
  - `SearchProviderConfigRequirements` — requiresApiKey, apiKeyLabel, requiresBaseUrl, baseUrlDefault
  - `SearchResult` — title, url, snippet, publishedDate
  - `SearchOutput` — success, results, error, totalFound, query
  - `executeSearch()` — execute a web search query
  - `formatResults()` — format results for LLM context
  - `validateApiKey()` — optional API key validation
  - `icon` — optional SVG icon data
- `SearchProviderPluginExport` standard export type
- `SearchProviderConfig` manifest configuration type for SEARCH_PROVIDER plugins
- Exported all search provider types via `@quilltap/plugin-types` and `@quilltap/plugin-types/plugins`

## [1.12.0] - 2026-02-01

### Removed

- **Breaking:** Removed React peer dependency entirely
  - `renderIcon` return type changed from `ReactNode` to `unknown`
  - Removed `peerDependencies` and `peerDependenciesMeta` for React
  - Removed `@types/react` from devDependencies
  - Plugins using deprecated `renderIcon` still work at runtime but lose type safety
  - Use the `icon` property with `PluginIconData` instead (recommended)

## [1.11.0] - 2026-02-01

### Added

- `ImageStyleInfo` interface for describing style/LoRA information:
  - `name: string` - Human-readable name for the style
  - `loraId: string` - Internal LoRA/style identifier used in API calls
  - `description: string` - Description for UI display and LLM context
  - `triggerPhrase?: string | null` - Trigger phrase to include in prompt for this style
- New fields on `ImageProviderConstraints`:
  - `promptingGuidance?: string` - Provider-specific guidance for the LLM when crafting image prompts
  - `styleInfo?: Record<string, ImageStyleInfo>` - Detailed information about available styles/LoRAs
- Exported `ImageStyleInfo` from the main package entry point

## [1.10.0] - 2026-02-01

### Added

- `PluginIconData` interface for providing SVG icon data without React dependency:
  - `svg?: string` - Raw SVG string (complete `<svg>` element)
  - `viewBox?: string` - SVG viewBox attribute
  - `paths?: Array<{...}>` - SVG path elements with d, fill, stroke, etc.
  - `circles?: Array<{...}>` - SVG circle elements
  - `text?: {...}` - SVG text element for abbreviation or label
- `icon?: PluginIconData` property on `LLMProviderPlugin` interface
  - Preferred approach for providing provider icons
  - Quilltap renders the SVG data, removing React dependency from plugins

### Changed

- `renderIcon` method on `LLMProviderPlugin` is now optional and deprecated
  - Falls back to `icon` property or generates default icon from abbreviation
  - Kept for backwards compatibility with existing external plugins

## [1.9.4] - 2026-01-30

### Added

- New embedding provider types for building embedding plugins:
  - `EmbeddingResult` - Result of an embedding operation (vector, model, dimensions, usage)
  - `EmbeddingOptions` - Options for embedding generation (dimensions)
  - `EmbeddingProvider` - Interface for API-based embedding providers (OpenAI, Ollama, etc.)
  - `LocalEmbeddingProvider` - Extended interface for local/offline providers like TF-IDF
  - `LocalEmbeddingProviderState` - Serializable state for local providers (vocabulary, IDF, etc.)
  - `isLocalEmbeddingProvider` - Type guard function to detect local providers
- Updated `createEmbeddingProvider` method on `LLMProviderPlugin` to return proper typed interface
  - Now returns `EmbeddingProvider | LocalEmbeddingProvider` instead of `unknown`

## [1.9.2] - 2026-01-27

### Changed

- `InstalledPluginInfo.scope` field now only allows `'site'` value (removed `'user'`)
  - Per-user plugin installations are no longer supported in single-user mode
  - All plugins are installed site-wide

## [1.9.1] - 2026-01-26

### Added

- `legacyNames` optional field to `ProviderMetadata` interface
  - Allows providers to declare legacy provider names that should be treated as aliases
  - Used for backward compatibility when provider names change (e.g., `GOOGLE_IMAGEN` → `GOOGLE`)
- `legacyNames` optional field to `ProviderConfig` interface in manifest types

## [1.8.1] - 2026-01-14

### Changed

- **Breaking**: `getMultipleToolDefinitions` now accepts a `config` parameter
  - Old signature: `getMultipleToolDefinitions?: () => UniversalTool[]`
  - New signature: `getMultipleToolDefinitions?: (config: Record<string, unknown>) => UniversalTool[]`
  - This allows multi-tool plugins to discover tools dynamically based on user configuration
  - Required for plugins like MCP that need configuration to connect to external servers

## [1.8.0] - 2026-01-13

### Added

- Multi-tool plugin support for `ToolPlugin` interface:
  - `getMultipleToolDefinitions?: () => UniversalTool[]` - Allows plugins to provide multiple tools dynamically
  - `executeByName?: (toolName, input, context) => Promise<ToolExecutionResult>` - Execute a specific tool by name (required for multi-tool plugins)
  - `onConfigurationChange?: (config) => Promise<void>` - Callback when user configuration changes
- These additions enable plugins like the MCP connector to discover and expose multiple tools from external servers

## [1.7.0] - 2026-01-09

### Added

- Added file storage plugin types for building custom storage backend plugins:
  - `FileBackendCapabilities` - Interface describing storage backend features
  - `FileBackendMetadata` - Backend registration metadata
  - `FileMetadata` - Stored file metadata (size, contentType, lastModified)
  - `FileStorageBackend` - Core interface with upload, download, delete, exists, and optional operations
  - `FileStorageConfigField` - Configuration field definitions for plugin setup UI
  - `FileStorageProviderPlugin` - Main plugin interface for storage providers
  - `FileStoragePluginExport` - Standard export type for file storage plugins
- Added `@types/node` to devDependencies for Node.js type support (Buffer, Readable)

## [1.5.1] - 2026-01-05

### Added

- Added `maxBase64Size?: number` field to `AttachmentSupport` interface
  - Allows provider plugins to specify their maximum base64-encoded file size limit
  - Used by core to automatically resize images that exceed provider limits
  - Anthropic sets 5MB, OpenAI/Google/Grok set 20MB

## [1.5.0] - 2026-01-02

### Added

- Added `RenderingPattern` interface for configurable message content styling:
  - `pattern: string` - Regex pattern as a string (converted to RegExp at runtime)
  - `className: string` - CSS class to apply to matched text
  - `flags?: string` - Optional regex flags (e.g., 'm' for multiline)
- Added `DialogueDetection` interface for paragraph-level dialogue detection:
  - `openingChars: string[]` - Opening quote characters to detect
  - `closingChars: string[]` - Closing quote characters to detect
  - `className: string` - CSS class to apply to dialogue paragraphs
- Added `renderingPatterns?: RenderingPattern[]` field to `RoleplayTemplateConfig`
- Added `dialogueDetection?: DialogueDetection` field to `RoleplayTemplateConfig`
- Exported `AnnotationButton`, `RenderingPattern`, `DialogueDetection` from `@quilltap/plugin-types/plugins`

## [1.4.0] - 2026-01-02

### Added

- Added `AnnotationButton` interface for roleplay template annotation buttons:
  - `label: string` - Full name for tooltip (e.g., "Narration", "Internal Monologue")
  - `abbrev: string` - Abbreviated label for button display (e.g., "Nar", "Int", "OOC")
  - `prefix: string` - Opening delimiter (e.g., "[", "{", "// ")
  - `suffix: string` - Closing delimiter (e.g., "]", "}", "")
- Added `annotationButtons?: AnnotationButton[]` field to `RoleplayTemplateConfig` interface
  - Enables roleplay template plugins to define custom annotation formatting buttons
  - Used by the Document Editing Mode formatting toolbar

## [1.3.0] - 2026-01-02

### Added

- Added `requiresRestart?: boolean` field to `PluginManifest` interface
  - Optional field to indicate if a plugin requires a server restart to activate
  - If not specified, restart requirement is inferred from capabilities (AUTH_METHODS, DATABASE_BACKEND, FILE_BACKEND, UPGRADE_MIGRATION)
  - Used by hosted deployments to enforce site-wide installation for restart-requiring plugins

## [1.2.0] - 2025-12-31

### Added

- Roleplay template plugin types:
  - `RoleplayTemplatePlugin` main interface for roleplay template plugins
  - `RoleplayTemplateMetadata` for template identification and display
  - `RoleplayTemplateConfig` for individual template configuration
  - `RoleplayTemplatePluginExport` standard export type
- Added `ROLEPLAY_TEMPLATE` to `PluginCapability` type
- Added `TEMPLATE` to `PluginCategory` type
- Exported roleplay template types via `@quilltap/plugin-types/plugins`

## [1.1.0] - 2025-12-31

### Added

- Theme plugin types for self-contained theme plugins:
  - `ThemePlugin` main interface for theme plugins
  - `ThemeMetadata` for theme identification and display
  - `ThemeTokens` complete theme token structure
  - `ColorPalette` for light and dark mode colors
  - `Typography`, `Spacing`, `Effects` for design tokens
  - `FontDefinition` for font loading configuration
  - `EmbeddedFont` for self-contained font embedding
  - `ThemePluginExport` standard export type
- Exported theme types via `@quilltap/plugin-types/plugins`

## [1.0.3] - 2025-12-30

### Added

- New runtime configuration types for `LLMProviderPlugin`:
  - `MessageFormatSupport` - configures name field support for multi-character chats
  - `CheapModelConfig` - specifies recommended cheap models for background tasks
  - `ToolFormatType` - declares which tool format the provider uses ('openai' | 'anthropic' | 'google')
- New optional properties on `LLMProviderPlugin`:
  - `messageFormat?: MessageFormatSupport`
  - `charsPerToken?: number` - token estimation multiplier (default: 3.5)
  - `toolFormat?: ToolFormatType` - tool format type
  - `cheapModels?: CheapModelConfig` - cheap model configuration
  - `defaultContextWindow?: number` - fallback context window (default: 8192)
- Added `pricing?: { input: number; output: number }` to `ModelInfo` interface

## [1.0.2] - 2025-12-30

### Fixed

- Removed unused eslint-disable directives

## [1.0.1] - 2025-12-30

### Fixed

- Changed `formatTools` and `parseToolCalls` signatures to use `any` instead of `unknown` for backward compatibility with existing plugin implementations

## [1.0.0] - 2025-12-30

### Added

- Initial release of `@quilltap/plugin-types`
- Core LLM types:
  - `LLMProvider` interface
  - `LLMParams`, `LLMResponse`, `StreamChunk` types
  - `LLMMessage`, `FileAttachment` types
  - `ImageGenParams`, `ImageGenResponse` types
  - `ModelMetadata`, `ModelWarning` types
- Tool/function calling types:
  - `OpenAIToolDefinition`, `AnthropicToolDefinition`, `GoogleToolDefinition`
  - `UniversalTool` (alias for OpenAI format)
  - `ToolCall`, `ToolCallRequest`, `ToolResult`
- Plugin interface types:
  - `LLMProviderPlugin` main interface
  - `ProviderMetadata`, `ProviderCapabilities`
  - `AttachmentSupport`, `ModelInfo`
  - `EmbeddingModelInfo`, `ImageGenerationModelInfo`
- Plugin manifest types:
  - `PluginManifest` schema
  - `PluginCapability`, `PluginCategory`, `PluginStatus`
  - `InstalledPluginInfo`
- Common utilities:
  - Error classes: `PluginError`, `ApiKeyError`, `ProviderApiError`, `RateLimitError`
  - Additional errors: `ConfigurationError`, `ModelNotFoundError`, `AttachmentError`, `ToolExecutionError`
  - Logger interface: `PluginLogger`
  - Logger factories: `createConsoleLogger`, `createNoopLogger`
- Submodule exports for granular imports:
  - `@quilltap/plugin-types/llm`
  - `@quilltap/plugin-types/plugins`
  - `@quilltap/plugin-types/common`
- `PLUGIN_TYPES_VERSION` export for runtime compatibility checks
