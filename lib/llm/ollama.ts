// Ollama Provider Implementation
// Phase 0.7: Multi-Provider Support
// Note: Ollama supports images via multimodal models (llava, etc.) but implementation varies

import { LLMProvider, LLMParams, LLMResponse, StreamChunk, type ImageGenParams, type ImageGenResponse } from './base'

export class OllamaProvider extends LLMProvider {
  readonly supportsFileAttachments = false // TODO: Add support for llava and other multimodal models
  readonly supportedMimeTypes: string[] = []
  readonly supportsImageGeneration = false

  constructor(private baseUrl: string) {
    super()
  }

  // Helper to collect attachment failures for unsupported provider
  private collectAttachmentFailures(params: LLMParams): { sent: string[]; failed: { id: string; error: string }[] } {
    const failed: { id: string; error: string }[] = []
    for (const msg of params.messages) {
      if (msg.attachments) {
        for (const attachment of msg.attachments) {
          failed.push({
            id: attachment.id,
            error: 'Ollama file attachment support not yet implemented (requires multimodal model detection)',
          })
        }
      }
    }
    return { sent: [], failed }
  }

  async sendMessage(params: LLMParams, apiKey: string): Promise<LLMResponse> {
    const attachmentResults = this.collectAttachmentFailures(params)

    // Strip attachments from messages
    const messages = params.messages.map(m => ({
      role: m.role,
      content: m.content,
    }))

    const requestBody: any = {
      model: params.model,
      messages,
      stream: false,
      options: {
        temperature: params.temperature ?? 0.7,
        num_predict: params.maxTokens ?? 1000,
        top_p: params.topP ?? 1,
        stop: params.stop,
      },
    }

    // Add tools if provided
    if (params.tools && params.tools.length > 0) {
      requestBody.tools = params.tools
    }

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Ollama API error: ${response.status} ${errorText}`)
    }

    const data = await response.json()

    return {
      content: data.message.content,
      finishReason: data.done ? 'stop' : 'length',
      usage: {
        promptTokens: data.prompt_eval_count ?? 0,
        completionTokens: data.eval_count ?? 0,
        totalTokens: (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0),
      },
      raw: data,
      attachmentResults,
    }
  }

  async *streamMessage(params: LLMParams, apiKey: string): AsyncGenerator<StreamChunk> {
    const attachmentResults = this.collectAttachmentFailures(params)

    // Strip attachments from messages
    const messages = params.messages.map(m => ({
      role: m.role,
      content: m.content,
    }))

    const requestBody: any = {
      model: params.model,
      messages,
      stream: true,
      options: {
        temperature: params.temperature ?? 0.7,
        num_predict: params.maxTokens ?? 1000,
        top_p: params.topP ?? 1,
      },
    }

    // Add tools if provided
    if (params.tools && params.tools.length > 0) {
      requestBody.tools = params.tools
    }

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Ollama API error: ${response.status} ${errorText}`)
    }

    const reader = response.body?.getReader()
    if (!reader) {
      throw new Error('Failed to get response reader')
    }

    const decoder = new TextDecoder()
    let totalPromptTokens = 0
    let totalCompletionTokens = 0

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        const lines = chunk.split('\n').filter(Boolean)

        for (const line of lines) {
          try {
            const data = JSON.parse(line)

            if (data.message?.content) {
              yield {
                content: data.message.content,
                done: false,
              }
            }

            // Track token usage
            if (data.prompt_eval_count) {
              totalPromptTokens = data.prompt_eval_count
            }
            if (data.eval_count) {
              totalCompletionTokens = data.eval_count
            }

            // Final chunk
            if (data.done) {
              yield {
                content: '',
                done: true,
                usage: {
                  promptTokens: totalPromptTokens,
                  completionTokens: totalCompletionTokens,
                  totalTokens: totalPromptTokens + totalCompletionTokens,
                },
                attachmentResults,
              }
            }
          } catch (e) {
            // Skip invalid JSON lines
            console.warn('Failed to parse Ollama stream line:', line, e)
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  }

  async validateApiKey(apiKey: string): Promise<boolean> {
    // Ollama doesn't use API keys, just check if server is reachable
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        method: 'GET',
      })
      return response.ok
    } catch (error) {
      console.error('Ollama server validation failed:', error)
      return false
    }
  }

  async getAvailableModels(apiKey: string): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        method: 'GET',
      })

      if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.status}`)
      }

      const data = await response.json()
      return data.models?.map((m: any) => m.name) ?? []
    } catch (error) {
      console.error('Failed to fetch Ollama models:', error)
      return []
    }
  }

  async generateImage(params: ImageGenParams, apiKey: string): Promise<ImageGenResponse> {
    throw new Error('Ollama does not support image generation. Use a multimodal model for image analysis.')
  }
}
