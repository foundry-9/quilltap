/**
 * OpenRouterProvider text-send tests.
 *
 * Bug 31 regression: the non-streaming send path (regenerate / continuation
 * legs) must carry image attachments to OpenRouter. The @openrouter/sdk
 * chat.send() request path rejects OpenAI content-parts (image_url) messages at
 * client-side validation, so vision sends are routed around it through a direct
 * Chat Completions fetch. Text-only sends keep the SDK path.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'

// The subject imports @openrouter/sdk (mapped to the manual mock) and
// @quilltap/plugin-utils. Mock plugin-utils here so the logger is inert and the
// timeout/abort helpers are deterministic.
jest.mock('@quilltap/plugin-utils', () => ({
  __esModule: true,
  createPluginLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
  getQuilltapUserAgent: () => 'Quilltap/Test',
  resolveRequestTimeoutMs: () => 30_000,
  buildRequestAbortSignal: () => new AbortController().signal,
}))

import { __mocks__ as openRouterMocks } from '@openrouter/sdk'
import { OpenRouterProvider } from '@/plugins/dist/qtap-plugin-openrouter/provider'
import type { LLMParams } from '@/plugins/dist/qtap-plugin-openrouter/types'

const { mockChatSend } = openRouterMocks as unknown as { mockChatSend: jest.Mock }

// 1x1 red PNG.
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

function imageParams(): LLMParams {
  return {
    model: 'openai/gpt-4o',
    messages: [
      {
        role: 'user',
        content: 'What is in this image?',
        attachments: [
          {
            id: 'att-1',
            filename: 'red.png',
            mimeType: 'image/png',
            size: 68,
            data: PNG_B64,
          },
        ],
      },
    ],
  } as unknown as LLMParams
}

describe('OpenRouterProvider.sendMessage — non-streaming vision (Bug 31)', () => {
  let provider: OpenRouterProvider
  let fetchMock: jest.Mock
  const originalFetch = global.fetch

  beforeEach(() => {
    jest.clearAllMocks()
    provider = new OpenRouterProvider()
    fetchMock = jest.fn()
    global.fetch = fetchMock as unknown as typeof fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('routes an image send through a direct Chat Completions fetch carrying the image_url part', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: 'a single red pixel' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 },
      }),
      text: async () => '',
    })

    const res = await provider.sendMessage(imageParams(), 'sk-test')

    // The SDK's validating chat.send() must NOT be used for vision sends.
    expect(mockChatSend).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
    const body = JSON.parse(init.body as string)
    expect(body.stream).toBe(false)

    const userMsg = body.messages.find((m: any) => m.role === 'user')
    expect(Array.isArray(userMsg.content)).toBe(true)
    const imagePart = userMsg.content.find((p: any) => p.type === 'image_url')
    expect(imagePart).toBeDefined()
    expect(imagePart.image_url.url).toBe(`data:image/png;base64,${PNG_B64}`)
    // Text is preserved as its own part alongside the image.
    expect(userMsg.content.some((p: any) => p.type === 'text' && p.text === 'What is in this image?')).toBe(true)

    // Response is surfaced and the image is accounted as sent.
    expect(res.content).toBe('a single red pixel')
    expect(res.finishReason).toBe('stop')
    expect(res.usage.promptTokens).toBe(20)
    expect(res.attachmentResults?.sent).toContain('att-1')
    expect(res.attachmentResults?.failed).toHaveLength(0)
    expect(res.raw).toBeDefined()
  })

  it('forwards ZDR (data_collection: deny) on the vision path', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
      text: async () => '',
    })

    const params = imageParams()
    ;(params as any).profileParameters = { enableZDR: true }
    await provider.sendMessage(params, 'sk-test')

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.provider?.data_collection).toBe('deny')
  })

  it('keeps the SDK path for text-only sends (no direct fetch)', async () => {
    mockChatSend.mockResolvedValue({
      choices: [{ message: { content: 'hello there' }, finishReason: 'stop' }],
      usage: { promptTokens: 3, completionTokens: 2, totalTokens: 5 },
    })

    const params = {
      model: 'openai/gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
    } as unknown as LLMParams

    const res = await provider.sendMessage(params, 'sk-test')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(mockChatSend).toHaveBeenCalledTimes(1)
    expect(res.content).toBe('hello there')
  })
})
