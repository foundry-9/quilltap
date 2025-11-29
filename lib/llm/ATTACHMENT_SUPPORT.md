# LLM Attachment Support

This module provides utilities for determining which file attachments each LLM provider supports.

## Overview

Different LLM providers support different types of file attachments:

- **OpenAI**: Images only (JPEG, PNG, GIF, WebP)
- **Anthropic**: Images and PDF documents
- **Google**: Images only (JPEG, PNG, GIF, WebP)
- **Grok**: Images, PDF documents, and text files
- **Ollama, OpenRouter, OpenAI-Compatible, Gab AI**: No file attachment support

## Usage

### Basic Usage

```typescript
import {
  getSupportedMimeTypes,
  supportsFileAttachments,
  supportsMimeType,
  getAttachmentSupportDescription,
} from '@/lib/llm/attachment-support'

// Check if a provider supports file attachments
const canAttach = supportsFileAttachments('OPENAI')  // true
const noAttach = supportsFileAttachments('OLLAMA')   // false

// Get supported MIME types for a provider
const mimeTypes = getSupportedMimeTypes('ANTHROPIC')
// Returns: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf']

// Check if a specific MIME type is supported
const supportsPDF = supportsMimeType('ANTHROPIC', 'application/pdf')  // true
const openaiPDF = supportsMimeType('OPENAI', 'application/pdf')      // false

// Get a human-readable description
const description = getAttachmentSupportDescription('GROK')
// Returns: "Images (JPEG, PNG, GIF, WEBP), PDF documents, Text files (TXT, MARKDOWN, CSV)"
```

### Working with Connection Profiles

```typescript
import {
  enrichConnectionProfileWithAttachmentSupport,
  filterProfilesWithAttachmentSupport,
  getBestProfileForFile,
} from '@/lib/llm/connection-profile-utils'

// Enrich a profile with attachment support info
const profile = await connectionProfilesRepo.findById(profileId)
const enriched = enrichConnectionProfileWithAttachmentSupport(profile)

console.log(enriched.supportsFileAttachments)        // boolean
console.log(enriched.supportedMimeTypes)             // string[]
console.log(enriched.supportedFileTypes.images)      // string[]
console.log(enriched.attachmentSupportDescription)   // string

// Filter profiles that support attachments
const allProfiles = await connectionProfilesRepo.findAll()
const attachmentProfiles = filterProfilesWithAttachmentSupport(allProfiles)

// Find the best profile for a specific file type
const bestForPDF = getBestProfileForFile(allProfiles, 'application/pdf')
// Returns the default profile if it supports PDFs, otherwise the most recent one
```

### Categorizing File Types

```typescript
import { getSupportedFileTypes } from '@/lib/llm/attachment-support'

const fileTypes = getSupportedFileTypes('GROK')

console.log(fileTypes.images)     // ['image/jpeg', 'image/png', ...]
console.log(fileTypes.documents)  // ['application/pdf']
console.log(fileTypes.text)       // ['text/plain', 'text/markdown', 'text/csv']
console.log(fileTypes.all)        // All supported types
```

### UI Integration Example

```typescript
import {
  enrichConnectionProfiles,
  groupProfilesByAttachmentSupport,
} from '@/lib/llm/connection-profile-utils'

function ConnectionProfileSelector({ profiles }: { profiles: ConnectionProfile[] }) {
  const enrichedProfiles = enrichConnectionProfiles(profiles)
  const grouped = groupProfilesByAttachmentSupport(profiles)

  return (
    <div>
      <h3>Profiles with Image Support</h3>
      {grouped.supportsImages.map(profile => {
        const enriched = enrichConnectionProfileWithAttachmentSupport(profile)
        return (
          <div key={profile.id}>
            <strong>{profile.name}</strong>
            <small>{enriched.attachmentSupportDescription}</small>
          </div>
        )
      })}

      <h3>Profiles without Attachment Support</h3>
      {grouped.supportsNone.map(profile => (
        <div key={profile.id}>{profile.name}</div>
      ))}
    </div>
  )
}
```

## Constants

### MIME_TYPE_CATEGORIES

Predefined categories of MIME types:

```typescript
import { MIME_TYPE_CATEGORIES } from '@/lib/llm/attachment-support'

MIME_TYPE_CATEGORIES.images      // ['image/jpeg', 'image/png', ...]
MIME_TYPE_CATEGORIES.documents   // ['application/pdf']
MIME_TYPE_CATEGORIES.text        // ['text/plain', 'text/markdown', 'text/csv']
```

### PROVIDER_ATTACHMENT_CAPABILITIES

Static reference of provider capabilities:

```typescript
import { PROVIDER_ATTACHMENT_CAPABILITIES } from '@/lib/llm/attachment-support'

const openaiCaps = PROVIDER_ATTACHMENT_CAPABILITIES.OPENAI
// {
//   supportsAttachments: true,
//   types: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
//   description: 'Images only (JPEG, PNG, GIF, WebP)',
// }
```

## File Extension Helper

```typescript
import { getFileExtensionForMimeType } from '@/lib/llm/attachment-support'

const ext = getFileExtensionForMimeType('image/png')  // '.png'
const pdfExt = getFileExtensionForMimeType('application/pdf')  // '.pdf'
const unknown = getFileExtensionForMimeType('video/mp4')  // null
```

## API Reference

### Core Functions

- `getSupportedMimeTypes(provider, baseUrl?)` - Get array of supported MIME types
- `supportsFileAttachments(provider, baseUrl?)` - Check if provider supports any attachments
- `supportsMimeType(provider, mimeType, baseUrl?)` - Check if provider supports specific MIME type
- `getSupportedFileTypes(provider, baseUrl?)` - Get categorized file types
- `getAttachmentSupportDescription(provider, baseUrl?)` - Get human-readable description

### Connection Profile Utilities

- `enrichConnectionProfileWithAttachmentSupport(profile)` - Add attachment info to profile
- `enrichConnectionProfiles(profiles)` - Enrich multiple profiles
- `profileSupportsMimeType(profile, mimeType)` - Check MIME type support for profile
- `filterProfilesWithAttachmentSupport(profiles)` - Filter profiles with attachment support
- `filterProfilesBySupportedMimeType(profiles, mimeType)` - Filter by specific MIME type
- `getBestProfileForFile(profiles, mimeType)` - Find best profile for file type
- `groupProfilesByAttachmentSupport(profiles)` - Group profiles by support capabilities

## Notes

- Ollama may support images with multimodal models (e.g., LLaVA) in the future
- OpenRouter support depends on the underlying model being proxied
- OpenAI-compatible providers vary by implementation
- Grok's PDF support requires the Grok Files API (partial implementation)
