// OpenAI Provider Implementation
// Phase 0.5: Single Chat MVP

import OpenAI from 'openai'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { LLMProvider, LLMParams, LLMResponse, StreamChunk, LLMMessage, type ImageGenParams, type ImageGenResponse } from './base'

// OpenAI supports images in vision-capable models
const OPENAI_SUPPORTED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]

type OpenAIMessageContent = string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'low' | 'high' } }>

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant'
  content: OpenAIMessageContent
}

export class OpenAIProvider extends LLMProvider {
  readonly supportsFileAttachments = true
  readonly supportedMimeTypes = OPENAI_SUPPORTED_MIME_TYPES
  readonly supportsImageGeneration = true

  private formatMessagesWithAttachments(
    messages: LLMMessage[]
  ): { messages: OpenAIMessage[]; attachmentResults: { sent: string[]; failed: { id: string; error: string }[] } } {
    const sent: string[] = []
    const failed: { id: string; error: string }[] = []

    const formattedMessages: OpenAIMessage[] = messages.map((msg) => {
      // If no attachments, return simple string content
      if (!msg.attachments || msg.attachments.length === 0) {
        return {
          role: msg.role,
          content: msg.content,
        }
      }

      // Build multimodal content array
      const content: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'low' | 'high' } }> = []

      // Add text content first
      if (msg.content) {
        content.push({ type: 'text', text: msg.content })
      }

      // Add image attachments
      for (const attachment of msg.attachments) {
        if (!this.supportedMimeTypes.includes(attachment.mimeType)) {
          failed.push({
            id: attachment.id,
            error: `Unsupported file type: ${attachment.mimeType}. OpenAI supports: ${this.supportedMimeTypes.join(', ')}`,
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

        content.push({
          type: 'image_url',
          image_url: {
            url: `data:${attachment.mimeType};base64,${attachment.data}`,
            detail: 'auto',
          },
        })
        sent.push(attachment.id)
      }

      return {
        role: msg.role,
        content: content.length > 0 ? content : msg.content,
      }
    })

    return { messages: formattedMessages, attachmentResults: { sent, failed } }
  }

  async sendMessage(params: LLMParams, apiKey: string): Promise<LLMResponse> {
    const client = new OpenAI({
      apiKey,
      dangerouslyAllowBrowser: process.env.NODE_ENV === 'test',
    })

    const { messages, attachmentResults } = this.formatMessagesWithAttachments(params.messages)

    const requestParams: any = {
      model: params.model,
      messages: messages as ChatCompletionMessageParam[],
      temperature: params.temperature ?? 0.7,
      max_tokens: params.maxTokens ?? 1000,
      top_p: params.topP ?? 1,
      stop: params.stop,
    }

    // Add tools if provided
    if (params.tools && params.tools.length > 0) {
      requestParams.tools = params.tools
    }

    const response = await client.chat.completions.create(requestParams)

    const choice = response.choices[0]

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
    }
  }

  async *streamMessage(params: LLMParams, apiKey: string): AsyncGenerator<StreamChunk> {
    const client = new OpenAI({
      apiKey,
      dangerouslyAllowBrowser: process.env.NODE_ENV === 'test',
    })

    const { messages, attachmentResults } = this.formatMessagesWithAttachments(params.messages)

    const requestParams: any = {
      model: params.model,
      messages: messages as ChatCompletionMessageParam[],
      temperature: params.temperature ?? 0.7,
      max_tokens: params.maxTokens ?? 1000,
      top_p: params.topP ?? 1,
      stream: true,
      stream_options: { include_usage: true },
    }

    // Add tools if provided
    if (params.tools && params.tools.length > 0) {
      requestParams.tools = params.tools
    }

    const stream = (await client.chat.completions.create(requestParams)) as unknown as AsyncIterable<any>

    let fullMessage: any = null

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content
      const finishReason = chunk.choices[0]?.finish_reason
      const hasUsage = chunk.usage

      // Store the most recent chunk (needed for tool calls)
      if (!fullMessage) {
        fullMessage = chunk
      } else {
        // Merge tool calls if present
        if (chunk.choices?.[0]?.tool_calls) {
          if (!fullMessage.choices[0]) fullMessage.choices[0] = {}
          fullMessage.choices[0].tool_calls = chunk.choices[0].tool_calls
        }
        // Update finish reason
        if (finishReason) {
          fullMessage.choices[0].finish_reason = finishReason
        }
        // Update usage
        if (hasUsage) {
          fullMessage.usage = chunk.usage
        }
      }

      // Yield content unless this is the final chunk with usage info
      if (content && !(finishReason && hasUsage)) {
        yield {
          content,
          done: false,
        }
      }

      // Final chunk with usage info
      if (finishReason && hasUsage) {
        yield {
          content: '',
          done: true,
          usage: {
            promptTokens: chunk.usage?.prompt_tokens ?? 0,
            completionTokens: chunk.usage?.completion_tokens ?? 0,
            totalTokens: chunk.usage?.total_tokens ?? 0,
          },
          attachmentResults,
          rawResponse: fullMessage,
        }
      }
    }
  }

  async validateApiKey(apiKey: string): Promise<boolean> {
    try {
      const client = new OpenAI({ apiKey })
      await client.models.list()
      return true
    } catch (error) {
      console.error('OpenAI API key validation failed:', error)
      return false
    }
  }

  async getAvailableModels(apiKey: string): Promise<string[]> {
    try {
      const client = new OpenAI({ apiKey })
      const models = await client.models.list()
      return models.data
        .filter(m => m.id.includes('gpt'))
        .map(m => m.id)
        .sort()
    } catch (error) {
      console.error('Failed to fetch OpenAI models:', error)
      return []
    }
  }

  async generateImage(params: ImageGenParams, apiKey: string): Promise<ImageGenResponse> {
    const client = new OpenAI({ apiKey })

    const response = await client.images.generate({
      model: params.model ?? 'dall-e-3',
      prompt: params.prompt,
      n: params.n ?? 1,
      size: (params.size ?? '1024x1024') as '256x256' | '512x512' | '1024x1024' | '1792x1024' | '1024x1792',
      quality: params.quality ?? 'standard',
      style: params.style ?? 'vivid',
      response_format: 'b64_json',
    })

    const images = await Promise.all(
      (response.data || []).map(async (image) => {
        if (!image.b64_json) {
          throw new Error('No base64 image data in response')
        }

        return {
          data: image.b64_json,
          mimeType: 'image/png',
          revisedPrompt: image.revised_prompt,
        }
      })
    )

    return {
      images,
      raw: response,
    }
  }
}
