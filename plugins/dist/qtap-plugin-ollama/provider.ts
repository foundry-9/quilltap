/**
 * Ollama Provider Implementation for Quilltap Plugin
 *
 * Provides chat completion functionality using Ollama's local API
 * Supports any Ollama-compatible models running on a local or remote server
 */

import type { TextProvider, LLMParams, LLMResponse, StreamChunk } from './types';
import { buildRequestAbortSignal, collapseLeadingSystemMessages, createPluginLogger, getQuilltapUserAgent, resolveRequestTimeoutMs } from '@quilltap/plugin-utils';
import { ThinkTagStreamParser, extractThinkBlocks } from './think-parser';
import {
  applyOllamaProfileParameters,
  resolveProfileTimeoutMs,
  resolveThinkSetting,
} from './profile-options';

const logger = createPluginLogger('qtap-plugin-ollama');

/**
 * Whether an Ollama error body is complaining about the `think` request
 * parameter — e.g. `"<model> does not support thinking"` on models whose
 * template Ollama can't drive either way, or an effort level on a server too
 * old to know them. The caller retries once without the parameter so such
 * models keep working with the default profile.
 */
function isThinkRejection(errorText: string): boolean {
  return /think/i.test(errorText);
}

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
    const mappedMessages = params.messages
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

    // LOAD-BEARING: Ollama hands the array to the *model's own* chat template,
    // and the Qwen family — plus several Llama- and Gemma-derived templates —
    // `raise_exception` on any system message after index 0. Quilltap's context
    // builder deliberately emits up to three leading system blocks so its cache
    // breakpoints survive, which meant the opening greeting worked and every
    // turn after it died with a 500 (Bug 82). Fold the run here, where the
    // endpoint's constraint is known, rather than in the context assembly,
    // where it would cost every hosted provider its cache prefix.
    const messages = collapseLeadingSystemMessages(mappedMessages);

    const enableThinking = resolveThinkSetting(params);
    const requestBody: any = {
      model: params.model,
      messages,
      stream: false,
      // Ollama's native thinking switch (0.9+; older servers ignore unknown
      // fields). When off, thinking-capable models answer directly; when on,
      // Ollama returns the reasoning separately as `message.thinking`. Newer
      // servers also accept an effort level in place of the boolean.
      think: enableThinking,
      options: {
        temperature: params.temperature ?? 0.7,
        num_predict: params.maxTokens ?? 4096,
        top_p: params.topP ?? 1,
        stop: params.stop,
      },
    };
    // Everything else the profile may set — the sampler options (including
    // `num_ctx` from the profile's Max Context) and top-level `keep_alive`.
    applyOllamaProfileParameters(requestBody, params);

    // Add tools if provided
    if (params.tools && params.tools.length > 0) {
      requestBody.tools = params.tools;
    }

    try {
      const doFetch = () =>
        fetch(`${this.baseUrl}/api/chat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': getQuilltapUserAgent(),
          },
          body: JSON.stringify(requestBody),
          // Non-streaming: the whole exchange is one JSON blob, so bounding the
          // entire request is right. A local endpoint that stops answering — a
          // model still loading, a crashed runner — fails instead of hanging.
          signal: buildRequestAbortSignal(params, resolveProfileTimeoutMs(params)),
        });

      let response = await doFetch();
      if (!response.ok) {
        let errorText = await response.text();
        if ('think' in requestBody && isThinkRejection(errorText)) {
          // Some models refuse the think parameter outright (e.g. ones that
          // cannot disable thinking). Retry once without it rather than
          // failing the whole call.
          logger.warn('Ollama rejected the think parameter; retrying without it', {
            context: 'OllamaProvider.sendMessage',
            model: params.model,
            enableThinking,
            error: errorText,
          });
          delete requestBody.think;
          response = await doFetch();
          if (!response.ok) errorText = await response.text();
        }
        if (!response.ok) {
          logger.error('Ollama API error response', { context: 'OllamaProvider.sendMessage', status: response.status, error: errorText });
          throw new Error(`Ollama API error: ${response.status} ${errorText}`);
        }
      }

      const data = await response.json();
      // Reasoning may arrive on the dedicated `thinking` field (Ollama parsed
      // the template) or as inline `<think>` blocks in the content (it did
      // not). Route both into reasoningContent and keep the message clean.
      const rawContent = typeof data.message?.content === 'string' ? data.message.content : '';
      const { content, reasoning: inlineReasoning } = extractThinkBlocks(rawContent);
      const nativeThinking = typeof data.message?.thinking === 'string' ? data.message.thinking : '';
      const reasoningContent = nativeThinking + inlineReasoning;
      if (reasoningContent) {
        logger.debug('Ollama response carried reasoning', {
          context: 'OllamaProvider.sendMessage',
          model: params.model,
          enableThinking,
          nativeChars: nativeThinking.length,
          inlineChars: inlineReasoning.length,
        });
      }
      return {
        content,
        finishReason: data.done ? 'stop' : 'length',
        usage: {
          promptTokens: data.prompt_eval_count ?? 0,
          completionTokens: data.eval_count ?? 0,
          totalTokens: (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0),
        },
        raw: data,
        attachmentResults,
        ...(reasoningContent ? { reasoningContent } : {}),
      };
    } catch (error) {
      logger.error('Ollama sendMessage failed', { context: 'OllamaProvider.sendMessage', baseUrl: this.baseUrl }, error instanceof Error ? error : undefined);
      throw error;
    }
  }

  async *streamMessage(params: LLMParams, apiKey: string): AsyncGenerator<StreamChunk> {
    const attachmentResults = this.collectAttachmentFailures(params);

    // Map messages to Ollama/OpenAI Chat Completions format, including tool messages
    const mappedMessages = params.messages
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

    // LOAD-BEARING: Ollama hands the array to the *model's own* chat template,
    // and the Qwen family — plus several Llama- and Gemma-derived templates —
    // `raise_exception` on any system message after index 0. Quilltap's context
    // builder deliberately emits up to three leading system blocks so its cache
    // breakpoints survive, which meant the opening greeting worked and every
    // turn after it died with a 500 (Bug 82). Fold the run here, where the
    // endpoint's constraint is known, rather than in the context assembly,
    // where it would cost every hosted provider its cache prefix.
    const messages = collapseLeadingSystemMessages(mappedMessages);

    const enableThinking = resolveThinkSetting(params);
    // Log message details for debugging
    const requestBody: any = {
      model: params.model,
      messages,
      stream: true,
      // Ollama's native thinking switch (0.9+; older servers ignore unknown
      // fields). When off, thinking-capable models answer directly; when on,
      // Ollama streams reasoning deltas as `message.thinking`. Newer servers
      // also accept an effort level in place of the boolean.
      think: enableThinking,
      options: {
        temperature: params.temperature ?? 0.7,
        num_predict: params.maxTokens ?? 4096,
        top_p: params.topP ?? 1,
        stop: params.stop,
      },
    };
    // Everything else the profile may set — see applyOllamaProfileParameters.
    applyOllamaProfileParameters(requestBody, params);
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
      //
      // Model load and prompt eval both land inside this window, which is why
      // the budget is the profile's to set: a large model on a long context can
      // sit silent for minutes before the first token without being stuck.
      const openStream = async (): Promise<Response> => {
        const controller = new AbortController();
        const firstByteTimer = setTimeout(
          () => controller.abort(),
          resolveRequestTimeoutMs(params, resolveProfileTimeoutMs(params))
        );
        try {
          return await fetch(`${this.baseUrl}/api/chat`, {
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
      };
      let response = await openStream();
      if (!response.ok) {
        let errorText = await response.text();
        if ('think' in requestBody && isThinkRejection(errorText)) {
          // Some models refuse the think parameter outright (e.g. ones that
          // cannot disable thinking). Retry once without it rather than
          // failing the whole call.
          logger.warn('Ollama rejected the think parameter; retrying without it', {
            context: 'OllamaProvider.streamMessage',
            model: params.model,
            enableThinking,
            error: errorText,
          });
          delete requestBody.think;
          response = await openStream();
          if (!response.ok) errorText = await response.text();
        }
        if (!response.ok) {
          logger.error('Ollama streaming API error', { context: 'OllamaProvider.streamMessage', status: response.status, error: errorText });
          throw new Error(`Ollama API error: ${response.status} ${errorText}`);
        }
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
      // Reasoning can arrive on the dedicated `message.thinking` channel
      // (Ollama parsed the template) or as inline `<think>` blocks in the
      // content stream (it did not). Both accumulate here; the host expects
      // reasoningContent CUMULATIVELY — the full thinking-so-far each time.
      const thinkParser = new ThinkTagStreamParser();
      let reasoningSoFar = '';
      let inlineReasoningSeen = 0;
      // Carries the trailing partial line between reads. Ollama streams NDJSON;
      // a JSON object can straddle two network reads, so we hold the incomplete
      // tail here until its terminating newline arrives instead of splitting
      // each read in isolation (which silently dropped the straddling object).
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          // Append this read — or flush the decoder's own buffered bytes on the
          // final read — then split on newlines. Mid-stream the trailing
          // fragment (after the last newline) is carried forward in `buffer`;
          // on the final read everything left is a complete line to flush.
          buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
          let lines: string[];
          if (done) {
            lines = buffer.split('\n');
            buffer = '';
          } else {
            lines = buffer.split('\n');
            buffer = lines.pop() ?? '';
          }
          for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine) continue;
            try {
              const data = JSON.parse(trimmedLine);

              // Log parsed data structure
              // Track model name for raw response
              if (data.model) {
                lastModel = data.model;
              }

              // Capture tool calls from the message
              if (data.message?.tool_calls && Array.isArray(data.message.tool_calls)) {
                toolCalls = [...toolCalls, ...data.message.tool_calls];
              }

              let reasoningGrew = false;
              if (typeof data.message?.thinking === 'string' && data.message.thinking) {
                reasoningSoFar += data.message.thinking;
                reasoningGrew = true;
              }

              if (data.message?.content) {
                const visible = thinkParser.push(data.message.content);
                if (thinkParser.reasoning.length > inlineReasoningSeen) {
                  reasoningSoFar += thinkParser.reasoning.slice(inlineReasoningSeen);
                  inlineReasoningSeen = thinkParser.reasoning.length;
                  reasoningGrew = true;
                }
                if (visible) {
                  chunkCount++;
                  totalContent += visible;
                  yield {
                    content: visible,
                    done: false,
                    ...(reasoningGrew ? { reasoningContent: reasoningSoFar } : {}),
                  };
                  reasoningGrew = false;
                }
              } else if (data.message && !data.message.content && !data.done && !data.message.tool_calls) {
                // Log cases where message exists but has no content and no tool calls
              }

              if (reasoningGrew) {
                yield {
                  content: '',
                  done: false,
                  reasoningContent: reasoningSoFar,
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
                // Release anything the think parser held back (a trailing
                // partial tag, or an unterminated think block's reasoning).
                const tail = thinkParser.flush();
                if (thinkParser.reasoning.length > inlineReasoningSeen) {
                  reasoningSoFar += thinkParser.reasoning.slice(inlineReasoningSeen);
                  inlineReasoningSeen = thinkParser.reasoning.length;
                }
                if (tail) {
                  chunkCount++;
                  totalContent += tail;
                  yield { content: tail, done: false };
                }
                if (reasoningSoFar) {
                  logger.debug('Ollama stream carried reasoning', {
                    context: 'OllamaProvider.streamMessage',
                    model: lastModel,
                    enableThinking,
                    reasoningChars: reasoningSoFar.length,
                    inlineChars: inlineReasoningSeen,
                  });
                }

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
                  ...(reasoningSoFar ? { reasoningContent: reasoningSoFar } : {}),
                };
              }
            } catch (e) {
              // A line that won't parse. At end-of-stream it's the final
              // buffered tail — a partial or empty trailing fragment is normal,
              // so log at debug. Mid-stream (now that reads are buffered) it's a
              // genuinely malformed line, which stays at warn.
              if (done) {
                logger.debug('Discarding unparseable Ollama stream tail', {
                  context: 'OllamaProvider.streamMessage',
                  provider: 'ollama',
                  line: trimmedLine.substring(0, 100),
                  error: e instanceof Error ? e.message : String(e),
                });
              } else {
                logger.warn('Failed to parse Ollama stream line', {
                  context: 'OllamaProvider.streamMessage',
                  provider: 'ollama',
                  line: trimmedLine.substring(0, 100),
                  error: e instanceof Error ? e.message : String(e),
                });
              }
            }
          }
          if (done) break;
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
