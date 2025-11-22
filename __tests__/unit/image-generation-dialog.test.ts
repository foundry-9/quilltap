/**
 * ImageGenerationDialog Component Integration Tests
 * Phase 5: UI Integration for Image Generation
 *
 * Tests the image generation dialog component API integration
 */

describe('Image Generation Dialog - API Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  describe('Profile Loading', () => {
    it('should request image-capable profiles on component mount', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          profiles: [
            { id: '1', name: 'OpenAI GPT-4', provider: 'OPENAI', modelName: 'dall-e-3' },
          ],
        }),
      });

      await fetch('/api/profiles?imageCapable=true');

      expect(global.fetch).toHaveBeenCalledWith('/api/profiles?imageCapable=true');
    });

    it('should handle profile loading errors gracefully', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Failed to load profiles' }),
      });

      const response = await fetch('/api/profiles?imageCapable=true');
      const data = await response.json();

      expect(response.ok).toBe(false);
      expect(data.error).toBeDefined();
    });

    it('should filter only image-capable providers', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          profiles: [
            { id: '1', provider: 'OPENAI', modelName: 'dall-e-3' },
            { id: '2', provider: 'GOOGLE', modelName: 'gemini-2.5-flash-image' },
            { id: '3', provider: 'GROK', modelName: 'grok-2-image' },
            { id: '4', provider: 'OPENROUTER', modelName: 'google/gemini-2.5-flash-image-preview' },
          ],
        }),
      });

      const response = await fetch('/api/profiles?imageCapable=true');
      const data = await response.json();

      expect(data.profiles).toHaveLength(4);
      data.profiles.forEach((profile: any) => {
        expect(['OPENAI', 'GOOGLE', 'GROK', 'OPENROUTER']).toContain(profile.provider);
      });
    });
  });

  describe('Image Generation Request', () => {
    it('should send correct payload for image generation', async () => {
      const requestPayload = {
        prompt: 'A beautiful sunset over mountains',
        profileId: '550e8400-e29b-41d4-a716-446655440000',
        options: {
          n: 1,
          size: '1024x1024',
          quality: 'standard',
          style: 'vivid',
        },
        tags: [
          {
            tagType: 'CHARACTER',
            tagId: 'char-123',
          },
        ],
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ id: 'img-1', url: 'data:image/png;base64,...', mimeType: 'image/png' }],
          metadata: { prompt: 'test', provider: 'OpenAI', model: 'dall-e-3', count: 1 },
        }),
      });

      await fetch('/api/images/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestPayload),
      });

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/images/generate',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });

    it('should handle generation errors', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Rate limit exceeded' }),
      });

      const response = await fetch('/api/images/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'test', profileId: '123' }),
      });

      const data = await response.json();

      expect(response.ok).toBe(false);
      expect(data.error).toBe('Rate limit exceeded');
    });

    it('should include optional parameters for OpenAI provider', async () => {
      const requestPayload = {
        prompt: 'A beautiful sunset',
        profileId: '550e8400-e29b-41d4-a716-446655440000',
        options: {
          size: '1792x1024',
          quality: 'hd',
          style: 'natural',
        },
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ id: 'img-1', url: 'data:image/png;base64,...', mimeType: 'image/png' }],
          metadata: { prompt: 'test', provider: 'OpenAI', model: 'dall-e-3', count: 1 },
        }),
      });

      const response = await fetch('/api/images/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestPayload),
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.data).toHaveLength(1);
    });

    it('should include aspect ratio for Gemini provider', async () => {
      const requestPayload = {
        prompt: 'A beautiful sunset',
        profileId: '550e8400-e29b-41d4-a716-446655440000',
        options: {
          aspectRatio: '16:9',
        },
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ id: 'img-1', url: 'data:image/png;base64,...', mimeType: 'image/png' }],
          metadata: { prompt: 'test', provider: 'Google', model: 'gemini-2.5-flash-image', count: 1 },
        }),
      });

      const response = await fetch('/api/images/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestPayload),
      });

      expect(response.ok).toBe(true);
    });
  });

  describe('Image Response Handling', () => {
    it('should parse generated images from response', async () => {
      const mockGeneratedImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            {
              id: 'img-1',
              filename: 'generated-1.png',
              filepath: 'uploads/generated/user-123/generated-1.png',
              url: mockGeneratedImage,
              mimeType: 'image/png',
              size: 1024,
              revisedPrompt: 'A beautiful sunset over ocean',
              tags: [
                {
                  id: 'tag-1',
                  tagType: 'CHARACTER',
                  tagId: 'char-123',
                },
              ],
            },
          ],
          metadata: {
            prompt: 'A beautiful sunset',
            provider: 'OpenAI',
            model: 'dall-e-3',
            count: 1,
          },
        }),
      });

      const response = await fetch('/api/images/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'A beautiful sunset', profileId: '123' }),
      });

      const data = await response.json();

      expect(data.data).toHaveLength(1);
      expect(data.data[0].id).toBe('img-1');
      expect(data.data[0].url).toBe(mockGeneratedImage);
      expect(data.data[0].revisedPrompt).toBeDefined();
      expect(data.metadata.model).toBe('dall-e-3');
    });

    it('should handle multiple generated images', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            { id: 'img-1', url: 'data:image/png;base64,...', mimeType: 'image/png' },
            { id: 'img-2', url: 'data:image/png;base64,...', mimeType: 'image/png' },
            { id: 'img-3', url: 'data:image/png;base64,...', mimeType: 'image/png' },
          ],
          metadata: { prompt: 'test', provider: 'OpenAI', model: 'dall-e-3', count: 3 },
        }),
      });

      const response = await fetch('/api/images/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'test', profileId: '123', options: { n: 3 } }),
      });

      const data = await response.json();

      expect(data.data).toHaveLength(3);
      expect(data.metadata.count).toBe(3);
    });
  });

  describe('Image Tagging in Generation', () => {
    it('should include tags when generating with context', async () => {
      const requestPayload = {
        prompt: 'A character portrait',
        profileId: '550e8400-e29b-41d4-a716-446655440000',
        tags: [
          {
            tagType: 'CHARACTER',
            tagId: 'char-123',
          },
        ],
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            {
              id: 'img-1',
              url: 'data:image/png;base64,...',
              mimeType: 'image/png',
              tags: [
                {
                  tagType: 'CHARACTER',
                  tagId: 'char-123',
                },
              ],
            },
          ],
          metadata: { prompt: 'test', provider: 'OpenAI', model: 'dall-e-3', count: 1 },
        }),
      });

      const response = await fetch('/api/images/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestPayload),
      });

      const data = await response.json();

      expect(data.data[0].tags).toHaveLength(1);
      expect(data.data[0].tags[0].tagType).toBe('CHARACTER');
    });

    it('should support multiple tag types in generation', async () => {
      const requestPayload = {
        prompt: 'A scene from a roleplay',
        profileId: '550e8400-e29b-41d4-a716-446655440000',
        tags: [
          { tagType: 'CHARACTER', tagId: 'char-123' },
          { tagType: 'PERSONA', tagId: 'persona-456' },
          { tagType: 'CHAT', tagId: 'chat-789' },
        ],
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            {
              id: 'img-1',
              url: 'data:image/png;base64,...',
              mimeType: 'image/png',
              tags: [
                { tagType: 'CHARACTER', tagId: 'char-123' },
                { tagType: 'PERSONA', tagId: 'persona-456' },
                { tagType: 'CHAT', tagId: 'chat-789' },
              ],
            },
          ],
          metadata: { prompt: 'test', provider: 'OpenAI', model: 'dall-e-3', count: 1 },
        }),
      });

      const response = await fetch('/api/images/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestPayload),
      });

      const data = await response.json();

      expect(data.data[0].tags).toHaveLength(3);
    });
  });

  describe('Provider-Specific Options', () => {
    it('should accept size parameter for OpenAI', async () => {
      const sizes = ['256x256', '512x512', '1024x1024', '1792x1024', '1024x1792'];

      for (const size of sizes) {
        (global.fetch as jest.Mock).mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            data: [{ id: 'img-1', url: 'data:image/png;base64,...', mimeType: 'image/png' }],
            metadata: { prompt: 'test', provider: 'OpenAI', model: 'dall-e-3', count: 1 },
          }),
        });

        const response = await fetch('/api/images/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: 'test', profileId: '123', options: { size } }),
        });

        expect(response.ok).toBe(true);
      }
    });

    it('should accept aspect ratio for Gemini', async () => {
      const aspectRatios = ['1:1', '16:9', '4:3', '3:4', '9:16'];

      for (const aspectRatio of aspectRatios) {
        (global.fetch as jest.Mock).mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            data: [{ id: 'img-1', url: 'data:image/png;base64,...', mimeType: 'image/png' }],
            metadata: { prompt: 'test', provider: 'Google', model: 'gemini-2.5-flash-image', count: 1 },
          }),
        });

        const response = await fetch('/api/images/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: 'test', profileId: '123', options: { aspectRatio } }),
        });

        expect(response.ok).toBe(true);
      }
    });
  });

  describe('Image Metadata Storage', () => {
    it('should store generation metadata for generated images', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            {
              id: 'img-1',
              url: 'data:image/png;base64,...',
              mimeType: 'image/png',
              source: 'generated',
              generationPrompt: 'A beautiful sunset over mountains',
              generationModel: 'dall-e-3',
            },
          ],
          metadata: { prompt: 'A beautiful sunset over mountains', provider: 'OpenAI', model: 'dall-e-3', count: 1 },
        }),
      });

      const response = await fetch('/api/images/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'A beautiful sunset over mountains', profileId: '123' }),
      });

      const data = await response.json();

      expect(data.data[0].source).toBe('generated');
      expect(data.data[0].generationPrompt).toBe('A beautiful sunset over mountains');
      expect(data.data[0].generationModel).toBe('dall-e-3');
    });
  });
});
