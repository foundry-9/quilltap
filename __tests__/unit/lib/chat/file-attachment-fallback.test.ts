/**
 * Tests for the file attachment fallback pipeline introduced after 1.5-dev.
 * Ensures text files are converted inline, images invoke the cheap LLM, and error
 * conditions surface clear metadata for the UI.
 */

import type { ConnectionProfile } from '@/lib/schemas/types'
import type { FileAttachment } from '@/lib/llm/base'

jest.mock('@/lib/llm/connection-profile-utils', () => ({
  profileSupportsMimeType: jest.fn(),
}))
jest.mock('@/lib/llm/plugin-factory', () => ({
  createLLMProvider: jest.fn(),
}))
jest.mock('@/lib/encryption', () => ({
  decryptApiKey: jest.fn(),
}))
jest.mock('fs/promises', () => ({
  readFile: jest.fn(),
}))

import {
  needsFallbackProcessing,
  isTextFile,
  isImageFile,
  convertTextFileToInline,
  generateImageDescription,
  processFileAttachmentFallback,
  formatFallbackAsMessagePrefix,
} from '@/lib/chat/file-attachment-fallback'
import { profileSupportsMimeType } from '@/lib/llm/connection-profile-utils'
import { createLLMProvider } from '@/lib/llm'
import { decryptApiKey } from '@/lib/encryption'
import { readFile } from 'fs/promises'

const mockProfileSupportsMimeType = profileSupportsMimeType as jest.MockedFunction<typeof profileSupportsMimeType>
const mockCreateLLMProvider = createLLMProvider as jest.MockedFunction<typeof createLLMProvider>
const mockDecryptApiKey = decryptApiKey as jest.MockedFunction<typeof decryptApiKey>
const mockReadFile = readFile as jest.MockedFunction<typeof readFile>

const baseProfile: ConnectionProfile = {
  id: '44444444-4444-4444-4444-444444444444',
  userId: '11111111-1111-1111-1111-111111111111',
  name: 'Vision Helper',
  provider: 'OPENAI',
  apiKeyId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  baseUrl: 'https://api.openai.com/v1',
  modelName: 'gpt-4o-mini',
  parameters: { temperature: 0.3 },
  isDefault: false,
  isCheap: true,
  tags: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}

const mockRepos = {
  users: {
    getChatSettings: jest.fn(),
  },
  connections: {
    findById: jest.fn(),
    findByUserId: jest.fn(),
    findApiKeyById: jest.fn(),
  },
}

const mockFileAttachment: FileAttachment = {
  id: 'file-1',
  filepath: 'uploads/chat-files/chat-1/image.png',
  filename: 'image.png',
  mimeType: 'image/png',
  size: 1024,
}

describe('lib/chat/file-attachment-fallback', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockRepos.users.getChatSettings.mockReset()
    mockRepos.connections.findById.mockReset()
    mockRepos.connections.findByUserId.mockReset()
    mockRepos.connections.findApiKeyById.mockReset()
    mockProfileSupportsMimeType.mockReset()
    mockCreateLLMProvider.mockReset()
    mockDecryptApiKey.mockReset()
  })

  it('detects when fallback is required based on MIME support', () => {
    mockProfileSupportsMimeType.mockReturnValueOnce(false).mockReturnValueOnce(true)
    expect(needsFallbackProcessing(baseProfile, 'image/png')).toBe(true)
    expect(needsFallbackProcessing(baseProfile, 'image/png')).toBe(false)
  })

  it('classifies text and image MIME types', () => {
    expect(isTextFile('text/plain')).toBe(true)
    expect(isTextFile('application/json')).toBe(true)
    expect(isTextFile('application/pdf')).toBe(false)
    expect(isImageFile('image/png')).toBe(true)
    expect(isImageFile('video/mp4')).toBe(false)
  })

  it('converts text files into inline message content', async () => {
    mockReadFile.mockResolvedValue('Heading\nDetails line')

    const result = await convertTextFileToInline({
      filepath: 'uploads/chat-files/chat-1/notes.md',
      filename: 'notes.md',
      mimeType: 'text/markdown',
    })

    expect(mockReadFile).toHaveBeenCalledWith(
      expect.stringContaining('public/uploads/chat-files/chat-1/notes.md'),
      'utf-8'
    )
    expect(result.type).toBe('text')
    expect(result.textContent).toContain('[User attached text file: notes.md]')
    expect(result.processingMetadata?.originalMimeType).toBe('text/markdown')
  })

  it('returns unsupported when text conversion fails', async () => {
    mockReadFile.mockRejectedValue(new Error('boom'))

    const result = await convertTextFileToInline({
      filepath: 'uploads/chat-files/chat-1/bad.txt',
      filename: 'bad.txt',
      mimeType: 'text/plain',
    })

    expect(result.type).toBe('unsupported')
    expect(result.error).toContain('Failed to process text file')
  })

  it('returns unsupported when no image description profile is available', async () => {
    mockRepos.users.getChatSettings.mockResolvedValue(null)
    mockRepos.connections.findByUserId.mockResolvedValue([])

    const result = await generateImageDescription(mockFileAttachment, mockRepos, baseProfile.userId)

    expect(result.type).toBe('unsupported')
    expect(result.error).toContain('No image description profile')
  })

  it('rejects when the selected profile does not support the attachment MIME type', async () => {
    mockRepos.users.getChatSettings.mockResolvedValue({ imageDescriptionProfileId: baseProfile.id })
    mockRepos.connections.findById.mockResolvedValue(baseProfile)
    mockProfileSupportsMimeType.mockImplementation((_profile, mimeType) => mimeType === 'image/jpeg')

    const result = await generateImageDescription(mockFileAttachment, mockRepos, baseProfile.userId)

    expect(result.type).toBe('unsupported')
    expect(result.error).toContain('does not support image files')
  })

  it('requests an image description via the cheap LLM pipeline', async () => {
    mockRepos.users.getChatSettings.mockResolvedValue({ imageDescriptionProfileId: baseProfile.id })
    mockRepos.connections.findById.mockResolvedValue(baseProfile)
    mockRepos.connections.findApiKeyById.mockResolvedValue({
      ciphertext: 'cipher',
      iv: 'iv',
      authTag: 'tag',
    })
    mockDecryptApiKey.mockReturnValue('sk-test')
    mockProfileSupportsMimeType.mockReturnValue(true)

    const sendMessage = jest.fn().mockResolvedValue({
      content: 'Beautiful scene description',
      finishReason: 'stop',
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    })
    mockCreateLLMProvider.mockReturnValue({ sendMessage } as any)

    const result = await generateImageDescription(mockFileAttachment, mockRepos, baseProfile.userId)

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        model: baseProfile.modelName,
        messages: expect.any(Array),
      }),
      'sk-test'
    )
    expect(result.type).toBe('image_description')
    expect(result.processingMetadata?.usedImageDescriptionLLM).toBe(true)
    expect(result.imageDescription).toContain('Beautiful scene description')
  })

  it('flags suspicious LLM responses so the UI can warn the user', async () => {
    mockRepos.users.getChatSettings.mockResolvedValue({ imageDescriptionProfileId: baseProfile.id })
    mockRepos.connections.findById.mockResolvedValue(baseProfile)
    mockRepos.connections.findApiKeyById.mockResolvedValue(null)
    mockProfileSupportsMimeType.mockReturnValue(true)

    const sendMessage = jest.fn().mockResolvedValue({
      content: 'Error: not supported',
      finishReason: 'stop',
      usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
    })
    mockCreateLLMProvider.mockReturnValue({ sendMessage } as any)

    const result = await generateImageDescription(mockFileAttachment, mockRepos, baseProfile.userId)

    expect(result.type).toBe('unsupported')
    expect(result.error).toContain('appears to be an error')
  })

  it('processes text attachments when provider lacks native support', async () => {
    mockProfileSupportsMimeType.mockReturnValue(false)
    mockReadFile.mockResolvedValue('Converted body')

    const result = await processFileAttachmentFallback(
      {
        id: 'stored-file-id',
        filepath: 'uploads/chat-files/chat-1/notes.txt',
        filename: 'notes.txt',
        mimeType: 'text/plain',
        size: 50,
      },
      mockFileAttachment,
      baseProfile,
      mockRepos,
      baseProfile.userId
    )

    expect(result.type).toBe('text')
    expect(result.textContent).toContain('notes.txt')
  })

  it('short-circuits when provider already supports the attachment MIME type', async () => {
    mockProfileSupportsMimeType.mockReturnValue(true)

    const result = await processFileAttachmentFallback(
      {
        id: 'stored-file-id',
        filepath: 'uploads/chat-files/chat-1/notes.txt',
        filename: 'notes.txt',
        mimeType: 'text/plain',
        size: 50,
      },
      mockFileAttachment,
      baseProfile,
      mockRepos,
      baseProfile.userId
    )

    expect(result.type).toBe('unsupported')
    expect(result.error).toBeUndefined()
  })

  it('formats fallback results into a message prefix', () => {
    expect(
      formatFallbackAsMessagePrefix({
        type: 'text',
        textContent: 'Converted file content',
      })
    ).toContain('Converted file content')

    expect(
      formatFallbackAsMessagePrefix({
        type: 'image_description',
        imageDescription: 'Detailed desc',
        processingMetadata: { originalFilename: 'img.png', originalMimeType: 'image/png' },
      })
    ).toContain('Image Description')

    expect(
      formatFallbackAsMessagePrefix({
        type: 'unsupported',
        error: 'No support',
        processingMetadata: { originalFilename: 'bad.bin', originalMimeType: 'application/octet-stream' },
      })
    ).toContain('⚠️ Attachment Processing Failed')
  })
})
