/**
 * Ollama Provider Implementation for Quilltap Plugin
 *
 * Provides chat completion functionality using Ollama's local API
 * Supports any Ollama-compatible models running on a local or remote server
 */

import type { LLMProvider, LLMParams, LLMResponse, StreamChunk, ImageGenParams, ImageGenResponse } from './types';
import { logger } from '../../../lib/logger';

export class OllamaProvider implements LLMProvider {
  readonly supportsFileAttachments = false;
  readonly supportedMimeTypes: string[] = [];
  readonly supportsImageGeneration = false;
  readonly supportsWebSearch = false;

  constructor(private baseUrl: string) {
    logger.debug('Initializing Ollama provider', { context: 'OllamaProvider.constructor', baseUrl });
  }

  // Helper to collect attachment failures for unsupported provider
  private collectAttachmentFailures(params: LLMParams): { sent: string[]; failed: { id: string; error: string }[] } {
    const failed: { id: string; error: string }[] = [];
    for (const msg of params.messages) {
      if (msg.attachments) {
        for (const attachment of msg.attachments) {
          failed.push({
            id: attachment.id,
            error: 'Ollama file attachment support not yet implemented (requires multimodal model detection)',
          });
        }
      }
    }
    return { sent: [], failed };
  }

  async sendMessage(params: LLMParams, apiKey: string): Promise<LLMResponse> {
    logger.debug('Ollama sendMessage called', { context: 'OllamaProvider.sendMessage', model: params.model, baseUrl: this.baseUrl });

    const attachmentResults = this.collectAttachmentFailures(params);

    // Strip attachments from messages
    const messages = params.messages.map(m => ({
      role: m.role,
      content: m.content,
    }));

    const requestBody: any = {
      model: params.model,
      messages,
      stream: false,
      options: {
        temperature: params.temperature ?? 0.7,
        num_predict: params.maxTokens ?? 1000,
        top_p: params.topP ?? 1,
        stop: params.stop,
      },
    };

    // Add tools if provided
    if (params.tools && params.tools.length > 0) {
      logger.debug('Adding tools to request', { context: 'OllamaProvider.sendMessage', toolCount: params.tools.length });
      requestBody.tools = params.tools;
    }

    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('Ollama API error response', { context: 'OllamaProvider.sendMessage', status: response.status, error: errorText });
        throw new Error(`Ollama API error: ${response.status} ${errorText}`);
      }

      const data = await response.json();

      logger.debug('Received Ollama response', {
        context: 'OllamaProvider.sendMessage',
        model: params.model,
        done: data.done,
        promptTokens: data.prompt_eval_count,
        completionTokens: data.eval_count,
      });

      return {
        content: data.message.content,
        finishReason: data.done ? 'stop' : 'length',
        usage: {
          promptTokens: data.prompt_eval_count ?? 0,
          completionTokens: data.eval_count ?? 0,
          totalTokens: (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0),
        },
        raw: data,
        attachmentResults,
      };
    } catch (error) {
      logger.error('Ollama sendMessage failed', { context: 'OllamaProvider.sendMessage', baseUrl: this.baseUrl }, error instanceof Error ? error : undefined);
      throw error;
    }
  }

  async *streamMessage(params: LLMParams, apiKey: string): AsyncGenerator<StreamChunk> {
    logger.debug('Ollama streamMessage called', { context: 'OllamaProvider.streamMessage', model: params.model, baseUrl: this.baseUrl });

    const attachmentResults = this.collectAttachmentFailures(params);

    // Strip attachments from messages
    const messages = params.messages.map(m => ({
      role: m.role,
      content: m.content,
    }));

    const requestBody: any = {
      model: params.model,
      messages,
      stream: true,
      options: {
        temperature: params.temperature ?? 0.7,
        num_predict: params.maxTokens ?? 1000,
        top_p: params.topP ?? 1,
      },
    };

    // Add tools if provided
    if (params.tools && params.tools.length > 0) {
      logger.debug('Adding tools to stream request', { context: 'OllamaProvider.streamMessage', toolCount: params.tools.length });
      requestBody.tools = params.tools;
    }

    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('Ollama streaming API error', { context: 'OllamaProvider.streamMessage', status: response.status, error: errorText });
        throw new Error(`Ollama API error: ${response.status} ${errorText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Failed to get response reader');
      }

      const decoder = new TextDecoder();
      let totalPromptTokens = 0;
      let totalCompletionTokens = 0;
      let chunkCount = 0;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n').filter(Boolean);

          for (const line of lines) {
            try {
              const data = JSON.parse(line);

              if (data.message?.content) {
                chunkCount++;
                yield {
                  content: data.message.content,
                  done: false,
                };
              }

              // Track token usage
              if (data.prompt_eval_count) {
                totalPromptTokens = data.prompt_eval_count;
              }
              if (data.eval_count) {
                totalCompletionTokens = data.eval_count;
              }

              // Final chunk
              if (data.done) {
                logger.debug('Stream completed', {
                  context: 'OllamaProvider.streamMessage',
                  model: params.model,
                  chunkCount,
                  promptTokens: totalPromptTokens,
                  completionTokens: totalCompletionTokens,
                });

                yield {
                  content: '',
                  done: true,
                  usage: {
                    promptTokens: totalPromptTokens,
                    completionTokens: totalCompletionTokens,
                    totalTokens: totalPromptTokens + totalCompletionTokens,
                  },
                  attachmentResults,
                };
              }
            } catch (e) {
              // Skip invalid JSON lines
              logger.warn('Failed to parse Ollama stream line', {
                context: 'OllamaProvider.streamMessage',
                provider: 'ollama',
                line: line.substring(0, 100),
                error: e instanceof Error ? e.message : String(e),
              });
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    } catch (error) {
      logger.error('Ollama streamMessage failed', { context: 'OllamaProvider.streamMessage', baseUrl: this.baseUrl }, error instanceof Error ? error : undefined);
      throw error;
    }
  }

  async validateApiKey(apiKey: string): Promise<boolean> {
    logger.debug('Validating Ollama server', { context: 'OllamaProvider.validateApiKey', baseUrl: this.baseUrl });
    // Ollama doesn't use API keys, just check if server is reachable
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        method: 'GET',
      });
      const isValid = response.ok;
      logger.debug('Ollama server validation result', { context: 'OllamaProvider.validateApiKey', isValid, baseUrl: this.baseUrl });
      return isValid;
    } catch (error) {
      logger.error('Ollama server validation failed', { context: 'OllamaProvider.validateApiKey', baseUrl: this.baseUrl }, error instanceof Error ? error : undefined);
      return false;
    }
  }

  async getAvailableModels(apiKey: string): Promise<string[]> {
    logger.debug('Fetching available Ollama models', { context: 'OllamaProvider.getAvailableModels', baseUrl: this.baseUrl });
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        method: 'GET',
      });

      if (!response.ok) {
        logger.error('Failed to fetch Ollama models', { context: 'OllamaProvider.getAvailableModels', status: response.status });
        throw new Error(`Failed to fetch models: ${response.status}`);
      }

      const data = await response.json();
      const models = data.models?.map((m: any) => m.name) ?? [];
      logger.debug('Retrieved Ollama models', { context: 'OllamaProvider.getAvailableModels', modelCount: models.length });
      return models;
    } catch (error) {
      logger.error('Failed to fetch Ollama models', { context: 'OllamaProvider.getAvailableModels', baseUrl: this.baseUrl }, error instanceof Error ? error : undefined);
      return [];
    }
  }

  async generateImage(params: ImageGenParams, apiKey: string): Promise<ImageGenResponse> {
    logger.warn('Image generation not supported', { context: 'OllamaProvider.generateImage' });
    throw new Error('Ollama does not support image generation. Use a multimodal model for image analysis.');
  }
}
