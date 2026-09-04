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
 * Token limit exceeded error
 * Thrown when the prompt is too long for the model's context window
 */
export class TokenLimitError extends LLMProviderError {
  constructor(
    provider: string,
    public requestedTokens?: number,
    public maxTokens?: number,
    message?: string
  ) {
    const defaultMessage = requestedTokens && maxTokens
      ? `Prompt too long: ${requestedTokens.toLocaleString()} tokens exceeds ${maxTokens.toLocaleString()} maximum`
      : 'Prompt exceeds maximum token limit'
    super(provider, message || defaultMessage)
    this.name = 'TokenLimitError'
  }
}

/**
 * Content limit types for categorizing different limit errors
 */
export type ContentLimitType = 'token' | 'pdf_pages' | 'image_size' | 'file_size' | 'unknown'

/**
 * Content limit exceeded error
 * Thrown when content exceeds provider limits (tokens, PDF pages, image size, etc.)
 */
export class ContentLimitError extends LLMProviderError {
  constructor(
    provider: string,
    public limitType: ContentLimitType,
    public limitValue?: number,
    public maxValue?: number,
    message?: string
  ) {
    const defaultMessage = ContentLimitError.buildDefaultMessage(limitType, limitValue, maxValue)
    super(provider, message || defaultMessage)
    this.name = 'ContentLimitError'
  }

  private static buildDefaultMessage(
    limitType: ContentLimitType,
    limitValue?: number,
    maxValue?: number
  ): string {
    const limitDescriptions: Record<ContentLimitType, string> = {
      token: 'token limit',
      pdf_pages: 'PDF page limit',
      image_size: 'image size limit',
      file_size: 'file size limit',
      unknown: 'content limit',
    }

    const description = limitDescriptions[limitType]
    if (limitValue && maxValue) {
      return `Content exceeds ${description}: ${limitValue.toLocaleString()} > ${maxValue.toLocaleString()} maximum`
    }
    if (maxValue) {
      return `Content exceeds ${description}: maximum is ${maxValue.toLocaleString()}`
    }
    return `Content exceeds ${description}`
  }
}

/**
 * Patterns that indicate a token limit error across different providers
 */
const TOKEN_LIMIT_ERROR_PATTERNS = [
  // OpenAI patterns
  /context_length_exceeded/i,
  /maximum context length/i,
  /tokens.*exceeds?.*maximum/i,
  /request too large/i,

  // Anthropic patterns
  /prompt is too long/i,
  /maximum.*tokens/i,
  /request would exceed/i,

  // Google patterns
  /request payload size exceeds/i,
  /input too long/i,

  // Generic patterns
  /context.*length.*exceeded/i,
  /token.*limit/i,
  /input.*too.*long/i,
]

/**
 * Check if an error is a token limit error
 * @param error The error to check
 * @returns True if the error is related to token limits
 */
export function isTokenLimitError(error: unknown): boolean {
  if (error instanceof TokenLimitError) {
    return true
  }

  const message = error instanceof Error ? error.message : String(error)
  return TOKEN_LIMIT_ERROR_PATTERNS.some(pattern => pattern.test(message))
}

/**
 * Parse token counts from an error message
 * @param error The error to parse
 * @returns Object with requestedTokens and maxTokens if found
 */
export function parseTokenLimitError(error: unknown): {
  requestedTokens?: number
  maxTokens?: number
} {
  const message = error instanceof Error ? error.message : String(error)

  // Match patterns like "210311 tokens > 200000 maximum"
  const tokensPattern = /(\d+)\s*tokens?\s*[>]\s*(\d+)\s*maximum/i
  const tokensMatch = message.match(tokensPattern)
  if (tokensMatch) {
    return {
      requestedTokens: parseInt(tokensMatch[1], 10),
      maxTokens: parseInt(tokensMatch[2], 10),
    }
  }

  // Match patterns like "maximum context length is 200000 tokens"
  const maxPattern = /maximum.*?(\d+)\s*tokens/i
  const maxMatch = message.match(maxPattern)
  if (maxMatch) {
    return { maxTokens: parseInt(maxMatch[1], 10) }
  }

  return {}
}

/**
 * Patterns that indicate content limit errors (PDF pages, image size, etc.)
 */
const CONTENT_LIMIT_ERROR_PATTERNS: Array<{ pattern: RegExp; type: ContentLimitType }> = [
  // PDF page limits
  { pattern: /maximum of (\d+) PDF pages?/i, type: 'pdf_pages' },
  { pattern: /PDF.*?(\d+).*?pages?.*?maximum/i, type: 'pdf_pages' },
  { pattern: /too many PDF pages/i, type: 'pdf_pages' },

  // Image size limits
  { pattern: /image.*?too large/i, type: 'image_size' },
  { pattern: /image.*?exceeds?.*?maximum/i, type: 'image_size' },
  { pattern: /maximum image (size|dimensions)/i, type: 'image_size' },

  // File size limits
  { pattern: /file.*?too large/i, type: 'file_size' },
  { pattern: /file.*?exceeds?.*?maximum/i, type: 'file_size' },
  { pattern: /maximum file size/i, type: 'file_size' },

  // Generic content limits
  { pattern: /content.*?too (large|long)/i, type: 'unknown' },
  { pattern: /exceeds?.*?maximum.*?(size|length|limit)/i, type: 'unknown' },
]

/**
 * Check if an error is a content limit error (PDF pages, image size, etc.)
 * @param error The error to check
 * @returns True if the error is related to content limits
 */
export function isContentLimitError(error: unknown): boolean {
  if (error instanceof ContentLimitError) {
    return true
  }

  const message = error instanceof Error ? error.message : String(error)
  return CONTENT_LIMIT_ERROR_PATTERNS.some(({ pattern }) => pattern.test(message))
}

/**
 * Parse content limit details from an error message
 * @param error The error to parse
 * @returns Object with limit type and values if found
 */
export function parseContentLimitError(error: unknown): {
  type: ContentLimitType
  maxValue?: number
  description?: string
} {
  const message = error instanceof Error ? error.message : String(error)

  // Check PDF page limit patterns
  const pdfMaxPattern = /maximum of (\d+) PDF pages?/i
  const pdfMatch = message.match(pdfMaxPattern)
  if (pdfMatch) {
    return {
      type: 'pdf_pages',
      maxValue: parseInt(pdfMatch[1], 10),
      description: `PDF documents cannot exceed ${pdfMatch[1]} pages`,
    }
  }

  // Check for other patterns
  for (const { pattern, type } of CONTENT_LIMIT_ERROR_PATTERNS) {
    if (pattern.test(message)) {
      return { type, description: message }
    }
  }

  return { type: 'unknown' }
}

/**
 * Patterns that indicate the model does not support tool/function calling
 */
const TOOL_UNSUPPORTED_ERROR_PATTERNS = [
  /tool use with function calling is unsupported/i,
  /function.?calling is not supported/i,
  /does not support function.?calling/i,
  /does not support tools/i,
  /tool_use.*not.*supported/i,
  /tools are not supported/i,
]

/**
 * Check if an error indicates the model does not support tool/function calling
 * @param error The error to check
 * @returns True if the error is about unsupported tool calling
 */
export function isToolUnsupportedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return TOOL_UNSUPPORTED_ERROR_PATTERNS.some(pattern => pattern.test(message))
}

/**
 * Check if an error is recoverable (token limit OR content limit)
 * This is the main function to use when deciding whether to attempt recovery
 * @param error The error to check
 * @returns True if the error can potentially be recovered from with a simplified message
 */
export function isRecoverableRequestError(error: unknown): boolean {
  return isTokenLimitError(error) || isContentLimitError(error)
}
