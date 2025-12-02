/**
 * Grok Provider Implementation for Quilltap Plugin
 *
 * Provides chat completion functionality using Grok's OpenAI-compatible API
 * Supports Grok models with multimodal capabilities (text + images)
 * Grok API endpoint: https://api.x.ai/v1
 */

import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import type { LLMProvider, LLMParams, LLMResponse, StreamChunk, LLMMessage, ImageGenParams, ImageGenResponse } from './types';
import { logger } from '../../../lib/logger';

// Grok supports images (text/PDF handled via fallback system)
const GROK_SUPPORTED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
];

type GrokMessageContent = string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'low' | 'high' } }>;

interface GrokMessage {
  role: 'system' | 'user' | 'assistant';
  content: GrokMessageContent;
}

export class GrokProvider implements LLMProvider {
  private readonly baseUrl = 'https://api.x.ai/v1';
  readonly supportsFileAttachments = true;
  readonly supportedMimeTypes = GROK_SUPPORTED_MIME_TYPES;
  readonly supportsImageGeneration = true;
  readonly supportsWebSearch = true;

  private formatMessagesWithAttachments(
    messages: LLMMessage[]
  ): { messages: GrokMessage[]; attachmentResults: { sent: string[]; failed: { id: string; error: string }[] } } {
    const sent: string[] = [];
    const failed: { id: string; error: string }[] = [];

    const formattedMessages: GrokMessage[] = messages.map((msg) => {
      // If no attachments, return simple string content
      if (!msg.attachments || msg.attachments.length === 0) {
        return {
          role: msg.role,
          content: msg.content,
        };
      }

      // Build multimodal content array
      const content: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'low' | 'high' } }> = [];

      // Add text content first
      if (msg.content) {
        content.push({ type: 'text', text: msg.content });
      }

      // Add file attachments (Grok uses OpenAI-compatible format for images)
      for (const attachment of msg.attachments) {
        if (!this.supportedMimeTypes.includes(attachment.mimeType)) {
          failed.push({
            id: attachment.id,
            error: `Unsupported file type: ${attachment.mimeType}. Grok supports: ${this.supportedMimeTypes.join(', ')}`,
          });
          continue;
        }

        if (!attachment.data) {
          failed.push({
            id: attachment.id,
            error: 'File data not loaded',
          });
          continue;
        }

        // For images, use image_url format
        if (attachment.mimeType.startsWith('image/')) {
          content.push({
            type: 'image_url',
            image_url: {
              url: `data:${attachment.mimeType};base64,${attachment.data}`,
              detail: 'auto',
            },
          });
          sent.push(attachment.id);
        } else {
          // For documents (PDF, text, etc.), embed as text content
          // Note: Grok's Files API may require different handling for documents
          // For now, we'll include text-based files as text content
          if (attachment.mimeType.startsWith('text/')) {
            try {
              const textContent = Buffer.from(attachment.data, 'base64').toString('utf-8');
              content.push({
                type: 'text',
                text: `[File: ${attachment.filename}]\n${textContent}`,
              });
              sent.push(attachment.id);
            } catch {
              failed.push({
                id: attachment.id,
                error: 'Failed to decode text file',
              });
            }
          } else {
            // PDFs and other binary documents - mark as failed for now
            // Full support would require using Grok's Files API
            failed.push({
              id: attachment.id,
              error: 'PDF and binary document support requires Grok Files API (not yet implemented)',
            });
          }
        }
      }

      return {
        role: msg.role,
        content: content.length > 0 ? content : msg.content,
      };
    });

    return { messages: formattedMessages, attachmentResults: { sent, failed } };
  }

  async sendMessage(params: LLMParams, apiKey: string): Promise<LLMResponse> {
    logger.debug('Grok sendMessage called', { context: 'GrokProvider.sendMessage', model: params.model });

    if (!apiKey) {
      throw new Error('Grok provider requires an API key');
    }

    const client = new OpenAI({
      apiKey,
      baseURL: this.baseUrl,
    });

    const { messages, attachmentResults } = this.formatMessagesWithAttachments(params.messages);

    const requestParams: any = {
      model: params.model,
      messages: messages as ChatCompletionMessageParam[],
      temperature: params.temperature ?? 0.7,
      max_tokens: params.maxTokens ?? 1000,
      top_p: params.topP ?? 1,
      stop: params.stop,
    };

    // Add tools if provided
    if (params.tools && params.tools.length > 0) {
      logger.debug('Adding tools to request', { context: 'GrokProvider.sendMessage', toolCount: params.tools.length });
      requestParams.tools = params.tools;
      // Explicitly enable tool use with "auto" - let the model decide when to use tools
      requestParams.tool_choice = 'auto';
    }

    // Add native live search if enabled
    // Uses Grok's Live Search API (searches web, X/Twitter, news)
    if (params.webSearchEnabled) {
      logger.debug('Web search enabled', { context: 'GrokProvider.sendMessage' });
      requestParams.search_parameters = {
        mode: 'auto', // Model decides when to search
        return_citations: true,
        max_search_results: 20,
        sources: ['web', 'x', 'news'],
      };
    }

    const response = await client.chat.completions.create(requestParams);

    const choice = response.choices[0];

    logger.debug('Received Grok response', {
      context: 'GrokProvider.sendMessage',
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
    logger.debug('Grok streamMessage called', { context: 'GrokProvider.streamMessage', model: params.model });

    if (!apiKey) {
      throw new Error('Grok provider requires an API key');
    }

    const client = new OpenAI({
      apiKey,
      baseURL: this.baseUrl,
    });

    const { messages, attachmentResults } = this.formatMessagesWithAttachments(params.messages);

    const requestParams: any = {
      model: params.model,
      messages: messages as ChatCompletionMessageParam[],
      temperature: params.temperature ?? 0.7,
      max_tokens: params.maxTokens ?? 1000,
      top_p: params.topP ?? 1,
      stream: true,
      stream_options: { include_usage: true },
    };

    // Add tools if provided
    if (params.tools && params.tools.length > 0) {
      logger.debug('Adding tools to stream request', { context: 'GrokProvider.streamMessage', toolCount: params.tools.length });
      requestParams.tools = params.tools;
      // Explicitly enable tool use with "auto" - let the model decide when to use tools
      requestParams.tool_choice = 'auto';
    }

    // Add native live search if enabled
    if (params.webSearchEnabled) {
      logger.debug('Web search enabled for stream', { context: 'GrokProvider.streamMessage' });
      requestParams.search_parameters = {
        mode: 'auto',
        return_citations: true,
        max_search_results: 20,
        sources: ['web', 'x', 'news'],
      };
    }

    const stream = (await client.chat.completions.create(requestParams)) as unknown as AsyncIterable<any>;

    // Initialize fullMessage structure to accumulate response
    let fullMessage: any = {
      choices: [{
        message: {
          role: 'assistant',
          content: '',
          tool_calls: []
        },
        finish_reason: null
      }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
    };

    let chunkCount = 0;
    let finishReasonSeen = false;
    let usageSeen = false;

    for await (const chunk of stream) {
      chunkCount++;
      const delta = chunk.choices?.[0]?.delta;
      const content = delta?.content;
      const finishReason = chunk.choices?.[0]?.finish_reason;
      const hasUsage = chunk.usage;

      // Merge delta content
      if (content) {
        fullMessage.choices[0].message.content += content;
      }

      // Merge delta tool calls
      if (delta?.tool_calls) {
        for (const toolCall of delta.tool_calls) {
          const index = toolCall.index ?? 0;

          // Initialize tool call if it doesn't exist
          if (!fullMessage.choices[0].message.tool_calls[index]) {
            fullMessage.choices[0].message.tool_calls[index] = {
              id: '',
              type: 'function',
              function: { name: '', arguments: '' }
            };
          }

          // Merge the delta into the existing tool call
          if (toolCall.id) fullMessage.choices[0].message.tool_calls[index].id = toolCall.id;
          if (toolCall.function?.name) fullMessage.choices[0].message.tool_calls[index].function.name = toolCall.function.name;
          if (toolCall.function?.arguments) fullMessage.choices[0].message.tool_calls[index].function.arguments += toolCall.function.arguments;
        }
      }

      // Update finish reason
      if (finishReason) {
        fullMessage.choices[0].finish_reason = finishReason;
        finishReasonSeen = true;
      }

      // Update usage
      if (hasUsage) {
        fullMessage.usage = chunk.usage;
        usageSeen = true;
      }

      // Yield content chunks unless this is the final chunk (finish_reason + usage together)
      // Exception: for tool_calls, we yield even with finish_reason (no usage comes with tool_calls)
      const isFinalChunk = finishReasonSeen && usageSeen;
      const isToolCallsChunk = finishReasonSeen && finishReason === 'tool_calls';

      if (content && !isFinalChunk && !isToolCallsChunk) {
        yield {
          content,
          done: false,
        };
      }

      // For tool calls: Grok sends finish_reason='tool_calls' in one chunk, usage in the next
      // We yield immediately when we see tool_calls finish reason
      if (finishReasonSeen && finishReason === 'tool_calls' && !usageSeen) {
        logger.debug('Tool calls detected in stream', { context: 'GrokProvider.streamMessage', toolCallCount: fullMessage.choices[0].message.tool_calls.length });
        yield {
          content: '',
          done: true,
          usage: {
            promptTokens: fullMessage.usage?.prompt_tokens ?? 0,
            completionTokens: fullMessage.usage?.completion_tokens ?? 0,
            totalTokens: fullMessage.usage?.total_tokens ?? 0,
          },
          attachmentResults,
          rawResponse: fullMessage,
        };
        // Continue reading to drain the stream
      } else if (finishReasonSeen && usageSeen) {
        // For regular text responses, we get both finish_reason and usage
        logger.debug('Stream completed', {
          context: 'GrokProvider.streamMessage',
          finishReason,
          chunks: chunkCount,
          promptTokens: fullMessage.usage?.prompt_tokens,
          completionTokens: fullMessage.usage?.completion_tokens,
        });
        yield {
          content: '',
          done: true,
          usage: {
            promptTokens: fullMessage.usage?.prompt_tokens ?? 0,
            completionTokens: fullMessage.usage?.completion_tokens ?? 0,
            totalTokens: fullMessage.usage?.total_tokens ?? 0,
          },
          attachmentResults,
          rawResponse: fullMessage,
        };
      }
    }
  }

  async validateApiKey(apiKey: string): Promise<boolean> {
    try {
      logger.debug('Validating Grok API key', { context: 'GrokProvider.validateApiKey' });
      const client = new OpenAI({
        apiKey,
        baseURL: this.baseUrl,
      });
      await client.models.list();
      logger.debug('Grok API key validation successful', { context: 'GrokProvider.validateApiKey' });
      return true;
    } catch (error) {
      logger.error('Grok API key validation failed', { context: 'GrokProvider.validateApiKey' }, error instanceof Error ? error : undefined);
      return false;
    }
  }

  async getAvailableModels(apiKey: string): Promise<string[]> {
    try {
      logger.debug('Fetching Grok models', { context: 'GrokProvider.getAvailableModels' });
      const client = new OpenAI({
        apiKey,
        baseURL: this.baseUrl,
      });
      const models = await client.models.list();
      const grokModels = models.data
        .map((m) => m.id)
        .sort();
      logger.debug('Retrieved Grok models', { context: 'GrokProvider.getAvailableModels', modelCount: grokModels.length });
      return grokModels;
    } catch (error) {
      logger.error('Failed to fetch Grok models', { context: 'GrokProvider.getAvailableModels' }, error instanceof Error ? error : undefined);
      return [];
    }
  }

  async generateImage(params: ImageGenParams, apiKey: string): Promise<ImageGenResponse> {
    logger.debug('Generating image with Grok', { context: 'GrokProvider.generateImage', model: params.model, prompt: params.prompt.substring(0, 100) });

    if (!apiKey) {
      throw new Error('Grok provider requires an API key');
    }

    const client = new OpenAI({
      apiKey,
      baseURL: this.baseUrl,
    });

    const response = await client.images.generate({
      model: params.model ?? 'grok-2-image',
      prompt: params.prompt,
      n: params.n ?? 1,
      response_format: 'b64_json',
    });

    const images = await Promise.all(
      (response.data || []).map(async (image) => {
        if (!image.b64_json) {
          throw new Error('No base64 image data in response');
        }

        return {
          data: image.b64_json,
          mimeType: 'image/jpeg',
          revisedPrompt: image.revised_prompt,
        };
      })
    );

    logger.debug('Image generation completed', { context: 'GrokProvider.generateImage', imageCount: images.length });

    return {
      images,
      raw: response,
    };
  }
}
