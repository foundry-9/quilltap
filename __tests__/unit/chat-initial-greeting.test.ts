import { describe, it, expect, jest, beforeEach } from '@jest/globals'
import { generateGreetingMessage } from '@/lib/chat/initial-greeting'
import { createLLMProvider } from '@/lib/llm'
import type { LLMProvider } from '@/lib/llm/base'

jest.mock('@/lib/llm/plugin-factory')

const mockCreateProvider = jest.mocked(createLLMProvider)

const mockProvider = {
  supportsFileAttachments: false,
  supportedMimeTypes: [],
  supportsImageGeneration: false,
  sendMessage: jest.fn(),
  streamMessage: jest.fn(),
  validateApiKey: jest.fn(),
  getAvailableModels: jest.fn(),
  generateImage: jest.fn(),
} as unknown as jest.Mocked<LLMProvider>

describe('generateGreetingMessage', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockProvider.sendMessage.mockResolvedValue({
      content: ' Hi there! ',
      finishReason: 'stop',
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      raw: {},
    })
    mockCreateProvider.mockReturnValue(mockProvider)
  })

  it('requests a greeting from the provider and trims the response', async () => {
    const content = await generateGreetingMessage({
      systemPrompt: 'System instructions',
      characterName: 'Avery',
      provider: 'OPENAI',
      modelName: 'gpt-test',
      apiKey: 'api-key',
      temperature: 0.5,
      maxTokens: 120,
      topP: 0.9,
    })

    expect(content).toBe('Hi there!')
    expect(mockCreateProvider).toHaveBeenCalledWith('OPENAI', undefined)

    const call = mockProvider.sendMessage.mock.calls[0] as [any, string]
    const payload = call[0] as {
      model: string
      temperature?: number
      maxTokens?: number
      topP?: number
      messages: Array<{ role: string; content: string }>
    }

    expect(payload.model).toBe('gpt-test')
    expect(payload.temperature).toBe(0.5)
    expect(payload.maxTokens).toBe(120)
    expect(payload.topP).toBe(0.9)
    expect(payload.messages[0].role).toBe('system')
    expect(payload.messages[0].content).toContain('brand new conversation')
    expect(payload.messages[1].content).toContain('Greet the user')

    expect(call[1]).toBe('api-key')
  })

  it('falls back to default maxTokens when optional params are omitted', async () => {
    mockProvider.sendMessage.mockResolvedValueOnce({
      content: 'Hello there',
      finishReason: 'stop',
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      raw: {},
    })

    const content = await generateGreetingMessage({
      systemPrompt: 'System instructions',
      characterName: 'Rin',
      provider: 'OLLAMA',
      modelName: 'llama3',
      baseUrl: 'http://localhost:11434',
    })

    const call = mockProvider.sendMessage.mock.calls[0] as [any, string]
    const payload = call[0] as { maxTokens?: number }

    expect(payload.maxTokens).toBe(160)
    expect(call[1]).toBe('')
    expect(content).toBe('Hello there')
  })
})
