// OpenRouter Provider Implementation
// Phase 0.7: Multi-Provider Support

import OpenAI from 'openai'
import { LLMProvider, LLMParams, LLMResponse, StreamChunk } from './base'

export class OpenRouterProvider extends LLMProvider {
  private readonly baseUrl = 'https://openrouter.ai/api/v1'

  async sendMessage(params: LLMParams, apiKey: string): Promise<LLMResponse> {
    const client = new OpenAI({
      apiKey,
      baseURL: this.baseUrl,
      defaultHeaders: {
        'HTTP-Referer': process.env.NEXTAUTH_URL || 'http://localhost:3000',
        'X-Title': 'Quilltap',
      },
    })

    const response = await client.chat.completions.create({
      model: params.model,
      messages: params.messages,
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
    }
  }

  async *streamMessage(params: LLMParams, apiKey: string): AsyncGenerator<StreamChunk> {
    const client = new OpenAI({
      apiKey,
      baseURL: this.baseUrl,
      defaultHeaders: {
        'HTTP-Referer': process.env.NEXTAUTH_URL || 'http://localhost:3000',
        'X-Title': 'Quilltap',
      },
    })

    const stream = await client.chat.completions.create({
      model: params.model,
      messages: params.messages,
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
}
