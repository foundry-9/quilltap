/**
 * Ollama Provider Implementation for Quilltap Plugin
 *
 * Provides chat completion functionality using Ollama's local API
 * Supports any Ollama-compatible models running on a local or remote server
 */

import type { TextProvider, LLMParams, LLMResponse, StreamChunk } from './types';
import { buildRequestAbortSignal, createPluginLogger, getQuilltapUserAgent, resolveRequestTimeoutMs } from '@quilltap/plugin-utils';

const logger = createPluginLogger('qtap-plugin-ollama');

// `params.cacheKey` is ignored: Ollama runs locally and manages its own
// per-process KV cache; no remote routing or isolation hint applies.
export class OllamaProvider implements TextProvider {
  readonly supportsFileAttachments = false;
  readonly supportedMimeTypes: string[] = [];
  readonly supportsWebSearch = false;
  private baseUrl: string;

  constructor(baseUrl: string) {
    // Strip trailing slash to prevent double-slash in API paths
    this.baseUrl = baseUrl.replace(/\/+$/, '');
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
    const attachmentResults = this.collectAttachmentFailures(params);

    // Map messages to Ollama/OpenAI Chat Completions format, including tool messages
    const messages = params.messages
      .filter((m) => {
        // Skip tool messages without toolCallId (backward compat)
        if (m.role === 'tool' && !m.toolCallId) return false;
        return true;
      })
      .map((m) => {
        // Tool result messages
        if (m.role === 'tool' && m.toolCallId) {
          return {
            role: 'tool' as const,
            tool_call_id: m.toolCallId,
            content: m.content,
          };
        }
        // Assistant messages with tool calls
        if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
          return {
            role: 'assistant' as const,
            content: m.content || null,
            tool_calls: m.toolCalls.map((tc) => ({
              id: tc.id,
              type: tc.type,
              function: tc.function,
            })),
          };
        }
        // Standard messages (strip attachments)
        return {
          role: m.role,
          content: m.content,
        };
      });

    const requestBody: any = {
      model: params.model,
      messages,
      stream: false,
      options: {
        temperature: params.temperature ?? 0.7,
        num_predict: params.maxTokens ?? 4096,
        top_p: params.topP ?? 1,
        stop: params.stop,
      },
    };

    // Add tools if provided
    if (params.tools && params.tools.length > 0) {
      requestBody.tools = params.tools;
    }

    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': getQuilltapUserAgent(),
        },
        body: JSON.stringify(requestBody),
        // Non-streaming: the whole exchange is one JSON blob, so bounding the
        // entire request is right. A local endpoint that stops answering — a
        // model still loading, a crashed runner — fails instead of hanging.
        signal: buildRequestAbortSignal(params),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('Ollama API error response', { context: 'OllamaProvider.sendMessage', status: response.status, error: errorText });
        throw new Error(`Ollama API error: ${response.status} ${errorText}`);
      }

      const data = await response.json();
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
    const attachmentResults = this.collectAttachmentFailures(params);

    // Map messages to Ollama/OpenAI Chat Completions format, including tool messages
    const messages = params.messages
      .filter((m) => {
        // Skip tool messages without toolCallId (backward compat)
        if (m.role === 'tool' && !m.toolCallId) return false;
        return true;
      })
      .map((m) => {
        // Tool result messages
        if (m.role === 'tool' && m.toolCallId) {
          return {
            role: 'tool' as const,
            tool_call_id: m.toolCallId,
            content: m.content,
          };
        }
        // Assistant messages with tool calls
        if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
          return {
            role: 'assistant' as const,
            content: m.content || null,
            tool_calls: m.toolCalls.map((tc) => ({
              id: tc.id,
              type: tc.type,
              function: tc.function,
            })),
          };
        }
        // Standard messages (strip attachments)
        return {
          role: m.role,
          content: m.content,
        };
      });

    // Log message details for debugging
    const requestBody: any = {
      model: params.model,
      messages,
      stream: true,
      options: {
        temperature: params.temperature ?? 0.7,
        num_predict: params.maxTokens ?? 4096,
        top_p: params.topP ?? 1,
        stop: params.stop,
      },
    };
    // Add tools if provided
    if (params.tools && params.tools.length > 0) {
      requestBody.tools = params.tools;
    }

    try {
      // Streaming: bound how long the endpoint may take to *start* answering,
      // not how long it takes to finish. An AbortSignal covering the whole
      // exchange would cut off a long generation mid-answer, so the timer is
      // cleared once the response headers land and the body streams unbounded
      // — the same semantics the OpenAI SDK applies to its own timeout.
      const controller = new AbortController();
      const firstByteTimer = setTimeout(
        () => controller.abort(),
        resolveRequestTimeoutMs(params)
      );
      let response: Response;
      try {
        response = await fetch(`${this.baseUrl}/api/chat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': getQuilltapUserAgent(),
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(firstByteTimer);
      }
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
            break;
          }

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n').filter(Boolean);
          for (const line of lines) {
            try {
              const data = JSON.parse(line);

              // Log parsed data structure
              // Track model name for raw response
              if (data.model) {
                lastModel = data.model;
              }

              // Capture tool calls from the message
              if (data.message?.tool_calls && Array.isArray(data.message.tool_calls)) {
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
    // Ollama doesn't use API keys, just check if server is reachable
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        method: 'GET',
        headers: {
          'User-Agent': getQuilltapUserAgent(),
        },
      });
      const isValid = response.ok;
      return isValid;
    } catch (error) {
      logger.error('Ollama server validation failed', { context: 'OllamaProvider.validateApiKey', baseUrl: this.baseUrl }, error instanceof Error ? error : undefined);
      return false;
    }
  }

  async getAvailableModels(apiKey: string): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        method: 'GET',
        headers: {
          'User-Agent': getQuilltapUserAgent(),
        },
      });

      if (!response.ok) {
        logger.error('Failed to fetch Ollama models', { context: 'OllamaProvider.getAvailableModels', status: response.status });
        throw new Error(`Failed to fetch models: ${response.status}`);
      }

      const data = await response.json();
      const models = data.models?.map((m: any) => m.name) ?? [];
      return models;
    } catch (error) {
      logger.error('Failed to fetch Ollama models', { context: 'OllamaProvider.getAvailableModels', baseUrl: this.baseUrl }, error instanceof Error ? error : undefined);
      return [];
    }
  }

}
