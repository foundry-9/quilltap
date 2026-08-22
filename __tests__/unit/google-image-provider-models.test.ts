
import { GoogleImagenProvider } from '@/plugins/dist/qtap-plugin-google/image-provider';

describe('GoogleImagenProvider.getAvailableModels', () => {
  let provider: GoogleImagenProvider;
  const mockApiKey = 'test-api-key';
  const originalFetch = global.fetch;

  beforeEach(() => {
    provider = new GoogleImagenProvider();
    jest.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns the curated static list without an API key', async () => {
    const models = await provider.getAvailableModels();
    expect(models).toEqual(provider.supportedModels);
  });

  it('keeps only genuinely image-producing models from the paged models list', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          models: [
            { name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/imagen-4.0-generate-001', supportedGenerationMethods: ['predict'] },
            { name: 'models/veo-3.0-generate-001', supportedGenerationMethods: ['predictLongRunning'] },
          ],
          nextPageToken: 'page-2',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          models: [
            { name: 'models/gemini-2.5-flash-image', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
          ],
        }),
      });
    global.fetch = fetchMock as unknown as typeof fetch;

    const models = await provider.getAvailableModels(mockApiKey);

    // Text, embedding, and video (veo) models must never leak in
    expect(models).toEqual(['gemini-2.5-flash-image', 'imagen-4.0-generate-001']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain('pageToken=page-2');
  });

  it('throws on an HTTP error so callers can label the fallback honestly', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 403 }) as unknown as typeof fetch;

    await expect(provider.getAvailableModels(mockApiKey)).rejects.toThrow('HTTP 403');
  });

  it('throws when the list contains no image-generation models', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [{ name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent'] }],
      }),
    }) as unknown as typeof fetch;

    await expect(provider.getAvailableModels(mockApiKey)).rejects.toThrow(
      'no image-generation models'
    );
  });
});
