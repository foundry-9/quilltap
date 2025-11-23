// OpenRouter Provider Implementation
// Phase 0.7: Multi-Provider Support
// Note: OpenRouter proxies to many models, file support depends on the underlying model

import OpenAI from 'openai'
import { LLMProvider, LLMParams, LLMResponse, StreamChunk, type ImageGenParams, type ImageGenResponse } from './base'

export class OpenRouterProvider extends LLMProvider {
  private readonly baseUrl = 'https://openrouter.ai/api/v1'
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

    const client = new OpenAI({
      apiKey,
      baseURL: this.baseUrl,
      defaultHeaders: {
        'HTTP-Referer': process.env.NEXTAUTH_URL || 'http://localhost:3000',
        'X-Title': 'Quilltap',
      },
    })

    // Strip attachments from messages
    const messages = params.messages.map(m => ({
      role: m.role,
      content: m.content,
    }))

    const requestParams: any = {
      model: params.model,
      messages,
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
    const attachmentResults = this.collectAttachmentFailures(params)

    const client = new OpenAI({
      apiKey,
      baseURL: this.baseUrl,
      defaultHeaders: {
        'HTTP-Referer': process.env.NEXTAUTH_URL || 'http://localhost:3000',
        'X-Title': 'Quilltap',
      },
    })

    // Strip attachments from messages
    const messages = params.messages.map(m => ({
      role: m.role,
      content: m.content,
    }))

    const requestParams: any = {
      model: params.model,
      messages,
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
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': process.env.NEXTAUTH_URL || 'http://localhost:3000',
          'X-Title': 'Quilltap',
        },
      })
      return response.ok
    } catch (error) {
      console.error('OpenRouter API key validation failed:', error)
      return false
    }
  }

  async getAvailableModels(apiKey: string): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': process.env.NEXTAUTH_URL || 'http://localhost:3000',
          'X-Title': 'Quilltap',
        },
      })

      if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.status}`)
      }

      const data = await response.json()
      return data.data?.map((m: any) => m.id) ?? []
    } catch (error) {
      console.error('Failed to fetch OpenRouter models:', error)
      return []
    }
  }

  async generateImage(params: ImageGenParams, apiKey: string): Promise<ImageGenResponse> {
    const requestBody: any = {
      model: params.model ?? 'google/gemini-2.5-flash-image-preview',
      messages: [{ role: 'user', content: params.prompt }],
      modalities: ['image', 'text'],
    }

    if (params.aspectRatio) {
      requestBody.image_config = { aspect_ratio: params.aspectRatio }
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.NEXTAUTH_URL || 'http://localhost:3000',
        'X-Title': 'Quilltap',
      },
      body: JSON.stringify(requestBody),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`OpenRouter API error: ${response.status} ${errorText}`)
    }

    const data = await response.json()
    const choice = data.choices?.[0]
    if (!choice) {
      throw new Error('No choices in OpenRouter response')
    }

    const images = []

    // Check if response includes images
    if ((choice.message as any).images && Array.isArray((choice.message as any).images)) {
      for (const image of (choice.message as any).images) {
        if (image.image_url?.url) {
          // Extract base64 data from data URL
          const dataUrl = image.image_url.url
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
      raw: data,
    }
  }
}
