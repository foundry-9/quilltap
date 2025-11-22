# Phase 3 Implementation Summary - Image Generation Tool Definition

## Overview

Phase 3 of the Image Generation Tool feature has been successfully completed. This phase defines the standardized tool interface that allows tool-capable LLMs (OpenAI, Anthropic, Grok, etc.) to invoke image generation as a built-in capability during conversations.

## Completed Work

### 1. Tool Definition (`lib/tools/image-generation-tool.ts`)

**Purpose**: Defines the complete tool specification including parameters, validation, and provider-specific formats.

**Key Interfaces**:

- `ImageGenerationToolInput` - Parameters the LLM can provide:
  - `prompt` (required): Detailed image description (1-4000 chars)
  - `negativePrompt?`: What to avoid in the image
  - `size?`: Dimensions (1024x1024, 1792x1024, 1024x1792)
  - `style?`: vivid or natural
  - `quality?`: standard or hd
  - `aspectRatio?`: For Google Imagen (1:1, 3:4, 4:3, 9:16, 16:9)
  - `count?`: Number of images (1-10)

- `ImageGenerationToolConfig` - Configuration options:
  - `profileId`: Which image profile to use
  - `allowedSizes?`: Restrict available sizes
  - `allowedStyles?`: Restrict available styles
  - `allowedAspectRatios?`: Restrict available aspect ratios
  - `maxImagesPerCall?`: Limit images per call
  - `defaultQuality?`: Default quality level
  - `defaultStyle?`: Default style

- `GeneratedImageResult` - Result metadata:
  - `id`: Image ID in system
  - `url`: URL to access image
  - `filename`: Original filename
  - `revisedPrompt?`: Prompt revised by provider

- `ImageGenerationToolOutput` - Tool execution result:
  - `success`: Whether generation succeeded
  - `images?`: Array of generated images
  - `error?`: Error message if failed
  - `message?`: Additional context

**Tool Definitions**:

- `imageGenerationToolDefinition` - OpenAI function calling format
  - Type: `function` (OpenAI's function calling)
  - Name: `generate_image`
  - Full parameter schema with validation

- `anthropicImageGenerationToolDefinition` - Anthropic tool_use format
  - Name: `generate_image`
  - Full input_schema with validation
  - Compatible with Anthropic's tool_use protocol

**Helper Functions**:

- `validateImageGenerationInput()` - Type-safe input validation
  - Checks prompt is non-empty string
  - Validates enum values (size, style, quality, aspectRatio)
  - Validates count is 1-10
  - Returns TypeScript type guard

- `getProviderConstraints()` - Provider-specific capabilities
  - OPENAI: Sizes, styles, qualities; no aspect ratios
  - GROK: No size/style/quality constraints
  - GOOGLE_IMAGEN: Aspect ratios; no sizes/styles
  - Returns null for unknown providers

- `getOpenAIImageGenerationTool()` - Returns OpenAI format
- `getAnthropicImageGenerationTool()` - Returns Anthropic format

### 2. Tool Registry (`lib/tools/registry.ts`)

**Purpose**: Central management of available tools with provider-aware format conversion.

**ToolRegistry Class**:

- `register(tool)` - Register a tool definition
- `get(name)` - Retrieve tool by name
- `getAll()` - Get all registered tools
- `has(name)` - Check if tool exists
- `clear()` - Clear all tools

**Format Conversion Methods**:

- `toOpenAIFormat()` - Converts to OpenAI function calling
  ```typescript
  {
    type: 'function',
    function: {
      name: string,
      description: string,
      parameters: object
    }
  }
  ```

- `toAnthropicFormat()` - Converts to Anthropic tool_use
  ```typescript
  {
    name: string,
    description: string,
    input_schema: object
  }
  ```

- `toGoogleFormat()` - Converts to Google format
- `toProviderFormat(provider)` - Intelligent format selection based on LLM provider

**Provider Support**:
- OpenAI → OpenAI format
- Anthropic → Anthropic format
- Grok → OpenAI format (xAI compatibility)
- Ollama → OpenAI format
- OpenRouter → OpenAI format
- Gab AI → OpenAI format

**Singleton Pattern**:
- `getToolRegistry()` - Get global registry instance
- `resetToolRegistry()` - Reset for testing

### 3. Tools Module Exports (`lib/tools/index.ts`)

**Purpose**: Centralized exports for all tool functionality.

**Exports**:
- Registry: `ToolRegistry`, `getToolRegistry`, `resetToolRegistry`, types
- Definitions: `imageGenerationToolDefinition`, `anthropicImageGenerationToolDefinition`
- Helpers: `getOpenAIImageGenerationTool`, `getAnthropicImageGenerationTool`
- Validation: `validateImageGenerationInput`, `getProviderConstraints`
- All type definitions for tool inputs/outputs

## Architecture Integration

### Phase Dependencies

```
Phase 1: Schema & Database ✅
    ↓
Phase 2: Provider Abstraction ✅
    ↓
Phase 3: Tool Definition ✅ (current)
    ↓
Phase 4: Tool Execution Handler (next)
    ↓
Phase 5: Chat Integration
    ↓
Phase 6+: UI, API Endpoints, Testing
```

### How It Works in Context

1. **Tool Definition** (Phase 3 - Current)
   - Defines what the LLM can do (generate_image)
   - Parameters the LLM can request
   - Validation rules
   - Provider-specific formats

2. **Tool Execution** (Phase 4 - Next)
   - Receives LLM's tool call with parameters
   - Validates input
   - Merges with profile defaults
   - Calls provider via Phase 2 abstraction
   - Saves images to storage
   - Returns results to LLM

3. **Chat Integration** (Phase 5)
   - LLM sees tool definition during conversation
   - When LLM requests image generation
   - Chat handler detects tool call
   - Executes via tool execution
   - Includes results in conversation context

## Code Quality

- **TypeScript**: Fully typed with no `any` types
- **Validation**: Input validation guards with type safety
- **Extensibility**: Easy to add new tools to registry
- **Provider Support**: Intelligent format conversion
- **Documentation**: Comprehensive parameter descriptions
- **Testing**: Validator functions for unit tests

## File Locations

```
lib/tools/
├── image-generation-tool.ts    # Tool definition and helpers
├── registry.ts                 # Tool registry class
└── index.ts                    # Central exports
```

## Key Design Decisions

### 1. Separate Tool and Execution
- Tool definition (Phase 3) focuses on LLM interface
- Tool execution (Phase 4) handles implementation
- Allows tool definition to be reused across handlers

### 2. Provider-Aware Format Conversion
- Each LLM provider has different tool formats
- Registry handles conversion transparently
- Easy to add support for new providers

### 3. Input Validation
- Type-safe validation using TypeScript guards
- Enum validation for constrained values
- Range validation for numeric parameters
- Can be called before execution for early error detection

### 4. Provider Constraints
- Each provider has different capabilities
- `getProviderConstraints()` exposes these
- Allows frontend to show appropriate options
- Prevents invalid parameter combinations

## Next Steps (Phase 4+)

### Phase 4: Tool Execution Handler
- Create `lib/tools/handlers/image-generation-handler.ts`
- Profile loading and validation
- Parameter merging with defaults
- Image storage integration
- Error handling and logging

### Phase 5: Chat Integration
- Add `imageProfileId` to Chat model
- Chat creation with image profile
- Message handler tool detection
- Tool result formatting

### Phase 6: API Endpoints
- Image profile CRUD endpoints
- Model availability endpoints
- API key validation

### Phase 7+: UI and Testing
- Profile management UI
- Chat integration UI
- Comprehensive testing suite

## Usage Examples

### Getting Tools for OpenAI
```typescript
import { getToolRegistry, imageGenerationToolDefinition } from '@/lib/tools';

const registry = getToolRegistry();
const openaiTools = registry.toOpenAIFormat();
// Pass to OpenAI API in function_calling mode
```

### Getting Tools for Anthropic
```typescript
const anthropicTools = registry.toAnthropicFormat();
// Pass to Anthropic API in tool_use mode
```

### Validating User Input
```typescript
import { validateImageGenerationInput } from '@/lib/tools';

if (validateImageGenerationInput(userInput)) {
  // userInput is now typed as ImageGenerationToolInput
  await executeImageGenerationTool(userInput, config, userId);
}
```

### Checking Provider Constraints
```typescript
import { getProviderConstraints } from '@/lib/tools';

const constraints = getProviderConstraints('OPENAI');
// Returns { sizes: [...], styles: [...], qualities: [...], ... }
```

## Testing Recommendations

1. **Unit Tests**: Validate input validation logic
2. **Format Tests**: Test conversion to different provider formats
3. **Integration Tests**: Test registry with actual LLM calls
4. **Constraint Tests**: Verify provider constraints are accurate
5. **Edge Cases**: Test boundary values (4000 char prompt, 10 images, etc.)

## Documentation Updated

- [features/image-generation-tool.md](features/image-generation-tool.md)
  - Phase 3 status: ✅ Complete (Tool Definition)
  - Tool definition details with all interfaces and functions
  - Tool Registry implementation notes
  - Provider format conversions documented

## Summary

Phase 3 successfully defines a robust, LLM-agnostic tool interface for image generation. The tool definition:

1. **Standardizes Parameters** - Single interface for all image generation requests
2. **Supports Multiple LLM Formats** - OpenAI, Anthropic, Grok, Ollama, etc.
3. **Provides Validation** - Type-safe input validation
4. **Exposes Constraints** - Provider-specific capabilities
5. **Enables Future Expansion** - Registry pattern allows adding new tools easily

The implementation is production-ready and fully typed, providing the foundation for tool execution and chat integration in subsequent phases.
