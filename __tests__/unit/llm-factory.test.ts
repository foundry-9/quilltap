/**
 * Unit Tests for LLM Provider Factory
 * Tests lib/llm/factory.ts
 * Phase 0.7: Multi-Provider Support
 */

// Unmock the factory module to test the real implementation
jest.unmock('@/lib/llm/factory')

import { describe, it, expect } from '@jest/globals'
import { createLLMProvider } from '@/lib/llm/factory'
import { OpenAIProvider } from '@/lib/llm/openai'
import { AnthropicProvider } from '@/lib/llm/anthropic'
import { OllamaProvider } from '@/lib/llm/ollama'
import { OpenRouterProvider } from '@/lib/llm/openrouter'
import { OpenAICompatibleProvider } from '@/lib/llm/openai-compatible'
import { GrokProvider } from '@/lib/llm/grok'
import { GabAIProvider } from '@/lib/llm/gab-ai'

describe('createLLMProvider', () => {
  describe('OpenAI provider', () => {
    it('should create an OpenAI provider', () => {
      const provider = createLLMProvider('OPENAI')

      expect(provider).toBeInstanceOf(OpenAIProvider)
    })

    it('should create OpenAI provider regardless of baseUrl parameter', () => {
      const provider = createLLMProvider('OPENAI', 'https://custom-url.com')

      expect(provider).toBeInstanceOf(OpenAIProvider)
    })
  })

  describe('Anthropic provider', () => {
    it('should create an Anthropic provider', () => {
      const provider = createLLMProvider('ANTHROPIC')

      expect(provider).toBeInstanceOf(AnthropicProvider)
    })

    it('should create Anthropic provider regardless of baseUrl parameter', () => {
      const provider = createLLMProvider('ANTHROPIC', 'https://custom-url.com')

      expect(provider).toBeInstanceOf(AnthropicProvider)
    })
  })

  describe('Ollama provider', () => {
    it('should create an Ollama provider with baseUrl', () => {
      const provider = createLLMProvider('OLLAMA', 'http://localhost:11434')

      expect(provider).toBeInstanceOf(OllamaProvider)
    })

    it('should throw error when baseUrl is not provided', () => {
      expect(() => {
        createLLMProvider('OLLAMA')
      }).toThrow('Ollama provider requires baseUrl (e.g., http://localhost:11434)')
    })

    it('should throw error when baseUrl is empty string', () => {
      expect(() => {
        createLLMProvider('OLLAMA', '')
      }).toThrow('Ollama provider requires baseUrl')
    })
  })

  describe('OpenRouter provider', () => {
    it('should create an OpenRouter provider', () => {
      const provider = createLLMProvider('OPENROUTER')

      expect(provider).toBeInstanceOf(OpenRouterProvider)
    })

    it('should create OpenRouter provider regardless of baseUrl parameter', () => {
      const provider = createLLMProvider('OPENROUTER', 'https://custom-url.com')

      expect(provider).toBeInstanceOf(OpenRouterProvider)
    })
  })

  describe('OpenAI-compatible provider', () => {
    it('should create an OpenAI-compatible provider with baseUrl', () => {
      const provider = createLLMProvider('OPENAI_COMPATIBLE', 'http://localhost:1234/v1')

      expect(provider).toBeInstanceOf(OpenAICompatibleProvider)
    })

    it('should throw error when baseUrl is not provided', () => {
      expect(() => {
        createLLMProvider('OPENAI_COMPATIBLE')
      }).toThrow('OpenAI-compatible provider requires baseUrl')
    })

    it('should throw error when baseUrl is empty string', () => {
      expect(() => {
        createLLMProvider('OPENAI_COMPATIBLE', '')
      }).toThrow('OpenAI-compatible provider requires baseUrl')
    })
  })

  describe('Grok provider', () => {
    it('should create a Grok provider', () => {
      const provider = createLLMProvider('GROK')

      expect(provider).toBeInstanceOf(GrokProvider)
    })

    it('should create Grok provider regardless of baseUrl parameter', () => {
      const provider = createLLMProvider('GROK', 'https://custom-url.com')

      expect(provider).toBeInstanceOf(GrokProvider)
    })
  })

  describe('Gab AI provider', () => {
    it('should create a Gab AI provider', () => {
      const provider = createLLMProvider('GAB_AI')

      expect(provider).toBeInstanceOf(GabAIProvider)
    })

    it('should create Gab AI provider regardless of baseUrl parameter', () => {
      const provider = createLLMProvider('GAB_AI', 'https://custom-url.com')

      expect(provider).toBeInstanceOf(GabAIProvider)
    })
  })

  describe('Invalid provider names', () => {
    it('should throw error for invalid provider name', () => {
      expect(() => {
        createLLMProvider('INVALID' as any)
      }).toThrow('Unsupported provider: INVALID')
    })

    it('should throw error for empty string', () => {
      expect(() => {
        createLLMProvider('' as any)
      }).toThrow('Unsupported provider: ')
    })

    it('should throw error for lowercase provider name', () => {
      expect(() => {
        createLLMProvider('openai' as any)
      }).toThrow('Unsupported provider: openai')
    })

    it('should throw error for null provider', () => {
      expect(() => {
        createLLMProvider(null as any)
      }).toThrow()
    })

    it('should throw error for undefined provider', () => {
      expect(() => {
        createLLMProvider(undefined as any)
      }).toThrow()
    })
  })

  describe('Provider type validation', () => {
    it('should accept all valid Provider type strings', () => {
      const validProviders = [
        { name: 'OPENAI', instance: OpenAIProvider, requiresBaseUrl: false },
        { name: 'ANTHROPIC', instance: AnthropicProvider, requiresBaseUrl: false },
        { name: 'OLLAMA', instance: OllamaProvider, requiresBaseUrl: true },
        { name: 'OPENROUTER', instance: OpenRouterProvider, requiresBaseUrl: false },
        { name: 'OPENAI_COMPATIBLE', instance: OpenAICompatibleProvider, requiresBaseUrl: true },
        { name: 'GROK', instance: GrokProvider, requiresBaseUrl: false },
        { name: 'GAB_AI', instance: GabAIProvider, requiresBaseUrl: false },
      ]

      validProviders.forEach(({ name, instance, requiresBaseUrl }) => {
        if (requiresBaseUrl) {
          const provider = createLLMProvider(name as any, 'http://localhost:1234')
          expect(provider).toBeInstanceOf(instance)
        } else {
          const provider = createLLMProvider(name as any)
          expect(provider).toBeInstanceOf(instance)
        }
      })
    })

    it('should reject provider names with different casing', () => {
      const invalidProviders = ['OpenAI', 'openAI', 'Openai', 'anthropic', 'Anthropic']

      invalidProviders.forEach(provider => {
        expect(() => createLLMProvider(provider as any)).toThrow(/Unsupported provider/)
      })
    })
  })
})
