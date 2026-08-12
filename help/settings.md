---
url: /settings
---

# Settings

> **[Open this page in Quilltap](/settings)**

The Settings page is the central bureau of operations for your Quilltap estate --- a single, well-appointed room where every lever, dial, and velvet rope can be found without having to remember which wing of the house conceals which control. Everything is organized into seven plainly-labeled tabs, each a model of efficiency that would make even the most fastidious butler weep with approval.

## Accessing Settings

1. Click the **Settings** icon (wrench) in the left sidebar footer
2. You will arrive at the Settings page with the **AI Providers** tab selected by default
3. Click any tab to view and manage its settings

You may also navigate directly to a specific tab by appending `?tab=` to the URL --- for example, `/settings?tab=chat` will open the Chat tab directly. To jump straight to a particular section within a tab, add `&section=` as well --- for example, `/settings?tab=chat&section=dangerous-content` will open the Chat tab and scroll directly to the Dangerous Content section with its accordion already open.

## The Seven Tabs

### AI Providers

The beating mechanical heart of the operation. Here you configure everything that makes Quilltap talk to the various Large Language Model services of the world.

- **AI Stack Setup Wizard** --- A guided walkthrough for configuring providers, API keys, models, and profiles in one efficient swoop
- **API Keys** --- Store authentication credentials for LLM providers and services
- **Connection Profiles** --- Link API keys to specific providers and models for AI chat
- **Cheap LLM Settings** --- Configure the lightweight model that handles background tasks (summarization, memory extraction, and the like)
- **The Almanack (System Report)** --- Compile a compendium of the whole establishment: configuration, contents and condition

> See [API Keys Settings](api-keys-settings.md), [Connection Profiles](connection-profiles.md), and [Setup Wizard](setup-wizard.md) for full details

### Chat

The conversational drawing-room. Every setting that governs how the AI behaves during a chat --- from the counting of tokens to the handling of content that might cause a maiden aunt to reach for the smelling salts.

- **Token Display** --- Show or hide token usage and cost estimates in chat
- **Context Compression** --- Configure how older messages are compressed to fit the context window
- **Memory Cascade** --- Control how memories flow into conversations when messages change
- **Image Description** --- How the AI describes images shared in chat
- **Automation** --- Configure automatic detection features (dice rolls, etc.)
- **Agent Mode** --- Enable iterative tool-use behaviors where the AI can verify and self-correct
- **Dangerous Content** --- Configure content detection, routing to compatible providers, and display behavior

> See [Chat Settings](chat-settings.md) and [Dangerous Content Handling](dangerous-content.md) for full details

### Appearance

Where aesthetics meet functionality, and both are treated with the respect they deserve.

- **Appearance** --- Theme selection, color mode (light/dark), and display options
- **Avatar Settings** --- Configure how avatars are displayed in chats (mode and style)
- **Tags** --- Create and manage tags for organizing your content, with custom colors and icons

> See [Appearance Settings](appearance-settings.md) and [Tags Customization](tags-customization.md) for full details

### Commonplace Book

The library wing --- quiet, orderly, and possessed of an uncanny ability to recall precisely the passage you need.

- **Embedding Profiles** --- Configure text embedding services for semantic memory search
- **Memory Housekeeping** --- Automatically prune stale, low-importance memories as each character approaches its cap (off by default)
- **Memory Deduplication** --- Find and merge duplicate memories across characters

> See [Embedding Provider Profiles](embedding-profiles.md) and [System Tools](system-tools.md) for full details

### Images

The gallery and the lighting both, all in one place.

- **Image Profiles** --- Configure image generation providers and models
- **Story Backgrounds** --- Configure automatic atmospheric background images for chats and projects

> See [Image Generation Profiles](image-generation-profiles.md) and [Story Backgrounds](story-backgrounds.md) for full details

### Templates & Prompts

The scriptwriting department, where you shape how characters speak and what instructions they follow.

- **Roleplay Templates** --- Define conversation patterns, system prompts, and character behaviors
- **Prompts** --- Create and manage reusable prompt templates across characters and conversations

> See [Roleplay Templates Settings](roleplay-templates-settings.md) and [Prompts](prompts.md) for full details

### Data & System

The engine room, the filing cabinet, and the emergency exits. Everything that keeps the machinery running and the records intact.

- **Plugins** --- Install, update, and configure plugins from the registry
- **File Storage** --- Configure where Quilltap stores files and images
- **Backup & Restore** --- Create and restore full system backups
- **Import / Export** --- Transfer data in and out of Quilltap in native format
- **LLM Logging** --- Toggle and configure detailed logging of AI interactions
- **Tasks Queue** --- View and manage background jobs (memory extraction, imports, analysis)
- **LLM Logs** --- Review detailed records of all AI model interactions
- **Delete All Data** --- Permanently remove all data (the lever beneath the glass cover; break only in case of genuine emergency)

> See [Plugins](plugins.md), [Data Directory](data-directory.md), [Backup & Restore](system-backup-restore.md), [Import & Export Data](system-import-export.md), [Managing Tasks](system-tasks-queue.md), [LLM Logs](system-llm-logs.md), and [Deleting Your Data](system-delete-data.md) for full details

## Quick Configuration Workflow

### Setting up Quilltap for the first time

1. **AI Providers tab** --- Run the Setup Wizard, or manually add API Keys and create Connection Profiles
2. **Chat tab** --- Configure default chat behaviors and preferences
3. **Images tab** (optional) --- Set up image generation if desired
4. **Commonplace Book tab** (optional) --- Configure embedding profiles for semantic memory and enable automatic housekeeping

### Installing new capabilities

1. **Data & System tab** --- Browse and install plugins
2. **AI Providers tab** --- Create any new Connection, Image, or Embedding profiles the plugin requires

## Estate Flavor

Each tab displays a small thumbnail and description from the Quilltap estate subsystem it represents. If you have an active theme installed, these personifications may have different names --- the Calliope of one theme might appear as "Visual Design" in another. The functionality remains identical regardless of what the inhabitants choose to call themselves.

## Settings Persistence

All changes are saved automatically. You need not hunt for a "Save" button --- most settings update the moment you make a change, like a well-trained household staff that anticipates your every need.

### When changes take effect

- **Immediately:** Appearance, tags, chat preferences
- **On next chat:** Connection profile changes, plugin enablement
- **On next operation:** Image generation profile, embedding profile changes

## Navigating from the Old Foundry Routes

If you have bookmarks or links to the old `/foundry` subsystem pages, they will automatically redirect to the appropriate Settings tab. No link left behind, as they say.

## In-Chat Settings Access

Characters with help tools enabled can read your current settings aloud during a conversation, rather like a well-informed secretary who has memorized the contents of every filing cabinet. The `help_settings` tool accepts a `category` parameter with the following values:

- **`overview`** — A high-level summary of all configured profiles, counts, and key preferences
- **`chat`** — Token display, context compression, memory cascade, timestamps, agent mode, and content settings
- **`connections`** — Your configured LLM providers and models (API keys are never disclosed)
- **`embeddings`** — Embedding and memory search profiles
- **`images`** — Image generation profiles and story background settings
- **`appearance`** — Theme preference, avatar settings, and sidebar width
- **`templates`** — Roleplay templates and the current default
- **`system`** — Plugin list and logging settings

To use it, simply ask a help-tools-enabled character something like "What are my current settings?" or "Show me my connection profiles," and the character will consult the appropriate category on your behalf.

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/settings")`

## Troubleshooting

### Can't find a setting?

- Think about which category the setting belongs to: is it about how the AI talks (Chat), how things look (Appearance), or how data is stored (Data & System)?
- Some settings only appear after their prerequisites are configured (e.g., Image Profiles requires an API key first)
- Check whether a plugin provides additional settings you may need

### Changes aren't taking effect

- Refresh the page to ensure changes are loaded
- For connection changes, start a new chat or send a new message
- Verify that all required prerequisites are configured (API keys, etc.)
