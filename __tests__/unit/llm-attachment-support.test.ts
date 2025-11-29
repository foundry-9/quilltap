/**
 * Tests for LLM Attachment Support
 */

import {
  getSupportedMimeTypes,
  supportsFileAttachments,
  supportsMimeType,
  getSupportedFileTypes,
  getAttachmentSupportDescription,
  getFileExtensionForMimeType,
  MIME_TYPE_CATEGORIES,
  PROVIDER_ATTACHMENT_CAPABILITIES,
} from '@/lib/llm/attachment-support'
import {
  enrichConnectionProfileWithAttachmentSupport,
  profileSupportsMimeType,
  filterProfilesWithAttachmentSupport,
  filterProfilesBySupportedMimeType,
  getBestProfileForFile,
} from '@/lib/llm/connection-profile-utils'
import type { ConnectionProfile } from '@/lib/json-store/schemas/types'

describe('LLM Attachment Support', () => {
  describe('getSupportedMimeTypes', () => {
    it('should return supported MIME types for OpenAI', () => {
      const mimeTypes = getSupportedMimeTypes('OPENAI')
      expect(mimeTypes).toEqual([
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/webp',
      ])
    })

    it('should return supported MIME types for Anthropic', () => {
      const mimeTypes = getSupportedMimeTypes('ANTHROPIC')
      expect(mimeTypes).toEqual([
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/webp',
        'application/pdf',
      ])
    })

    it('should return supported MIME types for Google', () => {
      const mimeTypes = getSupportedMimeTypes('GOOGLE')
      expect(mimeTypes).toEqual([
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/webp',
      ])
    })

    it('should return supported MIME types for Grok', () => {
      const mimeTypes = getSupportedMimeTypes('GROK')
      expect(mimeTypes).toEqual([
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/webp',
      ])
    })

    it('should return empty array for Ollama', () => {
      const mimeTypes = getSupportedMimeTypes('OLLAMA', 'http://localhost:11434')
      expect(mimeTypes).toEqual([])
    })

    it('should return empty array for OpenRouter', () => {
      const mimeTypes = getSupportedMimeTypes('OPENROUTER')
      expect(mimeTypes).toEqual([])
    })

    it('should return empty array for Gab AI', () => {
      const mimeTypes = getSupportedMimeTypes('GAB_AI')
      expect(mimeTypes).toEqual([])
    })
  })

  describe('supportsFileAttachments', () => {
    it('should return true for providers with attachment support', () => {
      expect(supportsFileAttachments('OPENAI')).toBe(true)
      expect(supportsFileAttachments('ANTHROPIC')).toBe(true)
      expect(supportsFileAttachments('GOOGLE')).toBe(true)
      expect(supportsFileAttachments('GROK')).toBe(true)
    })

    it('should return false for providers without attachment support', () => {
      expect(supportsFileAttachments('OLLAMA', 'http://localhost:11434')).toBe(false)
      expect(supportsFileAttachments('OPENROUTER')).toBe(false)
      expect(supportsFileAttachments('GAB_AI')).toBe(false)
    })
  })

  describe('supportsMimeType', () => {
    it('should return true for supported image types on OpenAI', () => {
      expect(supportsMimeType('OPENAI', 'image/jpeg')).toBe(true)
      expect(supportsMimeType('OPENAI', 'image/png')).toBe(true)
    })

    it('should return false for PDFs on OpenAI', () => {
      expect(supportsMimeType('OPENAI', 'application/pdf')).toBe(false)
    })

    it('should return true for PDFs on Anthropic', () => {
      expect(supportsMimeType('ANTHROPIC', 'application/pdf')).toBe(true)
    })

    it('should return false for text files on Grok (uses fallback)', () => {
      expect(supportsMimeType('GROK', 'text/plain')).toBe(false)
      expect(supportsMimeType('GROK', 'text/markdown')).toBe(false)
    })

    it('should return false for unsupported types', () => {
      expect(supportsMimeType('OPENAI', 'video/mp4')).toBe(false)
      expect(supportsMimeType('ANTHROPIC', 'audio/mpeg')).toBe(false)
    })
  })

  describe('getSupportedFileTypes', () => {
    it('should categorize file types for OpenAI', () => {
      const fileTypes = getSupportedFileTypes('OPENAI')
      expect(fileTypes.images).toHaveLength(4)
      expect(fileTypes.documents).toHaveLength(0)
      expect(fileTypes.text).toHaveLength(0)
      expect(fileTypes.all).toHaveLength(4)
    })

    it('should categorize file types for Anthropic', () => {
      const fileTypes = getSupportedFileTypes('ANTHROPIC')
      expect(fileTypes.images).toHaveLength(4)
      expect(fileTypes.documents).toHaveLength(1)
      expect(fileTypes.text).toHaveLength(0)
      expect(fileTypes.all).toHaveLength(5)
    })

    it('should categorize file types for Grok', () => {
      const fileTypes = getSupportedFileTypes('GROK')
      expect(fileTypes.images).toHaveLength(4)
      expect(fileTypes.documents).toHaveLength(0) // PDF uses fallback
      expect(fileTypes.text).toHaveLength(0) // Text uses fallback
      expect(fileTypes.all).toHaveLength(4)
    })
  })

  describe('getAttachmentSupportDescription', () => {
    it('should return descriptive text for OpenAI', () => {
      const description = getAttachmentSupportDescription('OPENAI')
      expect(description).toContain('Images')
      expect(description).toContain('JPEG')
      expect(description).toContain('PNG')
    })

    it('should return descriptive text for Anthropic', () => {
      const description = getAttachmentSupportDescription('ANTHROPIC')
      expect(description).toContain('Images')
      expect(description).toContain('PDF')
    })

    it('should return no support message for Ollama', () => {
      const description = getAttachmentSupportDescription('OLLAMA', 'http://localhost:11434')
      expect(description).toBe('No file attachments supported')
    })
  })

  describe('getFileExtensionForMimeType', () => {
    it('should return correct extensions for MIME types', () => {
      expect(getFileExtensionForMimeType('image/jpeg')).toBe('.jpg')
      expect(getFileExtensionForMimeType('image/png')).toBe('.png')
      expect(getFileExtensionForMimeType('application/pdf')).toBe('.pdf')
      expect(getFileExtensionForMimeType('text/plain')).toBe('.txt')
      expect(getFileExtensionForMimeType('text/markdown')).toBe('.md')
    })

    it('should return null for unknown MIME types', () => {
      expect(getFileExtensionForMimeType('video/mp4')).toBeNull()
      expect(getFileExtensionForMimeType('application/unknown')).toBeNull()
    })
  })

  describe('MIME_TYPE_CATEGORIES', () => {
    it('should define image MIME types', () => {
      expect(MIME_TYPE_CATEGORIES.images).toEqual([
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/webp',
      ])
    })

    it('should define document MIME types', () => {
      expect(MIME_TYPE_CATEGORIES.documents).toEqual(['application/pdf'])
    })

    it('should define text MIME types', () => {
      expect(MIME_TYPE_CATEGORIES.text).toEqual([
        'text/plain',
        'text/markdown',
        'text/csv',
      ])
    })
  })

  describe('PROVIDER_ATTACHMENT_CAPABILITIES', () => {
    it('should have capabilities for all providers', () => {
      expect(PROVIDER_ATTACHMENT_CAPABILITIES.OPENAI).toBeDefined()
      expect(PROVIDER_ATTACHMENT_CAPABILITIES.ANTHROPIC).toBeDefined()
      expect(PROVIDER_ATTACHMENT_CAPABILITIES.GOOGLE).toBeDefined()
      expect(PROVIDER_ATTACHMENT_CAPABILITIES.GROK).toBeDefined()
      expect(PROVIDER_ATTACHMENT_CAPABILITIES.OLLAMA).toBeDefined()
      expect(PROVIDER_ATTACHMENT_CAPABILITIES.OPENROUTER).toBeDefined()
      expect(PROVIDER_ATTACHMENT_CAPABILITIES.GAB_AI).toBeDefined()
    })

    it('should correctly indicate attachment support', () => {
      expect(PROVIDER_ATTACHMENT_CAPABILITIES.OPENAI.supportsAttachments).toBe(true)
      expect(PROVIDER_ATTACHMENT_CAPABILITIES.OLLAMA.supportsAttachments).toBe(false)
    })
  })
})

describe('Connection Profile Utilities', () => {
  const createMockProfile = (provider: string, isDefault = false): ConnectionProfile => ({
    id: `profile-${provider}`,
    userId: 'user-123',
    name: `${provider} Profile`,
    provider: provider as any,
    apiKeyId: 'key-123',
    baseUrl: null,
    modelName: 'test-model',
    parameters: {},
    isDefault,
    isCheap: false,
    tags: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })

  describe('enrichConnectionProfileWithAttachmentSupport', () => {
    it('should enrich profile with attachment support info', () => {
      const profile = createMockProfile('OPENAI')
      const enriched = enrichConnectionProfileWithAttachmentSupport(profile)

      expect(enriched.supportsFileAttachments).toBe(true)
      expect(enriched.supportedMimeTypes).toHaveLength(4)
      expect(enriched.supportedFileTypes.images).toHaveLength(4)
      expect(enriched.attachmentSupportDescription).toContain('Images')
    })

    it('should indicate no support for providers without attachments', () => {
      const profile = createMockProfile('OLLAMA')
      profile.baseUrl = 'http://localhost:11434'
      const enriched = enrichConnectionProfileWithAttachmentSupport(profile)

      expect(enriched.supportsFileAttachments).toBe(false)
      expect(enriched.supportedMimeTypes).toHaveLength(0)
      expect(enriched.attachmentSupportDescription).toBe('No file attachments supported')
    })
  })

  describe('profileSupportsMimeType', () => {
    it('should check MIME type support for profile', () => {
      const profile = createMockProfile('ANTHROPIC')

      expect(profileSupportsMimeType(profile, 'image/png')).toBe(true)
      expect(profileSupportsMimeType(profile, 'application/pdf')).toBe(true)
      expect(profileSupportsMimeType(profile, 'video/mp4')).toBe(false)
    })
  })

  describe('filterProfilesWithAttachmentSupport', () => {
    it('should filter profiles with attachment support', () => {
      const profiles = [
        createMockProfile('OPENAI'),
        createMockProfile('ANTHROPIC'),
        createMockProfile('OLLAMA'),
        createMockProfile('GAB_AI'),
      ]

      profiles[2].baseUrl = 'http://localhost:11434'

      const filtered = filterProfilesWithAttachmentSupport(profiles)
      expect(filtered).toHaveLength(2)
      expect(filtered[0].provider).toBe('OPENAI')
      expect(filtered[1].provider).toBe('ANTHROPIC')
    })
  })

  describe('filterProfilesBySupportedMimeType', () => {
    it('should filter profiles by MIME type support', () => {
      const profiles = [
        createMockProfile('OPENAI'),
        createMockProfile('ANTHROPIC'),
        createMockProfile('GROK'),
      ]

      const pdfSupporting = filterProfilesBySupportedMimeType(profiles, 'application/pdf')
      expect(pdfSupporting).toHaveLength(1) // Only Anthropic supports PDF natively
      expect(pdfSupporting.map(p => p.provider)).toEqual(['ANTHROPIC'])

      const imageSupporting = filterProfilesBySupportedMimeType(profiles, 'image/png')
      expect(imageSupporting).toHaveLength(3)
    })
  })

  describe('getBestProfileForFile', () => {
    it('should return default profile if it supports the file', () => {
      const profiles = [
        createMockProfile('OPENAI'),
        createMockProfile('ANTHROPIC', true),
        createMockProfile('GOOGLE'),
      ]

      const best = getBestProfileForFile(profiles, 'image/png')
      expect(best?.provider).toBe('ANTHROPIC')
      expect(best?.isDefault).toBe(true)
    })

    it('should return null if no profile supports the file', () => {
      const profiles = [
        createMockProfile('OPENAI'),
        createMockProfile('GOOGLE'),
      ]

      const best = getBestProfileForFile(profiles, 'application/pdf')
      expect(best).toBeNull()
    })

    it('should return most recent profile if no default', () => {
      const profile1 = createMockProfile('ANTHROPIC')
      profile1.createdAt = new Date('2024-01-01').toISOString()

      const profile2 = createMockProfile('ANTHROPIC')
      profile2.createdAt = new Date('2024-06-01').toISOString()

      const profiles = [profile1, profile2]

      const best = getBestProfileForFile(profiles, 'application/pdf')
      expect(best?.provider).toBe('ANTHROPIC')
      // Should be the more recent profile (2024-06-01)
      expect(best?.createdAt).toBe(profile2.createdAt)
    })
  })
})
