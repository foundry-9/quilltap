/**
 * Unit Tests for Cheap LLM Provider Selection
 * Tests lib/llm/cheap-llm.ts
 * Sprint 2: Memory System - Cheap LLM Support
 */

import { describe, it, expect } from '@jest/globals'
import {
  getCheapLLMProvider,
  getCheapestModel,
  resolveUncensoredCheapLLMSelection,
  profileParams,
  DEFAULT_CHEAP_LLM_CONFIG,
  RECOMMENDED_CHEAP_MODELS,
  type CheapLLMConfig,
  type CheapLLMSelection,
} from '@/lib/llm/cheap-llm'
import type { ConnectionProfile, Provider } from '@/lib/schemas/types'
import type { DangerousContentSettings } from '@/lib/schemas/settings.types'

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
      ]

      for (const provider of providers) {
        expect(RECOMMENDED_CHEAP_MODELS[provider]).toBeDefined()
        expect(RECOMMENDED_CHEAP_MODELS[provider].length).toBeGreaterThan(0)
      }
    })
  })

  describe('resolveUncensoredCheapLLMSelection', () => {
    const standardSelection: CheapLLMSelection = {
      provider: 'OPENAI',
      modelName: 'gpt-4o-mini',
      connectionProfileId: 'standard-profile',
      isLocal: false,
    }

    const uncensoredProfile = createMockProfile(
      'uncensored-profile',
      'DEEPSEEK',
      'deepseek-chat'
    )
    // Add isDangerousCompatible to the uncensored profile
    ;(uncensoredProfile as any).isDangerousCompatible = true

    const dangerSettingsAutoRoute: DangerousContentSettings = {
      mode: 'AUTO_ROUTE',
      scanTextChat: true,
      scanImagePrompts: false,
      scanImageGeneration: false,
      uncensoredTextProfileId: 'uncensored-profile',
      uncensoredImageProfileId: null,
    } as DangerousContentSettings

    const dangerSettingsOff: DangerousContentSettings = {
      mode: 'OFF',
      scanTextChat: false,
      scanImagePrompts: false,
      scanImageGeneration: false,
      uncensoredTextProfileId: null,
      uncensoredImageProfileId: null,
    } as DangerousContentSettings

    it('should return standard selection when chat is not dangerous', () => {
      const result = resolveUncensoredCheapLLMSelection(
        standardSelection,
        false,
        dangerSettingsAutoRoute,
        [uncensoredProfile]
      )
      expect(result).toBe(standardSelection)
    })

    it('should return standard selection when danger settings are undefined', () => {
      const result = resolveUncensoredCheapLLMSelection(
        standardSelection,
        true,
        undefined,
        [uncensoredProfile]
      )
      expect(result).toBe(standardSelection)
    })

    it('should return standard selection when mode is OFF', () => {
      const result = resolveUncensoredCheapLLMSelection(
        standardSelection,
        true,
        dangerSettingsOff,
        [uncensoredProfile]
      )
      expect(result).toBe(standardSelection)
    })

    it('should return uncensored selection when chat is dangerous and uncensored profile is configured', () => {
      const result = resolveUncensoredCheapLLMSelection(
        standardSelection,
        true,
        dangerSettingsAutoRoute,
        [uncensoredProfile]
      )
      expect(result.provider).toBe('DEEPSEEK')
      expect(result.modelName).toBe('deepseek-chat')
      expect(result.connectionProfileId).toBe('uncensored-profile')
    })

    it('should find any isDangerousCompatible profile when no uncensored text profile is configured', () => {
      const settingsWithoutProfile = {
        ...dangerSettingsAutoRoute,
        uncensoredTextProfileId: null,
      } as DangerousContentSettings

      const result = resolveUncensoredCheapLLMSelection(
        standardSelection,
        true,
        settingsWithoutProfile,
        [uncensoredProfile]
      )
      expect(result.provider).toBe('DEEPSEEK')
      expect(result.connectionProfileId).toBe('uncensored-profile')
    })

    it('should return standard selection when no uncensored profiles exist (fail-open)', () => {
      const settingsWithoutProfile = {
        ...dangerSettingsAutoRoute,
        uncensoredTextProfileId: null,
      } as DangerousContentSettings

      const standardProfile = createMockProfile('standard-profile', 'OPENAI', 'gpt-4o-mini')

      const result = resolveUncensoredCheapLLMSelection(
        standardSelection,
        true,
        settingsWithoutProfile,
        [standardProfile]
      )
      expect(result).toBe(standardSelection)
    })

    it('should return standard selection when configured uncensored profile is not in available profiles', () => {
      const standardProfile = createMockProfile('standard-profile', 'OPENAI', 'gpt-4o-mini')

      const result = resolveUncensoredCheapLLMSelection(
        standardSelection,
        true,
        dangerSettingsAutoRoute,
        [standardProfile] // uncensored-profile not in list
      )
      // Falls through to isDangerousCompatible scan, but standardProfile doesn't have it
      expect(result).toBe(standardSelection)
    })

    it('should work with WARN mode (not just AUTO_ROUTE)', () => {
      const warnSettings = {
        ...dangerSettingsAutoRoute,
        mode: 'WARN' as const,
      } as DangerousContentSettings

      const result = resolveUncensoredCheapLLMSelection(
        standardSelection,
        true,
        warnSettings,
        [uncensoredProfile]
      )
      // WARN mode is not OFF, so it should still route to uncensored
      expect(result.provider).toBe('DEEPSEEK')
    })
  })
})

describe('profileParams', () => {
  it('returns the parameters blob untouched for non-Ollama providers', () => {
    const params = { temperature: 0.7, thinking: 'enabled' }
    expect(
      profileParams({ provider: 'DEEPSEEK', parameters: params, maxContext: 131072 })
    ).toBe(params)
  })

  it('injects num_ctx from maxContext for Ollama profiles', () => {
    expect(
      profileParams({
        provider: 'OLLAMA',
        parameters: { temperature: 0.7, max_tokens: 16384 },
        maxContext: 40960,
      })
    ).toEqual({ temperature: 0.7, max_tokens: 16384, num_ctx: 40960 })
  })

  it('injects num_ctx even when the profile has no parameters blob', () => {
    expect(profileParams({ provider: 'OLLAMA', parameters: undefined, maxContext: 65536 }))
      .toEqual({ num_ctx: 65536 })
  })

  it('does not clobber an explicit num_ctx in the parameters blob', () => {
    expect(
      profileParams({ provider: 'OLLAMA', parameters: { num_ctx: 8192 }, maxContext: 65536 })
    ).toEqual({ num_ctx: 8192 })
  })

  it('leaves Ollama profiles without maxContext at the server default', () => {
    const params = { temperature: 0.7 }
    expect(profileParams({ provider: 'OLLAMA', parameters: params, maxContext: null })).toBe(params)
    expect(profileParams({ provider: 'OLLAMA', parameters: undefined, maxContext: null })).toBeUndefined()
  })

  it('does not mutate the profile parameters object when injecting', () => {
    const params = { temperature: 0.7 }
    profileParams({ provider: 'OLLAMA', parameters: params, maxContext: 40960 })
    expect(params).toEqual({ temperature: 0.7 })
  })
})
