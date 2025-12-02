# Plugins

**Status:** Implemented and Active

The plugin system is now fully operational with all LLM providers migrated to plugins.

## Concept

- All installations go under `plugins/`
- Developed using TypeScript to defined interfaces
- Plugin activity is sandboxed as much as possible for security; only what is exposed can be altered
- Plugins can provide new API endpoints, database extensions, and UI components
- Plugins can ship complete replacements for providers, databases, or file backends

## Implemented Functionality

### Provider Plugins (Complete)

All LLM providers have been migrated to the plugin architecture:

| Plugin | Provider | Capabilities |
|--------|----------|--------------|
| `qtap-plugin-openai` | OpenAI | Chat, DALL-E images, embeddings, file attachments |
| `qtap-plugin-anthropic` | Anthropic | Chat, image/PDF analysis, tool use |
| `qtap-plugin-google` | Google Gemini | Chat, Imagen images, file attachments |
| `qtap-plugin-grok` | Grok/xAI | Chat, image generation, file attachments |
| `qtap-plugin-gab-ai` | Gab AI | Chat (text-only) |
| `qtap-plugin-ollama` | Ollama | Chat (local models) |
| `qtap-plugin-openrouter` | OpenRouter | Chat (100+ models), pricing sync |
| `qtap-plugin-openai-compatible` | Generic | Chat (any OpenAI-format API) |

### Upgrade Plugin (Complete)

The `qtap-plugin-upgrade` plugin provides database migration capabilities:

- OpenRouter profile conversion (legacy format migration)
- Provider plugin enablement migrations
- Extensible migration runner system

### Plugin Infrastructure (Complete)

- [x] Plugin manifest schema with 19 capability types
- [x] Plugin registry for managing loaded plugins
- [x] Provider registry for LLM provider plugins
- [x] Plugin validation and security checks
- [x] TypeScript transpilation for plugin source
- [x] Dynamic plugin loading at startup
- [x] Plugin API routes support

## Planned Functionality

### Themes

- [ ] Alternative UI themes as plugins
- [ ] Theme switching without app restart
- [ ] Support for Tailwind and other CSS frameworks

### Additional Backends

- [ ] New API endpoints via plugins
- [ ] New database "tables" via plugins
- [ ] Alternative file backends (S3, etc.)
- [ ] Alternative database backends (MongoDB, etc.)

### Frontend Extensions

- [ ] New pages and routes
- [ ] New components
- [ ] New tabs and interface add-ons

## Update Mechanism

Future work: Using GitHub Pages to make pointers available for people, and a front-end for browse and installation.

## Plugin Template

The template plugin (`qtap-plugin-template`) demonstrates:

- [x] Plugin manifest structure
- [x] Package.json configuration
- [x] TypeScript source with proper exports
- [x] Icon component implementation
- [x] README documentation

## Hooks

- [x] Provider creation hooks (via provider registry)
- [x] Tool formatting hooks (provider-specific tool format conversion)
- [x] Tool parsing hooks (provider-specific response parsing)
- [ ] UI component slots (pending)
- [ ] Message processing hooks (pending)

## Documentation

- [Plugin Developer Guide](../plugins/README.md) - How to create plugins
- [LLM Provider Guide](../plugins/LLM-PROVIDER-GUIDE.md) - Specific guide for provider plugins
- [Plugin Manifest Reference](../docs/PLUGIN_MANIFEST.md) - Complete manifest schema
- [Plugin Initialization](../docs/PLUGIN_INITIALIZATION.md) - Startup flow documentation
