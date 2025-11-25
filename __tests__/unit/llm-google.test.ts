import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { GoogleProvider } from '@/lib/llm/google';
import { LLMParams } from '@/lib/llm/base';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Mock the @google/generative-ai library
jest.mock('@google/generative-ai');

describe('GoogleProvider', () => {
  let provider: GoogleProvider;
  let mockGenerativeModel: any;
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockGenerativeModel = {
      generateContent: jest.fn(),
      generateContentStream: jest.fn(),
      countTokens: jest.fn(),
    };

    const mockGetGenerativeModel = jest.fn().mockReturnValue(mockGenerativeModel);

    (GoogleGenerativeAI as jest.Mock).mockImplementation(() => ({
      getGenerativeModel: mockGetGenerativeModel,
    }));

    provider = new GoogleProvider();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  describe('sendMessage', () => {
    const mockParams: LLMParams = {
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Hello!' },
      ],
      model: 'gemini-pro',
    };

    it('should send a message and return formatted response', async () => {
        const mockResponse = {
            text: () => 'Hello! How can I help you today?',
            candidates: [
              {
                finishReason: 'STOP',
              },
            ],
            usageMetadata: {
              promptTokenCount: 20,
              candidatesTokenCount: 10,
              totalTokenCount: 30,
            },
          };

      mockGenerativeModel.generateContent.mockResolvedValue(mockResponse);

      const result = await provider.sendMessage(mockParams, 'test-api-key');

      expect(GoogleGenerativeAI).toHaveBeenCalledWith('test-api-key');
      expect(mockGenerativeModel.generateContent).toHaveBeenCalled();
      expect(result.content).toBe('Hello! How can I help you today?');
      expect(result.finishReason).toBe('STOP');
      expect(result.usage).toEqual({
        promptTokens: 20,
        completionTokens: 10,
        totalTokens: 30,
      });
    });
  });

  describe('streamMessage', () => {
    const mockParams: LLMParams = {
      messages: [{ role: 'user', content: 'Hello!' }],
      model: 'gemini-pro',
    };

    it('should stream message chunks and final usage', async () => {
      const mockStream = [
        { text: () => 'Hello' },
        { text: () => ' there' },
        { text: () => '!' },
      ];

      const asyncIterable = {
        [Symbol.asyncIterator]: async function* () {
          for (const chunk of mockStream) {
            yield chunk;
          }
        },
      };

      mockGenerativeModel.generateContentStream.mockResolvedValue({ stream: asyncIterable, response: Promise.resolve({
        usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 5,
            totalTokenCount: 15,
        }
      }) });

      const chunks: any[] = [];
      for await (const chunk of provider.streamMessage(mockParams, 'test-api-key')) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual([
        { content: 'Hello', done: false },
        { content: ' there', done: false },
        { content: '!', done: false },
        {
          content: '',
          done: true,
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          attachmentResults: { sent: [], failed: [] },
          rawResponse: {
            usageMetadata: {
              promptTokenCount: 10,
              candidatesTokenCount: 5,
              totalTokenCount: 15,
            },
          },
        },
      ]);
    });
  });

  describe('validateApiKey', () => {
    it('should return true for valid API key', async () => {
      mockGenerativeModel.generateContent.mockResolvedValue({ text: () => 'test' });

      const result = await provider.validateApiKey('valid-api-key');

      expect(result).toBe(true);
      expect(GoogleGenerativeAI).toHaveBeenCalledWith('valid-api-key');
      expect(mockGenerativeModel.generateContent).toHaveBeenCalledWith('test');
    });

    it('should return false for invalid API key', async () => {
      mockGenerativeModel.generateContent.mockRejectedValue(new Error('Invalid API key'));

      const result = await provider.validateApiKey('invalid-api-key');

      expect(result).toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Google API key validation failed:',
        expect.any(Error)
      );
    });
  });

  describe('getAvailableModels', () => {
    it('should return a hardcoded list of models', async () => {
      const models = await provider.getAvailableModels('test-api-key');
      expect(models).toEqual([
        'gemini-2.5-flash-image',
        'gemini-3-pro-image-preview',
        'imagen-4',
        'imagen-4-fast',
        'gemini-2.5-flash',
        'gemini-pro-vision',
      ]);
    });
  });
});
