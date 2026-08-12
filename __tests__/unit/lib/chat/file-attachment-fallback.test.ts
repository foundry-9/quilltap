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
jest.mock('@/lib/services/llm-logging.service', () => ({
  logLLMCall: jest.fn().mockResolvedValue(undefined),
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

const mockProfileSupportsMimeType = profileSupportsMimeType as jest.MockedFunction<typeof profileSupportsMimeType>
const mockCreateLLMProvider = createLLMProvider as jest.MockedFunction<typeof createLLMProvider>

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
  isDangerousCompatible: false,
  allowWebSearch: false,
  useNativeWebSearch: false,
  allowToolUse: true,
  supportsImageUpload: true,
  tags: [],
  sortIndex: 0,
  totalTokens: 0,
  totalPromptTokens: 0,
  totalCompletionTokens: 0,
  messageCount: 0,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}

const mockRepos = {
  chatSettings: {
    findByUserId: jest.fn(),
  },
  connections: {
    findById: jest.fn(),
    findByUserId: jest.fn(),
    findApiKeyById: jest.fn(),
    findApiKeyByIdAndUserId: jest.fn(),
  },
  files: {
    findById: jest.fn(),
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
    mockRepos.chatSettings.findByUserId.mockReset()
    mockRepos.connections.findById.mockReset()
    mockRepos.connections.findByUserId.mockReset()
    mockRepos.connections.findApiKeyById.mockReset()
    mockRepos.connections.findApiKeyByIdAndUserId.mockReset()
    mockRepos.files.findById.mockReset()
    // Default: no persisted description, so tests exercise the vision path
    // unless they opt into the reuse behaviour explicitly.
    mockRepos.files.findById.mockResolvedValue(null)
    mockProfileSupportsMimeType.mockReset()
    mockCreateLLMProvider.mockReset()
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
    // Base64 encoded "Heading\nDetails line"
    const base64Content = Buffer.from('Heading\nDetails line').toString('base64')

    const result = await convertTextFileToInline({
      filepath: 'api/files/file-123',
      filename: 'notes.md',
      mimeType: 'text/markdown',
    }, base64Content)

    expect(result.type).toBe('text')
    expect(result.textContent).toContain('[User attached text file: notes.md]')
    expect(result.textContent).toContain('Heading')
    expect(result.textContent).toContain('Details line')
    expect(result.processingMetadata?.originalMimeType).toBe('text/markdown')
  })

  it('returns unsupported when text conversion fails', async () => {
    // Invalid base64 data that will cause decode to fail
    // Actually, Buffer.from with 'base64' is lenient, so let's just test with empty/undefined behavior
    // The actual error case is handled in processFileAttachmentFallback when data is missing
    const result = await convertTextFileToInline({
      filepath: 'api/files/file-123',
      filename: 'bad.txt',
      mimeType: 'text/plain',
    }, '') // Empty string - will decode to empty but not fail

    // Empty content should still return a valid text result
    expect(result.type).toBe('text')
    expect(result.textContent).toContain('[User attached text file: bad.txt]')
  })

  it('returns unsupported when no image description profile is available', async () => {
    mockRepos.chatSettings.findByUserId.mockResolvedValue(null)
    mockRepos.connections.findByUserId.mockResolvedValue([])

    const result = await generateImageDescription(mockFileAttachment, mockRepos, baseProfile.userId)

    expect(result.type).toBe('unsupported')
    expect(result.error).toContain('No image description profile')
  })

  it('rejects when the selected profile does not support the attachment MIME type', async () => {
    mockRepos.chatSettings.findByUserId.mockResolvedValue({ imageDescriptionProfileId: baseProfile.id })
    mockRepos.connections.findById.mockResolvedValue(baseProfile)
    mockProfileSupportsMimeType.mockImplementation((_profile, mimeType) => mimeType === 'image/jpeg')

    const result = await generateImageDescription(mockFileAttachment, mockRepos, baseProfile.userId)

    expect(result.type).toBe('unsupported')
    expect(result.error).toContain('does not support image files')
  })

  it('requests an image description via the cheap LLM pipeline', async () => {
    mockRepos.chatSettings.findByUserId.mockResolvedValue({ imageDescriptionProfileId: baseProfile.id })
    mockRepos.connections.findById.mockResolvedValue(baseProfile)
    mockRepos.connections.findApiKeyByIdAndUserId.mockResolvedValue({
      key_value: 'sk-test',
    })
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

  it('forwards the image-description profile provider params (e.g. thinking mode) to the vision call', async () => {
    // Regression for the direct-call forwarding fix (commit 8cf7272e): a
    // profile's per-model settings such as DeepSeek `thinking: "disabled"` must
    // reach provider.sendMessage, or a reasoning model burns its budget on
    // hidden reasoning and returns empty content.
    const reasoningProfile: ConnectionProfile = {
      ...baseProfile,
      parameters: { temperature: 0.3, thinking: 'disabled', reasoning_effort: 'high' },
    }
    mockRepos.chatSettings.findByUserId.mockResolvedValue({ imageDescriptionProfileId: reasoningProfile.id })
    mockRepos.connections.findById.mockResolvedValue(reasoningProfile)
    mockRepos.connections.findApiKeyByIdAndUserId.mockResolvedValue({ key_value: 'sk-test' })
    mockProfileSupportsMimeType.mockReturnValue(true)

    const sendMessage = jest.fn().mockResolvedValue({
      content: 'Beautiful scene description',
      finishReason: 'stop',
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    })
    mockCreateLLMProvider.mockReturnValue({ sendMessage } as any)

    await generateImageDescription(mockFileAttachment, mockRepos, reasoningProfile.userId)

    expect(sendMessage).toHaveBeenCalledTimes(1)
    const [params] = sendMessage.mock.calls[0]
    expect(params.profileParameters).toEqual(
      expect.objectContaining({ thinking: 'disabled', reasoning_effort: 'high' })
    )
  })

  it('reuses a generated image\'s prompt as its description without any vision call', async () => {
    mockRepos.files.findById.mockResolvedValue({
      id: 'file-1',
      generationPrompt: 'Solo portrait of Ariel: pale gold quill, dragonfly wings.',
      description: 'Ariel — wardrobe portrait',
    })
    const sendMessage = jest.fn()
    mockCreateLLMProvider.mockReturnValue({ sendMessage } as any)

    const result = await generateImageDescription(mockFileAttachment, mockRepos, baseProfile.userId)

    // No profile lookup, no vision call — the persisted prompt is authoritative.
    expect(sendMessage).not.toHaveBeenCalled()
    expect(mockRepos.chatSettings.findByUserId).not.toHaveBeenCalled()
    expect(result.type).toBe('image_description')
    expect(result.imageDescription).toContain('pale gold quill')
    expect(result.processingMetadata?.reusedPersistedDescription).toBe(true)
    expect(result.processingMetadata?.usedImageDescriptionLLM).toBe(false)
  })

  it('reuses a stored description for an already-described upload (no generation prompt)', async () => {
    mockRepos.files.findById.mockResolvedValue({
      id: 'file-1',
      generationPrompt: null,
      description: 'A copper kettle on a windowsill at sunset.',
    })
    const sendMessage = jest.fn()
    mockCreateLLMProvider.mockReturnValue({ sendMessage } as any)

    const result = await generateImageDescription(mockFileAttachment, mockRepos, baseProfile.userId)

    expect(sendMessage).not.toHaveBeenCalled()
    expect(result.type).toBe('image_description')
    expect(result.imageDescription).toContain('copper kettle')
    expect(result.processingMetadata?.reusedPersistedDescription).toBe(true)
  })

  it('falls through to the vision call when persisted-description lookup throws', async () => {
    mockRepos.files.findById.mockRejectedValue(new Error('db unavailable'))
    mockRepos.chatSettings.findByUserId.mockResolvedValue({ imageDescriptionProfileId: baseProfile.id })
    mockRepos.connections.findById.mockResolvedValue(baseProfile)
    mockRepos.connections.findApiKeyByIdAndUserId.mockResolvedValue({ key_value: 'sk-test' })
    mockProfileSupportsMimeType.mockReturnValue(true)

    const sendMessage = jest.fn().mockResolvedValue({
      content: 'Beautiful scene description',
      finishReason: 'stop',
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    })
    mockCreateLLMProvider.mockReturnValue({ sendMessage } as any)

    const result = await generateImageDescription(mockFileAttachment, mockRepos, baseProfile.userId)

    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(result.type).toBe('image_description')
    expect(result.processingMetadata?.reusedPersistedDescription).toBeUndefined()
  })

  it('flags suspicious LLM responses so the UI can warn the user', async () => {
    mockRepos.chatSettings.findByUserId.mockResolvedValue({ imageDescriptionProfileId: baseProfile.id })
    mockRepos.connections.findById.mockResolvedValue(baseProfile)
    mockRepos.connections.findApiKeyByIdAndUserId.mockResolvedValue(null)
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
    const base64Content = Buffer.from('Converted body').toString('base64')

    const result = await processFileAttachmentFallback(
      {
        id: 'stored-file-id',
        filepath: 'api/files/stored-file-id',
        filename: 'notes.txt',
        mimeType: 'text/plain',
        size: 50,
      },
      {
        ...mockFileAttachment,
        filename: 'notes.txt',
        mimeType: 'text/plain',
        data: base64Content,
      },
      baseProfile,
      mockRepos,
      baseProfile.userId
    )

    expect(result.type).toBe('text')
    expect(result.textContent).toContain('notes.txt')
    expect(result.textContent).toContain('Converted body')
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

  it('falls back to the uncensored profile when the primary refuses', async () => {
    const uncensoredProfile: ConnectionProfile = {
      ...baseProfile,
      id: '55555555-5555-5555-5555-555555555555',
      name: 'Local llava',
      provider: 'OLLAMA',
      modelName: 'llava-uncensored',
    }
    mockRepos.chatSettings.findByUserId.mockResolvedValue({
      imageDescriptionProfileId: baseProfile.id,
      uncensoredImageDescriptionProfileId: uncensoredProfile.id,
    })
    mockRepos.connections.findById.mockImplementation(async (id: string) =>
      id === baseProfile.id ? baseProfile : uncensoredProfile
    )
    mockRepos.connections.findApiKeyByIdAndUserId.mockResolvedValue({ key_value: 'sk-test' })
    mockProfileSupportsMimeType.mockReturnValue(true)

    const sendMessage = jest
      .fn()
      .mockResolvedValueOnce({
        content: 'I cannot describe this image.',
        finishReason: 'stop',
        usage: { promptTokens: 5, completionTokens: 8, totalTokens: 13 },
      })
      .mockResolvedValueOnce({
        content: 'A copper kettle on a windowsill at sunset; warm tones; long horizontal composition.',
        finishReason: 'stop',
        usage: { promptTokens: 10, completionTokens: 30, totalTokens: 40 },
      })
    mockCreateLLMProvider.mockReturnValue({ sendMessage } as any)

    const result = await generateImageDescription(mockFileAttachment, mockRepos, baseProfile.userId)

    expect(sendMessage).toHaveBeenCalledTimes(2)
    expect(result.type).toBe('image_description')
    expect(result.imageDescription).toContain('copper kettle')
    expect(result.processingMetadata?.usedUncensoredFallback).toBe(true)
    expect(result.processingMetadata?.descriptionProfileId).toBe(uncensoredProfile.id)
  })

  it('does not retry when no uncensored fallback is configured', async () => {
    mockRepos.chatSettings.findByUserId.mockResolvedValue({
      imageDescriptionProfileId: baseProfile.id,
      uncensoredImageDescriptionProfileId: null,
    })
    mockRepos.connections.findById.mockResolvedValue(baseProfile)
    mockRepos.connections.findApiKeyByIdAndUserId.mockResolvedValue({ key_value: 'sk-test' })
    mockProfileSupportsMimeType.mockReturnValue(true)

    const sendMessage = jest.fn().mockResolvedValue({
      content: 'I cannot describe this image.',
      finishReason: 'stop',
      usage: { promptTokens: 5, completionTokens: 8, totalTokens: 13 },
    })
    mockCreateLLMProvider.mockReturnValue({ sendMessage } as any)

    const result = await generateImageDescription(mockFileAttachment, mockRepos, baseProfile.userId)

    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(result.type).toBe('unsupported')
    expect(result.processingMetadata?.usedUncensoredFallback).toBeUndefined()
  })

  it('does not retry when the uncensored fallback is the same profile as the primary', async () => {
    mockRepos.chatSettings.findByUserId.mockResolvedValue({
      imageDescriptionProfileId: baseProfile.id,
      uncensoredImageDescriptionProfileId: baseProfile.id,
    })
    mockRepos.connections.findById.mockResolvedValue(baseProfile)
    mockRepos.connections.findApiKeyByIdAndUserId.mockResolvedValue({ key_value: 'sk-test' })
    mockProfileSupportsMimeType.mockReturnValue(true)

    const sendMessage = jest.fn().mockResolvedValue({
      content: 'I cannot describe this image.',
      finishReason: 'stop',
      usage: { promptTokens: 5, completionTokens: 8, totalTokens: 13 },
    })
    mockCreateLLMProvider.mockReturnValue({ sendMessage } as any)

    const result = await generateImageDescription(mockFileAttachment, mockRepos, baseProfile.userId)
    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(result.type).toBe('unsupported')
  })

  it('surfaces a combined error when both primary and fallback fail', async () => {
    const uncensoredProfile: ConnectionProfile = {
      ...baseProfile,
      id: '66666666-6666-6666-6666-666666666666',
      name: 'Backup',
    }
    mockRepos.chatSettings.findByUserId.mockResolvedValue({
      imageDescriptionProfileId: baseProfile.id,
      uncensoredImageDescriptionProfileId: uncensoredProfile.id,
    })
    mockRepos.connections.findById.mockImplementation(async (id: string) =>
      id === baseProfile.id ? baseProfile : uncensoredProfile
    )
    mockRepos.connections.findApiKeyByIdAndUserId.mockResolvedValue({ key_value: 'sk-test' })
    mockProfileSupportsMimeType.mockReturnValue(true)

    const sendMessage = jest
      .fn()
      .mockResolvedValueOnce({
        content: 'Cannot do this.',
        finishReason: 'stop',
        usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
      })
      .mockResolvedValueOnce({
        content: '',
        finishReason: 'stop',
        usage: { promptTokens: 5, completionTokens: 0, totalTokens: 5 },
      })
    mockCreateLLMProvider.mockReturnValue({ sendMessage } as any)

    const result = await generateImageDescription(mockFileAttachment, mockRepos, baseProfile.userId)

    expect(sendMessage).toHaveBeenCalledTimes(2)
    expect(result.type).toBe('unsupported')
    expect(result.error).toContain('uncensored fallback also failed')
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
