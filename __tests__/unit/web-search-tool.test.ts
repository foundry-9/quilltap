/**
 * Unit Tests for Web Search Tool Definitions
 * Tests lib/tools/web-search-tool.ts
 */

import { describe, it, expect } from '@jest/globals'
import {
  webSearchToolDefinition,
  validateWebSearchInput,
  WebSearchToolInput,
} from '@/lib/tools/web-search-tool'

describe('Web Search Tool Definitions', () => {
  describe('webSearchToolDefinition', () => {
    it('should have correct structure for OpenAI format', () => {
      expect(webSearchToolDefinition).toHaveProperty('type')
      expect(webSearchToolDefinition).toHaveProperty('function')
      expect(webSearchToolDefinition.type).toBe('function')
    })

    it('should have function with correct properties', () => {
      const func = webSearchToolDefinition.function
      expect(func).toHaveProperty('name')
      expect(func).toHaveProperty('description')
      expect(func).toHaveProperty('parameters')
    })

    it('should have correct function name', () => {
      expect(webSearchToolDefinition.function.name).toBe('search_web')
    })

    it('should have descriptive text', () => {
      expect(webSearchToolDefinition.function.description).toBeTruthy()
      expect(webSearchToolDefinition.function.description.length).toBeGreaterThan(20)
    })

    it('should have proper parameters schema', () => {
      const params = webSearchToolDefinition.function.parameters
      expect(params).toHaveProperty('type')
      expect(params.type).toBe('object')
      expect(params).toHaveProperty('properties')
      expect(params).toHaveProperty('required')
    })

    it('should have query property defined', () => {
      const props = webSearchToolDefinition.function.parameters.properties
      expect(props).toHaveProperty('query')
      expect(props.query).toHaveProperty('type')
      expect(props.query.type).toBe('string')
    })

    it('should have maxResults property defined', () => {
      const props = webSearchToolDefinition.function.parameters.properties
      expect(props).toHaveProperty('maxResults')
      expect(props.maxResults).toHaveProperty('type')
      expect(props.maxResults.type).toBe('integer')
    })

    it('should mark query as required', () => {
      const required = webSearchToolDefinition.function.parameters.required
      expect(Array.isArray(required)).toBe(true)
      expect(required).toContain('query')
    })

    it('should NOT mark maxResults as required', () => {
      const required = webSearchToolDefinition.function.parameters.required
      expect(required).not.toContain('maxResults')
    })

    it('should have query with proper constraints', () => {
      const query = webSearchToolDefinition.function.parameters.properties.query
      expect(query).toHaveProperty('minLength')
      expect(query).toHaveProperty('maxLength')
      expect(query.minLength).toBe(1)
      expect(query.maxLength).toBe(500)
    })

    it('should have maxResults with proper constraints', () => {
      const maxResults = webSearchToolDefinition.function.parameters.properties.maxResults
      expect(maxResults).toHaveProperty('minimum')
      expect(maxResults).toHaveProperty('maximum')
      expect(maxResults).toHaveProperty('default')
      expect(maxResults.minimum).toBe(1)
      expect(maxResults.maximum).toBe(10)
      expect(maxResults.default).toBe(5)
    })
  })
})

describe('validateWebSearchInput()', () => {
  describe('Valid inputs', () => {
    it('should accept input with valid query string', () => {
      const input: unknown = { query: 'latest AI news' }
      expect(validateWebSearchInput(input)).not.toBeNull()
    })

    it('should accept input with query and maxResults', () => {
      const input: unknown = { query: 'python programming', maxResults: 5 }
      expect(validateWebSearchInput(input)).not.toBeNull()
    })

    it('should accept maxResults at minimum boundary', () => {
      const input: unknown = { query: 'test', maxResults: 1 }
      expect(validateWebSearchInput(input)).not.toBeNull()
    })

    it('should accept maxResults at maximum boundary', () => {
      const input: unknown = { query: 'test', maxResults: 10 }
      expect(validateWebSearchInput(input)).not.toBeNull()
    })

    it('should accept query with special characters', () => {
      const input: unknown = { query: 'search for "exact match" -exclude +include' }
      expect(validateWebSearchInput(input)).not.toBeNull()
    })

    it('should accept query with numbers', () => {
      const input: unknown = { query: 'ChatGPT 4.0 pricing 2024' }
      expect(validateWebSearchInput(input)).not.toBeNull()
    })

    it('should accept query with unicode characters', () => {
      const input: unknown = { query: '日本語検索 español português' }
      expect(validateWebSearchInput(input)).not.toBeNull()
    })

    it('should accept single character query', () => {
      const input: unknown = { query: 'a' }
      expect(validateWebSearchInput(input)).not.toBeNull()
    })

    it('should accept long query up to 500 characters', () => {
      const longQuery = 'a'.repeat(500)
      const input: unknown = { query: longQuery }
      expect(validateWebSearchInput(input)).not.toBeNull()
    })

    it('should accept input with extra properties', () => {
      const input: unknown = {
        query: 'test',
        maxResults: 5,
        extraProp: 'ignored',
        anotherProp: 123,
      }
      expect(validateWebSearchInput(input)).not.toBeNull()
    })
  })

  describe('Invalid inputs - missing query', () => {
    it('should reject input without query property', () => {
      const input: unknown = {}
      expect(validateWebSearchInput(input)).toBeNull()
    })

    it('should reject input with undefined query', () => {
      const input: unknown = { query: undefined }
      expect(validateWebSearchInput(input)).toBeNull()
    })

    it('should reject input with null query', () => {
      const input: unknown = { query: null }
      expect(validateWebSearchInput(input)).toBeNull()
    })

    it('should reject input with empty string query', () => {
      const input: unknown = { query: '' }
      expect(validateWebSearchInput(input)).toBeNull()
    })

    it('should reject input with whitespace-only query', () => {
      const input: unknown = { query: '   ' }
      expect(validateWebSearchInput(input)).toBeNull()
    })

    it('should reject input with tabs and newlines in query', () => {
      const input: unknown = { query: '\t\n  ' }
      expect(validateWebSearchInput(input)).toBeNull()
    })
  })

  describe('Invalid inputs - non-string query', () => {
    it('should reject input with number as query', () => {
      const input: unknown = { query: 123 }
      expect(validateWebSearchInput(input)).toBeNull()
    })

    it('should reject input with boolean as query', () => {
      const input: unknown = { query: true }
      expect(validateWebSearchInput(input)).toBeNull()
    })

    it('should reject input with array as query', () => {
      const input: unknown = { query: ['test'] }
      expect(validateWebSearchInput(input)).toBeNull()
    })

    it('should reject input with object as query', () => {
      const input: unknown = { query: { search: 'test' } }
      expect(validateWebSearchInput(input)).toBeNull()
    })
  })

  describe('Invalid inputs - invalid maxResults', () => {
    it('should reject maxResults less than minimum', () => {
      const input: unknown = { query: 'test', maxResults: 0 }
      expect(validateWebSearchInput(input)).toBeNull()
    })

    it('should reject negative maxResults', () => {
      const input: unknown = { query: 'test', maxResults: -5 }
      expect(validateWebSearchInput(input)).toBeNull()
    })

    it('should reject maxResults greater than maximum', () => {
      const input: unknown = { query: 'test', maxResults: 11 }
      expect(validateWebSearchInput(input)).toBeNull()
    })

    it('should reject maxResults as float', () => {
      const input: unknown = { query: 'test', maxResults: 5.5 }
      expect(validateWebSearchInput(input)).toBeNull()
    })

    it('should accept maxResults as a quoted number (models quote their numbers)', () => {
      // llmNumber converts numeric-looking strings: a model sending "5" instead
      // of 5 gets its search rather than a validation failure. The published
      // JSON Schema still asks for an integer. See lib/tools/llm-number.ts and
      // __tests__/unit/lib/tools/tool-input-lenient-numbers.test.ts.
      const input: unknown = { query: 'test', maxResults: '5' }
      expect(validateWebSearchInput(input)).not.toBeNull()
    })

    it('should still reject maxResults as a non-numeric string', () => {
      const input: unknown = { query: 'test', maxResults: 'five' }
      expect(validateWebSearchInput(input)).toBeNull()
    })

    it('should still reject a quoted maxResults above the maximum', () => {
      const input: unknown = { query: 'test', maxResults: '11' }
      expect(validateWebSearchInput(input)).toBeNull()
    })

    it('should reject maxResults as null', () => {
      const input: unknown = { query: 'test', maxResults: null }
      expect(validateWebSearchInput(input)).toBeNull()
    })

    it('should reject very large maxResults', () => {
      const input: unknown = { query: 'test', maxResults: 999999 }
      expect(validateWebSearchInput(input)).toBeNull()
    })
  })

  describe('Invalid inputs - non-object inputs', () => {
    it('should reject null input', () => {
      const input: unknown = null
      expect(validateWebSearchInput(input)).toBeNull()
    })

    it('should reject undefined input', () => {
      const input: unknown = undefined
      expect(validateWebSearchInput(input)).toBeNull()
    })

    it('should reject string input', () => {
      const input: unknown = 'just a string'
      expect(validateWebSearchInput(input)).toBeNull()
    })

    it('should reject number input', () => {
      const input: unknown = 123
      expect(validateWebSearchInput(input)).toBeNull()
    })

    it('should reject boolean input', () => {
      const input: unknown = true
      expect(validateWebSearchInput(input)).toBeNull()
    })

    it('should reject array input', () => {
      const input: unknown = ['query']
      expect(validateWebSearchInput(input)).toBeNull()
    })
  })

  describe('Type guard behavior', () => {
    it('should return true for valid input and allow type narrowing', () => {
      const input: unknown = { query: 'test', maxResults: 5 }
      if (validateWebSearchInput(input)) {
        // TypeScript should recognize input as WebSearchToolInput
        const validInput: WebSearchToolInput = input
        expect(validInput.query).toBe('test')
        expect(validInput.maxResults).toBe(5)
      }
    })

    it('should work with invalid input without error', () => {
      const input: unknown = { query: 123 }
      expect(() => {
        validateWebSearchInput(input)
      }).not.toThrow()
    })

    it('should handle various falsy values correctly', () => {
      const inputs = [
        { query: '' },
        { query: 0 },
        { query: false },
        { query: Number.NaN },
      ]

      for (const input of inputs) {
        expect(validateWebSearchInput(input as unknown)).toBeNull()
      }
    })
  })

  describe('Edge cases and boundary conditions', () => {
    it('should reject query exceeding max length (Zod enforces the JSON Schema maxLength)', () => {
      const longQuery = 'a'.repeat(501)
      const input: unknown = { query: longQuery }
      expect(validateWebSearchInput(input)).toBeNull()
    })

    it('should accept query at exact min length (1 character)', () => {
      const input: unknown = { query: 'a' }
      expect(validateWebSearchInput(input)).not.toBeNull()
    })

    it('should accept query at exact max length (500 characters)', () => {
      const query = 'a'.repeat(500)
      const input: unknown = { query }
      expect(validateWebSearchInput(input)).not.toBeNull()
    })

    it('should validate maxResults as integer only', () => {
      const validInputs = [
        { query: 'test', maxResults: 1 },
        { query: 'test', maxResults: 5 },
        { query: 'test', maxResults: 10 },
      ]

      for (const input of validInputs) {
        expect(validateWebSearchInput(input as unknown)).not.toBeNull()
      }
    })

    it('should handle objects with numeric string properties', () => {
      const input: unknown = {
        query: 'test',
        '0': 'zero',
        '1': 'one',
      }
      expect(validateWebSearchInput(input)).not.toBeNull()
    })

    it('should handle inputs with prototype pollution attempt', () => {
      const input: unknown = {
        query: 'test',
        '__proto__': { isAdmin: true },
      }
      expect(validateWebSearchInput(input)).not.toBeNull()
    })
  })
})

describe('Interface compliance', () => {
  describe('WebSearchToolInput interface', () => {
    it('should accept input matching WebSearchToolInput interface', () => {
      const input: WebSearchToolInput = {
        query: 'test query',
      }
      expect(validateWebSearchInput(input)).not.toBeNull()
    })

    it('should accept input with optional maxResults', () => {
      const input: WebSearchToolInput = {
        query: 'test query',
        maxResults: 5,
      }
      expect(validateWebSearchInput(input)).not.toBeNull()
    })

    it('should accept input with undefined optional maxResults', () => {
      const input: WebSearchToolInput = {
        query: 'test query',
        maxResults: undefined,
      }
      expect(validateWebSearchInput(input)).not.toBeNull()
    })
  })
})
