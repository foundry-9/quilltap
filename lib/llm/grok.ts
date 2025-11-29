// Grok Provider Implementation
// Based on OpenAI-Compatible Provider
// Grok API is OpenAI-compatible and uses base URL: https://api.x.ai/v1
// Grok supports image uploads as of November 2025
// Text and PDF files are handled via the fallback system for better compatibility

import OpenAI from 'openai'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { LLMProvider, LLMParams, LLMResponse, StreamChunk, LLMMessage, type ImageGenParams, type ImageGenResponse } from './base'

// Grok supports images (text/PDF handled via fallback system)
const GROK_SUPPORTED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]

type GrokMessageContent = string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'low' | 'high' } }>

interface GrokMessage {
  role: 'system' | 'user' | 'assistant'
  content: GrokMessageContent
}

export class GrokProvider extends LLMProvider {
  private readonly baseUrl = 'https://api.x.ai/v1'
  readonly supportsFileAttachments = true
  readonly supportedMimeTypes = GROK_SUPPORTED_MIME_TYPES
  readonly supportsImageGeneration = true

  private formatMessagesWithAttachments(
    messages: LLMMessage[]
  ): { messages: GrokMessage[]; attachmentResults: { sent: string[]; failed: { id: string; error: string }[] } } {
    const sent: string[] = []
    const failed: { id: string; error: string }[] = []

    const formattedMessages: GrokMessage[] = messages.map((msg) => {
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

      // Add file attachments (Grok uses OpenAI-compatible format for images)
      for (const attachment of msg.attachments) {
        if (!this.supportedMimeTypes.includes(attachment.mimeType)) {
          failed.push({
            id: attachment.id,
            error: `Unsupported file type: ${attachment.mimeType}. Grok supports: ${this.supportedMimeTypes.join(', ')}`,
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

        // For images, use image_url format
        if (attachment.mimeType.startsWith('image/')) {
          content.push({
            type: 'image_url',
            image_url: {
              url: `data:${attachment.mimeType};base64,${attachment.data}`,
              detail: 'auto',
            },
          })
          sent.push(attachment.id)
        } else {
          // For documents (PDF, text, etc.), embed as text content
          // Note: Grok's Files API may require different handling for documents
          // For now, we'll include text-based files as text content
          if (attachment.mimeType.startsWith('text/')) {
            try {
              const textContent = Buffer.from(attachment.data, 'base64').toString('utf-8')
              content.push({
                type: 'text',
                text: `[File: ${attachment.filename}]\n${textContent}`,
              })
              sent.push(attachment.id)
            } catch {
              failed.push({
                id: attachment.id,
                error: 'Failed to decode text file',
              })
            }
          } else {
            // PDFs and other binary documents - mark as failed for now
            // Full support would require using Grok's Files API
            failed.push({
              id: attachment.id,
              error: 'PDF and binary document support requires Grok Files API (not yet implemented)',
            })
          }
        }
      }

      return {
        role: msg.role,
        content: content.length > 0 ? content : msg.content,
      }
    })

    return { messages: formattedMessages, attachmentResults: { sent, failed } }
  }

  async sendMessage(params: LLMParams, apiKey: string): Promise<LLMResponse> {
    if (!apiKey) {
      throw new Error('Grok provider requires an API key')
    }

    const client = new OpenAI({
      apiKey,
      baseURL: this.baseUrl,
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
      // Explicitly enable tool use with "auto" - let the model decide when to use tools
      requestParams.tool_choice = 'auto'
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
    if (!apiKey) {
      throw new Error('Grok provider requires an API key')
    }

    const client = new OpenAI({
      apiKey,
      baseURL: this.baseUrl,
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
      // Explicitly enable tool use with "auto" - let the model decide when to use tools
      requestParams.tool_choice = 'auto'
    }

    const stream = (await client.chat.completions.create(requestParams)) as unknown as AsyncIterable<any>

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
    }

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta
      const content = delta?.content
      const finishReason = chunk.choices?.[0]?.finish_reason
      const hasUsage = chunk.usage

      // Merge delta content
      if (content) {
        fullMessage.choices[0].message.content += content
        yield {
          content,
          done: false,
        }
      }

      // Merge delta tool calls
      if (delta?.tool_calls) {
        for (const toolCall of delta.tool_calls) {
          const index = toolCall.index ?? 0
          
          // Initialize tool call if it doesn't exist
          if (!fullMessage.choices[0].message.tool_calls[index]) {
            fullMessage.choices[0].message.tool_calls[index] = {
              id: '',
              type: 'function',
              function: { name: '', arguments: '' }
            }
          }
          
          // Merge the delta into the existing tool call
          if (toolCall.id) fullMessage.choices[0].message.tool_calls[index].id = toolCall.id
          if (toolCall.function?.name) fullMessage.choices[0].message.tool_calls[index].function.name = toolCall.function.name
          if (toolCall.function?.arguments) fullMessage.choices[0].message.tool_calls[index].function.arguments += toolCall.function.arguments
        }
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

    // Transform fullMessage to match what the caller expects (OpenAI response format)
    const finalResponse = {
      choices: [{
        message: {
          role: 'assistant',
          content: fullMessage.choices[0].message.content,
          tool_calls: fullMessage.choices[0].message.tool_calls.length > 0 
            ? fullMessage.choices[0].message.tool_calls 
            : undefined
        },
        finish_reason: fullMessage.choices[0].finish_reason
      }],
      usage: fullMessage.usage
    }

    yield {
      content: '',
      done: true,
      usage: {
        promptTokens: fullMessage.usage?.prompt_tokens ?? 0,
        completionTokens: fullMessage.usage?.completion_tokens ?? 0,
        totalTokens: fullMessage.usage?.total_tokens ?? 0,
      },
      attachmentResults,
      rawResponse: finalResponse,
    }
  }

  async validateApiKey(apiKey: string): Promise<boolean> {
    if (!apiKey) {
      return false
    }

    try {
      const client = new OpenAI({
        apiKey,
        baseURL: this.baseUrl,
      })
      await client.models.list()
      return true
    } catch (error) {
      console.error('Grok API validation failed:', error)
      return false
    }
  }

  async getAvailableModels(apiKey: string): Promise<string[]> {
    if (!apiKey) {
      console.error('Grok provider requires an API key to fetch models')
      return []
    }

    try {
      const client = new OpenAI({
        apiKey,
        baseURL: this.baseUrl,
      })
      const models = await client.models.list()
      return models.data.map(m => m.id).sort()
    } catch (error) {
      console.error('Failed to fetch Grok models:', error)
      return []
    }
  }

  async generateImage(params: ImageGenParams, apiKey: string): Promise<ImageGenResponse> {
    if (!apiKey) {
      throw new Error('Grok provider requires an API key')
    }

    const client = new OpenAI({
      apiKey,
      baseURL: this.baseUrl,
    })

    const response = await client.images.generate({
      model: params.model ?? 'grok-2-image',
      prompt: params.prompt,
      n: params.n ?? 1,
      response_format: 'b64_json',
    })

    const images = await Promise.all(
      (response.data || []).map(async (image) => {
        if (!image.b64_json) {
          throw new Error('No base64 image data in response')
        }

        return {
          data: image.b64_json,
          mimeType: 'image/jpeg',
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
