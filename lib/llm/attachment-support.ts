/**
 * LLM Provider Attachment Support
 *
 * Centralized information about which file attachments each provider supports.
 * This information is derived from provider implementations and used to:
 * - Show users which files they can attach in the UI
 * - Validate file uploads before sending
 * - Display helpful error messages when unsupported files are attached
 */

import { Provider } from '@/lib/json-store/schemas/types'

/**
 * MIME type categories for file validation
 */
export const MIME_TYPE_CATEGORIES = {
  images: [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
  ],
  documents: [
    'application/pdf',
  ],
  text: [
    'text/plain',
    'text/markdown',
    'text/csv',
  ],
} as const

/**
 * Provider-specific attachment capabilities summary
 * This is a static reference - actual support is determined by the provider classes
 */
export const PROVIDER_ATTACHMENT_CAPABILITIES = {
  OPENAI: {
    supportsAttachments: true,
    types: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
    description: 'Images only (JPEG, PNG, GIF, WebP)',
  },
  ANTHROPIC: {
    supportsAttachments: true,
    types: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'],
    description: 'Images (JPEG, PNG, GIF, WebP) and PDF documents',
  },
  GOOGLE: {
    supportsAttachments: true,
    types: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
    description: 'Images only (JPEG, PNG, GIF, WebP)',
  },
  GROK: {
    supportsAttachments: true,
    types: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
    description: 'Images only (JPEG, PNG, GIF, WebP)',
    notes: 'Text and PDF files are handled via fallback system for better compatibility',
  },
  OLLAMA: {
    supportsAttachments: false,
    types: [],
    description: 'No file attachments supported',
    notes: 'Multimodal models like LLaVA may support images in the future',
  },
  OPENROUTER: {
    supportsAttachments: false,
    types: [],
    description: 'No file attachments supported',
    notes: 'Support depends on the underlying model being proxied',
  },
  OPENAI_COMPATIBLE: {
    supportsAttachments: false,
    types: [],
    description: 'No file attachments supported',
    notes: 'Varies by implementation (LM Studio, vLLM, etc.)',
  },
  GAB_AI: {
    supportsAttachments: false,
    types: [],
    description: 'No file attachments supported',
  },
} as const

/**
 * Get supported MIME types for a provider
 * Returns an empty array if the provider doesn't support file attachments
 *
 * @param provider The LLM provider
 * @param baseUrl Optional base URL for providers that require it (Ollama, OpenAI-compatible)
 * @returns Array of supported MIME types (empty if no support)
 */
export function getSupportedMimeTypes(provider: Provider, baseUrl?: string): string[] {
  // Use the static provider capabilities instead of instantiating providers
  // This is more reliable and doesn't require provider instances
  const capabilities = PROVIDER_ATTACHMENT_CAPABILITIES[provider]
  return capabilities ? [...capabilities.types] : []
}

/**
 * Check if a provider supports file attachments
 *
 * @param provider The LLM provider
 * @param baseUrl Optional base URL for providers that require it
 * @returns true if the provider supports any file attachments
 */
export function supportsFileAttachments(provider: Provider, baseUrl?: string): boolean {
  const mimeTypes = getSupportedMimeTypes(provider, baseUrl)
  return mimeTypes.length > 0
}

/**
 * Check if a provider supports a specific MIME type
 *
 * @param provider The LLM provider
 * @param mimeType The MIME type to check (e.g., 'image/png', 'application/pdf')
 * @param baseUrl Optional base URL for providers that require it
 * @returns true if the provider supports this MIME type
 */
export function supportsMimeType(provider: Provider, mimeType: string, baseUrl?: string): boolean {
  const supportedTypes = getSupportedMimeTypes(provider, baseUrl)
  return supportedTypes.includes(mimeType)
}

/**
 * Get a human-readable list of supported file types for a provider
 *
 * @param provider The LLM provider
 * @param baseUrl Optional base URL for providers that require it
 * @returns Object with categorized file type lists
 */
export function getSupportedFileTypes(provider: Provider, baseUrl?: string): {
  images: string[]
  documents: string[]
  text: string[]
  all: string[]
} {
  const mimeTypes = getSupportedMimeTypes(provider, baseUrl)

  const images = mimeTypes.filter(type => type.startsWith('image/'))
  const documents = mimeTypes.filter(type => type === 'application/pdf')
  const text = mimeTypes.filter(type => type.startsWith('text/'))

  return {
    images,
    documents,
    text,
    all: mimeTypes,
  }
}

/**
 * Get a user-friendly description of attachment support for a provider
 *
 * @param provider The LLM provider
 * @param baseUrl Optional base URL for providers that require it
 * @returns Human-readable description
 */
export function getAttachmentSupportDescription(provider: Provider, baseUrl?: string): string {
  const fileTypes = getSupportedFileTypes(provider, baseUrl)

  if (fileTypes.all.length === 0) {
    return 'No file attachments supported'
  }

  const parts: string[] = []

  if (fileTypes.images.length > 0) {
    const imageFormats = fileTypes.images.map(type => type.replace('image/', '').toUpperCase())
    parts.push(`Images (${imageFormats.join(', ')})`)
  }

  if (fileTypes.documents.length > 0) {
    parts.push('PDF documents')
  }

  if (fileTypes.text.length > 0) {
    const textFormats = fileTypes.text.map(type => {
      const format = type.replace('text/', '')
      return format === 'plain' ? 'TXT' : format.toUpperCase()
    })
    parts.push(`Text files (${textFormats.join(', ')})`)
  }

  return parts.join(', ')
}

/**
 * Get file extension for a MIME type
 *
 * @param mimeType The MIME type
 * @returns Common file extension (with dot) or null if unknown
 */
export function getFileExtensionForMimeType(mimeType: string): string | null {
  const extensionMap: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'application/pdf': '.pdf',
    'text/plain': '.txt',
    'text/markdown': '.md',
    'text/csv': '.csv',
  }

  return extensionMap[mimeType] || null
}
