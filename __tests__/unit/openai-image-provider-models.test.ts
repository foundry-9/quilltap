
import { OpenAIImageProvider } from '@/plugins/dist/qtap-plugin-openai/image-provider';

// Mock OpenAI
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

describe('OpenAIImageProvider.getAvailableModels', () => {
  let provider: OpenAIImageProvider;
  const mockApiKey = 'test-api-key';

  beforeEach(() => {
    provider = new OpenAIImageProvider();
    jest.clearAllMocks();
  });

  it('returns the curated static list without an API key', async () => {
    const models = await provider.getAvailableModels();
    expect(models).toEqual(provider.supportedModels);
  });

  it('filters /v1/models to the image-generation families with an API key', async () => {
    const mockClient = {
      images: { generate: jest.fn() },
      models: {
        list: jest.fn().mockResolvedValue({
          data: [
            { id: 'gpt-4o' },
            { id: 'dall-e-3' },
            { id: 'gpt-image-1' },
            { id: 'text-embedding-3-small' },
            { id: 'gpt-image-1-mini' },
            { id: 'whisper-1' },
          ],
        }),
      },
    };
    (OpenAI as unknown as jest.Mock).mockImplementation(() => mockClient);

    const models = await provider.getAvailableModels(mockApiKey);

    // Chat, embedding, and audio models must never leak into the image list
    expect(models).toEqual(['dall-e-3', 'gpt-image-1', 'gpt-image-1-mini']);
  });

  it('throws when the account lists no image-generation models', async () => {
    const mockClient = {
      images: { generate: jest.fn() },
      models: { list: jest.fn().mockResolvedValue({ data: [{ id: 'gpt-4o' }] }) },
    };
    (OpenAI as unknown as jest.Mock).mockImplementation(() => mockClient);

    await expect(provider.getAvailableModels(mockApiKey)).rejects.toThrow(
      'no image-generation models'
    );
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
