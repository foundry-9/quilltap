/**
 * Unit Tests for OpenRouter Profile Migration
 * Tests the automatic conversion of OPENAI_COMPATIBLE profiles to OPENROUTER
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals'
import { isOpenRouterEndpoint } from '@/lib/llm/convert-openrouter-profiles'

describe('OpenRouter Profile Migration', () => {
  describe('isOpenRouterEndpoint', () => {
    it('should return true for openrouter.ai URLs', () => {
      expect(isOpenRouterEndpoint('https://openrouter.ai/api/v1')).toBe(true)
      expect(isOpenRouterEndpoint('http://openrouter.ai/api/v1')).toBe(true)
      expect(isOpenRouterEndpoint('https://openrouter.ai')).toBe(true)
    })

    it('should return true for openrouter.ai subdomains', () => {
      expect(isOpenRouterEndpoint('https://api.openrouter.ai/v1')).toBe(true)
      expect(isOpenRouterEndpoint('https://beta.openrouter.ai')).toBe(true)
    })

    it('should return false for non-OpenRouter URLs', () => {
      expect(isOpenRouterEndpoint('https://api.openai.com/v1')).toBe(false)
      expect(isOpenRouterEndpoint('http://localhost:11434')).toBe(false)
      expect(isOpenRouterEndpoint('https://example.com')).toBe(false)
    })

    it('should return false for null/undefined/empty', () => {
      expect(isOpenRouterEndpoint(null)).toBe(false)
      expect(isOpenRouterEndpoint(undefined)).toBe(false)
      expect(isOpenRouterEndpoint('')).toBe(false)
    })

    it('should return false for invalid URLs', () => {
      expect(isOpenRouterEndpoint('not-a-url')).toBe(false)
      expect(isOpenRouterEndpoint('ftp://openrouter.ai')).toBe(false)
    })

    it('should not match URLs that just contain openrouter.ai', () => {
      expect(isOpenRouterEndpoint('https://fakeopenrouter.ai.com')).toBe(false)
      expect(isOpenRouterEndpoint('https://openrouter.ai.phishing.com')).toBe(false)
    })
  })
})
