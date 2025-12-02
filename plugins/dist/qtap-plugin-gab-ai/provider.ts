/**
 * Gab AI Provider Implementation for Quilltap Plugin
 *
 * Gab AI is OpenAI-compatible and provides language models via api.gab.com/v1
 * Supports streaming and standard chat completion requests
 * Note: Gab AI does not currently support file attachments
 */

import OpenAI from 'openai';
import type { LLMProvider, LLMParams, LLMResponse, StreamChunk, ImageGenParams, ImageGenResponse } from './types';
import { logger } from '../../../lib/logger';

export class GabAIProvider implements LLMProvider {
  private readonly baseUrl = 'https://gab.ai/v1';
  readonly supportsFileAttachments = false;
  readonly supportedMimeTypes: string[] = [];
  readonly supportsImageGeneration = false;
  readonly supportsWebSearch = false;

  // Helper to collect attachment failures for unsupported provider
  private collectAttachmentFailures(params: LLMParams): { sent: string[]; failed: { id: string; error: string }[] } {
    logger.debug('Gab AI does not support attachments', { context: 'GabAIProvider.collectAttachmentFailures' });
    const failed: { id: string; error: string }[] = [];
    for (const msg of params.messages) {
      if (msg.attachments) {
        for (const attachment of msg.attachments) {
          failed.push({
            id: attachment.id,
            error: 'Gab AI does not support file attachments',
          });
        }
      }
    }
    return { sent: [], failed };
  }

  async sendMessage(params: LLMParams, apiKey: string): Promise<LLMResponse> {
    logger.debug('Gab AI sendMessage called', { context: 'GabAIProvider.sendMessage', model: params.model });

    if (!apiKey) {
      throw new Error('Gab AI provider requires an API key');
    }

    const attachmentResults = this.collectAttachmentFailures(params);

    const client = new OpenAI({
      apiKey,
      baseURL: this.baseUrl,
    });

    // Strip attachments from messages (Gab AI doesn't support them)
    const messages = params.messages.map(m => ({
      role: m.role,
      content: m.content,
    }));

    const response = await client.chat.completions.create({
      model: params.model,
      messages,
      temperature: params.temperature ?? 0.7,
      max_tokens: params.maxTokens ?? 1000,
      top_p: params.topP ?? 1,
      stop: params.stop,
    });

    const choice = response.choices[0];

    logger.debug('Received Gab AI response', {
      context: 'GabAIProvider.sendMessage',
      finishReason: choice.finish_reason,
      promptTokens: response.usage?.prompt_tokens,
      completionTokens: response.usage?.completion_tokens,
    });

    return {
      content: choice.message.content ?? '',
      finishReason: choice.finish_reason,
      usage: {
        promptTokens: response.usage?.prompt_tokens ?? 0,
        completionTokens: response.usage?.completion_tokens ?? 0,
        totalTokens: response.usage?.total_tokens ?? 0,
      },
      raw: response,
      attachmentResults,
    };
  }

  async *streamMessage(params: LLMParams, apiKey: string): AsyncGenerator<StreamChunk> {
    logger.debug('Gab AI streamMessage called', { context: 'GabAIProvider.streamMessage', model: params.model });

    if (!apiKey) {
      throw new Error('Gab AI provider requires an API key');
    }

    const attachmentResults = this.collectAttachmentFailures(params);

    const client = new OpenAI({
      apiKey,
      baseURL: this.baseUrl,
    });

    // Strip attachments from messages (Gab AI doesn't support them)
    const messages = params.messages.map(m => ({
      role: m.role,
      content: m.content,
    }));

    const stream = await client.chat.completions.create({
      model: params.model,
      messages,
      temperature: params.temperature ?? 0.7,
      max_tokens: params.maxTokens ?? 1000,
      top_p: params.topP ?? 1,
      stream: true,
      stream_options: { include_usage: true },
    });

    let chunkCount = 0;
    for await (const chunk of stream) {
      chunkCount++;
      const content = chunk.choices[0]?.delta?.content;
      const finishReason = chunk.choices[0]?.finish_reason;
      const hasUsage = chunk.usage;

      // Yield content unless this is the final chunk with usage info
      if (content && !(finishReason && hasUsage)) {
        yield {
          content,
          done: false,
        };
      }

      // Final chunk with usage info
      if (finishReason && hasUsage) {
        logger.debug('Stream completed', {
          context: 'GabAIProvider.streamMessage',
          finishReason,
          chunks: chunkCount,
          promptTokens: chunk.usage?.prompt_tokens,
          completionTokens: chunk.usage?.completion_tokens,
        });
        yield {
          content: '',
          done: true,
          usage: {
            promptTokens: chunk.usage?.prompt_tokens ?? 0,
            completionTokens: chunk.usage?.completion_tokens ?? 0,
            totalTokens: chunk.usage?.total_tokens ?? 0,
          },
          attachmentResults,
        };
      }
    }
  }

  async validateApiKey(apiKey: string): Promise<boolean> {
    logger.debug('Validating Gab AI API key', { context: 'GabAIProvider.validateApiKey' });

    if (!apiKey) {
      return false;
    }

    try {
      const client = new OpenAI({
        apiKey,
        baseURL: this.baseUrl,
      });
      await client.models.list();
      logger.debug('Gab AI API key validation successful', { context: 'GabAIProvider.validateApiKey' });
      return true;
    } catch (error) {
      logger.error('Gab AI API key validation failed', { context: 'GabAIProvider.validateApiKey' }, error instanceof Error ? error : undefined);
      return false;
    }
  }

  async getAvailableModels(apiKey: string): Promise<string[]> {
    logger.debug('Fetching Gab AI models', { context: 'GabAIProvider.getAvailableModels' });

    if (!apiKey) {
      logger.error('Gab AI provider requires an API key to fetch models', { context: 'GabAIProvider.getAvailableModels' });
      return [];
    }

    try {
      const client = new OpenAI({
        apiKey,
        baseURL: this.baseUrl,
      });
      const models = await client.models.list();
      const sortedModels = models.data.map(m => m.id).sort();
      logger.debug('Retrieved Gab AI models', { context: 'GabAIProvider.getAvailableModels', modelCount: sortedModels.length });
      return sortedModels;
    } catch (error) {
      logger.error('Failed to fetch Gab AI models', { context: 'GabAIProvider.getAvailableModels' }, error instanceof Error ? error : undefined);
      return [];
    }
  }

  async generateImage(params: ImageGenParams, apiKey: string): Promise<ImageGenResponse> {
    logger.error('Image generation not supported', { context: 'GabAIProvider.generateImage' });
    throw new Error('Gab AI does not support image generation.');
  }
}
