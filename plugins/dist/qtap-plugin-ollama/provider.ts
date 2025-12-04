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
    logger.debug('Ollama streamMessage called', {
      context: 'OllamaProvider.streamMessage',
      model: params.model,
      baseUrl: this.baseUrl,
      messageCount: params.messages.length,
      temperature: params.temperature,
      maxTokens: params.maxTokens,
      topP: params.topP,
    });

    const attachmentResults = this.collectAttachmentFailures(params);

    // Strip attachments from messages
    const messages = params.messages.map(m => ({
      role: m.role,
      content: m.content,
    }));

    // Log message details for debugging
    logger.debug('Ollama request messages', {
      context: 'OllamaProvider.streamMessage',
      messages: messages.map((m, i) => ({
        index: i,
        role: m.role,
        contentLength: m.content.length,
        contentPreview: m.content.substring(0, 100) + (m.content.length > 100 ? '...' : ''),
      })),
    });

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

    logger.debug('Ollama request body', {
      context: 'OllamaProvider.streamMessage',
      model: requestBody.model,
      messageCount: requestBody.messages.length,
      options: requestBody.options,
    });

    // Add tools if provided
    if (params.tools && params.tools.length > 0) {
      logger.debug('Adding tools to stream request', { context: 'OllamaProvider.streamMessage', toolCount: params.tools.length });
      requestBody.tools = params.tools;
    }

    try {
      logger.debug('Sending request to Ollama', {
        context: 'OllamaProvider.streamMessage',
        url: `${this.baseUrl}/api/chat`,
      });

      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      logger.debug('Ollama response received', {
        context: 'OllamaProvider.streamMessage',
        status: response.status,
        ok: response.ok,
        headers: Object.fromEntries(response.headers.entries()),
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
      let totalContent = '';
      let toolCalls: any[] = [];
      let lastModel = params.model;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            logger.debug('Stream reader done', {
              context: 'OllamaProvider.streamMessage',
              chunkCount,
              totalContentLength: totalContent.length,
              toolCallCount: toolCalls.length,
            });
            break;
          }

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n').filter(Boolean);

          logger.debug('Processing stream chunk', {
            context: 'OllamaProvider.streamMessage',
            chunkLength: chunk.length,
            lineCount: lines.length,
            rawChunkPreview: chunk.substring(0, 200),
          });

          for (const line of lines) {
            try {
              const data = JSON.parse(line);

              // Log parsed data structure
              logger.debug('Parsed Ollama stream data', {
                context: 'OllamaProvider.streamMessage',
                hasMessage: !!data.message,
                messageContent: data.message?.content?.substring(0, 50),
                hasToolCalls: !!data.message?.tool_calls,
                toolCallCount: data.message?.tool_calls?.length,
                done: data.done,
                model: data.model,
              });

              // Track model name for raw response
              if (data.model) {
                lastModel = data.model;
              }

              // Capture tool calls from the message
              if (data.message?.tool_calls && Array.isArray(data.message.tool_calls)) {
                logger.debug('Captured tool calls from Ollama response', {
                  context: 'OllamaProvider.streamMessage',
                  toolCalls: data.message.tool_calls.map((tc: any) => ({
                    id: tc.id,
                    name: tc.function?.name,
                  })),
                });
                toolCalls = [...toolCalls, ...data.message.tool_calls];
              }

              if (data.message?.content) {
                chunkCount++;
                totalContent += data.message.content;
                yield {
                  content: data.message.content,
                  done: false,
                };
              } else if (data.message && !data.message.content && !data.done && !data.message.tool_calls) {
                // Log cases where message exists but has no content and no tool calls
                logger.debug('Ollama message without content or tool calls', {
                  context: 'OllamaProvider.streamMessage',
                  message: data.message,
                  done: data.done,
                });
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
                  hasToolCalls: toolCalls.length > 0,
                  toolCallCount: toolCalls.length,
                });

                // Build rawResponse object in OpenAI format for tool detection
                // This allows the tool-executor to parse tool calls
                const rawResponse: any = {
                  model: lastModel,
                  message: {
                    role: 'assistant',
                    content: totalContent,
                  },
                };

                // Include tool_calls in the response if present
                // Normalize Ollama format to OpenAI format for parseOpenAIToolCalls compatibility
                if (toolCalls.length > 0) {
                  // Convert Ollama tool call format to OpenAI format
                  // Ollama: { id, function: { name, arguments: object } }
                  // OpenAI: { id, type: 'function', function: { name, arguments: string } }
                  const normalizedToolCalls = toolCalls.map((tc: any) => ({
                    id: tc.id,
                    type: 'function',
                    function: {
                      name: tc.function?.name,
                      // Arguments may already be an object (Ollama) or string (OpenAI)
                      arguments: typeof tc.function?.arguments === 'string'
                        ? tc.function.arguments
                        : JSON.stringify(tc.function?.arguments || {}),
                    },
                  }));

                  // Put tool_calls at top level for parseOpenAIToolCalls to find
                  rawResponse.tool_calls = normalizedToolCalls;

                  logger.debug('Including normalized tool calls in rawResponse', {
                    context: 'OllamaProvider.streamMessage',
                    originalFormat: toolCalls.map((tc: any) => ({
                      id: tc.id,
                      name: tc.function?.name,
                      argsType: typeof tc.function?.arguments,
                    })),
                    normalizedFormat: normalizedToolCalls.map((tc: any) => ({
                      id: tc.id,
                      type: tc.type,
                      name: tc.function?.name,
                    })),
                  });
                }

                yield {
                  content: '',
                  done: true,
                  usage: {
                    promptTokens: totalPromptTokens,
                    completionTokens: totalCompletionTokens,
                    totalTokens: totalPromptTokens + totalCompletionTokens,
                  },
                  attachmentResults,
                  rawResponse,
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
