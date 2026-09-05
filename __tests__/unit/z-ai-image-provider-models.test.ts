
import { ZAIImageProvider } from '@/plugins/dist/qtap-plugin-z-ai/image-provider';

// Mock OpenAI (Z.AI's endpoint is OpenAI-shaped)
jest.mock('openai', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      images: { generate: jest.fn() },
      models: { list: jest.fn() },
    })),
  };
});

import OpenAI from 'openai';

describe('ZAIImageProvider.getAvailableModels', () => {
  let provider: ZAIImageProvider;
  const mockApiKey = 'test-api-key';

  beforeEach(() => {
    provider = new ZAIImageProvider();
    jest.clearAllMocks();
  });

  it('returns the curated static list without an API key', async () => {
    const models = await provider.getAvailableModels();
    expect(models).toEqual(provider.supportedModels);
  });

  it('unions API-listed image models with the documented set, excluding chat models', async () => {
    const mockClient = {
      images: { generate: jest.fn() },
      models: {
        list: jest.fn().mockResolvedValue({
          data: [
            { id: 'glm-4.6' },
            { id: 'cogview-4-250304' },
            { id: 'cogview-5' },
            { id: 'glm-4.5-flash' },
          ],
        }),
      },
    };
    (OpenAI as unknown as jest.Mock).mockImplementation(() => mockClient);

    const models = await provider.getAvailableModels(mockApiKey);

    // Chat models never leak in; documented image models survive even when
    // the endpoint under-reports them (glm-image was absent from the API list)
    expect(models).toEqual(['cogview-4-250304', 'cogview-5', 'glm-image']);
  });

  it('propagates transport errors so callers can label the fallback honestly', async () => {
    const mockClient = {
      images: { generate: jest.fn() },
      models: { list: jest.fn().mockRejectedValue(new Error('boom')) },
    };
    (OpenAI as unknown as jest.Mock).mockImplementation(() => mockClient);

    await expect(provider.getAvailableModels(mockApiKey)).rejects.toThrow('boom');
  });
});

describe('ZAIImageProvider.generateImage', () => {
  let provider: ZAIImageProvider;
  const mockApiKey = 'test-api-key';
  const originalFetch = global.fetch;

  beforeEach(() => {
    provider = new ZAIImageProvider();
    jest.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('downloads URL-only responses into base64 data (Quilltap consumers read only base64)', async () => {
    const mockClient = {
      images: {
        generate: jest.fn().mockResolvedValue({
          data: [{ url: 'https://cdn.example/img.png' }],
        }),
      },
      models: { list: jest.fn() },
    };
    (OpenAI as unknown as jest.Mock).mockImplementation(() => mockClient);

    const bytes = Uint8Array.from([1, 2, 3, 4]);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'image/jpeg' },
      arrayBuffer: async () => bytes.buffer,
    }) as unknown as typeof fetch;

    const result = await provider.generateImage({ prompt: 'a hat' }, mockApiKey);

    expect(global.fetch).toHaveBeenCalledWith('https://cdn.example/img.png');
    expect(result.images[0].data).toBe(Buffer.from(bytes).toString('base64'));
    expect(result.images[0].mimeType).toBe('image/jpeg');
  });

  it('throws when the image download fails', async () => {
    const mockClient = {
      images: {
        generate: jest.fn().mockResolvedValue({
          data: [{ url: 'https://cdn.example/img.png' }],
        }),
      },
      models: { list: jest.fn() },
    };
    (OpenAI as unknown as jest.Mock).mockImplementation(() => mockClient);
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404 }) as unknown as typeof fetch;

    await expect(provider.generateImage({ prompt: 'a hat' }, mockApiKey)).rejects.toThrow('HTTP 404');
  });
});
