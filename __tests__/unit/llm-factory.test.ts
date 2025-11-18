/**
 * Unit Tests for LLM Provider Factory
 * Tests lib/llm/factory.ts
 */

import { describe, it, expect } from '@jest/globals'
import { createLLMProvider } from '@/lib/llm/factory'
import { OpenAIProvider } from '@/lib/llm/openai'

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

  describe('Unsupported providers (Phase 0.5)', () => {
    it('should throw error for ANTHROPIC provider', () => {
      expect(() => {
        createLLMProvider('ANTHROPIC')
      }).toThrow('Provider ANTHROPIC not yet implemented. Phase 0.5 supports OpenAI only.')
    })

    it('should throw error for OLLAMA provider', () => {
      expect(() => {
        createLLMProvider('OLLAMA')
      }).toThrow('Provider OLLAMA not yet implemented. Phase 0.5 supports OpenAI only.')
    })

    it('should throw error for OPENROUTER provider', () => {
      expect(() => {
        createLLMProvider('OPENROUTER')
      }).toThrow('Provider OPENROUTER not yet implemented. Phase 0.5 supports OpenAI only.')
    })

    it('should throw error for OPENAI_COMPATIBLE provider', () => {
      expect(() => {
        createLLMProvider('OPENAI_COMPATIBLE')
      }).toThrow('Provider OPENAI_COMPATIBLE not yet implemented. Phase 0.5 supports OpenAI only.')
    })

    it('should throw error with baseUrl parameter for unsupported providers', () => {
      expect(() => {
        createLLMProvider('OLLAMA', 'http://localhost:11434')
      }).toThrow('Provider OLLAMA not yet implemented. Phase 0.5 supports OpenAI only.')
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
    it('should only accept valid Provider type strings', () => {
      const validProviders = ['OPENAI', 'ANTHROPIC', 'OLLAMA', 'OPENROUTER', 'OPENAI_COMPATIBLE']

      validProviders.forEach(provider => {
        if (provider === 'OPENAI') {
          expect(() => createLLMProvider(provider as any)).not.toThrow(/Unsupported provider/)
        } else {
          expect(() => createLLMProvider(provider as any)).toThrow(/not yet implemented/)
        }
      })
    })

    it('should reject provider names with different casing', () => {
      const invalidProviders = ['OpenAI', 'openAI', 'Openai']

      invalidProviders.forEach(provider => {
        expect(() => createLLMProvider(provider as any)).toThrow(/Unsupported provider/)
      })
    })
  })
})
