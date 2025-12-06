/**
 * Unit Tests for Cheap LLM Provider Selection
 * Tests lib/llm/cheap-llm.ts
 * Sprint 2: Memory System - Cheap LLM Support
 */

import { describe, it, expect } from '@jest/globals'
import {
  getCheapLLMProvider,
  getCheapestModel,
  isCheapModel,
  estimateModelCost,
  validateCheapLLMConfig,
  DEFAULT_CHEAP_LLM_CONFIG,
  RECOMMENDED_CHEAP_MODELS,
  type CheapLLMConfig,
  type CheapLLMSelection,
} from '@/lib/llm/cheap-llm'
import type { ConnectionProfile, Provider } from '@/lib/schemas/types'

// Helper to create a mock connection profile
function createMockProfile(
  id: string,
  provider: Provider,
  modelName: string,
  baseUrl?: string,
  isCheap?: boolean
): ConnectionProfile {
  return {
    id,
    userId: 'test-user-id',
    name: `Test ${provider} Profile`,
    provider,
    modelName,
    baseUrl: baseUrl || null,
    apiKeyId: 'test-api-key-id',
    parameters: {},
    isDefault: false,
    isCheap: isCheap || false,
    tags: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

describe('Cheap LLM Provider Selection', () => {
  describe('getCheapestModel', () => {
    it('should return the cheapest model for Anthropic', () => {
      const model = getCheapestModel('ANTHROPIC')
      expect(model).toBe('claude-haiku-4-5-20251001')
    })

    it('should return the cheapest model for OpenAI', () => {
      const model = getCheapestModel('OPENAI')
      expect(model).toBe('gpt-4o-mini')
    })

    it('should return the cheapest model for Google', () => {
      const model = getCheapestModel('GOOGLE')
      expect(model).toBe('gemini-2.0-flash')
    })

    it('should return the cheapest model for Ollama', () => {
      const model = getCheapestModel('OLLAMA')
      expect(model).toBe('llama3.2:3b')
    })

    it('should return the cheapest model for OpenRouter', () => {
      const model = getCheapestModel('OPENROUTER')
      expect(model).toBe('openai/gpt-4o-mini')
    })

    it('should return the cheapest model for Grok', () => {
      const model = getCheapestModel('GROK')
      expect(model).toBe('grok-2-mini')
    })
  })

  describe('getCheapLLMProvider', () => {
    const anthropicProfile = createMockProfile(
      'anthropic-profile',
      'ANTHROPIC',
      'claude-sonnet-4-5-20250929'
    )

    const ollamaProfile = createMockProfile(
      'ollama-profile',
      'OLLAMA',
      'llama3.2:70b',
      'http://localhost:11434'
    )

    const cheapUserProfile = createMockProfile(
      'cheap-profile',
      'OPENAI',
      'gpt-4o-mini'
    )

    describe('defaultCheapProfileId (priority 1)', () => {
      it('should use the global default cheap profile when set', () => {
        const config: CheapLLMConfig = {
          strategy: 'PROVIDER_CHEAPEST',
          defaultCheapProfileId: 'cheap-profile',
          fallbackToLocal: false,
        }

        const selection = getCheapLLMProvider(
          anthropicProfile,
          config,
          [anthropicProfile, cheapUserProfile, ollamaProfile]
        )

        expect(selection.provider).toBe('OPENAI')
        expect(selection.modelName).toBe('gpt-4o-mini')
        expect(selection.connectionProfileId).toBe('cheap-profile')
      })

      it('should override USER_DEFINED strategy when defaultCheapProfileId is set', () => {
        const config: CheapLLMConfig = {
          strategy: 'USER_DEFINED',
          userDefinedProfileId: 'anthropic-profile',
          defaultCheapProfileId: 'cheap-profile',
          fallbackToLocal: false,
        }

        const selection = getCheapLLMProvider(
          anthropicProfile,
          config,
          [anthropicProfile, cheapUserProfile, ollamaProfile]
        )

        expect(selection.provider).toBe('OPENAI')
        expect(selection.connectionProfileId).toBe('cheap-profile')
      })

      it('should fall through to other strategies if defaultCheapProfileId not found', () => {
        const config: CheapLLMConfig = {
          strategy: 'PROVIDER_CHEAPEST',
          defaultCheapProfileId: 'non-existent-cheap-profile',
          fallbackToLocal: false,
        }

        const selection = getCheapLLMProvider(
          anthropicProfile,
          config,
          [anthropicProfile]
        )

        expect(selection.provider).toBe('ANTHROPIC')
        expect(selection.modelName).toBe('claude-haiku-4-5-20251001')
      })
    })

    describe('PROVIDER_CHEAPEST strategy (default)', () => {
      it('should return the cheapest model for the current provider', () => {
        const selection = getCheapLLMProvider(anthropicProfile)

        expect(selection.provider).toBe('ANTHROPIC')
        expect(selection.modelName).toBe('claude-haiku-4-5-20251001')
        expect(selection.connectionProfileId).toBe('anthropic-profile')
        expect(selection.isLocal).toBe(false)
      })

      it('should mark Ollama as local', () => {
        const selection = getCheapLLMProvider(ollamaProfile)

        expect(selection.provider).toBe('OLLAMA')
        expect(selection.isLocal).toBe(true)
        expect(selection.baseUrl).toBe('http://localhost:11434')
      })
    })

    describe('USER_DEFINED strategy', () => {
      it('should use the user-defined profile when available', () => {
        const config: CheapLLMConfig = {
          strategy: 'USER_DEFINED',
          userDefinedProfileId: 'cheap-profile',
          fallbackToLocal: false,
        }

        const selection = getCheapLLMProvider(
          anthropicProfile,
          config,
          [anthropicProfile, cheapUserProfile, ollamaProfile]
        )

        expect(selection.provider).toBe('OPENAI')
        expect(selection.modelName).toBe('gpt-4o-mini')
        expect(selection.connectionProfileId).toBe('cheap-profile')
      })

      it('should fall back to PROVIDER_CHEAPEST if user profile not found', () => {
        const config: CheapLLMConfig = {
          strategy: 'USER_DEFINED',
          userDefinedProfileId: 'non-existent-profile',
          fallbackToLocal: false,
        }

        const selection = getCheapLLMProvider(
          anthropicProfile,
          config,
          [anthropicProfile, ollamaProfile]
        )

        expect(selection.provider).toBe('ANTHROPIC')
        expect(selection.modelName).toBe('claude-haiku-4-5-20251001')
      })
    })

    describe('isCheap profile flag (priority 3)', () => {
      it('should use any profile marked as isCheap=true', () => {
        const cheapOpenAIProfile = createMockProfile(
          'cheap-openai',
          'OPENAI',
          'gpt-4o-mini',
          undefined,
          true
        )

        const selection = getCheapLLMProvider(
          anthropicProfile,
          DEFAULT_CHEAP_LLM_CONFIG,
          [anthropicProfile, cheapOpenAIProfile]
        )

        expect(selection.provider).toBe('OPENAI')
        expect(selection.modelName).toBe('gpt-4o-mini')
        expect(selection.connectionProfileId).toBe('cheap-openai')
      })

      it('should prefer local Ollama profiles when marked as cheap', () => {
        const cheapOllamaProfile = createMockProfile(
          'cheap-ollama',
          'OLLAMA',
          'llama3.2:3b',
          'http://localhost:11434',
          true
        )
        const cheapOpenAIProfile = createMockProfile(
          'cheap-openai',
          'OPENAI',
          'gpt-4o-mini',
          undefined,
          true
        )

        const selection = getCheapLLMProvider(
          anthropicProfile,
          DEFAULT_CHEAP_LLM_CONFIG,
          [anthropicProfile, cheapOpenAIProfile, cheapOllamaProfile]
        )

        expect(selection.provider).toBe('OLLAMA')
        expect(selection.isLocal).toBe(true)
        expect(selection.connectionProfileId).toBe('cheap-ollama')
      })

      it('should use the first non-local cheap profile if no local cheap profile exists', () => {
        const cheapOpenAIProfile = createMockProfile(
          'cheap-openai',
          'OPENAI',
          'gpt-4o-mini',
          undefined,
          true
        )
        const cheapGoogleProfile = createMockProfile(
          'cheap-google',
          'GOOGLE',
          'gemini-2.0-flash',
          undefined,
          true
        )

        const selection = getCheapLLMProvider(
          anthropicProfile,
          DEFAULT_CHEAP_LLM_CONFIG,
          [anthropicProfile, cheapOpenAIProfile, cheapGoogleProfile]
        )

        // Should use the first cheap profile found
        expect(selection.provider).toBe('OPENAI')
        expect(selection.connectionProfileId).toBe('cheap-openai')
      })
    })

    describe('LOCAL_FIRST strategy', () => {
      it('should prefer Ollama when available', () => {
        const config: CheapLLMConfig = {
          strategy: 'LOCAL_FIRST',
          fallbackToLocal: true,
        }

        const selection = getCheapLLMProvider(
          anthropicProfile,
          config,
          [anthropicProfile, ollamaProfile]
        )

        expect(selection.provider).toBe('OLLAMA')
        expect(selection.modelName).toBe('llama3.2:70b')
        expect(selection.isLocal).toBe(true)
      })

      it('should fall back to PROVIDER_CHEAPEST if no Ollama profile', () => {
        const config: CheapLLMConfig = {
          strategy: 'LOCAL_FIRST',
          fallbackToLocal: true,
        }

        const selection = getCheapLLMProvider(
          anthropicProfile,
          config,
          [anthropicProfile, cheapUserProfile]
        )

        expect(selection.provider).toBe('ANTHROPIC')
        expect(selection.modelName).toBe('claude-haiku-4-5-20251001')
      })
    })

    describe('fallbackToLocal option', () => {
      it('should use Ollama if available and fallbackToLocal is true', () => {
        const config: CheapLLMConfig = {
          strategy: 'PROVIDER_CHEAPEST',
          fallbackToLocal: true,
        }

        const selection = getCheapLLMProvider(
          anthropicProfile,
          config,
          [anthropicProfile, ollamaProfile],
          true // ollamaAvailable
        )

        expect(selection.provider).toBe('OLLAMA')
        expect(selection.isLocal).toBe(true)
      })

      it('should not use Ollama if fallbackToLocal is false', () => {
        const config: CheapLLMConfig = {
          strategy: 'PROVIDER_CHEAPEST',
          fallbackToLocal: false,
        }

        const selection = getCheapLLMProvider(
          anthropicProfile,
          config,
          [anthropicProfile, ollamaProfile],
          true // ollamaAvailable
        )

        expect(selection.provider).toBe('ANTHROPIC')
        expect(selection.isLocal).toBe(false)
      })
    })

    describe('onNoCheapLLM callback', () => {
      it('should call onNoCheapLLM when no cheap LLM is available', () => {
        const onNoCheapLLMCallback = jest.fn()

        const config: CheapLLMConfig = {
          strategy: 'USER_DEFINED',
          userDefinedProfileId: 'non-existent',
          fallbackToLocal: false,
        }

        getCheapLLMProvider(
          anthropicProfile,
          config,
          [anthropicProfile],
          false,
          onNoCheapLLMCallback
        )

        expect(onNoCheapLLMCallback).toHaveBeenCalled()
      })

      it('should not call onNoCheapLLM when a cheap LLM is available', () => {
        const onNoCheapLLMCallback = jest.fn()

        const cheapOpenAIProfile = createMockProfile(
          'cheap-openai',
          'OPENAI',
          'gpt-4o-mini',
          undefined,
          true
        )

        getCheapLLMProvider(
          anthropicProfile,
          DEFAULT_CHEAP_LLM_CONFIG,
          [anthropicProfile, cheapOpenAIProfile],
          false,
          onNoCheapLLMCallback
        )

        expect(onNoCheapLLMCallback).not.toHaveBeenCalled()
      })
    })
  })

  describe('isCheapModel', () => {
    it('should recognize recommended cheap models', () => {
      expect(isCheapModel('ANTHROPIC', 'claude-haiku-4-5-20251001')).toBe(true)
      expect(isCheapModel('OPENAI', 'gpt-4o-mini')).toBe(true)
      expect(isCheapModel('GOOGLE', 'gemini-2.0-flash')).toBe(true)
    })

    it('should recognize models with cheap indicators in name', () => {
      expect(isCheapModel('ANTHROPIC', 'claude-3-haiku')).toBe(true)
      expect(isCheapModel('OPENAI', 'gpt-3.5-turbo')).toBe(true)
      expect(isCheapModel('OLLAMA', 'phi3:mini')).toBe(true)
      expect(isCheapModel('OLLAMA', 'llama3.2:3b')).toBe(true)
      expect(isCheapModel('GOOGLE', 'gemini-flash')).toBe(true)
    })

    it('should not recognize expensive models as cheap', () => {
      expect(isCheapModel('ANTHROPIC', 'claude-opus-4-1-20250805')).toBe(false)
      expect(isCheapModel('OPENAI', 'gpt-4o')).toBe(false)
      expect(isCheapModel('GOOGLE', 'gemini-2.0-pro')).toBe(false)
    })
  })

  describe('estimateModelCost', () => {
    it('should rate local models as cheapest (1)', () => {
      expect(estimateModelCost('OLLAMA', 'llama3.2:70b')).toBe(1)
      expect(estimateModelCost('OLLAMA', 'mistral:7b')).toBe(1)
    })

    it('should rate mini/flash models as cheap (2)', () => {
      expect(estimateModelCost('OPENAI', 'gpt-4o-mini')).toBe(2)
      expect(estimateModelCost('ANTHROPIC', 'claude-haiku-4-5-20251001')).toBe(2)
      expect(estimateModelCost('GOOGLE', 'gemini-2.0-flash')).toBe(2)
    })

    it('should rate standard models as mid-tier (3)', () => {
      expect(estimateModelCost('ANTHROPIC', 'claude-sonnet-4-5-20250929')).toBe(3)
      expect(estimateModelCost('OPENAI', 'gpt-4o')).toBe(3)
      expect(estimateModelCost('GOOGLE', 'gemini-1.5-pro')).toBe(3)
    })

    it('should rate premium models as expensive (5)', () => {
      expect(estimateModelCost('ANTHROPIC', 'claude-opus-4-1-20250805')).toBe(5)
      expect(estimateModelCost('OPENAI', 'o1-preview')).toBe(5)
    })
  })

  describe('validateCheapLLMConfig', () => {
    const profiles = [
      createMockProfile('cheap-profile', 'OPENAI', 'gpt-4o-mini'),
      createMockProfile('expensive-profile', 'ANTHROPIC', 'claude-opus-4-1-20250805'),
    ]

    it('should validate PROVIDER_CHEAPEST strategy', () => {
      const config: CheapLLMConfig = {
        strategy: 'PROVIDER_CHEAPEST',
        fallbackToLocal: true,
      }

      const result = validateCheapLLMConfig(config, profiles)
      expect(result.valid).toBe(true)
      expect(result.error).toBeUndefined()
    })

    it('should validate LOCAL_FIRST strategy', () => {
      const config: CheapLLMConfig = {
        strategy: 'LOCAL_FIRST',
        fallbackToLocal: true,
      }

      const result = validateCheapLLMConfig(config, profiles)
      expect(result.valid).toBe(true)
    })

    it('should require userDefinedProfileId for USER_DEFINED strategy', () => {
      const config: CheapLLMConfig = {
        strategy: 'USER_DEFINED',
        fallbackToLocal: false,
      }

      const result = validateCheapLLMConfig(config, profiles)
      expect(result.valid).toBe(false)
      expect(result.error).toContain('requires userDefinedProfileId')
    })

    it('should fail if user-defined profile not found', () => {
      const config: CheapLLMConfig = {
        strategy: 'USER_DEFINED',
        userDefinedProfileId: 'non-existent',
        fallbackToLocal: false,
      }

      const result = validateCheapLLMConfig(config, profiles)
      expect(result.valid).toBe(false)
      expect(result.error).toContain('not found')
    })

    it('should warn if user-defined profile uses expensive model', () => {
      const config: CheapLLMConfig = {
        strategy: 'USER_DEFINED',
        userDefinedProfileId: 'expensive-profile',
        fallbackToLocal: false,
      }

      const result = validateCheapLLMConfig(config, profiles)
      expect(result.valid).toBe(true) // Still valid, just a warning
      expect(result.error).toContain('not a recommended cheap model')
    })

    it('should validate user-defined profile with cheap model', () => {
      const config: CheapLLMConfig = {
        strategy: 'USER_DEFINED',
        userDefinedProfileId: 'cheap-profile',
        fallbackToLocal: false,
      }

      const result = validateCheapLLMConfig(config, profiles)
      expect(result.valid).toBe(true)
      expect(result.error).toBeUndefined()
    })
  })

  describe('DEFAULT_CHEAP_LLM_CONFIG', () => {
    it('should use PROVIDER_CHEAPEST strategy by default', () => {
      expect(DEFAULT_CHEAP_LLM_CONFIG.strategy).toBe('PROVIDER_CHEAPEST')
    })

    it('should enable fallbackToLocal by default', () => {
      expect(DEFAULT_CHEAP_LLM_CONFIG.fallbackToLocal).toBe(true)
    })
  })

  describe('RECOMMENDED_CHEAP_MODELS', () => {
    it('should have recommendations for all providers', () => {
      const providers: Provider[] = [
        'ANTHROPIC',
        'OPENAI',
        'GOOGLE',
        'GROK',
        'OPENROUTER',
        'OLLAMA',
        'OPENAI_COMPATIBLE',
        'GAB_AI',
      ]

      for (const provider of providers) {
        expect(RECOMMENDED_CHEAP_MODELS[provider]).toBeDefined()
        expect(RECOMMENDED_CHEAP_MODELS[provider].length).toBeGreaterThan(0)
      }
    })
  })
})
