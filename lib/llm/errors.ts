// LLM Provider Error Handling
// Phase 0.7: Multi-Provider Support

export class LLMProviderError extends Error {
  constructor(
    public provider: string,
    message: string,
    public originalError?: unknown
  ) {
    super(message)
    this.name = 'LLMProviderError'
  }
}

export class APIKeyError extends LLMProviderError {
  constructor(provider: string, message: string = 'Invalid or missing API key') {
    super(provider, message)
    this.name = 'APIKeyError'
  }
}

export class RateLimitError extends LLMProviderError {
  constructor(
    provider: string,
    public retryAfter?: number,
    message: string = 'Rate limit exceeded'
  ) {
    super(provider, message)
    this.name = 'RateLimitError'
  }
}

export class NetworkError extends LLMProviderError {
  constructor(provider: string, message: string = 'Network error occurred') {
    super(provider, message)
    this.name = 'NetworkError'
  }
}

export class ModelNotFoundError extends LLMProviderError {
  constructor(provider: string, model: string) {
    super(provider, `Model "${model}" not found or not available`)
    this.name = 'ModelNotFoundError'
  }
}

export class InvalidRequestError extends LLMProviderError {
  constructor(provider: string, message: string) {
    super(provider, message)
    this.name = 'InvalidRequestError'
  }
}

/**
 * Parse and standardize errors from different providers
 */
export function handleProviderError(
  provider: string,
  error: unknown
): LLMProviderError {
  // Already a provider error
  if (error instanceof LLMProviderError) {
    return error
  }

  // Check for common error patterns
  if (error instanceof Error) {
    const message = error.message.toLowerCase()

    // API key errors
    if (
      message.includes('unauthorized') ||
      message.includes('invalid api key') ||
      message.includes('authentication') ||
      message.includes('401')
    ) {
      return new APIKeyError(provider)
    }

    // Rate limit errors
    if (
      message.includes('rate limit') ||
      message.includes('too many requests') ||
      message.includes('429')
    ) {
      return new RateLimitError(provider)
    }

    // Network errors
    if (
      message.includes('network') ||
      message.includes('econnrefused') ||
      message.includes('timeout') ||
      message.includes('enotfound')
    ) {
      return new NetworkError(provider, error.message)
    }

    // Model not found
    if (
      message.includes('model') &&
      (message.includes('not found') || message.includes('does not exist'))
    ) {
      return new ModelNotFoundError(provider, 'unknown')
    }

    // Invalid request
    if (message.includes('invalid') || message.includes('400')) {
      return new InvalidRequestError(provider, error.message)
    }

    // Generic error with original message
    return new LLMProviderError(provider, error.message, error)
  }

  // Unknown error type
  return new LLMProviderError(
    provider,
    'An unknown error occurred',
    error
  )
}

/**
 * Get user-friendly error message
 */
export function getUserFriendlyError(error: unknown): string {
  if (error instanceof APIKeyError) {
    return `Invalid or expired API key for ${error.provider}. Please check your API key in settings.`
  }

  if (error instanceof RateLimitError) {
    const retryMessage = error.retryAfter
      ? ` Please try again in ${error.retryAfter} seconds.`
      : ' Please try again later.'
    return `Rate limit exceeded for ${error.provider}.${retryMessage}`
  }

  if (error instanceof NetworkError) {
    return `Unable to connect to ${error.provider}. Please check your internet connection and provider settings.`
  }

  if (error instanceof ModelNotFoundError) {
    return `${error.message}. Please select a different model in your connection profile.`
  }

  if (error instanceof InvalidRequestError) {
    return `Invalid request to ${error.provider}: ${error.message}`
  }

  if (error instanceof LLMProviderError) {
    return `${error.provider} error: ${error.message}`
  }

  if (error instanceof Error) {
    return error.message
  }

  return 'An unexpected error occurred. Please try again.'
}
