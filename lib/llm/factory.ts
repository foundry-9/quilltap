// LLM Provider Factory
// Phase 0.7: Multi-Provider Support

import { LLMProvider } from './base'
import { OpenAIProvider } from './openai'
import { AnthropicProvider } from './anthropic'
import { OllamaProvider } from './ollama'
import { OpenRouterProvider } from './openrouter'
import { OpenAICompatibleProvider } from './openai-compatible'

type Provider = 'OPENAI' | 'ANTHROPIC' | 'OLLAMA' | 'OPENROUTER' | 'OPENAI_COMPATIBLE'

export function createLLMProvider(
  provider: Provider,
  baseUrl?: string
): LLMProvider {
  switch (provider) {
    case 'OPENAI':
      return new OpenAIProvider()

    case 'ANTHROPIC':
      return new AnthropicProvider()

    case 'OLLAMA':
      if (!baseUrl) {
        throw new Error('Ollama provider requires baseUrl (e.g., http://localhost:11434)')
      }
      return new OllamaProvider(baseUrl)

    case 'OPENROUTER':
      return new OpenRouterProvider()

    case 'OPENAI_COMPATIBLE':
      if (!baseUrl) {
        throw new Error('OpenAI-compatible provider requires baseUrl')
      }
      return new OpenAICompatibleProvider(baseUrl)

    default:
      throw new Error(`Unsupported provider: ${provider}`)
  }
}
