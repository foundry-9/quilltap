/**
 * Google Provider Implementation for Quilltap Plugin
 *
 * Provides chat completion functionality using Google's Generative AI API
 * Supports Gemini models with multimodal capabilities (text + images)
 */

import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import type { LLMProvider, LLMParams, LLMResponse, StreamChunk, LLMMessage, ImageGenParams, ImageGenResponse } from './types';
import { logger } from '../../../lib/logger';

// Google Gemini supports image analysis
const GOOGLE_SUPPORTED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
];

export class GoogleProvider implements LLMProvider {
  readonly supportsFileAttachments = true;
  readonly supportedMimeTypes = GOOGLE_SUPPORTED_MIME_TYPES;
  readonly supportsImageGeneration = true;
  readonly supportsWebSearch = true;

  private async formatMessagesWithAttachments(
    messages: LLMMessage[]
  ): Promise<{ messages: any[]; attachmentResults: { sent: string[]; failed: { id: string; error: string }[] } }> {
    logger.debug('Formatting messages with attachments', { context: 'GoogleProvider.formatMessagesWithAttachments', messageCount: messages.length });

    const sent: string[] = [];
    const failed: { id: string; error: string }[] = [];

    const formattedMessages: any[] = [];

    for (const msg of messages) {
      const formattedMessage: any = {
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [],
      };

      // Add text content
      if (msg.content) {
        formattedMessage.parts.push({ text: msg.content });
      }

      // Add image attachments
      if (msg.attachments && msg.attachments.length > 0) {
        for (const attachment of msg.attachments) {
          if (!this.supportedMimeTypes.includes(attachment.mimeType)) {
            logger.warn('Unsupported attachment type', {
              context: 'GoogleProvider.formatMessagesWithAttachments',
              mimeType: attachment.mimeType,
            });
            failed.push({
              id: attachment.id,
              error: `Unsupported file type: ${attachment.mimeType}. Google supports: ${this.supportedMimeTypes.join(', ')}`,
            });
            continue;
          }

          if (!attachment.data) {
            logger.warn('Attachment data not loaded', {
              context: 'GoogleProvider.formatMessagesWithAttachments',
              attachmentId: attachment.id,
            });
            failed.push({
              id: attachment.id,
              error: 'File data not loaded',
            });
            continue;
          }

          formattedMessage.parts.push({
            inlineData: {
              mimeType: attachment.mimeType,
              data: attachment.data,
            },
          });
          sent.push(attachment.id);
        }
      }

      formattedMessages.push(formattedMessage);
    }

    logger.debug('Messages formatted with attachments', {
      context: 'GoogleProvider.formatMessagesWithAttachments',
      sentCount: sent.length,
      failedCount: failed.length,
    });

    return { messages: formattedMessages, attachmentResults: { sent, failed } };
  }

  async sendMessage(params: LLMParams, apiKey: string): Promise<LLMResponse> {
    logger.debug('Google sendMessage called', { context: 'GoogleProvider.sendMessage', model: params.model });

    const client = new GoogleGenerativeAI(apiKey);
    const modelConfig: any = {
      model: params.model,
      safetySettings: [
        {
          category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_HARASSMENT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
      ],
    };

    // Build tools array
    const tools: any[] = [];

    // Add function declarations if provided
    if (params.tools && params.tools.length > 0) {
      logger.debug('Adding tools to request', { context: 'GoogleProvider.sendMessage', toolCount: params.tools.length });
      tools.push({
        functionDeclarations: params.tools.map((tool: any) => ({
          name: tool.name,
          description: tool.description,
          parameters: {
            type: 'OBJECT',
            properties: tool.parameters?.properties || {},
            required: tool.parameters?.required || [],
          },
        })),
      });
    }

    // Add Google Search grounding if web search is enabled
    // Uses googleSearch for Gemini 2.0+ models
    if (params.webSearchEnabled) {
      logger.debug('Web search enabled', { context: 'GoogleProvider.sendMessage' });
      tools.push({ googleSearch: {} });
    }

    if (tools.length > 0) {
      modelConfig.tools = tools;
    }

    const model = client.getGenerativeModel(modelConfig);

    const { messages, attachmentResults } = await this.formatMessagesWithAttachments(params.messages);

    const response = (await model.generateContent({
      contents: messages,
      generationConfig: {
        temperature: params.temperature ?? 0.7,
        maxOutputTokens: params.maxTokens ?? 1000,
        topP: params.topP ?? 1,
        stopSequences: params.stop,
      },
    })) as any;

    const text = response.text?.() ?? '';
    const finishReason = response.candidates?.[0]?.finishReason ?? 'STOP';
    const usage = response.usageMetadata;

    logger.debug('Received Google response', {
      context: 'GoogleProvider.sendMessage',
      finishReason,
      promptTokens: usage?.promptTokenCount,
      completionTokens: usage?.candidatesTokenCount,
    });

    return {
      content: text,
      finishReason,
      usage: {
        promptTokens: usage?.promptTokenCount ?? 0,
        completionTokens: usage?.candidatesTokenCount ?? 0,
        totalTokens: usage?.totalTokenCount ?? 0,
      },
      raw: response,
      attachmentResults,
    };
  }

  async *streamMessage(params: LLMParams, apiKey: string): AsyncGenerator<StreamChunk> {
    logger.debug('Google streamMessage called', { context: 'GoogleProvider.streamMessage', model: params.model });

    const client = new GoogleGenerativeAI(apiKey);
    const modelConfig: any = {
      model: params.model,
      safetySettings: [
        {
          category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_HARASSMENT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
      ],
    };

    // Build tools array
    const tools: any[] = [];

    // Add function declarations if provided
    if (params.tools && params.tools.length > 0) {
      logger.debug('Adding tools to stream request', { context: 'GoogleProvider.streamMessage', toolCount: params.tools.length });
      tools.push({
        functionDeclarations: params.tools.map((tool: any) => ({
          name: tool.name,
          description: tool.description,
          parameters: {
            type: 'OBJECT',
            properties: tool.parameters?.properties || {},
            required: tool.parameters?.required || [],
          },
        })),
      });
    }

    // Add Google Search grounding if web search is enabled
    if (params.webSearchEnabled) {
      logger.debug('Web search enabled for stream', { context: 'GoogleProvider.streamMessage' });
      tools.push({ googleSearch: {} });
    }

    if (tools.length > 0) {
      modelConfig.tools = tools;
    }

    const model = client.getGenerativeModel(modelConfig);

    const { messages, attachmentResults } = await this.formatMessagesWithAttachments(params.messages);

    const stream = await model.generateContentStream({
      contents: messages,
      generationConfig: {
        temperature: params.temperature ?? 0.7,
        maxOutputTokens: params.maxTokens ?? 1000,
        topP: params.topP ?? 1,
        stopSequences: params.stop,
      },
    });

    let chunkCount = 0;
    for await (const chunk of stream.stream) {
      chunkCount++;
      const text = (chunk as any).text?.() ?? '';
      if (text) {
        logger.debug('Received stream chunk', { context: 'GoogleProvider.streamMessage', chunkNumber: chunkCount, contentLength: text.length });
        yield {
          content: text,
          done: false,
        };
      }
    }

    // Final chunk with usage info
    const response = (await stream.response) as any;
    const usage = response.usageMetadata;

    logger.debug('Stream completed', {
      context: 'GoogleProvider.streamMessage',
      totalChunks: chunkCount,
      promptTokens: usage?.promptTokenCount,
      completionTokens: usage?.candidatesTokenCount,
    });

    yield {
      content: '',
      done: true,
      usage: {
        promptTokens: usage?.promptTokenCount ?? 0,
        completionTokens: usage?.candidatesTokenCount ?? 0,
        totalTokens: usage?.totalTokenCount ?? 0,
      },
      attachmentResults,
      rawResponse: response,
    };
  }

  async validateApiKey(apiKey: string): Promise<boolean> {
    try {
      logger.debug('Validating Google API key', { context: 'GoogleProvider.validateApiKey' });
      const client = new GoogleGenerativeAI(apiKey);
      // Try to get a simple model to validate the API key
      const model = client.getGenerativeModel({ model: 'gemini-2.5-flash' });
      await model.generateContent('test');
      logger.debug('Google API key validation successful', { context: 'GoogleProvider.validateApiKey' });
      return true;
    } catch (error) {
      logger.error('Google API key validation failed', { context: 'GoogleProvider.validateApiKey' }, error instanceof Error ? error : undefined);
      return false;
    }
  }

  async getAvailableModels(apiKey: string): Promise<string[]> {
    try {
      logger.debug('Fetching Google models', { context: 'GoogleProvider.getAvailableModels' });
      // Return known Google models that support chat
      const models = [
        'gemini-2.5-flash-image',
        'gemini-3-pro-image-preview',
        'imagen-4',
        'imagen-4-fast',
        'gemini-2.5-flash',
        'gemini-pro-vision',
      ];
      logger.debug('Retrieved Google models', { context: 'GoogleProvider.getAvailableModels', modelCount: models.length });
      return models;
    } catch (error) {
      logger.error('Failed to fetch Google models', { context: 'GoogleProvider.getAvailableModels' }, error instanceof Error ? error : undefined);
      return [];
    }
  }

  async generateImage(params: ImageGenParams, apiKey: string): Promise<ImageGenResponse> {
    logger.debug('Generating image with Google', {
      context: 'GoogleProvider.generateImage',
      model: params.model,
      promptLength: params.prompt.length,
    });

    const client = new GoogleGenerativeAI(apiKey);

    // Use the specified model or default to gemini-2.5-flash-image
    const modelName = params.model ?? 'gemini-2.5-flash-image';
    const model = client.getGenerativeModel({
      model: modelName,
      safetySettings: [
        {
          category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_HARASSMENT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
      ],
    });

    const config: any = {
      temperature: 0.7,
    };

    if (params.aspectRatio) {
      config.aspectRatio = params.aspectRatio;
    }

    const response = (await model.generateContent({
      contents: [
        {
          role: 'user',
          parts: [{ text: params.prompt }],
        },
      ],
      generationConfig: config,
    })) as any;

    const images: Array<{ data: string; mimeType: string; revisedPrompt?: string }> = [];

    // Extract images from response - check candidates array
    const candidates = response.candidates ?? [];
    for (const candidate of candidates) {
      const parts = candidate.content?.parts ?? [];
      for (const part of parts) {
        if ('inlineData' in part && part.inlineData) {
          images.push({
            data: part.inlineData.data,
            mimeType: part.inlineData.mimeType || 'image/png',
          });
        }
      }
    }

    if (images.length === 0) {
      logger.error('No images generated in response', { context: 'GoogleProvider.generateImage' });
      throw new Error('No images generated in response');
    }

    logger.debug('Image generation completed', { context: 'GoogleProvider.generateImage', imageCount: images.length });

    return {
      images,
      raw: response,
    };
  }
}
