// Anthropic Provider Implementation
// Phase 0.7: Multi-Provider Support

import Anthropic from '@anthropic-ai/sdk'
import { LLMProvider, LLMParams, LLMResponse, StreamChunk, LLMMessage, type ImageGenParams, type ImageGenResponse } from './base'

// Anthropic supports images and PDFs
const ANTHROPIC_SUPPORTED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
]

type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'

type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: ImageMediaType; data: string } }
  | { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string } }

interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: string | AnthropicContentBlock[]
}

export class AnthropicProvider extends LLMProvider {
  readonly supportsFileAttachments = true
  readonly supportedMimeTypes = ANTHROPIC_SUPPORTED_MIME_TYPES
  readonly supportsImageGeneration = false

  private formatMessagesWithAttachments(
    messages: LLMMessage[]
  ): { messages: AnthropicMessage[]; attachmentResults: { sent: string[]; failed: { id: string; error: string }[] } } {
    const sent: string[] = []
    const failed: { id: string; error: string }[] = []

    // Filter out system messages (handled separately in Anthropic)
    const nonSystemMessages = messages.filter(m => m.role !== 'system')

    const formattedMessages: AnthropicMessage[] = nonSystemMessages.map((msg) => {
      const role = msg.role === 'user' ? 'user' : 'assistant'

      // If no attachments, return simple string content
      if (!msg.attachments || msg.attachments.length === 0) {
        return {
          role,
          content: msg.content,
        }
      }

      // Build multimodal content array
      const content: AnthropicContentBlock[] = []

      // Add text content first
      if (msg.content) {
        content.push({ type: 'text', text: msg.content })
      }

      // Add file attachments
      for (const attachment of msg.attachments) {
        if (!this.supportedMimeTypes.includes(attachment.mimeType)) {
          failed.push({
            id: attachment.id,
            error: `Unsupported file type: ${attachment.mimeType}. Anthropic supports: ${this.supportedMimeTypes.join(', ')}`,
          })
          continue
        }

        if (!attachment.data) {
          failed.push({
            id: attachment.id,
            error: 'File data not loaded',
          })
          continue
        }

        if (attachment.mimeType === 'application/pdf') {
          // PDF document
          content.push({
            type: 'document',
            source: {
              type: 'base64',
              media_type: attachment.mimeType,
              data: attachment.data,
            },
          })
        } else {
          // Image - mimeType is validated above to be one of the supported image types
          content.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: attachment.mimeType as ImageMediaType,
              data: attachment.data,
            },
          })
        }
        sent.push(attachment.id)
      }

      return {
        role,
        content: content.length > 0 ? content : msg.content,
      }
    })

    return { messages: formattedMessages, attachmentResults: { sent, failed } }
  }

  async sendMessage(params: LLMParams, apiKey: string): Promise<LLMResponse> {
    const client = new Anthropic({ apiKey })

    // Anthropic requires system message separate from messages array
    const systemMessage = params.messages.find(m => m.role === 'system')
    const { messages, attachmentResults } = this.formatMessagesWithAttachments(params.messages)

    const requestParams: any = {
      model: params.model,
      system: systemMessage?.content,
      messages,
      max_tokens: params.maxTokens ?? 1000,
    }

    // Anthropic API requires either temperature OR top_p, not both
    if (params.temperature !== undefined) {
      requestParams.temperature = params.temperature
    } else if (params.topP !== undefined) {
      requestParams.top_p = params.topP
    } else {
      // Default to temperature if neither is specified
      requestParams.temperature = 1.0
    }

    // Add tools if provided
    if (params.tools && params.tools.length > 0) {
      requestParams.tools = params.tools
    }

    const response = await client.messages.create(requestParams)

    const content = response.content[0]

    return {
      content: content.type === 'text' ? content.text : '',
      finishReason: response.stop_reason ?? 'stop',
      usage: {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      },
      raw: response,
      attachmentResults,
    }
  }

  async *streamMessage(params: LLMParams, apiKey: string): AsyncGenerator<StreamChunk> {
    const client = new Anthropic({ apiKey })

    const systemMessage = params.messages.find(m => m.role === 'system')
    const { messages, attachmentResults } = this.formatMessagesWithAttachments(params.messages)

    const requestParams: any = {
      model: params.model,
      system: systemMessage?.content,
      messages,
      max_tokens: params.maxTokens ?? 1000,
      stream: true,
    }

    // Anthropic API requires either temperature OR top_p, not both
    if (params.temperature !== undefined) {
      requestParams.temperature = params.temperature
    } else if (params.topP !== undefined) {
      requestParams.top_p = params.topP
    } else {
      // Default to temperature if neither is specified
      requestParams.temperature = 1.0
    }

    // Add tools if provided
    if (params.tools && params.tools.length > 0) {
      requestParams.tools = params.tools
    }

    const stream = (await client.messages.create(requestParams)) as unknown as AsyncIterable<any>

    let totalInputTokens = 0
    let totalOutputTokens = 0
    let fullMessage: any = null

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield {
          content: event.delta.text,
          done: false,
        }
      }

      // Track usage from message_start event
      if (event.type === 'message_start') {
        totalInputTokens = event.message.usage.input_tokens
        fullMessage = event.message
      }

      // Track usage from message_delta event
      if (event.type === 'message_delta') {
        totalOutputTokens = event.usage.output_tokens
      }

      // Final event
      if (event.type === 'message_stop') {
        yield {
          content: '',
          done: true,
          usage: {
            promptTokens: totalInputTokens,
            completionTokens: totalOutputTokens,
            totalTokens: totalInputTokens + totalOutputTokens,
          },
          attachmentResults,
          rawResponse: fullMessage,
        }
      }
    }
  }

  async validateApiKey(apiKey: string): Promise<boolean> {
    try {
      const client = new Anthropic({ apiKey })
      // Anthropic doesn't have a direct validation endpoint, so we make a minimal request
      await client.messages.create({
        model: 'claude-haiku-4-5-20251015',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'test' }],
      })
      return true
    } catch (error) {
      console.error('Anthropic API key validation failed:', error)
      return false
    }
  }

  async getAvailableModels(apiKey: string): Promise<string[]> {
    // Anthropic doesn't have a models endpoint, return known models
    // These are the current Claude models as of November 2025
    // Note: Claude 3.5 models were deprecated on October 22, 2025
    // Note: Claude 3 Sonnet was retired on July 21, 2025
    return [
      // Claude 4.5 models (latest)
      'claude-sonnet-4-5-20250929',
      'claude-haiku-4-5-20251015',

      // Claude 4 models
      'claude-opus-4-1-20250805',
      'claude-sonnet-4-20250514',
      'claude-opus-4-20250514',

      // Claude 3 models (legacy, will be retired)
      'claude-3-opus-20240229', // Retiring Jan 5, 2026
      'claude-3-haiku-20240307',
    ]
  }

  async generateImage(params: ImageGenParams, apiKey: string): Promise<ImageGenResponse> {
    throw new Error('Anthropic does not support image generation. Claude can analyze images but cannot generate them.')
  }
}
