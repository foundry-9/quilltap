// Ollama Provider Implementation
// Phase 0.7: Multi-Provider Support

import { LLMProvider, LLMParams, LLMResponse, StreamChunk } from './base'

export class OllamaProvider extends LLMProvider {
  constructor(private baseUrl: string) {
    super()
  }

  async sendMessage(params: LLMParams, apiKey: string): Promise<LLMResponse> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: params.model,
        messages: params.messages,
        stream: false,
        options: {
          temperature: params.temperature ?? 0.7,
          num_predict: params.maxTokens ?? 1000,
          top_p: params.topP ?? 1,
          stop: params.stop,
        },
      }),
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
    }
  }

  async *streamMessage(params: LLMParams, apiKey: string): AsyncGenerator<StreamChunk> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: params.model,
        messages: params.messages,
        stream: true,
        options: {
          temperature: params.temperature ?? 0.7,
          num_predict: params.maxTokens ?? 1000,
          top_p: params.topP ?? 1,
        },
      }),
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
}
