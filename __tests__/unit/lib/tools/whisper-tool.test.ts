/**
 * Tests for lib/tools/whisper-tool.ts
 */

import { validateWhisperInput } from '@/lib/tools/whisper-tool'

describe('validateWhisperInput', () => {
  describe('invalid types', () => {
    it('returns false for null', () => {
      expect(validateWhisperInput(null)).toBeNull()
    })

    it('returns false for undefined', () => {
      expect(validateWhisperInput(undefined)).toBeNull()
    })

    it('returns false for string', () => {
      expect(validateWhisperInput('not an object')).toBeNull()
    })

    it('returns false for number', () => {
      expect(validateWhisperInput(42)).toBeNull()
    })

    it('returns false for array', () => {
      expect(validateWhisperInput(['target', 'message'])).toBeNull()
    })
  })

  describe('missing or invalid fields', () => {
    it('returns false for empty object', () => {
      expect(validateWhisperInput({})).toBeNull()
    })

    it('returns false for missing target', () => {
      expect(validateWhisperInput({ message: 'hello' })).toBeNull()
    })

    it('returns false for missing message', () => {
      expect(validateWhisperInput({ target: 'Alice' })).toBeNull()
    })

    it('returns false for empty target string', () => {
      expect(validateWhisperInput({ target: '', message: 'hello' })).toBeNull()
    })

    it('returns false for empty message string', () => {
      expect(validateWhisperInput({ target: 'Alice', message: '' })).toBeNull()
    })

    it('returns false for non-string target', () => {
      expect(validateWhisperInput({ target: 123, message: 'hello' })).toBeNull()
    })

    it('returns false for non-string message', () => {
      expect(validateWhisperInput({ target: 'Alice', message: 456 })).toBeNull()
    })
  })

  describe('valid input', () => {
    it('returns true for valid input with target and message', () => {
      expect(validateWhisperInput({ target: 'Alice', message: 'hello' })).not.toBeNull()
    })

    it('returns true with whitespace in message', () => {
      expect(validateWhisperInput({ target: 'Bob', message: '  hello world  ' })).not.toBeNull()
    })

    it('returns true with special characters in names and messages', () => {
      expect(validateWhisperInput({ target: 'Alice@123', message: 'Secret: $$$' })).not.toBeNull()
    })

    it('returns true ignoring extra fields', () => {
      expect(validateWhisperInput({ target: 'Alice', message: 'hi', extra: 'ignored' })).not.toBeNull()
    })
  })
})
