/**
 * Unit Tests for LLM Error Handling
 * Tests lib/llm/errors.ts
 * Phase 0.7: Multi-Provider Support
 */

import { describe, it, expect } from '@jest/globals'
import {
  LLMProviderError,
  APIKeyError,
  RateLimitError,
  NetworkError,
  ModelNotFoundError,
  InvalidRequestError,
} from '@/lib/llm/errors'

describe('LLM Error Classes', () => {
  describe('LLMProviderError', () => {
    it('should create error with provider and message', () => {
      const error = new LLMProviderError('OPENAI', 'Test error')

      expect(error).toBeInstanceOf(Error)
      expect(error).toBeInstanceOf(LLMProviderError)
      expect(error.provider).toBe('OPENAI')
      expect(error.message).toBe('Test error')
      expect(error.name).toBe('LLMProviderError')
    })

    it('should store original error', () => {
      const originalError = new Error('Original')
      const error = new LLMProviderError('ANTHROPIC', 'Wrapped error', originalError)

      expect(error.originalError).toBe(originalError)
    })
  })

  describe('APIKeyError', () => {
    it('should create error with default message', () => {
      const error = new APIKeyError('OPENAI')

      expect(error).toBeInstanceOf(LLMProviderError)
      expect(error).toBeInstanceOf(APIKeyError)
      expect(error.provider).toBe('OPENAI')
      expect(error.message).toBe('Invalid or missing API key')
      expect(error.name).toBe('APIKeyError')
    })

    it('should create error with custom message', () => {
      const error = new APIKeyError('ANTHROPIC', 'Custom API key error')

      expect(error.message).toBe('Custom API key error')
      expect(error.provider).toBe('ANTHROPIC')
    })
  })

  describe('RateLimitError', () => {
    it('should create error with default message', () => {
      const error = new RateLimitError('OPENAI')

      expect(error).toBeInstanceOf(LLMProviderError)
      expect(error).toBeInstanceOf(RateLimitError)
      expect(error.message).toBe('Rate limit exceeded')
      expect(error.name).toBe('RateLimitError')
    })

    it('should store retryAfter value', () => {
      const error = new RateLimitError('OPENAI', 60)

      expect(error.retryAfter).toBe(60)
    })

    it('should create error with custom message', () => {
      const error = new RateLimitError('OPENROUTER', 30, 'Custom rate limit message')

      expect(error.message).toBe('Custom rate limit message')
      expect(error.retryAfter).toBe(30)
    })
  })

  describe('NetworkError', () => {
    it('should create error with default message', () => {
      const error = new NetworkError('OLLAMA')

      expect(error).toBeInstanceOf(LLMProviderError)
      expect(error).toBeInstanceOf(NetworkError)
      expect(error.message).toBe('Network error occurred')
      expect(error.name).toBe('NetworkError')
    })

    it('should create error with custom message', () => {
      const error = new NetworkError('OLLAMA', 'Connection refused')

      expect(error.message).toBe('Connection refused')
    })
  })

  describe('ModelNotFoundError', () => {
    it('should create error with model name', () => {
      const error = new ModelNotFoundError('OPENAI', 'gpt-5')

      expect(error).toBeInstanceOf(LLMProviderError)
      expect(error).toBeInstanceOf(ModelNotFoundError)
      expect(error.message).toBe('Model "gpt-5" not found or not available')
      expect(error.name).toBe('ModelNotFoundError')
    })
  })

  describe('InvalidRequestError', () => {
    it('should create error with message', () => {
      const error = new InvalidRequestError('ANTHROPIC', 'Invalid parameter')

      expect(error).toBeInstanceOf(LLMProviderError)
      expect(error).toBeInstanceOf(InvalidRequestError)
      expect(error.message).toBe('Invalid parameter')
      expect(error.name).toBe('InvalidRequestError')
    })
  })
})
