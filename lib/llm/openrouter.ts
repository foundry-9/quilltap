// OpenRouter Provider Implementation
// Phase 0.7: Multi-Provider Support
// Note: OpenRouter proxies to many models, file support depends on the underlying model

import { OpenRouter } from '@openrouter/sdk'
import type { ChatStreamingResponseChunkData } from '@openrouter/sdk/models/chatstreamingresponsechunk'
import { LLMProvider, LLMParams, LLMResponse, StreamChunk, type ImageGenParams, type ImageGenResponse } from './base'

export class OpenRouterProvider extends LLMProvider {
  readonly supportsFileAttachments = false // Model-dependent, conservative default
  readonly supportedMimeTypes: string[] = []
  readonly supportsImageGeneration = true

  // Helper to collect attachment failures
  private collectAttachmentFailures(params: LLMParams): { sent: string[]; failed: { id: string; error: string }[] } {
    const failed: { id: string; error: string }[] = []
    for (const msg of params.messages) {
      if (msg.attachments) {
        for (const attachment of msg.attachments) {
          failed.push({
            id: attachment.id,
            error: 'OpenRouter file attachment support depends on model (not yet implemented)',
          })
        }
      }
    }
    return { sent: [], failed }
  }

  async sendMessage(params: LLMParams, apiKey: string): Promise<LLMResponse> {
    const attachmentResults = this.collectAttachmentFailures(params)

    const client = new OpenRouter({
      apiKey,
      httpReferer: process.env.NEXTAUTH_URL || 'http://localhost:3000',
      xTitle: 'Quilltap',
    })

    // Strip attachments from messages and convert to OpenRouter format
    const messages = params.messages.map(m => ({
      role: m.role,
      content: m.content,
    }))

    const requestParams: any = {
      model: params.model,
      messages,
      temperature: params.temperature ?? 0.7,
      maxTokens: params.maxTokens ?? 1000,
      topP: params.topP ?? 1,
      stop: params.stop,
      stream: false,
    }

    // Add tools if provided
    if (params.tools && params.tools.length > 0) {
      requestParams.tools = params.tools
      // Explicitly enable tool use with "auto" - let the model decide when to use tools
      requestParams.toolChoice = 'auto'
    }

    const response = await client.chat.send(requestParams)

    const choice = response.choices[0]
    const content = choice.message.content
    const contentStr = typeof content === 'string' ? content : ''

    return {
      content: contentStr,
      finishReason: choice.finishReason || 'stop',
      usage: {
        promptTokens: response.usage?.promptTokens ?? 0,
        completionTokens: response.usage?.completionTokens ?? 0,
        totalTokens: response.usage?.totalTokens ?? 0,
      },
      raw: response,
      attachmentResults,
    }
  }

  async *streamMessage(params: LLMParams, apiKey: string): AsyncGenerator<StreamChunk> {
    const attachmentResults = this.collectAttachmentFailures(params)

    const client = new OpenRouter({
      apiKey,
      httpReferer: process.env.NEXTAUTH_URL || 'http://localhost:3000',
      xTitle: 'Quilltap',
    })

    // Strip attachments from messages and convert to OpenRouter format
    const messages = params.messages.map(m => ({
      role: m.role,
      content: m.content,
    }))

    const requestParams: any = {
      model: params.model,
      messages,
      temperature: params.temperature ?? 0.7,
      maxTokens: params.maxTokens ?? 1000,
      topP: params.topP ?? 1,
      stream: true,
      streamOptions: { includeUsage: true },
    }

    // Add tools if provided
    if (params.tools && params.tools.length > 0) {
      requestParams.tools = params.tools
      // Explicitly enable tool use with "auto" - let the model decide when to use tools
      requestParams.toolChoice = 'auto'
    }

    const response = await client.chat.send(requestParams)

    // Type guard to ensure we have a stream
    if (!response || typeof (response as any)[Symbol.asyncIterator] !== 'function') {
      throw new Error('Expected streaming response from OpenRouter')
    }

    const stream = response as unknown as AsyncIterable<ChatStreamingResponseChunkData>
    let fullMessage: ChatStreamingResponseChunkData | null = null

    for await (const chunk of stream) {
      const content = chunk.choices?.[0]?.delta?.content
      const finishReason = chunk.choices?.[0]?.finishReason
      const hasUsage = chunk.usage

      // Store the most recent chunk (needed for tool calls)
      if (!fullMessage) {
        fullMessage = chunk
      } else {
        // Merge tool calls if present
        const toolCalls = chunk.choices?.[0]?.delta?.toolCalls
        if (toolCalls) {
          fullMessage.choices[0].delta.toolCalls ??= []
          fullMessage.choices[0].delta.toolCalls = toolCalls
        }
        // Update finish reason
        if (finishReason) {
          fullMessage.choices[0].finishReason = finishReason
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
            promptTokens: chunk.usage?.promptTokens ?? 0,
            completionTokens: chunk.usage?.completionTokens ?? 0,
            totalTokens: chunk.usage?.totalTokens ?? 0,
          },
          attachmentResults,
          rawResponse: fullMessage,
        }
      }
    }
  }

  async validateApiKey(apiKey: string): Promise<boolean> {
    try {
      const client = new OpenRouter({
        apiKey,
        httpReferer: process.env.NEXTAUTH_URL || 'http://localhost:3000',
        xTitle: 'Quilltap',
      })
      await client.models.list()
      return true
    } catch (error) {
      console.error('OpenRouter API key validation failed:', error)
      return false
    }
  }

  async getAvailableModels(apiKey: string): Promise<string[]> {
    try {
      const client = new OpenRouter({
        apiKey,
        httpReferer: process.env.NEXTAUTH_URL || 'http://localhost:3000',
        xTitle: 'Quilltap',
      })

      const response = await client.models.list()
      return response.data?.map((m: any) => m.id) ?? []
    } catch (error) {
      console.error('Failed to fetch OpenRouter models:', error)
      return []
    }
  }

  async generateImage(params: ImageGenParams, apiKey: string): Promise<ImageGenResponse> {
    const client = new OpenRouter({
      apiKey,
      httpReferer: process.env.NEXTAUTH_URL || 'http://localhost:3000',
      xTitle: 'Quilltap',
    })

    const requestBody: any = {
      model: params.model ?? 'google/gemini-2.5-flash-image-preview',
      messages: [{ role: 'user', content: params.prompt }],
      stream: false,
      // Note: OpenRouter SDK doesn't have direct image generation support yet
      // We'll use chat completion with special parameters
    }

    if (params.aspectRatio) {
      requestBody.imageConfig = { aspectRatio: params.aspectRatio }
    }

    const response = await client.chat.send(requestBody) as any

    const choice = response.choices?.[0]
    if (!choice) {
      throw new Error('No choices in OpenRouter response')
    }

    const images = []

    // Check if response includes images
    if ((choice.message as any).images && Array.isArray((choice.message as any).images)) {
      for (const image of (choice.message as any).images) {
        if (image.imageUrl?.url || image.image_url?.url) {
          // Extract base64 data from data URL
          const dataUrl = image.imageUrl?.url || image.image_url?.url
          if (dataUrl.startsWith('data:image/')) {
            const [, base64] = dataUrl.split(',')
            const mimeType = dataUrl.match(/data:(image\/[^;]+)/)?.[1] || 'image/png'
            images.push({
              data: base64,
              mimeType,
            })
          }
        }
      }
    }

    if (images.length === 0) {
      throw new Error('No images returned from OpenRouter')
    }

    return {
      images,
      raw: response,
    }
  }
}
