/**
 * Unit Tests for Cheap LLM Settings Schema
 * Tests the Zod schema for cheap LLM configuration
 * Sprint 2: Memory System - Cheap LLM Support
 */

import { describe, it, expect } from '@jest/globals'
import {
  CheapLLMStrategyEnum,
  EmbeddingProviderEnum,
  CheapLLMSettingsSchema,
  ChatSettingsSchema,
  type CheapLLMSettings,
} from '@/lib/json-store/schemas/types'

describe('Cheap LLM Settings Schema', () => {
  describe('CheapLLMStrategyEnum', () => {
    it('should accept valid strategy values', () => {
      expect(CheapLLMStrategyEnum.parse('USER_DEFINED')).toBe('USER_DEFINED')
      expect(CheapLLMStrategyEnum.parse('PROVIDER_CHEAPEST')).toBe('PROVIDER_CHEAPEST')
      expect(CheapLLMStrategyEnum.parse('LOCAL_FIRST')).toBe('LOCAL_FIRST')
    })

    it('should reject invalid strategy values', () => {
      expect(() => CheapLLMStrategyEnum.parse('INVALID')).toThrow()
      expect(() => CheapLLMStrategyEnum.parse('')).toThrow()
      expect(() => CheapLLMStrategyEnum.parse(123)).toThrow()
    })
  })

  describe('EmbeddingProviderEnum', () => {
    it('should accept valid embedding provider values', () => {
      expect(EmbeddingProviderEnum.parse('SAME_PROVIDER')).toBe('SAME_PROVIDER')
      expect(EmbeddingProviderEnum.parse('OPENAI')).toBe('OPENAI')
      expect(EmbeddingProviderEnum.parse('LOCAL')).toBe('LOCAL')
    })

    it('should reject invalid embedding provider values', () => {
      expect(() => EmbeddingProviderEnum.parse('ANTHROPIC')).toThrow()
      expect(() => EmbeddingProviderEnum.parse('GOOGLE')).toThrow()
    })
  })

  describe('CheapLLMSettingsSchema', () => {
    it('should accept valid settings with all fields', () => {
      const settings: CheapLLMSettings = {
        strategy: 'USER_DEFINED',
        userDefinedProfileId: '123e4567-e89b-12d3-a456-426614174000',
        fallbackToLocal: true,
        embeddingProvider: 'OPENAI',
      }

      const result = CheapLLMSettingsSchema.parse(settings)
      expect(result).toEqual(settings)
    })

    it('should provide default values', () => {
      const result = CheapLLMSettingsSchema.parse({})

      expect(result.strategy).toBe('PROVIDER_CHEAPEST')
      expect(result.fallbackToLocal).toBe(true)
      expect(result.embeddingProvider).toBe('OPENAI')
    })

    it('should accept settings without optional userDefinedProfileId', () => {
      const settings = {
        strategy: 'PROVIDER_CHEAPEST',
        fallbackToLocal: false,
        embeddingProvider: 'LOCAL',
      }

      const result = CheapLLMSettingsSchema.parse(settings)
      expect(result.strategy).toBe('PROVIDER_CHEAPEST')
      expect(result.fallbackToLocal).toBe(false)
      expect(result.embeddingProvider).toBe('LOCAL')
    })

    it('should accept null for userDefinedProfileId', () => {
      const settings = {
        strategy: 'LOCAL_FIRST',
        userDefinedProfileId: null,
        fallbackToLocal: true,
        embeddingProvider: 'SAME_PROVIDER',
      }

      const result = CheapLLMSettingsSchema.parse(settings)
      expect(result.userDefinedProfileId).toBeNull()
    })

    it('should validate userDefinedProfileId as UUID when provided', () => {
      const invalidSettings = {
        strategy: 'USER_DEFINED',
        userDefinedProfileId: 'not-a-uuid',
        fallbackToLocal: true,
        embeddingProvider: 'OPENAI',
      }

      expect(() => CheapLLMSettingsSchema.parse(invalidSettings)).toThrow()
    })
  })

  describe('ChatSettingsSchema with cheapLLMSettings', () => {
    const validChatSettings = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      userId: '123e4567-e89b-12d3-a456-426614174001',
      avatarDisplayMode: 'ALWAYS',
      avatarDisplayStyle: 'CIRCULAR',
      tagStyles: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    it('should provide default cheapLLMSettings when not specified', () => {
      const result = ChatSettingsSchema.parse(validChatSettings)

      expect(result.cheapLLMSettings).toBeDefined()
      expect(result.cheapLLMSettings.strategy).toBe('PROVIDER_CHEAPEST')
      expect(result.cheapLLMSettings.fallbackToLocal).toBe(true)
      expect(result.cheapLLMSettings.embeddingProvider).toBe('OPENAI')
    })

    it('should accept custom cheapLLMSettings', () => {
      const settings = {
        ...validChatSettings,
        cheapLLMSettings: {
          strategy: 'LOCAL_FIRST',
          fallbackToLocal: false,
          embeddingProvider: 'LOCAL',
        },
      }

      const result = ChatSettingsSchema.parse(settings)

      expect(result.cheapLLMSettings.strategy).toBe('LOCAL_FIRST')
      expect(result.cheapLLMSettings.fallbackToLocal).toBe(false)
      expect(result.cheapLLMSettings.embeddingProvider).toBe('LOCAL')
    })

    it('should accept cheapLLMSettings with userDefinedProfileId', () => {
      const settings = {
        ...validChatSettings,
        cheapLLMSettings: {
          strategy: 'USER_DEFINED',
          userDefinedProfileId: '123e4567-e89b-12d3-a456-426614174002',
          fallbackToLocal: true,
          embeddingProvider: 'OPENAI',
        },
      }

      const result = ChatSettingsSchema.parse(settings)

      expect(result.cheapLLMSettings.strategy).toBe('USER_DEFINED')
      expect(result.cheapLLMSettings.userDefinedProfileId).toBe('123e4567-e89b-12d3-a456-426614174002')
    })

    it('should merge partial cheapLLMSettings with defaults', () => {
      const settings = {
        ...validChatSettings,
        cheapLLMSettings: {
          strategy: 'LOCAL_FIRST',
        },
      }

      const result = ChatSettingsSchema.parse(settings)

      expect(result.cheapLLMSettings.strategy).toBe('LOCAL_FIRST')
      // Should have defaults for other fields
      expect(result.cheapLLMSettings.fallbackToLocal).toBe(true)
      expect(result.cheapLLMSettings.embeddingProvider).toBe('OPENAI')
    })
  })
})
