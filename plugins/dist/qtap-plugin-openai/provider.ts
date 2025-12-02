/**
 * OpenAI Provider Implementation for Quilltap Plugin
 *
 * Provides chat completion functionality using OpenAI's API
 * Supports GPT models with multimodal capabilities (text + images)
 */

import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import type { LLMProvider, LLMParams, LLMResponse, StreamChunk, LLMMessage, ImageGenParams, ImageGenResponse } from './types';
import { logger } from '../../../lib/logger';

// OpenAI supports images in vision-capable models
const OPENAI_SUPPORTED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
];

type OpenAIMessageContent = string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'low' | 'high' } }>;

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: OpenAIMessageContent;
}

export class OpenAIProvider implements LLMProvider {
  readonly supportsFileAttachments = true;
  readonly supportedMimeTypes = OPENAI_SUPPORTED_MIME_TYPES;
  readonly supportsImageGeneration = true;
  readonly supportsWebSearch = true;

  private formatMessagesWithAttachments(
    messages: LLMMessage[]
  ): { messages: OpenAIMessage[]; attachmentResults: { sent: string[]; failed: { id: string; error: string }[] } } {
    const sent: string[] = [];
    const failed: { id: string; error: string }[] = [];

    const formattedMessages: OpenAIMessage[] = messages.map((msg) => {
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

      // Add image attachments
      for (const attachment of msg.attachments) {
        if (!this.supportedMimeTypes.includes(attachment.mimeType)) {
          failed.push({
            id: attachment.id,
            error: `Unsupported file type: ${attachment.mimeType}. OpenAI supports: ${this.supportedMimeTypes.join(', ')}`,
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

        content.push({
          type: 'image_url',
          image_url: {
            url: `data:${attachment.mimeType};base64,${attachment.data}`,
            detail: 'auto',
          },
        });
        sent.push(attachment.id);
      }

      return {
        role: msg.role,
        content: content.length > 0 ? content : msg.content,
      };
    });

    return { messages: formattedMessages, attachmentResults: { sent, failed } };
  }

  async sendMessage(params: LLMParams, apiKey: string): Promise<LLMResponse> {
    logger.debug('OpenAI sendMessage called', { context: 'OpenAIProvider.sendMessage', model: params.model });

    const client = new OpenAI({
      apiKey,
      dangerouslyAllowBrowser: process.env.NODE_ENV === 'test',
    });

    const { messages, attachmentResults } = this.formatMessagesWithAttachments(params.messages);

    const requestParams: any = {
      model: params.model,
      messages: messages as ChatCompletionMessageParam[],
      max_completion_tokens: params.maxTokens ?? 1000,
      top_p: params.topP ?? 1,
      stop: params.stop,
    };

    // Only include temperature if explicitly provided - some models don't support custom values
    if (params.temperature !== undefined) {
      requestParams.temperature = params.temperature;
    }

    // Add tools if provided
    if (params.tools && params.tools.length > 0) {
      logger.debug('Adding tools to request', { context: 'OpenAIProvider.sendMessage', toolCount: params.tools.length });
      requestParams.tools = params.tools;
      // Explicitly enable tool use with "auto" - let the model decide when to use tools
      requestParams.tool_choice = 'auto';
    }

    // Add native web search if enabled
    // Requires gpt-4o-search-preview or gpt-4o-mini-search-preview models
    if (params.webSearchEnabled) {
      logger.debug('Web search enabled', { context: 'OpenAIProvider.sendMessage' });
      requestParams.web_search_options = {};
    }

    const response = await client.chat.completions.create(requestParams);

    const choice = response.choices[0];

    logger.debug('Received OpenAI response', {
      context: 'OpenAIProvider.sendMessage',
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
    logger.debug('OpenAI streamMessage called', { context: 'OpenAIProvider.streamMessage', model: params.model });

    const client = new OpenAI({
      apiKey,
      dangerouslyAllowBrowser: process.env.NODE_ENV === 'test',
    });

    const { messages, attachmentResults } = this.formatMessagesWithAttachments(params.messages);

    const requestParams: any = {
      model: params.model,
      messages: messages as ChatCompletionMessageParam[],
      max_completion_tokens: params.maxTokens ?? 1000,
      top_p: params.topP ?? 1,
      stream: true,
      stream_options: { include_usage: true },
    };

    // Only include temperature if explicitly provided - some models don't support custom values
    if (params.temperature !== undefined) {
      requestParams.temperature = params.temperature;
    }

    // Add tools if provided
    if (params.tools && params.tools.length > 0) {
      logger.debug('Adding tools to stream request', { context: 'OpenAIProvider.streamMessage', toolCount: params.tools.length });
      requestParams.tools = params.tools;
      // Explicitly enable tool use with "auto" - let the model decide when to use tools
      requestParams.tool_choice = 'auto';
    }

    // Add native web search if enabled
    if (params.webSearchEnabled) {
      logger.debug('Web search enabled for stream', { context: 'OpenAIProvider.streamMessage' });
      requestParams.web_search_options = {};
    }

    const stream = (await client.chat.completions.create(requestParams)) as unknown as AsyncIterable<any>;

    let fullMessage: any = {
      choices: [
        {
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [],
          },
          finish_reason: null,
        },
      ],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    };
    let chunkCount = 0;
    let finishReasonSeen = false;
    let usageSeen = false;

    for await (const chunk of stream) {
      chunkCount++;
      const delta = chunk.choices?.[0]?.delta;
      const content = delta?.content;
      const finishReason = chunk.choices[0]?.finish_reason;
      const hasUsage = chunk.usage;

      // Merge delta content
      if (content) {
        fullMessage.choices[0].message.content += content;
      }

      // Merge delta tool calls
      if (delta?.tool_calls) {
        for (const toolCall of delta.tool_calls) {
          // Tool calls have an index property that tells us which one to update
          const index = toolCall.index ?? 0;
          if (!fullMessage.choices[0].message.tool_calls[index]) {
            fullMessage.choices[0].message.tool_calls[index] = {
              id: '',
              type: 'function',
              function: { name: '', arguments: '' },
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

      // For tool calls: OpenAI sends finish_reason='tool_calls' in one chunk, usage in the next
      // We yield immediately when we see tool_calls finish reason
      if (finishReasonSeen && finishReason === 'tool_calls' && !usageSeen) {
        logger.debug('Tool calls detected in stream', { context: 'OpenAIProvider.streamMessage', toolCallCount: fullMessage.choices[0].message.tool_calls.length });
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
          context: 'OpenAIProvider.streamMessage',
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
      logger.debug('Validating OpenAI API key', { context: 'OpenAIProvider.validateApiKey' });
      const client = new OpenAI({ apiKey });
      await client.models.list();
      logger.debug('OpenAI API key validation successful', { context: 'OpenAIProvider.validateApiKey' });
      return true;
    } catch (error) {
      logger.error('OpenAI API key validation failed', { context: 'OpenAIProvider.validateApiKey' }, error instanceof Error ? error : undefined);
      return false;
    }
  }

  async getAvailableModels(apiKey: string): Promise<string[]> {
    try {
      logger.debug('Fetching OpenAI models', { context: 'OpenAIProvider.getAvailableModels' });
      const client = new OpenAI({ apiKey });
      const models = await client.models.list();
      const gptModels = models.data
        .filter((m) => m.id.includes('gpt'))
        .map((m) => m.id)
        .sort();
      logger.debug('Retrieved OpenAI models', { context: 'OpenAIProvider.getAvailableModels', modelCount: gptModels.length });
      return gptModels;
    } catch (error) {
      logger.error('Failed to fetch OpenAI models', { context: 'OpenAIProvider.getAvailableModels' }, error instanceof Error ? error : undefined);
      return [];
    }
  }

  async generateImage(params: ImageGenParams, apiKey: string): Promise<ImageGenResponse> {
    logger.debug('Generating image with OpenAI', { context: 'OpenAIProvider.generateImage', model: params.model, prompt: params.prompt.substring(0, 100) });

    const client = new OpenAI({ apiKey });

    const response = await client.images.generate({
      model: params.model ?? 'dall-e-3',
      prompt: params.prompt,
      n: params.n ?? 1,
      size: (params.size ?? '1024x1024') as '256x256' | '512x512' | '1024x1024' | '1792x1024' | '1024x1792',
      quality: params.quality ?? 'standard',
      style: params.style ?? 'vivid',
      response_format: 'b64_json',
    });

    const images = await Promise.all(
      (response.data || []).map(async (image) => {
        if (!image.b64_json) {
          throw new Error('No base64 image data in response');
        }

        return {
          data: image.b64_json,
          mimeType: 'image/png',
          revisedPrompt: image.revised_prompt,
        };
      })
    );

    logger.debug('Image generation completed', { context: 'OpenAIProvider.generateImage', imageCount: images.length });

    return {
      images,
      raw: response,
    };
  }
}
