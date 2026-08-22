
import { NanoGPTImageProvider } from '@/plugins/dist/qtap-plugin-nanogpt/image-provider';

// Mock OpenAI (NanoGPT's images route is OpenAI-shaped)
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

describe('NanoGPTImageProvider.getAvailableModels', () => {
  let provider: NanoGPTImageProvider;
  const mockApiKey = 'test-api-key';
  const originalFetch = global.fetch;

  beforeEach(() => {
    provider = new NanoGPTImageProvider();
    jest.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns the curated static list without an API key', async () => {
    const models = await provider.getAvailableModels();
    expect(models).toEqual(provider.supportedModels);
  });

  it('unions capability-filtered listing entries with the curated set', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        object: 'list',
        data: [
          { id: 'hidream', capabilities: { image_generation: true } },
          { id: 'seedream-v4.5', capabilities: { image_generation: true } },
          // Edit-only and upscale-only entries must not leak into the picker
          { id: 'pruna-ai/p-image/upscale', capabilities: { image_generation: false } },
          { id: 'no-capabilities-at-all' },
        ],
      }),
    }) as unknown as typeof fetch;

    const models = await provider.getAvailableModels(mockApiKey);

    expect(global.fetch).toHaveBeenCalledWith(
      'https://nano-gpt.com/api/v1/image-models',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: `Bearer ${mockApiKey}` }),
      })
    );
    // Curated flagships survive even when the listing omits them
    expect(models).toContain('flux-2-pro');
    expect(models).toContain('seedream-v4.5');
    expect(models).not.toContain('pruna-ai/p-image/upscale');
    expect(models).not.toContain('no-capabilities-at-all');
    expect(models).toEqual([...models].sort());
  });

  it('propagates transport errors so callers can label the fallback honestly', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 }) as unknown as typeof fetch;

    await expect(provider.getAvailableModels(mockApiKey)).rejects.toThrow('HTTP 500');
  });
});

describe('NanoGPTImageProvider.generateImage', () => {
  let provider: NanoGPTImageProvider;
  const mockApiKey = 'test-api-key';
  const originalFetch = global.fetch;

  beforeEach(() => {
    provider = new NanoGPTImageProvider();
    jest.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('requests b64_json and passes base64 entries through untouched', async () => {
    const generate = jest.fn().mockResolvedValue({
      data: [{ b64_json: 'aGVsbG8=' }],
    });
    (OpenAI as unknown as jest.Mock).mockImplementation(() => ({
      images: { generate },
      models: { list: jest.fn() },
    }));

    const result = await provider.generateImage({ prompt: 'a hat' }, mockApiKey);

    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'hidream', response_format: 'b64_json' })
    );
    expect(result.images[0].data).toBe('aGVsbG8=');
  });

  it('downloads URL-only responses into base64 data (Quilltap consumers read only base64)', async () => {
    (OpenAI as unknown as jest.Mock).mockImplementation(() => ({
      images: {
        generate: jest.fn().mockResolvedValue({
          data: [{ url: 'https://cdn.example/img.png' }],
        }),
      },
      models: { list: jest.fn() },
    }));

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
    (OpenAI as unknown as jest.Mock).mockImplementation(() => ({
      images: {
        generate: jest.fn().mockResolvedValue({
          data: [{ url: 'https://cdn.example/img.png' }],
        }),
      },
      models: { list: jest.fn() },
    }));
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404 }) as unknown as typeof fetch;

    await expect(provider.generateImage({ prompt: 'a hat' }, mockApiKey)).rejects.toThrow('HTTP 404');
  });
});
