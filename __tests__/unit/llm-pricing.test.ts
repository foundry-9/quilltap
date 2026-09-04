/**
 * Unit Tests for Model Pricing System
 * Tests lib/llm/pricing.ts
 * Sprint 2.1: Real pricing data for cheap LLM selection
 */

import { describe, it, expect } from '@jest/globals'
import {
  ModelPricing,
  FALLBACK_PRICING,
  getAverageCostPer1M,
  estimateCost,
  sortByCost,
  findCheapestModel,
} from '@/lib/llm/pricing'

// Test fixtures
const cheapModel: ModelPricing = {
  modelId: 'gpt-4o-mini',
  provider: 'OPENAI',
  name: 'GPT-4o Mini',
  promptCostPer1M: 0.15,
  completionCostPer1M: 0.6,
  contextLength: 128000,
  supportsVision: true,
  supportsTools: true,
  fetchedAt: '2025-11-01T00:00:00Z',
}

const midTierModel: ModelPricing = {
  modelId: 'claude-sonnet-4-5-20250929',
  provider: 'ANTHROPIC',
  name: 'Claude 4.5 Sonnet',
  promptCostPer1M: 3,
  completionCostPer1M: 15,
  contextLength: 200000,
  supportsVision: true,
  supportsTools: true,
  fetchedAt: '2025-11-01T00:00:00Z',
}

const expensiveModel: ModelPricing = {
  modelId: 'claude-opus-4-1-20250805',
  provider: 'ANTHROPIC',
  name: 'Claude 4.1 Opus',
  promptCostPer1M: 15,
  completionCostPer1M: 75,
  contextLength: 200000,
  supportsVision: true,
  supportsTools: true,
  fetchedAt: '2025-11-01T00:00:00Z',
}

const freeModel: ModelPricing = {
  modelId: 'llama3.2:3b',
  provider: 'OLLAMA',
  name: 'Llama 3.2 3B',
  promptCostPer1M: 0,
  completionCostPer1M: 0,
  contextLength: null,
  supportsVision: false,
  supportsTools: false,
  fetchedAt: '2025-11-01T00:00:00Z',
}

const visionOnlyModel: ModelPricing = {
  modelId: 'gpt-4-vision',
  provider: 'OPENAI',
  name: 'GPT-4 Vision',
  promptCostPer1M: 10,
  completionCostPer1M: 30,
  contextLength: 128000,
  supportsVision: true,
  supportsTools: false,
  fetchedAt: '2025-11-01T00:00:00Z',
}

describe('Model Pricing System', () => {
  describe('FALLBACK_PRICING', () => {
    it('should have pricing data for Anthropic models', () => {
      expect(FALLBACK_PRICING.ANTHROPIC.length).toBeGreaterThan(0)
      expect(FALLBACK_PRICING.ANTHROPIC.some(m => m.modelId.includes('haiku'))).toBe(true)
      expect(FALLBACK_PRICING.ANTHROPIC.some(m => m.modelId.includes('sonnet'))).toBe(true)
      expect(FALLBACK_PRICING.ANTHROPIC.some(m => m.modelId.includes('opus'))).toBe(true)
    })

    it('should have pricing data for OpenAI models', () => {
      expect(FALLBACK_PRICING.OPENAI.length).toBeGreaterThan(0)
      expect(FALLBACK_PRICING.OPENAI.some(m => m.modelId === 'gpt-4o-mini')).toBe(true)
      expect(FALLBACK_PRICING.OPENAI.some(m => m.modelId === 'gpt-4o')).toBe(true)
    })

    it('should have pricing data for Google models', () => {
      expect(FALLBACK_PRICING.GOOGLE.length).toBeGreaterThan(0)
      expect(FALLBACK_PRICING.GOOGLE.some(m => m.modelId.includes('flash'))).toBe(true)
    })

    it('should have pricing data for Grok models', () => {
      expect(FALLBACK_PRICING.GROK.length).toBeGreaterThan(0)
    })

    it('should have empty arrays for API-fetched providers', () => {
      expect(FALLBACK_PRICING.OPENROUTER).toEqual([])
      expect(FALLBACK_PRICING.OLLAMA).toEqual([])
    })
  })

  describe('getAverageCostPer1M', () => {
    it('should calculate average of prompt and completion costs', () => {
      const avg = getAverageCostPer1M(cheapModel)
      expect(avg).toBe((0.15 + 0.6) / 2)
    })

    it('should return 0 for free models', () => {
      const avg = getAverageCostPer1M(freeModel)
      expect(avg).toBe(0)
    })

    it('should handle expensive models correctly', () => {
      const avg = getAverageCostPer1M(expensiveModel)
      expect(avg).toBe((15 + 75) / 2)
    })
  })

  describe('estimateCost', () => {
    it('should calculate cost for given token counts', () => {
      const cost = estimateCost(cheapModel, 1000, 500)
      // 1000 prompt tokens = 1000/1M * 0.15 = 0.00015
      // 500 completion tokens = 500/1M * 0.6 = 0.0003
      expect(cost).toBeCloseTo(0.00015 + 0.0003, 10)
    })

    it('should return 0 for free models', () => {
      const cost = estimateCost(freeModel, 10000, 5000)
      expect(cost).toBe(0)
    })

    it('should calculate correctly for 1M tokens', () => {
      const cost = estimateCost(midTierModel, 1_000_000, 1_000_000)
      expect(cost).toBe(3 + 15)
    })
  })

  describe('sortByCost', () => {
    it('should sort models by average cost (cheapest first)', () => {
      const models = [expensiveModel, cheapModel, midTierModel, freeModel]
      const sorted = sortByCost(models)

      expect(sorted[0].modelId).toBe('llama3.2:3b') // Free
      expect(sorted[1].modelId).toBe('gpt-4o-mini') // Cheapest paid
      expect(sorted[2].modelId).toBe('claude-sonnet-4-5-20250929') // Mid
      expect(sorted[3].modelId).toBe('claude-opus-4-1-20250805') // Expensive
    })

    it('should not mutate the original array', () => {
      const models = [expensiveModel, cheapModel]
      const sorted = sortByCost(models)

      expect(models[0].modelId).toBe('claude-opus-4-1-20250805')
      expect(sorted[0].modelId).toBe('gpt-4o-mini')
    })
  })

  describe('findCheapestModel', () => {
    const models = [expensiveModel, cheapModel, midTierModel, freeModel, visionOnlyModel]

    it('should find the cheapest model without constraints', () => {
      const cheapest = findCheapestModel(models)
      expect(cheapest?.modelId).toBe('llama3.2:3b')
    })

    it('should find cheapest model requiring vision', () => {
      const cheapest = findCheapestModel(models, { requireVision: true })
      expect(cheapest?.modelId).toBe('gpt-4o-mini')
      expect(cheapest?.supportsVision).toBe(true)
    })

    it('should find cheapest model requiring tools', () => {
      const cheapest = findCheapestModel(models, { requireTools: true })
      expect(cheapest?.modelId).toBe('gpt-4o-mini')
      expect(cheapest?.supportsTools).toBe(true)
    })

    it('should find cheapest model with minimum context length', () => {
      // Note: null contextLength passes (treated as unlimited), so freeModel passes
      // We need to exclude it by also requiring vision or tools
      const cheapest = findCheapestModel(models, { minContextLength: 150000, requireVision: true })
      expect(cheapest?.modelId).toBe('claude-sonnet-4-5-20250929')
      expect(cheapest?.contextLength).toBeGreaterThanOrEqual(150000)
    })

    it('should return null if no models match constraints', () => {
      const cheapest = findCheapestModel(models, {
        requireVision: true,
        requireTools: true,
        minContextLength: 500000,
      })
      expect(cheapest).toBeNull()
    })

    it('should handle null context length (treat as unlimited)', () => {
      const modelsWithNull = [freeModel] // Has null contextLength
      const cheapest = findCheapestModel(modelsWithNull, { minContextLength: 1000000 })
      expect(cheapest?.modelId).toBe('llama3.2:3b')
    })
  })

})
