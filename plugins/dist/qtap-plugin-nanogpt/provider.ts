/**
 * NanoGPT Provider Implementation for Quilltap Plugin
 *
 * Extends the shared OpenAICompatibleProvider base class from
 * @quilltap/plugin-utils to talk to NanoGPT's OpenAI-compatible
 * Chat Completions API at https://nano-gpt.com/api/v1.
 *
 * NanoGPT is a router: one endpoint fronts hundreds of upstream models
 * (OpenAI, Anthropic, Google, open-weight hosts). The base class already
 * handles message normalization, the OpenAI SDK client, validateApiKey, and
 * getAvailableModels. We override sendMessage / streamMessage to:
 *
 *   - Forward function tools and tool_choice
 *   - Forward response_format (JSON mode / JSON Schema)
 *   - Surface reasoning deltas from the many reasoning models NanoGPT
 *     routes — the main endpoint carries them in `delta.reasoning` /
 *     `message.reasoning`, with `reasoning_content` kept as a fallback for
 *     upstreams that speak the legacy dialect — display-only
 *   - Suppress the gateway's occasional verbatim echo of the answer down
 *     the reasoning channel (routing-dependent; would repeat the reply
 *     under a thinking fold)
 *   - Accumulate streamed tool-call fragments
 */

import OpenAI from 'openai';
import {
  OpenAICompatibleProvider,
  type OpenAICompatibleProviderConfig,
} from '@quilltap/plugin-utils';
import type {
  LLMParams,
  LLMResponse,
  StreamChunk,
  LLMMessage,
} from './types';

const NANOGPT_BASE_URL = 'https://nano-gpt.com/api/v1';

// NanoGPT-specific profile parameters forwarded verbatim into the request
// body. Allow-listed so a misconfigured profile cannot override model,
// messages, stream, etc. NanoGPT passes unknown-to-it parameters through to
// the upstream provider, so the standard OpenAI sampling extras plus
// `reasoning_effort` cover the useful surface.
const NANOGPT_PROFILE_PARAM_ALLOWLIST = [
  'frequency_penalty',
  'presence_penalty',
  'logprobs',
  'top_logprobs',
  'reasoning_effort',
] as const;

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

export class NanoGPTProvider extends OpenAICompatibleProvider {
  constructor(config?: Partial<OpenAICompatibleProviderConfig>) {
    super({
      baseUrl: config?.baseUrl ?? NANOGPT_BASE_URL,
      providerName: config?.providerName ?? 'NanoGPT',
      requireApiKey: config?.requireApiKey ?? true,
      attachmentErrorMessage:
        config?.attachmentErrorMessage ??
        'NanoGPT chat requests are text-only in Quilltap. Send text-only messages.',
    });
  }

  /**
   * Map LLMMessages to OpenAI chat-completion format, preserving assistant
   * tool_calls and tool-result messages so multi-turn tool loops survive a
   * round-trip through NanoGPT. Reasoning content is never sent back —
   * thinking display is display-only in Quilltap.
   */
  private formatMessages(messages: LLMMessage[]): ChatMessage[] {
    const out: ChatMessage[] = [];
    for (const msg of messages) {
      if (msg.role === 'tool') {
        if (!msg.toolCallId) continue;
        out.push({
          role: 'tool',
          tool_call_id: msg.toolCallId,
          content: msg.content,
        });
        continue;
      }

      if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
        out.push({
          role: 'assistant',
          content: msg.content || null,
          tool_calls: msg.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.function.name,
              arguments: tc.function.arguments,
            },
          })),
        });
        continue;
      }

      if (msg.role === 'system') {
        out.push({ role: 'system', content: msg.content });
        continue;
      }

      if (msg.role === 'assistant') {
        out.push({ role: 'assistant', content: msg.content });
        continue;
      }

      // user — attachments are dropped and surfaced through
      // attachmentResults on the response.
      out.push({ role: 'user', content: msg.content });
    }
    return out;
  }

  protected override readonly profileParamAllowlist = NANOGPT_PROFILE_PARAM_ALLOWLIST;

  private buildBody(params: LLMParams, stream: boolean): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: params.model,
      messages: this.formatMessages(params.messages),
      temperature: params.temperature ?? 0.7,
      max_tokens: params.maxTokens ?? 4096,
      top_p: params.topP ?? 1,
      stream,
    };

    if (stream) body.stream_options = { include_usage: true };
    if (params.stop) body.stop = params.stop;

    if (params.tools && params.tools.length > 0) {
      body.tools = params.tools;
      body.tool_choice = params.toolChoice ?? 'auto';
    }

    if (params.responseFormat) {
      if (params.responseFormat.type === 'json_object') {
        body.response_format = { type: 'json_object' };
      } else if (params.responseFormat.type === 'json_schema' && params.responseFormat.jsonSchema) {
        body.response_format = {
          type: 'json_schema',
          json_schema: params.responseFormat.jsonSchema,
        };
      }
    }

    if (typeof params.cacheKey === 'string' && params.cacheKey.length > 0) {
      body.user = params.cacheKey;
    }

    this.applyProfileParams(body, params);
    return body;
  }

  override async sendMessage(params: LLMParams, apiKey: string): Promise<LLMResponse> {
    this.validateApiKeyRequirement(apiKey);
    const attachmentResults = this.collectAttachmentFailures(params);

    const client = this.createClient(apiKey);
    const body = this.buildBody(params, false);

    try {
      const response = (await client.chat.completions.create(
        body as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
        this.buildRequestOptions(params)
      )) as OpenAI.Chat.Completions.ChatCompletion;

      const choice = response.choices[0];
      const msg = choice.message;
      // NanoGPT's /api/v1 endpoint returns reasoning in `message.reasoning`;
      // `reasoning_content` is its legacy dialect, kept as a fallback. The
      // gateway sometimes (routing-dependent) echoes the answer itself down
      // the reasoning field — drop the echo, keep real thinking.
      const msgWithReasoning = msg as { reasoning?: string; reasoning_content?: string };
      const rawReasoning = msgWithReasoning.reasoning ?? msgWithReasoning.reasoning_content;
      const reasoningContent = rawReasoning === (msg.content ?? '') ? undefined : rawReasoning;
      const toolCalls = this.normalizeToolCalls(msg.tool_calls);

      return {
        content: msg.content ?? '',
        finishReason: choice.finish_reason,
        usage: {
          promptTokens: response.usage?.prompt_tokens ?? 0,
          completionTokens: response.usage?.completion_tokens ?? 0,
          totalTokens: response.usage?.total_tokens ?? 0,
        },
        raw: response,
        attachmentResults,
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
        ...(reasoningContent ? { reasoningContent } : {}),
      };
    } catch (error) {
      this.logger.error(
        'NanoGPT API error in sendMessage',
        { context: 'NanoGPTProvider.sendMessage', baseUrl: this.baseUrl },
        error instanceof Error ? error : undefined
      );
      throw error;
    }
  }

  override async *streamMessage(params: LLMParams, apiKey: string): AsyncGenerator<StreamChunk> {
    this.validateApiKeyRequirement(apiKey);
    const attachmentResults = this.collectAttachmentFailures(params);

    const client = this.createClient(apiKey);
    const body = this.buildBody(params, true);

    try {
      const stream = (await client.chat.completions.create(
        body as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming,
        this.buildRequestOptions(params)
      )) as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;

      const toolCallAccumulator = new Map<
        number,
        { id: string; name: string; arguments: string }
      >();
      let finishReason: string | null = null;
      let usage: OpenAI.CompletionUsage | null = null;
      let reasoningContent = '';
      let contentSoFar = '';
      // Reasoning held back while it still replays the prose verbatim from
      // its start. NanoGPT's gateway sometimes (routing-dependent) echoes the
      // whole answer down the reasoning channel after the content stream
      // ends; committing that echo would repeat the reply under a thinking
      // fold. A held run that diverges from the prose is real thinking and
      // commits in full; one still mirroring it at stream end is discarded.
      let pendingReasoning = '';

      for await (const chunk of stream) {
        const choice = chunk.choices[0];
        if (!choice) {
          if (chunk.usage) usage = chunk.usage;
          continue;
        }
        const delta = choice.delta;

        if (delta?.content) {
          contentSoFar += delta.content;
          yield { content: delta.content, done: false };
        }

        // `delta.reasoning` on the main endpoint; `reasoning_content` is the
        // legacy dialect some routed upstreams still speak.
        const deltaWithReasoning = delta as { reasoning?: string; reasoning_content?: string } | undefined;
        const deltaReasoning = deltaWithReasoning?.reasoning ?? deltaWithReasoning?.reasoning_content;
        if (deltaReasoning) {
          pendingReasoning += deltaReasoning;
          const looksLikeProseEcho =
            reasoningContent === '' &&
            contentSoFar.length > 0 &&
            contentSoFar.startsWith(pendingReasoning);
          if (!looksLikeProseEcho) {
            reasoningContent += pendingReasoning;
            pendingReasoning = '';
            yield { content: '', done: false, reasoningContent };
          }
        }

        if (delta?.tool_calls) {
          for (const tcDelta of delta.tool_calls) {
            const idx = tcDelta.index;
            const existing = toolCallAccumulator.get(idx) ?? { id: '', name: '', arguments: '' };
            if (tcDelta.id) existing.id = tcDelta.id;
            if (tcDelta.function?.name) existing.name = tcDelta.function.name;
            if (tcDelta.function?.arguments) existing.arguments += tcDelta.function.arguments;
            toolCallAccumulator.set(idx, existing);
          }
        }

        if (choice.finish_reason) finishReason = choice.finish_reason;
        if (chunk.usage) usage = chunk.usage;
      }

      // A run still mirroring the prose at stream end is the gateway echo —
      // discard it. (Anything that diverged was already committed above.)
      if (pendingReasoning && !contentSoFar.startsWith(pendingReasoning)) {
        reasoningContent += pendingReasoning;
      }
      pendingReasoning = '';

      const toolCalls = Array.from(toolCallAccumulator.values()).map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.name, arguments: tc.arguments },
      }));

      const rawResponse = {
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: '',
              tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
              ...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
            },
            finish_reason: finishReason,
          },
        ],
        usage,
      };

      yield {
        content: '',
        done: true,
        usage: {
          promptTokens: usage?.prompt_tokens ?? 0,
          completionTokens: usage?.completion_tokens ?? 0,
          totalTokens: usage?.total_tokens ?? 0,
        },
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        attachmentResults,
        rawResponse,
        ...(reasoningContent ? { reasoningContent } : {}),
      };
    } catch (error) {
      this.logger.error(
        'NanoGPT API error in streamMessage',
        { context: 'NanoGPTProvider.streamMessage', baseUrl: this.baseUrl },
        error instanceof Error ? error : undefined
      );
      throw error;
    }
  }
}
