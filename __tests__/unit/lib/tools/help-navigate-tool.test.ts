/**
 * Tests for lib/tools/help-navigate-tool.ts
 */

import { validateHelpNavigateInput } from '@/lib/tools/help-navigate-tool'

describe('validateHelpNavigateInput', () => {
  describe('invalid types', () => {
    it('returns false for null', () => {
      expect(validateHelpNavigateInput(null)).toBeNull()
    })

    it('returns false for undefined', () => {
      expect(validateHelpNavigateInput(undefined)).toBeNull()
    })

    it('returns false for string', () => {
      expect(validateHelpNavigateInput('/settings')).toBeNull()
    })

    it('returns false for number', () => {
      expect(validateHelpNavigateInput(42)).toBeNull()
    })

    it('returns false for array', () => {
      expect(validateHelpNavigateInput(['/settings'])).toBeNull()
    })
  })

  describe('missing or invalid url field', () => {
    it('returns false for empty object', () => {
      expect(validateHelpNavigateInput({})).toBeNull()
    })

    it('returns false for missing url', () => {
      expect(validateHelpNavigateInput({ path: '/settings' })).toBeNull()
    })

    it('returns false for empty url string', () => {
      expect(validateHelpNavigateInput({ url: '' })).toBeNull()
    })

    it('returns false for whitespace-only url', () => {
      expect(validateHelpNavigateInput({ url: '   ' })).toBeNull()
    })

    it('returns false for non-string url', () => {
      expect(validateHelpNavigateInput({ url: 123 })).toBeNull()
    })
  })

  describe('url format validation', () => {
    it('returns false for url not starting with /', () => {
      expect(validateHelpNavigateInput({ url: 'settings' })).toBeNull()
    })

    it('returns false for absolute URL (https://...)', () => {
      expect(validateHelpNavigateInput({ url: 'https://example.com/settings' })).toBeNull()
    })

    it('returns false for disallowed path like /admin', () => {
      expect(validateHelpNavigateInput({ url: '/admin' })).toBeNull()
    })

    it('returns false for disallowed path like /api/v1/something', () => {
      expect(validateHelpNavigateInput({ url: '/api/v1/something' })).toBeNull()
    })

    it('returns false for disallowed path like /chats', () => {
      expect(validateHelpNavigateInput({ url: '/chats' })).toBeNull()
    })
  })

  describe('allowed paths', () => {
    it('returns true for /settings', () => {
      expect(validateHelpNavigateInput({ url: '/settings' })).not.toBeNull()
    })

    it('returns true for /aurora', () => {
      expect(validateHelpNavigateInput({ url: '/aurora' })).not.toBeNull()
    })

    it('returns true for /salon', () => {
      expect(validateHelpNavigateInput({ url: '/salon' })).not.toBeNull()
    })

    it('returns true for /prospero', () => {
      expect(validateHelpNavigateInput({ url: '/prospero' })).not.toBeNull()
    })

    it('returns true for /profile', () => {
      expect(validateHelpNavigateInput({ url: '/profile' })).not.toBeNull()
    })

    it('returns true for /files', () => {
      expect(validateHelpNavigateInput({ url: '/files' })).not.toBeNull()
    })

    it('returns true for /setup', () => {
      expect(validateHelpNavigateInput({ url: '/setup' })).not.toBeNull()
    })

    it('returns true for /settings?tab=chat&section=dangerous-content', () => {
      expect(validateHelpNavigateInput({ url: '/settings?tab=chat&section=dangerous-content' })).not.toBeNull()
    })

    it('returns true for /aurora/:id (pattern with subpaths)', () => {
      expect(validateHelpNavigateInput({ url: '/aurora/character-id-here' })).not.toBeNull()
    })

    it('returns true for /salon subpaths', () => {
      expect(validateHelpNavigateInput({ url: '/salon/chat-123' })).not.toBeNull()
    })

    it('returns true for /prospero with query params', () => {
      expect(validateHelpNavigateInput({ url: '/prospero?tab=editor' })).not.toBeNull()
    })

    it('returns true for /settings with complex query string', () => {
      expect(validateHelpNavigateInput({ url: '/settings?tab=appearance&section=theme' })).not.toBeNull()
    })
  })

  describe('ignoring extra fields', () => {
    it('ignores extra fields and validates url only', () => {
      expect(validateHelpNavigateInput({ url: '/settings', extra: 'ignored', other: 123 })).not.toBeNull()
    })
  })
})
