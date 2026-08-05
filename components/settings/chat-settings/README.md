# Chat Settings Module

A comprehensive, modular implementation of chat settings management for Quilltap. This module provides user-configurable settings across multiple domains: avatar display, cheap LLM usage, memory management, token visibility, context compression, logging, story backgrounds, agent mode, and dangerous content handling.

## Module Structure

### Files

```
chat-settings/
├── ChatSettingsProvider.tsx        # Context provider for shared settings state (44 lines)
├── types.ts                        # TypeScript types, constants, and defaults (417 lines)
├── hooks/
│   └── useChatSettings.ts          # Centralized state management hook (808 lines)
├── components/
│   └── TimestampConfigCard.tsx     # Timestamp/fictional time configuration UI (365 lines)
├── AvatarSettings.tsx              # Avatar display settings component (89 lines)
├── CheapLLMSettings.tsx            # Cheap LLM configuration component (211 lines)
├── ImageDescriptionSettings.tsx    # Image description profile settings (68 lines)
├── MemoryCascadeSettings.tsx       # Memory behavior on message delete/regen (88 lines)
├── TokenDisplaySettings.tsx        # Token and cost visibility controls (60 lines)
├── ContextCompressionSettings.tsx  # Sliding window compression configuration (320 lines)
├── LLMLoggingSettings.tsx          # LLM request/response logging controls (98 lines)
├── AutomationSettings.tsx          # Automation toggle switches (55 lines)
├── AgentModeSettings.tsx           # Agent mode (agentic tool use) configuration (97 lines)
├── StoryBackgroundsSettings.tsx    # AI-generated background image settings (99 lines)
├── DangerousContentSettings.tsx    # The Concierge content management system (359 lines)
├── TabooSettings.tsx               # Instance-wide forbidden-phrase list (self-fetching)
└── README.md                       # This file
```

**Total: 15 source files, 2,005 lines**

## Context Provider

### ChatSettingsProvider & useChatSettingsContext
A React context that wraps the `useChatSettings()` hook, allowing the entire settings page to share a single instance of chat settings state without duplicate API fetches. This prevents race conditions and ensures consistent state across multiple settings tabs.

**Usage:**
```tsx
import { ChatSettingsProvider, useChatSettingsContext } from '@/components/settings/chat-settings/ChatSettingsProvider'

// At page level
export function SettingsPage() {
  return (
    <ChatSettingsProvider>
      <ChatSettingsTabs />
    </ChatSettingsProvider>
  )
}

// In any child component
function TabContent() {
  const { settings, saving, handleAvatarModeChange } = useChatSettingsContext()
  // ...
}
```

## Components

### AvatarSettings (AvatarSettings.tsx)
Manages avatar display preferences in the chat interface:
- Avatar display mode: when to show character avatars (ALWAYS, GROUP_ONLY, NEVER)
- Avatar display style: how to render avatars (CIRCULAR, RECTANGULAR)

**Props:**
- `settings`: Current chat settings
- `saving`: Loading state indicator
- `onAvatarModeChange`: Callback for mode changes
- `onAvatarStyleChange`: Callback for style changes

### CheapLLMSettings (CheapLLMSettings.tsx)
Manages configuration for background task LLM usage (memory extraction, image descriptions, etc.):
- Strategy selection (USER_DEFINED, PROVIDER_CHEAPEST, LOCAL_FIRST)
- User-defined profile selection
- Global default override
- Fallback to local models
- Embedding provider configuration
- Embedding profile selection
- Image prompt expansion LLM override

**Props:**
- `settings`: Current chat settings
- `saving`: Loading state indicator
- `loadingProfiles`: Profile loading state
- `connectionProfiles`: Available LLM profiles
- `embeddingProfiles`: Available embedding profiles
- `onUpdate`: Callback for settings updates

### ImageDescriptionSettings (ImageDescriptionSettings.tsx)
Manages vision-capable profile selection for automatic image descriptions:
- Selects which vision-capable profile to use for describing uploaded images
- Filters only vision-capable providers (OPENAI, ANTHROPIC, GOOGLE, GROK)

**Props:**
- `settings`: Current chat settings
- `saving`: Loading state indicator
- `loadingProfiles`: Profile loading state
- `connectionProfiles`: Available profiles
- `onProfileChange`: Callback for profile changes

### MemoryCascadeSettings (MemoryCascadeSettings.tsx)
Controls what happens to auto-extracted memories when messages are deleted or regenerated (swiped):
- Delete action: DELETE_MEMORIES, KEEP_MEMORIES, REGENERATE_MEMORIES, or ASK_EVERY_TIME
- Swipe/regenerate action: same options as delete action

**Props:**
- `settings`: Current chat settings
- `saving`: Loading state indicator
- `onUpdate`: Callback for preference updates

### TokenDisplaySettings (TokenDisplaySettings.tsx)
Controls visibility of token counts and cost information throughout the UI:
- Per-message token counts
- Per-message costs
- Chat total costs and tokens
- System event token display

**Props:**
- `settings`: Current chat settings
- `saving`: Loading state indicator
- `onUpdate`: Callback for visibility preference changes

### ContextCompressionSettings (ContextCompressionSettings.tsx)
Configures the sliding window context compression feature that reduces token costs:
- Window size: how many messages to keep in full resolution
- Compression target: target token count for compressed messages
- System prompt target: target tokens for system prompt compression
- Project context reinject interval: how often to reinclude project context
- Enable/disable the feature

Uses configurable sliders for smooth adjustments. The Cheap LLM settings determine which provider performs the compression.

**Props:**
- `settings`: Current chat settings
- `saving`: Loading state indicator
- `onUpdate`: Callback for compression configuration updates

### LLMLoggingSettings (LLMLoggingSettings.tsx)
Controls detailed LLM request/response logging for debugging and auditing:
- Enable/disable request logging
- Enable/disable response logging
- Request payload size limit
- Response payload size limit

**Props:**
- `settings`: Current chat settings
- `saving`: Loading state indicator
- `onUpdate`: Callback for logging preference changes

### AutomationSettings (AutomationSettings.tsx)
Simple automation feature toggles:
- Auto-detect RNG patterns (automatically execute dice rolls, coin flips, etc.)

**Props:**
- `settings`: Current chat settings
- `saving`: Loading state indicator
- `onAutoDetectRngChange`: Callback for automation preference changes

### AgentModeSettings (AgentModeSettings.tsx)
Configuration for **Prospero** agentic tool use (iterative tool calling with self-correction):
- Enable/disable agent mode globally or per-chat
- Maximum number of tool-use turns before agent stops
- Controls how the LLM can iteratively refine tool calls

**Props:**
- `settings`: Current chat settings
- `saving`: Loading state indicator
- `onDefaultEnabledChange`: Callback for default enable state
- `onMaxTurnsChange`: Callback for max turns configuration

### StoryBackgroundsSettings (StoryBackgroundsSettings.tsx)
Configuration for **The Lantern** (story backgrounds) AI-generated background images:
- Enable/disable background image generation
- Select image generation profile (determines provider and model)

**Props:**
- `settings`: Current chat settings
- `saving`: Loading state indicator
- `imageProfiles`: Available image generation profiles
- `onUpdate`: Callback for background settings updates

### DangerousContentSettings (DangerousContentSettings.tsx)
Configuration for **The Concierge** (dangerous content tracking and rerouting system):
- Activation mode: OFF, DETECT_ONLY, or AUTO_ROUTE
- Content display mode: SHOW with warning, BLUR until clicked, or COLLAPSE behind placeholder
- Image prompt expansion profile (vision provider for classifying image content)
- Uncensored provider configuration for routing flagged content

This component integrates with the memory system to track dangerous content detection patterns.

**Props:**
- `settings`: Current chat settings
- `saving`: Loading state indicator
- `connectionProfiles`: Available LLM profiles
- `imageProfiles`: Available image profiles
- `loadingProfiles`: Profile loading state
- `onUpdate`: Callback for dangerous content settings updates
- `imagePromptProfileId`: Current image prompt profile ID
- `onImagePromptProfileChange`: Callback for profile changes

### TabooSettings (TabooSettings.tsx)
Editor for the instance-wide **Taboo** list — phrases no character may utter, rendered into the universal (cache-stable) portion of every character's system prompt.

Unlike most components here it takes **no props** and does not ride `useChatSettings`: the value is instance-scoped (`instance_settings['taboo']`), so the component fetches for itself via TanStack Query (`queryKeys.settings.taboo` → `GET /api/v1/settings/taboo`), same shape of decision as `DataRetentionSettings`. Each add/remove PUTs the whole `phrases` array; the server normalizes (trim, drop empties, case-insensitive dedupe, order preserved) and the normalized response is written straight into the query cache.

### TimestampConfigCard (components/TimestampConfigCard.tsx)
Reusable component for configuring timestamp display and fictional time:
- Timestamp mode: NONE, START_ONLY, or EVERY_MESSAGE
- Timestamp format: ISO8601, FRIENDLY, DATE_ONLY, TIME_ONLY, or CUSTOM
- Fictional time settings for roleplaying scenarios
- Timezone configuration
- Auto-prepend to user messages

Used by both the main chat settings and the chat creation dialog. Supports time zone selection and custom format strings.

**Props:**
- `config`: Current timestamp configuration
- `timezone`: Current timezone setting
- `saving`: Loading state indicator
- `onUpdate`: Callback for configuration changes
- `onTimezoneChange`: Callback for timezone changes

## Hooks

### useChatSettings
Centralized state management hook for all chat settings operations. Handles data fetching, updates, and synchronization across all setting domains.

**Returns:**
```typescript
{
  settings: ChatSettings | null
  loading: boolean
  error: string | null
  saving: boolean
  success: boolean
  connectionProfiles: ConnectionProfile[]
  embeddingProfiles: EmbeddingProfile[]
  imageProfiles: ImageProfile[]
  loadingProfiles: boolean
  fetchSettings: () => Promise<void>
  handleAvatarModeChange: (mode: AvatarDisplayMode) => Promise<void>
  handleAvatarStyleChange: (style: AvatarDisplayStyle) => Promise<void>
  handleCheapLLMUpdate: (updates: Partial<CheapLLMSettings>) => Promise<void>
  handleImageDescriptionProfileChange: (profileId: string | null) => Promise<void>
  handleMemoryCascadeUpdate: (updates: Partial<MemoryCascadePreferences>) => Promise<void>
  handleTokenDisplayChange: (key: keyof TokenDisplaySettings, value: boolean) => Promise<void>
  handleContextCompressionUpdate: (updates: Partial<ContextCompressionSettings>) => Promise<void>
  handleLLMLoggingChange: (key: keyof LLMLoggingSettings, value: boolean | number) => Promise<void>
  handleAutoDetectRngChange: (value: boolean) => Promise<void>
  handleAgentModeDefaultEnabledChange: (value: boolean) => Promise<void>
  handleAgentModeMaxTurnsChange: (value: number) => Promise<void>
  handleStoryBackgroundsEnabledChange: (value: boolean) => Promise<void>
  handleStoryBackgroundsProfileChange: (profileId: string | null) => Promise<void>
  handleDangerousContentUpdate: (updates: Partial<DangerousContentSettings>) => Promise<void>
  handleTimezoneChange: (timezone: string | null) => Promise<void>
}
```

**Features:**
- Complete separation of state logic from UI
- Full TypeScript typing with strict interfaces
- Comprehensive error handling with client logging
- Success feedback with automatic timeout
- API integration for all settings operations
- Automatic profile loading and caching with retry logic
- Race condition prevention using refs for concurrent updates
- Avatar display context synchronization via `useAvatarDisplay()`

## Types (types.ts)

### Core Type Definitions
- `AvatarDisplayMode`: 'ALWAYS' | 'GROUP_ONLY' | 'NEVER'
- `AvatarDisplayStyle`: 'CIRCULAR' | 'RECTANGULAR'
- `CheapLLMStrategy`: 'USER_DEFINED' | 'PROVIDER_CHEAPEST' | 'LOCAL_FIRST'
- `EmbeddingProvider`: 'SAME_PROVIDER' | 'OPENAI' | 'LOCAL'
- `TimestampMode`: 'NONE' | 'START_ONLY' | 'EVERY_MESSAGE'
- `TimestampFormat`: 'ISO8601' | 'FRIENDLY' | 'DATE_ONLY' | 'TIME_ONLY' | 'CUSTOM'
- `MemoryCascadeAction`: 'DELETE_MEMORIES' | 'KEEP_MEMORIES' | 'REGENERATE_MEMORIES' | 'ASK_EVERY_TIME'

### Core Interfaces
- `ChatSettings`: User's complete chat settings (container for all subcategories)
- `CheapLLMSettings`: Configuration for background LLM tasks
- `TimestampConfig`: Timestamp display and fictional time configuration
- `MemoryCascadePreferences`: Memory behavior preferences on message operations
- `TokenDisplaySettings`: Token and cost visibility controls
- `ContextCompressionSettings`: Sliding window context compression configuration
- `LLMLoggingSettings`: Request/response logging configuration
- `AgentModeSettings`: Agentic tool use configuration
- `StoryBackgroundsSettings`: AI-generated background image configuration
- `DangerousContentSettings`: The Concierge dangerous content system configuration
- `ConnectionProfile`: LLM provider connection details
- `EmbeddingProfile`: Embedding model configuration
- `ImageProfile`: Image generation model configuration

### Constants & Defaults
All constants and defaults are defined in `types.ts`:
- `DEFAULT_MEMORY_CASCADE_PREFERENCES`
- `DEFAULT_TOKEN_DISPLAY_SETTINGS`
- `DEFAULT_CONTEXT_COMPRESSION_SETTINGS`
- `DEFAULT_LLM_LOGGING_SETTINGS`
- `DEFAULT_AUTO_DETECT_RNG`
- `DEFAULT_AGENT_MODE_SETTINGS`
- `DEFAULT_STORY_BACKGROUNDS_SETTINGS`
- `DEFAULT_DANGEROUS_CONTENT_SETTINGS`
- `AVATAR_MODES`: Array of available avatar display modes with labels
- `AVATAR_STYLES`: Array of available avatar styles with preview symbols
- `MEMORY_CASCADE_ACTIONS`: Available memory cascade action options

## API Integration

The module communicates with the following v1 REST API endpoints:

### Settings Endpoints
- `GET /api/v1/settings/chat` - Fetch current user's chat settings
- `PUT /api/v1/settings/chat` - Update chat settings (request body varies by endpoint action)
- `GET /api/v1/settings/taboo` - Fetch the instance-wide forbidden-phrase list
- `PUT /api/v1/settings/taboo` - Replace the forbidden-phrase list (merged over the stored value, then normalized)

### Profile Endpoints
- `GET /api/v1/connection-profiles` - Fetch all available LLM connection profiles
- `GET /api/v1/embedding-profiles` - Fetch all available embedding profiles
- `GET /api/v1/image-profiles` - Fetch all available image generation profiles

All endpoints use JSON request/response bodies. Settings updates are atomic per setting type.

## Logging

All async operations include comprehensive debug/info/error logging via `clientLogger`:
- Settings load and update operations with context
- Profile fetch operations
- Error conditions with descriptive messages
- Race condition detection and resolution logging

Example:
```typescript
clientLogger.debug('Updating avatar display mode', { mode })
clientLogger.info('Avatar display mode updated successfully', { mode })
clientLogger.error('Failed to update avatar display mode', { error: errorMsg })
```

## Usage

### Using ChatSettingsProvider (Recommended)
```tsx
import { ChatSettingsProvider, useChatSettingsContext } from '@/components/settings/chat-settings/ChatSettingsProvider'
import { AvatarSettings } from '@/components/settings/chat-settings/AvatarSettings'

// At page level
export function SettingsPage() {
  return (
    <ChatSettingsProvider>
      <ChatSettingsTabs />
    </ChatSettingsProvider>
  )
}

// In child components
function AvatarTab() {
  const { settings, saving, handleAvatarModeChange, handleAvatarStyleChange } = useChatSettingsContext()

  return (
    <AvatarSettings
      settings={settings}
      saving={saving}
      onAvatarModeChange={handleAvatarModeChange}
      onAvatarStyleChange={handleAvatarStyleChange}
    />
  )
}
```

### Using useChatSettings Hook Directly
```tsx
import { useChatSettings } from '@/components/settings/chat-settings/hooks/useChatSettings'

function IndependentComponent() {
  const { settings, loading, handleAvatarModeChange } = useChatSettings()

  if (loading) return <div>Loading...</div>

  return (
    // Use the hook's state and handlers
  )
}
```

## Architecture Decisions

1. **Provider Pattern**: The `ChatSettingsProvider` wraps `useChatSettings()` to share state across all settings tabs, eliminating duplicate API calls and preventing race conditions.

2. **Modular Components**: Each setting domain (avatar, cheap LLM, memory cascade, etc.) is its own component with clear prop interfaces and single responsibility.

3. **Centralized Types**: All type definitions and defaults live in `types.ts` to ensure consistency across the module.

4. **Hook-Based State**: `useChatSettings` manages all state, loading, and error handling, keeping components pure and focused on UI.

5. **v1 API Integration**: All endpoints use the `/api/v1/` prefix with proper status code handling and error recovery.

## Line Count Summary

| File | Lines | Purpose |
|------|-------|---------|
| useChatSettings.ts | 808 | State management hook |
| TimestampConfigCard.tsx | 365 | Component |
| DangerousContentSettings.tsx | 359 | Component |
| ContextCompressionSettings.tsx | 320 | Component |
| types.ts | 417 | Type definitions |
| CheapLLMSettings.tsx | 211 | Component |
| StoryBackgroundsSettings.tsx | 99 | Component |
| LLMLoggingSettings.tsx | 98 | Component |
| AgentModeSettings.tsx | 97 | Component |
| AvatarSettings.tsx | 89 | Component |
| MemoryCascadeSettings.tsx | 88 | Component |
| ImageDescriptionSettings.tsx | 68 | Component |
| TokenDisplaySettings.tsx | 60 | Component |
| AutomationSettings.tsx | 55 | Component |
| ChatSettingsProvider.tsx | 44 | Context provider |
| **Total** | **2,005** | **All files under 1,000 lines** |

## Future Enhancements

- Unit tests for each component and the `useChatSettings` hook
- Snapshot tests for settings persistence
- Performance optimization for large profile lists
- Standalone component library documentation
- Storybook stories for theme testing
