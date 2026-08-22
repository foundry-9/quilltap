import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'

// jest.config.ts maps '@openrouter/sdk' to __mocks__/@openrouter/sdk.ts. An
// inline jest.mock factory here registers against the raw specifier, while the
// subject's own import is rewritten to the manual mock — so the provider would
// call a different jest.fn() than the one configured, and every assertion would
// silently exercise the error path. Configure the manual mock's handle instead.
import { __mocks__ as openRouterMocks } from '@openrouter/sdk'

const { mockModelsList } = openRouterMocks as unknown as {
  mockModelsList: jest.Mock
}

jest.mock('@quilltap/plugin-utils', () => ({
  __esModule: true,
  createPluginLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
  getQuilltapUserAgent: () => 'Quilltap/Test',
}))

import { OpenRouterImageProvider } from '@/plugins/dist/qtap-plugin-openrouter/image-provider'

const FALLBACK_IMAGE_MODELS = [
  'google/gemini-2.5-flash-preview-native-image',
  'google/gemini-3-pro-image-preview',
  'openai/gpt-5-image',
  'openai/gpt-5-image-mini',
]

describe('OpenRouterImageProvider', () => {
  let provider: OpenRouterImageProvider
  let fetchMock: jest.Mock
  const originalFetch = global.fetch
  const apiKey = 'test-openrouter-key'

  beforeEach(() => {
    jest.clearAllMocks()
    provider = new OpenRouterImageProvider()
    fetchMock = jest.fn()
    global.fetch = fetchMock as unknown as typeof fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('sends image generation requests through chat completions with modalities and image_config', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              images: [
                {
                  image_url: {
                    url: 'data:image/png;base64,abc123',
                  },
                },
              ],
            },
          },
        ],
      }),
    })

    const result = await provider.generateImage(
      {
        prompt: 'A moonlit portrait',
        negativePrompt: 'extra limbs',
        style: 'art deco',
        aspectRatio: '16:9',
        quality: 'hd',
        model: 'openai/gpt-5-image',
      },
      apiKey,
    )

    expect(result.images).toEqual([
      {
        data: 'abc123',
        mimeType: 'image/png',
      },
    ])
    expect(fetchMock).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: `Bearer ${apiKey}`,
          'X-Title': 'Quilltap',
        }),
      }),
    )

    const [, requestInit] = fetchMock.mock.calls[0]
    const body = JSON.parse(requestInit.body as string)

    expect(body).toMatchObject({
      model: 'openai/gpt-5-image',
      modalities: ['image', 'text'],
      image_config: {
        aspect_ratio: '16:9',
        image_size: '4K',
      },
    })
    expect(body.messages[0].content).toContain('A moonlit portrait')
    expect(body.messages[0].content).toContain('Avoid the following in the image: extra limbs')
    expect(body.messages[0].content).toContain('Use a art deco artistic style.')
  })

  it('parses inline image data from multipart fallback responses', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: [
                {
                  type: 'text',
                  text: 'Here is your image.',
                },
                {
                  type: 'input_image',
                  inline_data: {
                    data: 'xyz789',
                    mimeType: 'image/webp',
                  },
                },
              ],
            },
          },
        ],
      }),
    })

    const result = await provider.generateImage({ prompt: 'A velvet coat' }, apiKey)

    expect(result.images).toEqual([
      {
        data: 'xyz789',
        mimeType: 'image/webp',
      },
    ])
  })

  it('returns a concise refusal message when the model declines to generate an image', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              refusal: 'I cannot create that image because it violates the policy.',
            },
          },
        ],
      }),
    })

    await expect(provider.generateImage({ prompt: 'Forbidden portrait' }, apiKey)).rejects.toThrow(
      'Model declined to generate an image: I cannot create that image because it violates the policy.',
    )
  })

  it('advertises the updated fallback image-capable model list', () => {
    expect(provider.supportedModels).toEqual(FALLBACK_IMAGE_MODELS)
  })

  it('discovers image models across every page of the paginated response', async () => {
    // models.list() resolves to a PageIterator: async-iterable, with the model
    // array at page.result.data. Reading `response.data` instead yields
    // undefined, which is how discovery silently returned nothing and always
    // fell through to the fallback list. Two pages, so a single-page read
    // can't pass this either.
    mockModelsList.mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        yield {
          result: {
            data: [
              { id: 'vendor/paints', output_modalities: ['image'] },
              { id: 'vendor/talks', output_modalities: ['text'] },
            ],
          },
        }
        yield {
          result: {
            data: [
              { id: 'vendor/draws', architecture: { outputModality: 'image' } },
              { id: 'vendor/sketches', supported_generation_methods: ['image'] },
            ],
          },
        }
      },
    })

    const models = await provider.getAvailableModels(apiKey)

    expect(models).toEqual(['vendor/paints', 'vendor/draws', 'vendor/sketches'])
    expect(models).not.toEqual(FALLBACK_IMAGE_MODELS)
  })

  it('throws when the API reports no image models, so callers can label the fallback honestly', async () => {
    mockModelsList.mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        yield { result: { data: [{ id: 'vendor/talks', output_modalities: ['text'] }] } }
      },
    })

    await expect(provider.getAvailableModels(apiKey)).rejects.toThrow(
      'no image-output models'
    )
  })

  it('throws when discovery is unavailable, so callers can label the fallback honestly', async () => {
    mockModelsList.mockRejectedValue(new Error('network unavailable'))

    await expect(provider.getAvailableModels(apiKey)).rejects.toThrow('network unavailable')
  })

  it('returns the built-in model list when no API key is provided', async () => {
    const models = await provider.getAvailableModels()

    expect(models).toEqual(FALLBACK_IMAGE_MODELS)
    expect(mockModelsList).not.toHaveBeenCalled()
  })
})
