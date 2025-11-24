
import { GrokImageProvider } from '@/lib/image-gen/grok';

// Mock global fetch
globalThis.fetch = jest.fn();

describe('GrokImageProvider', () => {
  let provider: GrokImageProvider;
  const mockApiKey = 'test-api-key';

  beforeEach(() => {
    provider = new GrokImageProvider();
    jest.clearAllMocks();
  });

  it('should request b64_json and handle successful response with b64_json', async () => {
    const mockResponse = {
      data: [
        {
          b64_json: 'base64encodedimage',
          revised_prompt: 'revised prompt',
        },
      ],
    };

    (globalThis.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue(mockResponse),
    });

    const result = await provider.generateImage(
      {
        prompt: 'test prompt',
        model: 'grok-2-image',
        size: '1024x1024',
        quality: 'standard',
        style: 'vivid',
      },
      mockApiKey
    );

    // Verify request body includes response_format: 'b64_json'
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/images/generations'),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"response_format":"b64_json"'),
      })
    );

    // Verify request body does NOT include size, quality, or style
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: expect.not.stringContaining('"size"'),
      })
    );
    
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: expect.not.stringContaining('"quality"'),
      })
    );

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: expect.not.stringContaining('"style"'),
      })
    );

    expect(result.images).toHaveLength(1);
    expect(result.images[0].data).toBe('base64encodedimage');
    expect(result.images[0].revisedPrompt).toBe('revised prompt');
  });

  it('should fallback to fetching URL if b64_json is missing', async () => {
    const mockResponse = {
      data: [
        {
          url: 'https://example.com/image.png',
          revised_prompt: 'revised prompt',
        },
      ],
    };

    const mockImageBuffer = Buffer.from('image data');
    const mockImageBase64 = mockImageBuffer.toString('base64');

    (globalThis.fetch as jest.Mock)
      .mockResolvedValueOnce({ // API response
        ok: true,
        json: jest.fn().mockResolvedValue(mockResponse),
      })
      .mockResolvedValueOnce({ // Image download response
        ok: true,
        arrayBuffer: jest.fn().mockResolvedValue(mockImageBuffer),
      });

    const result = await provider.generateImage(
      {
        prompt: 'test prompt',
        model: 'grok-2-image',
      },
      mockApiKey
    );

    expect(result.images).toHaveLength(1);
    expect(result.images[0].data).toBe(mockImageBase64);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('should throw error if both b64_json and url are missing', async () => {
    const mockResponse = {
      data: [
        {
          // No data
        },
      ],
    };

    (globalThis.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue(mockResponse),
    });

    await expect(
      provider.generateImage(
        {
          prompt: 'test prompt',
          model: 'grok-2-image',
        },
        mockApiKey
      )
    ).rejects.toThrow('Failed to retrieve image data from Grok response');
  });

  it('should throw error if API returns error', async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: jest.fn().mockResolvedValue(JSON.stringify({ message: 'Bad Request' })),
      json: jest.fn().mockResolvedValue({ message: 'Bad Request' }),
    });

    await expect(
      provider.generateImage(
        {
          prompt: 'test prompt',
          model: 'grok-2-image',
        },
        mockApiKey
      )
    ).rejects.toThrow('Bad Request');
  });
});
