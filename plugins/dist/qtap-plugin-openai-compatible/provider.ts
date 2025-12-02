/**
 * OpenAI-Compatible Provider Implementation for Quilltap Plugin
 *
 * Provides chat completion functionality using OpenAI-compatible APIs
 * (e.g., LM Studio, vLLM, Text Generation Web UI, etc.)
 * Note: File support varies by implementation
 */

import OpenAI from 'openai';
import type { LLMProvider, LLMParams, LLMResponse, StreamChunk, ImageGenParams, ImageGenResponse } from './types';
import { logger } from '../../../lib/logger';

export class OpenAICompatibleProvider implements LLMProvider {
  readonly supportsFileAttachments = false; // Varies by implementation, conservative default
  readonly supportedMimeTypes: string[] = [];
  readonly supportsImageGeneration = false;
  readonly supportsWebSearch = false;

  constructor(private baseUrl: string) {
    logger.debug('OpenAI-compatible provider instantiated', { context: 'OpenAICompatibleProvider.constructor', baseUrl });
  }

  // Helper to collect attachment failures
  private collectAttachmentFailures(params: LLMParams): { sent: string[]; failed: { id: string; error: string }[] } {
    const failed: { id: string; error: string }[] = [];
    for (const msg of params.messages) {
      if (msg.attachments) {
        for (const attachment of msg.attachments) {
          failed.push({
            id: attachment.id,
            error: 'OpenAI-compatible provider file attachment support varies by implementation (not yet implemented)',
          });
        }
      }
    }
    return { sent: [], failed };
  }

  async sendMessage(params: LLMParams, apiKey: string): Promise<LLMResponse> {
    logger.debug('OpenAI-compatible sendMessage called', {
      context: 'OpenAICompatibleProvider.sendMessage',
      model: params.model,
      baseUrl: this.baseUrl,
    });

    const attachmentResults = this.collectAttachmentFailures(params);

    const client = new OpenAI({
      apiKey: apiKey || 'not-needed', // Some compatible APIs don't require keys
      baseURL: this.baseUrl,
    });

    // Strip attachments from messages
    const messages = params.messages.map(m => ({
      role: m.role,
      content: m.content,
    }));

    try {
      const response = await client.chat.completions.create({
        model: params.model,
        messages,
        temperature: params.temperature ?? 0.7,
        max_tokens: params.maxTokens ?? 1000,
        top_p: params.topP ?? 1,
        stop: params.stop,
      });

      const choice = response.choices[0];

      logger.debug('Received OpenAI-compatible response', {
        context: 'OpenAICompatibleProvider.sendMessage',
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
    } catch (error) {
      logger.error(
        'OpenAI-compatible API error in sendMessage',
        { context: 'OpenAICompatibleProvider.sendMessage', baseUrl: this.baseUrl },
        error instanceof Error ? error : undefined
      );
      throw error;
    }
  }

  async *streamMessage(params: LLMParams, apiKey: string): AsyncGenerator<StreamChunk> {
    logger.debug('OpenAI-compatible streamMessage called', {
      context: 'OpenAICompatibleProvider.streamMessage',
      model: params.model,
      baseUrl: this.baseUrl,
    });

    const attachmentResults = this.collectAttachmentFailures(params);

    const client = new OpenAI({
      apiKey: apiKey || 'not-needed',
      baseURL: this.baseUrl,
    });

    // Strip attachments from messages
    const messages = params.messages.map(m => ({
      role: m.role,
      content: m.content,
    }));

    try {
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
            context: 'OpenAICompatibleProvider.streamMessage',
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
    } catch (error) {
      logger.error(
        'OpenAI-compatible API error in streamMessage',
        { context: 'OpenAICompatibleProvider.streamMessage', baseUrl: this.baseUrl },
        error instanceof Error ? error : undefined
      );
      throw error;
    }
  }

  async validateApiKey(apiKey: string): Promise<boolean> {
    try {
      logger.debug('Validating OpenAI-compatible API connection', {
        context: 'OpenAICompatibleProvider.validateApiKey',
        baseUrl: this.baseUrl,
      });

      const client = new OpenAI({
        apiKey: apiKey || 'not-needed',
        baseURL: this.baseUrl,
      });
      await client.models.list();

      logger.debug('OpenAI-compatible API validation successful', {
        context: 'OpenAICompatibleProvider.validateApiKey',
      });
      return true;
    } catch (error) {
      logger.error(
        'OpenAI-compatible API validation failed',
        { context: 'OpenAICompatibleProvider.validateApiKey', baseUrl: this.baseUrl },
        error instanceof Error ? error : undefined
      );
      return false;
    }
  }

  async getAvailableModels(apiKey: string): Promise<string[]> {
    try {
      logger.debug('Fetching OpenAI-compatible models', {
        context: 'OpenAICompatibleProvider.getAvailableModels',
        baseUrl: this.baseUrl,
      });

      const client = new OpenAI({
        apiKey: apiKey || 'not-needed',
        baseURL: this.baseUrl,
      });
      const models = await client.models.list();
      const modelList = models.data.map(m => m.id).sort();

      logger.debug('Retrieved OpenAI-compatible models', {
        context: 'OpenAICompatibleProvider.getAvailableModels',
        modelCount: modelList.length,
      });

      return modelList;
    } catch (error) {
      logger.error(
        'Failed to fetch OpenAI-compatible models',
        { context: 'OpenAICompatibleProvider.getAvailableModels', baseUrl: this.baseUrl },
        error instanceof Error ? error : undefined
      );
      return [];
    }
  }

  async generateImage(params: ImageGenParams, apiKey: string): Promise<ImageGenResponse> {
    throw new Error('OpenAI-compatible image generation support varies by implementation (not yet implemented)');
  }
}
