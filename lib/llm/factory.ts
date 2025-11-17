// LLM Provider Factory
// Phase 0.5: Single Chat MVP (OpenAI only for now)

import { LLMProvider } from './base'
import { OpenAIProvider } from './openai'

type Provider = 'OPENAI' | 'ANTHROPIC' | 'OLLAMA' | 'OPENROUTER' | 'OPENAI_COMPATIBLE'

export function createLLMProvider(
  provider: Provider,
  baseUrl?: string
): LLMProvider {
  switch (provider) {
    case 'OPENAI':
      return new OpenAIProvider()
    case 'ANTHROPIC':
    case 'OLLAMA':
    case 'OPENROUTER':
    case 'OPENAI_COMPATIBLE':
      throw new Error(`Provider ${provider} not yet implemented. Phase 0.5 supports OpenAI only.`)
    default:
      throw new Error(`Unsupported provider: ${provider}`)
  }
}
