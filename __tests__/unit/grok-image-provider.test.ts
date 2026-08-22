
import { GrokImageProvider } from '@/plugins/dist/qtap-plugin-grok/image-provider';

// Mock OpenAI
jest.mock('openai', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      images: {
        generate: jest.fn(),
      },
      models: {
        list: jest.fn(),
      },
    })),
  };
});

import OpenAI from 'openai';

function getMockClient() {
  const MockOpenAI = OpenAI as jest.MockedClass<typeof OpenAI>;
  return MockOpenAI.mock.results[MockOpenAI.mock.results.length - 1]?.value;
}

describe('GrokImageProvider', () => {
  let provider: GrokImageProvider;
  const mockApiKey = 'test-api-key';

  beforeEach(() => {
    provider = new GrokImageProvider();
    jest.clearAllMocks();
  });

  describe('supportedModels', () => {
    it('should include grok-imagine-image, grok-imagine-image-pro, and legacy grok-2-image', () => {
      expect(provider.supportedModels).toEqual([
        'grok-imagine-image',
        'grok-imagine-image-pro',
        'grok-2-image',
      ]);
    });
  });

  describe('generateImage', () => {
    it('should default to grok-imagine-image when no model specified', async () => {
      const mockResponse = {
        data: [{ b64_json: 'base64data', revised_prompt: 'revised' }],
      };

      const mockClient = { images: { generate: jest.fn().mockResolvedValue(mockResponse) }, models: { list: jest.fn() } };
      (OpenAI as unknown as jest.Mock).mockImplementation(() => mockClient);

      await provider.generateImage({ prompt: 'test prompt' }, mockApiKey);

      expect(mockClient.images.generate).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'grok-imagine-image' })
      );
    });

    it('should handle grok-imagine-image model with b64_json response', async () => {
      const mockResponse = {
        data: [{ b64_json: 'base64encodedimage', revised_prompt: 'revised prompt' }],
      };

      const mockClient = { images: { generate: jest.fn().mockResolvedValue(mockResponse) }, models: { list: jest.fn() } };
      (OpenAI as unknown as jest.Mock).mockImplementation(() => mockClient);

      const result = await provider.generateImage(
        { prompt: 'test prompt', model: 'grok-imagine-image' },
        mockApiKey
      );

      expect(result.images).toHaveLength(1);
      expect(result.images[0].data).toBe('base64encodedimage');
      expect(result.images[0].revisedPrompt).toBe('revised prompt');
    });

    it('should set resolution to 2k for grok-imagine-image-pro', async () => {
      const mockResponse = {
        data: [{ b64_json: 'base64data' }],
      };

      const mockClient = { images: { generate: jest.fn().mockResolvedValue(mockResponse) }, models: { list: jest.fn() } };
      (OpenAI as unknown as jest.Mock).mockImplementation(() => mockClient);

      await provider.generateImage(
        { prompt: 'test prompt', model: 'grok-imagine-image-pro' },
        mockApiKey
      );

      expect(mockClient.images.generate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'grok-imagine-image-pro',
          resolution: '2k',
        })
      );
    });

    it('should not set resolution for standard grok-imagine-image', async () => {
      const mockResponse = {
        data: [{ b64_json: 'base64data' }],
      };

      const mockClient = { images: { generate: jest.fn().mockResolvedValue(mockResponse) }, models: { list: jest.fn() } };
      (OpenAI as unknown as jest.Mock).mockImplementation(() => mockClient);

      await provider.generateImage(
        { prompt: 'test prompt', model: 'grok-imagine-image' },
        mockApiKey
      );

      const callArgs = mockClient.images.generate.mock.calls[0][0];
      expect(callArgs.resolution).toBeUndefined();
    });

    it('should not set resolution for legacy grok-2-image', async () => {
      const mockResponse = {
        data: [{ b64_json: 'base64data' }],
      };

      const mockClient = { images: { generate: jest.fn().mockResolvedValue(mockResponse) }, models: { list: jest.fn() } };
      (OpenAI as unknown as jest.Mock).mockImplementation(() => mockClient);

      await provider.generateImage(
        { prompt: 'test prompt', model: 'grok-2-image' },
        mockApiKey
      );

      const callArgs = mockClient.images.generate.mock.calls[0][0];
      expect(callArgs.resolution).toBeUndefined();
    });

    it('should pass aspect_ratio when provided', async () => {
      const mockResponse = {
        data: [{ b64_json: 'base64data' }],
      };

      const mockClient = { images: { generate: jest.fn().mockResolvedValue(mockResponse) }, models: { list: jest.fn() } };
      (OpenAI as unknown as jest.Mock).mockImplementation(() => mockClient);

      await provider.generateImage(
        { prompt: 'test prompt', model: 'grok-imagine-image', aspectRatio: '16:9' },
        mockApiKey
      );

      expect(mockClient.images.generate).toHaveBeenCalledWith(
        expect.objectContaining({ aspect_ratio: '16:9' })
      );
    });

    it('should throw error if API returns invalid response', async () => {
      const mockClient = { images: { generate: jest.fn().mockResolvedValue({}) }, models: { list: jest.fn() } };
      (OpenAI as unknown as jest.Mock).mockImplementation(() => mockClient);

      await expect(
        provider.generateImage({ prompt: 'test prompt', model: 'grok-imagine-image' }, mockApiKey)
      ).rejects.toThrow('Invalid response from Grok Images API');
    });

    it('should throw error if no API key provided', async () => {
      await expect(
        provider.generateImage({ prompt: 'test prompt', model: 'grok-imagine-image' }, '')
      ).rejects.toThrow('Grok provider requires an API key');
    });

    it('should fall back to url when b64_json is missing', async () => {
      const mockResponse = {
        data: [{ url: 'https://example.com/image.jpg', revised_prompt: 'revised' }],
      };

      const mockClient = { images: { generate: jest.fn().mockResolvedValue(mockResponse) }, models: { list: jest.fn() } };
      (OpenAI as unknown as jest.Mock).mockImplementation(() => mockClient);

      const result = await provider.generateImage(
        { prompt: 'test prompt', model: 'grok-imagine-image' },
        mockApiKey
      );

      expect(result.images[0].data).toBe('https://example.com/image.jpg');
    });
  });

  describe('getAvailableModels', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('should return all supported models without an API key', async () => {
      const models = await provider.getAvailableModels();
      expect(models).toEqual(['grok-imagine-image', 'grok-imagine-image-pro', 'grok-2-image']);
    });

    it('queries the dedicated image-generation-models endpoint with an API key', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          models: [
            { id: 'grok-imagine-image-2.0', aliases: ['grok-imagine-image'] },
            { id: 'grok-2-image-1212', aliases: [] },
          ],
        }),
      });
      global.fetch = fetchMock as unknown as typeof fetch;

      const models = await provider.getAvailableModels(mockApiKey);

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.x.ai/v1/image-generation-models',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: `Bearer ${mockApiKey}` }),
        })
      );
      expect(models).toEqual(['grok-2-image-1212', 'grok-imagine-image', 'grok-imagine-image-2.0']);
    });

    it('accepts the alternate data-keyed response shape', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: [{ id: 'grok-imagine-image' }] }),
      }) as unknown as typeof fetch;

      const models = await provider.getAvailableModels(mockApiKey);
      expect(models).toEqual(['grok-imagine-image']);
    });

    it('throws on an HTTP error so callers can label the fallback honestly', async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401 }) as unknown as typeof fetch;

      await expect(provider.getAvailableModels(mockApiKey)).rejects.toThrow('HTTP 401');
    });

    it('throws when the endpoint lists no models', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ models: [] }),
      }) as unknown as typeof fetch;

      await expect(provider.getAvailableModels(mockApiKey)).rejects.toThrow('no image-generation models');
    });
  });
});
