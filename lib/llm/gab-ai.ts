// Gab AI Provider Implementation
// Based on OpenAI-Compatible Provider
// Gab AI API is OpenAI-compatible and uses base URL: https://gab.ai/v1

import OpenAI from 'openai'
import { LLMProvider, LLMParams, LLMResponse, StreamChunk } from './base'

export class GabAIProvider extends LLMProvider {
  private readonly baseUrl = 'https://gab.ai/v1'

  async sendMessage(params: LLMParams, apiKey: string): Promise<LLMResponse> {
    if (!apiKey) {
      throw new Error('Gab AI provider requires an API key')
    }

    const client = new OpenAI({
      apiKey,
      baseURL: this.baseUrl,
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
    if (!apiKey) {
      throw new Error('Gab AI provider requires an API key')
    }

    const client = new OpenAI({
      apiKey,
      baseURL: this.baseUrl,
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
      console.error('Gab AI API validation failed:', error)
      return false
    }
  }

  async getAvailableModels(apiKey: string): Promise<string[]> {
    if (!apiKey) {
      console.error('Gab AI provider requires an API key to fetch models')
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
      console.error('Failed to fetch Gab AI models:', error)
      return []
    }
  }
}
