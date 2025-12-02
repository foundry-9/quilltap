/**
 * Unit Tests for Web Search Tool Definitions
 * Tests lib/tools/web-search-tool.ts
 */

import { describe, it, expect } from '@jest/globals'
import {
  webSearchToolDefinition,
  anthropicWebSearchToolDefinition,
  getOpenAIWebSearchTool,
  getAnthropicWebSearchTool,
  getGoogleWebSearchTool,
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

  describe('anthropicWebSearchToolDefinition', () => {
    it('should have correct structure for Anthropic format', () => {
      expect(anthropicWebSearchToolDefinition).toHaveProperty('name')
      expect(anthropicWebSearchToolDefinition).toHaveProperty('description')
      expect(anthropicWebSearchToolDefinition).toHaveProperty('input_schema')
    })

    it('should have correct tool name', () => {
      expect(anthropicWebSearchToolDefinition.name).toBe('search_web')
    })

    it('should have same description as OpenAI version', () => {
      expect(anthropicWebSearchToolDefinition.description).toBe(
        webSearchToolDefinition.function.description
      )
    })

    it('should have proper input_schema', () => {
      const schema = anthropicWebSearchToolDefinition.input_schema
      expect(schema).toHaveProperty('type')
      expect(schema.type).toBe('object')
      expect(schema).toHaveProperty('properties')
      expect(schema).toHaveProperty('required')
    })

    it('should have query property with correct constraints', () => {
      const query = anthropicWebSearchToolDefinition.input_schema.properties.query
      expect(query).toHaveProperty('type')
      expect(query.type).toBe('string')
      expect(query).toHaveProperty('minLength')
      expect(query).toHaveProperty('maxLength')
      expect(query.minLength).toBe(1)
      expect(query.maxLength).toBe(500)
    })

    it('should have maxResults property with correct constraints', () => {
      const maxResults = anthropicWebSearchToolDefinition.input_schema.properties.maxResults
      expect(maxResults).toHaveProperty('type')
      expect(maxResults.type).toBe('integer')
      expect(maxResults).toHaveProperty('minimum')
      expect(maxResults).toHaveProperty('maximum')
      expect(maxResults).toHaveProperty('default')
      expect(maxResults.minimum).toBe(1)
      expect(maxResults.maximum).toBe(10)
      expect(maxResults.default).toBe(5)
    })

    it('should have query as required field', () => {
      const required = anthropicWebSearchToolDefinition.input_schema.required
      expect(Array.isArray(required)).toBe(true)
      expect(required).toContain('query')
    })

    it('should NOT have maxResults as required field', () => {
      const required = anthropicWebSearchToolDefinition.input_schema.required
      expect(required).not.toContain('maxResults')
    })
  })

  describe('Tool Definition Consistency', () => {
    it('should have same tool name in both definitions', () => {
      expect(webSearchToolDefinition.function.name).toBe(
        anthropicWebSearchToolDefinition.name
      )
    })

    it('should have same descriptions in both definitions', () => {
      expect(webSearchToolDefinition.function.description).toBe(
        anthropicWebSearchToolDefinition.description
      )
    })

    it('should have query constraints consistent between formats', () => {
      const openAiQuery = webSearchToolDefinition.function.parameters.properties.query
      const anthropicQuery = anthropicWebSearchToolDefinition.input_schema.properties.query

      expect(openAiQuery.minLength).toBe(anthropicQuery.minLength)
      expect(openAiQuery.maxLength).toBe(anthropicQuery.maxLength)
    })

    it('should have maxResults constraints consistent between formats', () => {
      const openAiMaxResults =
        webSearchToolDefinition.function.parameters.properties.maxResults
      const anthropicMaxResults = anthropicWebSearchToolDefinition.input_schema.properties
        .maxResults

      expect(openAiMaxResults.minimum).toBe(anthropicMaxResults.minimum)
      expect(openAiMaxResults.maximum).toBe(anthropicMaxResults.maximum)
      expect(openAiMaxResults.default).toBe(anthropicMaxResults.default)
    })
  })

  describe('getOpenAIWebSearchTool()', () => {
    it('should return the webSearchToolDefinition', () => {
      const tool = getOpenAIWebSearchTool()
      expect(tool).toBe(webSearchToolDefinition)
    })

    it('should return a function definition', () => {
      const tool = getOpenAIWebSearchTool()
      expect(tool.type).toBe('function')
      expect(tool.function).toBeDefined()
    })

    it('should return tool with search_web function name', () => {
      const tool = getOpenAIWebSearchTool()
      expect(tool.function.name).toBe('search_web')
    })
  })

  describe('getAnthropicWebSearchTool()', () => {
    it('should return the anthropicWebSearchToolDefinition', () => {
      const tool = getAnthropicWebSearchTool()
      expect(tool).toBe(anthropicWebSearchToolDefinition)
    })

    it('should return a tool definition with input_schema', () => {
      const tool = getAnthropicWebSearchTool()
      expect(tool.name).toBe('search_web')
      expect(tool.input_schema).toBeDefined()
    })

    it('should return tool with Anthropic format structure', () => {
      const tool = getAnthropicWebSearchTool()
      expect(tool).toHaveProperty('name')
      expect(tool).toHaveProperty('description')
      expect(tool).toHaveProperty('input_schema')
      expect(tool).not.toHaveProperty('type')
      expect(tool).not.toHaveProperty('function')
    })
  })

  describe('getGoogleWebSearchTool()', () => {
    it('should return a tool definition', () => {
      const tool = getGoogleWebSearchTool()
      expect(tool).toBeDefined()
    })

    it('should have name property', () => {
      const tool = getGoogleWebSearchTool()
      expect(tool).toHaveProperty('name')
      expect(tool.name).toBe('search_web')
    })

    it('should have description property', () => {
      const tool = getGoogleWebSearchTool()
      expect(tool).toHaveProperty('description')
      expect(tool.description).toBeTruthy()
    })

    it('should have parameters property', () => {
      const tool = getGoogleWebSearchTool()
      expect(tool).toHaveProperty('parameters')
    })

    it('should use input_schema from Anthropic definition as parameters', () => {
      const tool = getGoogleWebSearchTool()
      expect(tool.parameters).toBe(anthropicWebSearchToolDefinition.input_schema)
    })

    it('should have correct name from Anthropic definition', () => {
      const tool = getGoogleWebSearchTool()
      expect(tool.name).toBe(anthropicWebSearchToolDefinition.name)
    })

    it('should have correct description from Anthropic definition', () => {
      const tool = getGoogleWebSearchTool()
      expect(tool.description).toBe(anthropicWebSearchToolDefinition.description)
    })

    it('should have proper parameters structure for Google/Gemini format', () => {
      const tool = getGoogleWebSearchTool()
      expect(tool.parameters).toHaveProperty('type')
      expect(tool.parameters).toHaveProperty('properties')
      expect(tool.parameters).toHaveProperty('required')
    })
  })
})

describe('validateWebSearchInput()', () => {
  describe('Valid inputs', () => {
    it('should accept input with valid query string', () => {
      const input: unknown = { query: 'latest AI news' }
      expect(validateWebSearchInput(input)).toBe(true)
    })

    it('should accept input with query and maxResults', () => {
      const input: unknown = { query: 'python programming', maxResults: 5 }
      expect(validateWebSearchInput(input)).toBe(true)
    })

    it('should accept maxResults at minimum boundary', () => {
      const input: unknown = { query: 'test', maxResults: 1 }
      expect(validateWebSearchInput(input)).toBe(true)
    })

    it('should accept maxResults at maximum boundary', () => {
      const input: unknown = { query: 'test', maxResults: 10 }
      expect(validateWebSearchInput(input)).toBe(true)
    })

    it('should accept query with special characters', () => {
      const input: unknown = { query: 'search for "exact match" -exclude +include' }
      expect(validateWebSearchInput(input)).toBe(true)
    })

    it('should accept query with numbers', () => {
      const input: unknown = { query: 'ChatGPT 4.0 pricing 2024' }
      expect(validateWebSearchInput(input)).toBe(true)
    })

    it('should accept query with unicode characters', () => {
      const input: unknown = { query: '日本語検索 español português' }
      expect(validateWebSearchInput(input)).toBe(true)
    })

    it('should accept single character query', () => {
      const input: unknown = { query: 'a' }
      expect(validateWebSearchInput(input)).toBe(true)
    })

    it('should accept long query up to 500 characters', () => {
      const longQuery = 'a'.repeat(500)
      const input: unknown = { query: longQuery }
      expect(validateWebSearchInput(input)).toBe(true)
    })

    it('should accept input with extra properties', () => {
      const input: unknown = {
        query: 'test',
        maxResults: 5,
        extraProp: 'ignored',
        anotherProp: 123,
      }
      expect(validateWebSearchInput(input)).toBe(true)
    })
  })

  describe('Invalid inputs - missing query', () => {
    it('should reject input without query property', () => {
      const input: unknown = {}
      expect(validateWebSearchInput(input)).toBe(false)
    })

    it('should reject input with undefined query', () => {
      const input: unknown = { query: undefined }
      expect(validateWebSearchInput(input)).toBe(false)
    })

    it('should reject input with null query', () => {
      const input: unknown = { query: null }
      expect(validateWebSearchInput(input)).toBe(false)
    })

    it('should reject input with empty string query', () => {
      const input: unknown = { query: '' }
      expect(validateWebSearchInput(input)).toBe(false)
    })

    it('should reject input with whitespace-only query', () => {
      const input: unknown = { query: '   ' }
      expect(validateWebSearchInput(input)).toBe(false)
    })

    it('should reject input with tabs and newlines in query', () => {
      const input: unknown = { query: '\t\n  ' }
      expect(validateWebSearchInput(input)).toBe(false)
    })
  })

  describe('Invalid inputs - non-string query', () => {
    it('should reject input with number as query', () => {
      const input: unknown = { query: 123 }
      expect(validateWebSearchInput(input)).toBe(false)
    })

    it('should reject input with boolean as query', () => {
      const input: unknown = { query: true }
      expect(validateWebSearchInput(input)).toBe(false)
    })

    it('should reject input with array as query', () => {
      const input: unknown = { query: ['test'] }
      expect(validateWebSearchInput(input)).toBe(false)
    })

    it('should reject input with object as query', () => {
      const input: unknown = { query: { search: 'test' } }
      expect(validateWebSearchInput(input)).toBe(false)
    })
  })

  describe('Invalid inputs - invalid maxResults', () => {
    it('should reject maxResults less than minimum', () => {
      const input: unknown = { query: 'test', maxResults: 0 }
      expect(validateWebSearchInput(input)).toBe(false)
    })

    it('should reject negative maxResults', () => {
      const input: unknown = { query: 'test', maxResults: -5 }
      expect(validateWebSearchInput(input)).toBe(false)
    })

    it('should reject maxResults greater than maximum', () => {
      const input: unknown = { query: 'test', maxResults: 11 }
      expect(validateWebSearchInput(input)).toBe(false)
    })

    it('should reject maxResults as float', () => {
      const input: unknown = { query: 'test', maxResults: 5.5 }
      expect(validateWebSearchInput(input)).toBe(false)
    })

    it('should accept maxResults as string number (converts via Number())', () => {
      const input: unknown = { query: 'test', maxResults: '5' }
      expect(validateWebSearchInput(input)).toBe(true)
    })

    it('should reject maxResults as null', () => {
      const input: unknown = { query: 'test', maxResults: null }
      expect(validateWebSearchInput(input)).toBe(false)
    })

    it('should reject very large maxResults', () => {
      const input: unknown = { query: 'test', maxResults: 999999 }
      expect(validateWebSearchInput(input)).toBe(false)
    })
  })

  describe('Invalid inputs - non-object inputs', () => {
    it('should reject null input', () => {
      const input: unknown = null
      expect(validateWebSearchInput(input)).toBe(false)
    })

    it('should reject undefined input', () => {
      const input: unknown = undefined
      expect(validateWebSearchInput(input)).toBe(false)
    })

    it('should reject string input', () => {
      const input: unknown = 'just a string'
      expect(validateWebSearchInput(input)).toBe(false)
    })

    it('should reject number input', () => {
      const input: unknown = 123
      expect(validateWebSearchInput(input)).toBe(false)
    })

    it('should reject boolean input', () => {
      const input: unknown = true
      expect(validateWebSearchInput(input)).toBe(false)
    })

    it('should reject array input', () => {
      const input: unknown = ['query']
      expect(validateWebSearchInput(input)).toBe(false)
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
        expect(validateWebSearchInput(input as unknown)).toBe(false)
      }
    })
  })

  describe('Edge cases and boundary conditions', () => {
    it('should accept query exceeding max length (no length validation in runtime)', () => {
      const longQuery = 'a'.repeat(501)
      const input: unknown = { query: longQuery }
      expect(validateWebSearchInput(input)).toBe(true)
    })

    it('should accept query at exact min length (1 character)', () => {
      const input: unknown = { query: 'a' }
      expect(validateWebSearchInput(input)).toBe(true)
    })

    it('should accept query at exact max length (500 characters)', () => {
      const query = 'a'.repeat(500)
      const input: unknown = { query }
      expect(validateWebSearchInput(input)).toBe(true)
    })

    it('should validate maxResults as integer only', () => {
      const validInputs = [
        { query: 'test', maxResults: 1 },
        { query: 'test', maxResults: 5 },
        { query: 'test', maxResults: 10 },
      ]

      for (const input of validInputs) {
        expect(validateWebSearchInput(input as unknown)).toBe(true)
      }
    })

    it('should handle objects with numeric string properties', () => {
      const input: unknown = {
        query: 'test',
        '0': 'zero',
        '1': 'one',
      }
      expect(validateWebSearchInput(input)).toBe(true)
    })

    it('should handle inputs with prototype pollution attempt', () => {
      const input: unknown = {
        query: 'test',
        '__proto__': { isAdmin: true },
      }
      expect(validateWebSearchInput(input)).toBe(true)
    })
  })
})

describe('Interface compliance', () => {
  describe('WebSearchToolInput interface', () => {
    it('should accept input matching WebSearchToolInput interface', () => {
      const input: WebSearchToolInput = {
        query: 'test query',
      }
      expect(validateWebSearchInput(input)).toBe(true)
    })

    it('should accept input with optional maxResults', () => {
      const input: WebSearchToolInput = {
        query: 'test query',
        maxResults: 5,
      }
      expect(validateWebSearchInput(input)).toBe(true)
    })

    it('should accept input with undefined optional maxResults', () => {
      const input: WebSearchToolInput = {
        query: 'test query',
        maxResults: undefined,
      }
      expect(validateWebSearchInput(input)).toBe(true)
    })
  })
})
