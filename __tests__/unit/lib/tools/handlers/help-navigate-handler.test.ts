import { describe, it, expect, beforeEach, jest } from '@jest/globals'

const childLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}

jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(() => childLogger),
  },
}))

import { validateHelpNavigateInput } from '@/lib/tools/help-navigate-tool'
import {
  executeHelpNavigateTool,
  formatHelpNavigateResults,
  type HelpNavigateToolContext,
} from '@/lib/tools/handlers/help-navigate-handler'

describe('validateHelpNavigateInput', () => {
  it('accepts supported internal routes with query parameters', () => {
    expect(
      validateHelpNavigateInput({
        url: '/settings?tab=chat&section=dangerous-content',
      })
    ).not.toBeNull()

    expect(validateHelpNavigateInput({ url: '/aurora/character-123' })).not.toBeNull()
  })

  it('rejects missing, external, or unsupported routes', () => {
    expect(validateHelpNavigateInput({})).toBeNull()
    expect(validateHelpNavigateInput({ url: 'https://example.com/settings' })).toBeNull()
    expect(validateHelpNavigateInput({ url: '/api/v1/system/unlock' })).toBeNull()
    expect(validateHelpNavigateInput({ url: '   ' })).toBeNull()
  })
})

describe('executeHelpNavigateTool', () => {
  const context: HelpNavigateToolContext = { userId: 'user-123' }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns the validated URL for supported paths', async () => {
    const result = await executeHelpNavigateTool(
      { url: '/settings?tab=appearance&section=themes' },
      context
    )

    expect(result).toEqual({
      success: true,
      url: '/settings?tab=appearance&section=themes',
    })
  })

  it('returns a validation error for unsupported input', async () => {
    const result = await executeHelpNavigateTool(
      { url: '/api/v1/system/unlock' },
      context
    )

    expect(result.success).toBe(false)
    expect(result.url).toBe('')
    expect(result.error).toContain('Invalid input')
  })
})

describe('formatHelpNavigateResults', () => {
  it('formats successful navigation results', () => {
    expect(
      formatHelpNavigateResults({ success: true, url: '/salon/chat-1' })
    ).toBe('Navigation initiated to: /salon/chat-1')
  })

  it('formats failed navigation results', () => {
    expect(
      formatHelpNavigateResults({ success: false, url: '', error: 'Bad route' })
    ).toBe('Bad route')
    expect(formatHelpNavigateResults({ success: false, url: '' })).toBe('Failed to navigate.')
  })
})