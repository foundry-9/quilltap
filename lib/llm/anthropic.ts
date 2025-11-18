// Anthropic Provider Implementation
// Phase 0.7: Multi-Provider Support

import Anthropic from '@anthropic-ai/sdk'
import { LLMProvider, LLMParams, LLMResponse, StreamChunk } from './base'

export class AnthropicProvider extends LLMProvider {
  async sendMessage(params: LLMParams, apiKey: string): Promise<LLMResponse> {
    const client = new Anthropic({ apiKey })

    // Anthropic requires system message separate from messages array
    const systemMessage = params.messages.find(m => m.role === 'system')
    const messages = params.messages.filter(m => m.role !== 'system')

    const response = await client.messages.create({
      model: params.model,
      system: systemMessage?.content,
      messages: messages.map(m => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content,
      })),
      max_tokens: params.maxTokens ?? 1000,
      temperature: params.temperature ?? 0.7,
      top_p: params.topP ?? 1,
    })

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
    }
  }

  async *streamMessage(params: LLMParams, apiKey: string): AsyncGenerator<StreamChunk> {
    const client = new Anthropic({ apiKey })

    const systemMessage = params.messages.find(m => m.role === 'system')
    const messages = params.messages.filter(m => m.role !== 'system')

    const stream = await client.messages.create({
      model: params.model,
      system: systemMessage?.content,
      messages: messages.map(m => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content,
      })),
      max_tokens: params.maxTokens ?? 1000,
      temperature: params.temperature ?? 0.7,
      stream: true,
    })

    let totalInputTokens = 0
    let totalOutputTokens = 0

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
}
