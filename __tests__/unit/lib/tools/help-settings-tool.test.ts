/**
 * Tests for lib/tools/help-settings-tool.ts
 */

import { validateHelpSettingsInput } from '@/lib/tools/help-settings-tool'

describe('validateHelpSettingsInput', () => {
  describe('invalid types', () => {
    it('returns false for null', () => {
      expect(validateHelpSettingsInput(null)).toBeNull()
    })

    it('returns false for undefined', () => {
      expect(validateHelpSettingsInput(undefined)).toBeNull()
    })

    it('returns false for string', () => {
      expect(validateHelpSettingsInput('overview')).toBeNull()
    })

    it('returns false for number', () => {
      expect(validateHelpSettingsInput(123)).toBeNull()
    })

    it('returns false for array', () => {
      expect(validateHelpSettingsInput(['overview'])).toBeNull()
    })
  })

  describe('missing or invalid category field', () => {
    it('returns false for empty object', () => {
      expect(validateHelpSettingsInput({})).toBeNull()
    })

    it('returns false for missing category', () => {
      expect(validateHelpSettingsInput({ type: 'overview' })).toBeNull()
    })

    it('returns false for invalid category string', () => {
      expect(validateHelpSettingsInput({ category: 'invalid' })).toBeNull()
    })

    it('returns false for non-string category', () => {
      expect(validateHelpSettingsInput({ category: 123 })).toBeNull()
    })
  })

  describe('valid categories', () => {
    it('returns true for overview', () => {
      expect(validateHelpSettingsInput({ category: 'overview' })).not.toBeNull()
    })

    it('returns true for chat', () => {
      expect(validateHelpSettingsInput({ category: 'chat' })).not.toBeNull()
    })

    it('returns true for connections', () => {
      expect(validateHelpSettingsInput({ category: 'connections' })).not.toBeNull()
    })

    it('returns true for embeddings', () => {
      expect(validateHelpSettingsInput({ category: 'embeddings' })).not.toBeNull()
    })

    it('returns true for images', () => {
      expect(validateHelpSettingsInput({ category: 'images' })).not.toBeNull()
    })

    it('returns true for appearance', () => {
      expect(validateHelpSettingsInput({ category: 'appearance' })).not.toBeNull()
    })

    it('returns true for templates', () => {
      expect(validateHelpSettingsInput({ category: 'templates' })).not.toBeNull()
    })

    it('returns true for system', () => {
      expect(validateHelpSettingsInput({ category: 'system' })).not.toBeNull()
    })
  })

  describe('ignoring extra fields', () => {
    it('ignores extra fields and validates category only', () => {
      expect(validateHelpSettingsInput({ category: 'chat', extra: 'ignored', other: 123 })).not.toBeNull()
    })
  })
})
