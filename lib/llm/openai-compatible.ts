// OpenAI-Compatible Provider Implementation
// Phase 0.7: Multi-Provider Support
// This provider works with any OpenAI-compatible API (e.g., LM Studio, vLLM, text-generation-webui, etc.)
// Note: File support varies by implementation

import OpenAI from 'openai'
import { LLMProvider, LLMParams, LLMResponse, StreamChunk, type ImageGenParams, type ImageGenResponse } from './base'

export class OpenAICompatibleProvider extends LLMProvider {
  readonly supportsFileAttachments = false // Varies by implementation, conservative default
  readonly supportedMimeTypes: string[] = []
  readonly supportsImageGeneration = false

  constructor(private baseUrl: string) {
    super()
  }

  // Helper to collect attachment failures
  private collectAttachmentFailures(params: LLMParams): { sent: string[]; failed: { id: string; error: string }[] } {
    const failed: { id: string; error: string }[] = []
    for (const msg of params.messages) {
      if (msg.attachments) {
        for (const attachment of msg.attachments) {
          failed.push({
            id: attachment.id,
            error: 'OpenAI-compatible provider file attachment support varies by implementation (not yet implemented)',
          })
        }
      }
    }
    return { sent: [], failed }
  }

  async sendMessage(params: LLMParams, apiKey: string): Promise<LLMResponse> {
    const attachmentResults = this.collectAttachmentFailures(params)

    const client = new OpenAI({
      apiKey: apiKey || 'not-needed', // Some compatible APIs don't require keys
      baseURL: this.baseUrl,
    })

    // Strip attachments from messages
    const messages = params.messages.map(m => ({
      role: m.role,
      content: m.content,
    }))

    const response = await client.chat.completions.create({
      model: params.model,
      messages,
      temperature: params.temperature ?? 0.7,
      max_tokens: params.maxTokens ?? 1000,
      top_p: params.topP ?? 1,
      stop: params.stop,
    })

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
      apiKey: apiKey || 'not-needed',
      baseURL: this.baseUrl,
    })

    // Strip attachments from messages
    const messages = params.messages.map(m => ({
      role: m.role,
      content: m.content,
    }))

    const stream = await client.chat.completions.create({
      model: params.model,
      messages,
      temperature: params.temperature ?? 0.7,
      max_tokens: params.maxTokens ?? 1000,
      top_p: params.topP ?? 1,
      stream: true,
      stream_options: { include_usage: true },
    })

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content
      const finishReason = chunk.choices[0]?.finish_reason
      const hasUsage = chunk.usage

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
        }
      }
    }
  }

  async validateApiKey(apiKey: string): Promise<boolean> {
    try {
      const client = new OpenAI({
        apiKey: apiKey || 'not-needed',
        baseURL: this.baseUrl,
      })
      await client.models.list()
      return true
    } catch (error) {
      console.error('OpenAI-compatible API validation failed:', error)
      return false
    }
  }

  async getAvailableModels(apiKey: string): Promise<string[]> {
    try {
      const client = new OpenAI({
        apiKey: apiKey || 'not-needed',
        baseURL: this.baseUrl,
      })
      const models = await client.models.list()
      return models.data.map(m => m.id).sort()
    } catch (error) {
      console.error('Failed to fetch OpenAI-compatible models:', error)
      return []
    }
  }

  async generateImage(params: ImageGenParams, apiKey: string): Promise<ImageGenResponse> {
    throw new Error('OpenAI-compatible image generation support varies by implementation (not yet implemented)')
  }
}
