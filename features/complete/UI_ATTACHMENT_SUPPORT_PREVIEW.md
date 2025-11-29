# Connection Profile Attachment Support UI Preview

This document describes the UI changes made to show file attachment support in connection profiles.

## Changes Made

### 1. Connection Profiles List View

Each profile card now displays attachment support information below the provider and model name:

```
┌─────────────────────────────────────────────────────┐
│ My GPT-4 Profile                     [Default]      │
│ OPENAI • gpt-4                                      │
│ Images (JPEG, PNG, GIF, WEBP)                       │  ← NEW
│ 42 messages used                                    │
│ Temperature: 0.7 • Max Tokens: 1000 • Top P: 1     │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│ Claude Sonnet                                       │
│ ANTHROPIC • claude-sonnet-4-5-20250929             │
│ Images (JPEG, PNG, GIF, WEBP), PDF documents        │  ← NEW
│ 18 messages used                                    │
│ Temperature: 1.0 • Max Tokens: 2000 • Top P: 1     │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│ Local Ollama                                        │
│ OLLAMA • llama3.1:8b                               │
│ No file attachments supported                       │  ← NEW
│ 5 messages used                                     │
│ Base URL: http://localhost:11434                   │
└─────────────────────────────────────────────────────┘
```

**Location in code:** `components/settings/connection-profiles-tab.tsx:592-594`

**Displays:**
- For image-only providers (OpenAI, Google): "Images (JPEG, PNG, GIF, WEBP)"
- For providers with documents (Anthropic): "Images (...), PDF documents"
- For providers with text files (Grok): "Images (...), PDF documents, Text files (TXT, MARKDOWN, CSV)"
- For providers without support: "No file attachments supported"

### 2. Create/Edit Profile Form

When selecting a provider, the form now shows what file attachments are supported directly beneath the provider dropdown:

```
┌─────────────────────────────────────────────────────┐
│ Provider *                                          │
│ ┌─────────────────────────────────────────────┐    │
│ │ [Anthropic                             ▼]   │    │
│ └─────────────────────────────────────────────┘    │
│ File attachments: Images (JPEG, PNG, GIF, WEBP),   │  ← NEW
│ PDF documents                                       │
└─────────────────────────────────────────────────────┘
```

**Location in code:** `components/settings/connection-profiles-tab.tsx:711-713`

**Real-time updates:**
- Changes dynamically when switching providers in the dropdown
- For Ollama/OpenAI-compatible, will update when baseUrl is entered (if needed for detection)

## Example Descriptions by Provider

| Provider | Attachment Support Description |
|----------|-------------------------------|
| **OpenAI** | Images (JPEG, PNG, GIF, WEBP) |
| **Anthropic** | Images (JPEG, PNG, GIF, WEBP), PDF documents |
| **Google** | Images (JPEG, PNG, GIF, WEBP) |
| **Grok** | Images (JPEG, PNG, GIF, WEBP), PDF documents, Text files (TXT, MARKDOWN, CSV) |
| **Ollama** | No file attachments supported |
| **OpenRouter** | No file attachments supported |
| **OpenAI Compatible** | No file attachments supported |
| **Gab AI** | No file attachments supported |

## Technical Implementation

The UI uses the `getAttachmentSupportDescription()` function from `lib/llm/attachment-support.ts`:

```typescript
import { getAttachmentSupportDescription } from '@/lib/llm/attachment-support'

// In profile list:
<p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
  {getAttachmentSupportDescription(
    profile.provider as any,
    profile.baseUrl ?? undefined
  )}
</p>

// In form:
<p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
  File attachments: {getAttachmentSupportDescription(
    formData.provider as any,
    formData.baseUrl || undefined
  )}
</p>
```

## Benefits for Users

1. **At-a-glance visibility** - Users can immediately see which profiles support file uploads
2. **Informed decisions** - When creating a profile, users know what attachments they can send
3. **Avoid frustration** - No need to try uploading files only to discover they're not supported
4. **Feature discovery** - Users learn which providers support PDFs (Anthropic, Grok) vs just images

## Future Enhancements

Potential future improvements:
- Add icons for different file types (📷 for images, 📄 for PDFs)
- Show max file size limits per provider
- Add a filter to show only profiles with attachment support
- Display supported MIME types on hover/tooltip for more detail
