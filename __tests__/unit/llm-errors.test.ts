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
  handleProviderError,
  getUserFriendlyError,
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

describe('handleProviderError', () => {
  it('should pass through LLMProviderError as-is', () => {
    const originalError = new APIKeyError('OPENAI', 'Invalid key')
    const result = handleProviderError('OPENAI', originalError)

    expect(result).toBe(originalError)
  })

  it('should detect API key errors from message', () => {
    const errorMessages = [
      'Unauthorized access',
      'Invalid API key provided',
      'authentication failed',
      'Error 401: Unauthorized',
    ]

    errorMessages.forEach(msg => {
      const error = handleProviderError('OPENAI', new Error(msg))
      expect(error).toBeInstanceOf(APIKeyError)
      expect(error.provider).toBe('OPENAI')
    })
  })

  it('should detect rate limit errors from message', () => {
    const errorMessages = [
      'Rate limit exceeded',
      'Too many requests',
      'Error 429',
    ]

    errorMessages.forEach(msg => {
      const error = handleProviderError('OPENAI', new Error(msg))
      expect(error).toBeInstanceOf(RateLimitError)
      expect(error.provider).toBe('OPENAI')
    })
  })

  it('should detect network errors from message', () => {
    const errorMessages = [
      'Network error occurred',
      'ECONNREFUSED: connection refused',
      'Request timeout',
      'ENOTFOUND: host not found',
    ]

    errorMessages.forEach(msg => {
      const error = handleProviderError('OLLAMA', new Error(msg))
      expect(error).toBeInstanceOf(NetworkError)
      expect(error.provider).toBe('OLLAMA')
    })
  })

  it('should detect model not found errors from message', () => {
    const errorMessages = [
      'Model not found',
      'The model does not exist',
    ]

    errorMessages.forEach(msg => {
      const error = handleProviderError('OPENAI', new Error(msg))
      expect(error).toBeInstanceOf(ModelNotFoundError)
      expect(error.provider).toBe('OPENAI')
    })
  })

  it('should detect invalid request errors from message', () => {
    const errorMessages = [
      'Invalid request format',
      'Error 400: Bad request',
    ]

    errorMessages.forEach(msg => {
      const error = handleProviderError('ANTHROPIC', new Error(msg))
      expect(error).toBeInstanceOf(InvalidRequestError)
      expect(error.provider).toBe('ANTHROPIC')
    })
  })

  it('should create generic LLMProviderError for unknown error types', () => {
    const error = handleProviderError('OPENAI', new Error('Some unknown error'))

    expect(error).toBeInstanceOf(LLMProviderError)
    expect(error).not.toBeInstanceOf(APIKeyError)
    expect(error).not.toBeInstanceOf(RateLimitError)
    expect(error.message).toBe('Some unknown error')
    expect(error.provider).toBe('OPENAI')
  })

  it('should handle non-Error objects', () => {
    const error = handleProviderError('OPENAI', 'String error')

    expect(error).toBeInstanceOf(LLMProviderError)
    expect(error.message).toBe('An unknown error occurred')
    expect(error.originalError).toBe('String error')
  })

  it('should handle null and undefined', () => {
    const error1 = handleProviderError('OPENAI', null)
    const error2 = handleProviderError('OPENAI', undefined)

    expect(error1).toBeInstanceOf(LLMProviderError)
    expect(error2).toBeInstanceOf(LLMProviderError)
  })

  it('should be case-insensitive when matching error messages', () => {
    const error1 = handleProviderError('OPENAI', new Error('UNAUTHORIZED'))
    const error2 = handleProviderError('OPENAI', new Error('Unauthorized'))
    const error3 = handleProviderError('OPENAI', new Error('unauthorized'))

    expect(error1).toBeInstanceOf(APIKeyError)
    expect(error2).toBeInstanceOf(APIKeyError)
    expect(error3).toBeInstanceOf(APIKeyError)
  })
})

describe('getUserFriendlyError', () => {
  it('should return user-friendly message for APIKeyError', () => {
    const error = new APIKeyError('OPENAI')
    const message = getUserFriendlyError(error)

    expect(message).toContain('Invalid or expired API key')
    expect(message).toContain('OPENAI')
    expect(message).toContain('settings')
  })

  it('should return user-friendly message for RateLimitError without retry time', () => {
    const error = new RateLimitError('ANTHROPIC')
    const message = getUserFriendlyError(error)

    expect(message).toContain('Rate limit exceeded')
    expect(message).toContain('ANTHROPIC')
    expect(message).toContain('try again later')
  })

  it('should return user-friendly message for RateLimitError with retry time', () => {
    const error = new RateLimitError('OPENAI', 60)
    const message = getUserFriendlyError(error)

    expect(message).toContain('Rate limit exceeded')
    expect(message).toContain('OPENAI')
    expect(message).toContain('60 seconds')
  })

  it('should return user-friendly message for NetworkError', () => {
    const error = new NetworkError('OLLAMA', 'Connection refused')
    const message = getUserFriendlyError(error)

    expect(message).toContain('Unable to connect')
    expect(message).toContain('OLLAMA')
    expect(message).toContain('internet connection')
    expect(message).toContain('provider settings')
  })

  it('should return user-friendly message for ModelNotFoundError', () => {
    const error = new ModelNotFoundError('OPENAI', 'gpt-5')
    const message = getUserFriendlyError(error)

    expect(message).toContain('gpt-5')
    expect(message).toContain('not found')
    expect(message).toContain('select a different model')
    expect(message).toContain('connection profile')
  })

  it('should return user-friendly message for InvalidRequestError', () => {
    const error = new InvalidRequestError('ANTHROPIC', 'Invalid temperature value')
    const message = getUserFriendlyError(error)

    expect(message).toContain('Invalid request')
    expect(message).toContain('ANTHROPIC')
    expect(message).toContain('Invalid temperature value')
  })

  it('should return user-friendly message for generic LLMProviderError', () => {
    const error = new LLMProviderError('OPENROUTER', 'Some provider error')
    const message = getUserFriendlyError(error)

    expect(message).toContain('OPENROUTER')
    expect(message).toContain('Some provider error')
  })

  it('should handle regular Error objects', () => {
    const error = new Error('Regular error message')
    const message = getUserFriendlyError(error)

    expect(message).toBe('Regular error message')
  })

  it('should handle unknown error types', () => {
    const message1 = getUserFriendlyError('String error')
    const message2 = getUserFriendlyError(null)
    const message3 = getUserFriendlyError(undefined)
    const message4 = getUserFriendlyError({ foo: 'bar' })

    expect(message1).toBe('An unexpected error occurred. Please try again.')
    expect(message2).toBe('An unexpected error occurred. Please try again.')
    expect(message3).toBe('An unexpected error occurred. Please try again.')
    expect(message4).toBe('An unexpected error occurred. Please try again.')
  })

  it('should provide actionable advice in error messages', () => {
    const errors = [
      new APIKeyError('OPENAI'),
      new NetworkError('OLLAMA'),
      new ModelNotFoundError('OPENAI', 'test-model'),
    ]

    errors.forEach(error => {
      const message = getUserFriendlyError(error)
      const hasActionableAdvice =
        message.includes('Please') ||
        message.includes('check') ||
        message.includes('select') ||
        message.includes('try again')

      expect(hasActionableAdvice).toBe(true)
    })
  })
})
