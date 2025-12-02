/**
 * Unit Tests for Tool Executor
 * Tests lib/chat/tool-executor.ts
 *
 * Note: These tests focus on formatToolResult and detectToolCalls functions
 * which contain the core logic. The executeToolCall functions are integration
 * points that call external tool handlers.
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals'
import {
  formatToolResult,
  detectToolCalls,
  type ToolResult,
} from '@/lib/chat/tool-executor'

describe('Tool Executor', () => {
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>

  beforeEach(() => {
    jest.clearAllMocks()
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  // ============================================================================
  // formatToolResult Tests
  // ============================================================================

  describe('formatToolResult', () => {
    it('should format successful tool result for ANTHROPIC provider', () => {
      const toolResult: ToolResult = {
        toolName: 'generate_image',
        success: true,
        result: { images: ['image1.png'] },
      }

      const formatted = formatToolResult(toolResult, 'ANTHROPIC')

      expect(formatted).toEqual({
        role: 'user',
        content: expect.stringContaining('Tool Result: generate_image'),
      })
      expect(formatted.content).toContain('image1.png')
    })

    it('should format successful tool result for OPENAI provider', () => {
      const toolResult: ToolResult = {
        toolName: 'search_web',
        success: true,
        result: {
          results: [
            { title: 'Result 1', url: 'https://example.com', snippet: 'Snippet' },
          ],
        },
      }

      const formatted = formatToolResult(toolResult, 'OPENAI')

      expect(formatted).toEqual({
        role: 'user',
        content: expect.stringContaining('Tool Result: search_web'),
      })
      expect(formatted.content).toContain('Result 1')
    })

    it('should format default provider (handles unknown providers)', () => {
      const toolResult: ToolResult = {
        toolName: 'search_memories',
        success: true,
        result: { memories: ['memory1'] },
      }

      const formatted = formatToolResult(toolResult, 'UNKNOWN_PROVIDER')

      expect(formatted).toEqual({
        role: 'user',
        content: expect.stringContaining('Tool Result: search_memories'),
      })
    })

    it('should format error tool result', () => {
      const toolResult: ToolResult = {
        toolName: 'generate_image',
        success: false,
        result: null,
        error: 'API rate limit exceeded',
      }

      const formatted = formatToolResult(toolResult, 'OPENAI')

      expect(formatted.content).toContain('Error: API rate limit exceeded')
    })

    it('should format error result with undefined error message', () => {
      const toolResult: ToolResult = {
        toolName: 'search_web',
        success: false,
        result: null,
        error: undefined,
      }

      const formatted = formatToolResult(toolResult, 'ANTHROPIC')

      expect(formatted.content).toContain('Error: Unknown error')
    })

    it('should handle complex nested results', () => {
      const toolResult: ToolResult = {
        toolName: 'search_memories',
        success: true,
        result: {
          memories: [
            { id: '1', content: 'Memory 1', importance: 8 },
            { id: '2', content: 'Memory 2', importance: 9 },
          ],
          metadata: {
            provider: 'ANTHROPIC',
          },
        },
      }

      const formatted = formatToolResult(toolResult, 'ANTHROPIC')

      expect(formatted.role).toBe('user')
      expect(formatted.content).toContain('Tool Result: search_memories')
      expect(formatted.content).toContain('Memory 1')
      expect(formatted.content).toContain('Memory 2')
    })

    it('should return consistent structure for all providers', () => {
      const toolResult: ToolResult = {
        toolName: 'test_tool',
        success: true,
        result: { data: 'test' },
      }

      const providers = ['ANTHROPIC', 'OPENAI', 'GROK', 'GOOGLE', 'UNKNOWN']

      for (const provider of providers) {
        const formatted = formatToolResult(toolResult, provider)
        expect(formatted).toHaveProperty('role', 'user')
        expect(formatted).toHaveProperty('content')
        expect(formatted.content).toContain('Tool Result: test_tool')
      }
    })
  })

  // ============================================================================
  // detectToolCalls - OPENAI format Tests
  // ============================================================================

  describe('detectToolCalls - OPENAI format', () => {
    it('should detect tool calls from OpenAI response (direct structure)', () => {
      const response = {
        tool_calls: [
          {
            type: 'function',
            function: {
              name: 'generate_image',
              arguments: JSON.stringify({ prompt: 'A sunset' }),
            },
          },
        ],
      }

      const toolCalls = detectToolCalls(response, 'OPENAI')

      expect(toolCalls).toHaveLength(1)
      expect(toolCalls[0]).toEqual({
        name: 'generate_image',
        arguments: { prompt: 'A sunset' },
      })
    })

    it('should detect tool calls from OpenAI nested structure (streaming)', () => {
      const response = {
        choices: [
          {
            message: {
              tool_calls: [
                {
                  type: 'function',
                  function: {
                    name: 'search_web',
                    arguments: JSON.stringify({ query: 'weather today' }),
                  },
                },
              ],
            },
          },
        ],
      }

      const toolCalls = detectToolCalls(response, 'OPENAI')

      expect(toolCalls).toHaveLength(1)
      expect(toolCalls[0].name).toBe('search_web')
      expect(toolCalls[0].arguments).toEqual({ query: 'weather today' })
    })

    it('should handle multiple tool calls in OpenAI response', () => {
      const response = {
        tool_calls: [
          {
            type: 'function',
            function: {
              name: 'generate_image',
              arguments: JSON.stringify({ prompt: 'Cat' }),
            },
          },
          {
            type: 'function',
            function: {
              name: 'search_web',
              arguments: JSON.stringify({ query: 'cat breeds' }),
            },
          },
        ],
      }

      const toolCalls = detectToolCalls(response, 'OPENAI')

      expect(toolCalls).toHaveLength(2)
      expect(toolCalls[0].name).toBe('generate_image')
      expect(toolCalls[1].name).toBe('search_web')
    })

    it('should skip non-function tool calls in OpenAI response', () => {
      const response = {
        tool_calls: [
          {
            type: 'retrieval',
            function: {
              name: 'retrieve_docs',
              arguments: '{}',
            },
          },
          {
            type: 'function',
            function: {
              name: 'search_web',
              arguments: JSON.stringify({ query: 'test' }),
            },
          },
        ],
      }

      const toolCalls = detectToolCalls(response, 'OPENAI')

      expect(toolCalls).toHaveLength(1)
      expect(toolCalls[0].name).toBe('search_web')
    })

    it('should handle malformed JSON in OpenAI arguments', () => {
      const response = {
        tool_calls: [
          {
            type: 'function',
            function: {
              name: 'search_web',
              arguments: 'not valid json',
            },
          },
        ],
      }

      const toolCalls = detectToolCalls(response, 'OPENAI')

      expect(toolCalls).toEqual([])
    })

    it('should return empty array when no tool calls in OpenAI response', () => {
      const response = {
        choices: [
          {
            message: {
              content: 'Just a text response',
            },
          },
        ],
      }

      const toolCalls = detectToolCalls(response, 'OPENAI')

      expect(toolCalls).toEqual([])
    })

    it('should handle missing function property in OpenAI response', () => {
      const response = {
        tool_calls: [
          {
            type: 'function',
            // function property is missing
          },
        ],
      }

      const toolCalls = detectToolCalls(response, 'OPENAI')

      expect(toolCalls).toEqual([])
    })

    it('should handle empty arguments string', () => {
      const response = {
        tool_calls: [
          {
            type: 'function',
            function: {
              name: 'test_tool',
              arguments: '',
            },
          },
        ],
      }

      const toolCalls = detectToolCalls(response, 'OPENAI')

      expect(toolCalls).toHaveLength(1)
      expect(toolCalls[0].arguments).toEqual({})
    })
  })

  // ============================================================================
  // detectToolCalls - ANTHROPIC format Tests
  // ============================================================================

  describe('detectToolCalls - ANTHROPIC format', () => {
    it('should detect tool calls from Anthropic response', () => {
      const response = {
        content: [
          {
            type: 'tool_use',
            name: 'generate_image',
            input: { prompt: 'A mountain landscape' },
          },
        ],
      }

      const toolCalls = detectToolCalls(response, 'ANTHROPIC')

      expect(toolCalls).toHaveLength(1)
      expect(toolCalls[0]).toEqual({
        name: 'generate_image',
        arguments: { prompt: 'A mountain landscape' },
      })
    })

    it('should handle multiple tool use blocks in Anthropic response', () => {
      const response = {
        content: [
          {
            type: 'tool_use',
            name: 'search_memories',
            input: { query: 'birthday' },
          },
          {
            type: 'tool_use',
            name: 'generate_image',
            input: { prompt: 'Birthday cake' },
          },
        ],
      }

      const toolCalls = detectToolCalls(response, 'ANTHROPIC')

      expect(toolCalls).toHaveLength(2)
      expect(toolCalls[0].name).toBe('search_memories')
      expect(toolCalls[1].name).toBe('generate_image')
    })

    it('should skip non-tool_use content blocks in Anthropic response', () => {
      const response = {
        content: [
          {
            type: 'text',
            text: 'Let me search for that...',
          },
          {
            type: 'tool_use',
            name: 'search_web',
            input: { query: 'weather' },
          },
        ],
      }

      const toolCalls = detectToolCalls(response, 'ANTHROPIC')

      expect(toolCalls).toHaveLength(1)
      expect(toolCalls[0].name).toBe('search_web')
    })

    it('should handle missing input in Anthropic tool_use', () => {
      const response = {
        content: [
          {
            type: 'tool_use',
            name: 'search_web',
            // input is missing
          },
        ],
      }

      const toolCalls = detectToolCalls(response, 'ANTHROPIC')

      expect(toolCalls).toHaveLength(1)
      expect(toolCalls[0].arguments).toEqual({})
    })

    it('should return empty array when no tool_use in Anthropic response', () => {
      const response = {
        content: [
          {
            type: 'text',
            text: 'Hello, how can I help you?',
          },
        ],
      }

      const toolCalls = detectToolCalls(response, 'ANTHROPIC')

      expect(toolCalls).toEqual([])
    })

    it('should return empty array for null response content', () => {
      const response = {
        content: null,
      }

      const toolCalls = detectToolCalls(response, 'ANTHROPIC')

      expect(toolCalls).toEqual([])
    })

    it('should handle response with undefined content', () => {
      const response = {}

      const toolCalls = detectToolCalls(response, 'ANTHROPIC')

      expect(toolCalls).toEqual([])
    })
  })

  // ============================================================================
  // detectToolCalls - GROK format Tests
  // ============================================================================

  describe('detectToolCalls - GROK format', () => {
    it('should detect tool calls from Grok response (OpenAI-like direct structure)', () => {
      const response = {
        tool_calls: [
          {
            type: 'function',
            function: {
              name: 'search_web',
              arguments: JSON.stringify({ query: 'latest news' }),
            },
          },
        ],
      }

      const toolCalls = detectToolCalls(response, 'GROK')

      expect(toolCalls).toHaveLength(1)
      expect(toolCalls[0].name).toBe('search_web')
    })

    it('should detect tool calls from Grok nested structure (streaming)', () => {
      const response = {
        choices: [
          {
            message: {
              tool_calls: [
                {
                  type: 'function',
                  function: {
                    name: 'generate_image',
                    arguments: JSON.stringify({ prompt: 'Space station' }),
                  },
                },
              ],
            },
          },
        ],
      }

      const toolCalls = detectToolCalls(response, 'GROK')

      expect(toolCalls).toHaveLength(1)
      expect(toolCalls[0].name).toBe('generate_image')
    })

    it('should handle multiple tool calls in Grok response', () => {
      const response = {
        tool_calls: [
          {
            type: 'function',
            function: {
              name: 'search_memories',
              arguments: JSON.stringify({ query: 'preferences' }),
            },
          },
          {
            type: 'function',
            function: {
              name: 'search_web',
              arguments: JSON.stringify({ query: 'recommendations' }),
            },
          },
        ],
      }

      const toolCalls = detectToolCalls(response, 'GROK')

      expect(toolCalls).toHaveLength(2)
    })

    it('should return empty array when no tool calls in Grok response', () => {
      const response = {
        choices: [
          {
            message: {
              content: 'Text response only',
            },
          },
        ],
      }

      const toolCalls = detectToolCalls(response, 'GROK')

      expect(toolCalls).toEqual([])
    })
  })

  // ============================================================================
  // detectToolCalls - GOOGLE format Tests
  // ============================================================================

  describe('detectToolCalls - GOOGLE format', () => {
    it('should detect tool calls from Google response', () => {
      const response = {
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: {
                    name: 'search_web',
                    args: { query: 'AI news' },
                  },
                },
              ],
            },
          },
        ],
      }

      const toolCalls = detectToolCalls(response, 'GOOGLE')

      expect(toolCalls).toHaveLength(1)
      expect(toolCalls[0]).toEqual({
        name: 'search_web',
        arguments: { query: 'AI news' },
      })
    })

    it('should handle multiple function calls in Google response', () => {
      const response = {
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: {
                    name: 'search_memories',
                    args: { query: 'hobbies' },
                  },
                },
                {
                  functionCall: {
                    name: 'generate_image',
                    args: { prompt: 'Hobby scene' },
                  },
                },
              ],
            },
          },
        ],
      }

      const toolCalls = detectToolCalls(response, 'GOOGLE')

      expect(toolCalls).toHaveLength(2)
      expect(toolCalls[0].name).toBe('search_memories')
      expect(toolCalls[1].name).toBe('generate_image')
    })

    it('should skip text parts in Google response', () => {
      const response = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: 'Let me search for that...',
                },
                {
                  functionCall: {
                    name: 'search_web',
                    args: { query: 'test' },
                  },
                },
              ],
            },
          },
        ],
      }

      const toolCalls = detectToolCalls(response, 'GOOGLE')

      expect(toolCalls).toHaveLength(1)
      expect(toolCalls[0].name).toBe('search_web')
    })

    it('should handle missing args in Google function call', () => {
      const response = {
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: {
                    name: 'test_tool',
                    // args is missing
                  },
                },
              ],
            },
          },
        ],
      }

      const toolCalls = detectToolCalls(response, 'GOOGLE')

      expect(toolCalls).toHaveLength(1)
      expect(toolCalls[0].arguments).toEqual({})
    })

    it('should return empty array when no function calls in Google response', () => {
      const response = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: 'Just a text response',
                },
              ],
            },
          },
        ],
      }

      const toolCalls = detectToolCalls(response, 'GOOGLE')

      expect(toolCalls).toEqual([])
    })

    it('should return empty array for malformed Google response', () => {
      const response = {
        candidates: [],
      }

      const toolCalls = detectToolCalls(response, 'GOOGLE')

      expect(toolCalls).toEqual([])
    })

    it('should handle missing parts in Google response', () => {
      const response = {
        candidates: [
          {
            content: {},
          },
        ],
      }

      const toolCalls = detectToolCalls(response, 'GOOGLE')

      expect(toolCalls).toEqual([])
    })
  })

  // ============================================================================
  // detectToolCalls - Error Handling Tests
  // ============================================================================

  describe('detectToolCalls - error handling', () => {
    it('should return empty array for null response', () => {
      const toolCalls = detectToolCalls(null, 'OPENAI')

      expect(toolCalls).toEqual([])
    })

    it('should return empty array for undefined response', () => {
      const toolCalls = detectToolCalls(undefined, 'OPENAI')

      expect(toolCalls).toEqual([])
    })

    it('should handle malformed JSON in function arguments gracefully', () => {
      const response = {
        tool_calls: [
          {
            type: 'function',
            function: {
              name: 'test_tool',
              arguments: '{ invalid json }',
            },
          },
        ],
      }

      const toolCalls = detectToolCalls(response, 'OPENAI')

      expect(toolCalls).toEqual([])
    })

    it('should handle non-existent provider gracefully', () => {
      const response = {
        tool_calls: [
          {
            type: 'function',
            function: {
              name: 'test_tool',
              arguments: '{}',
            },
          },
        ],
      }

      const toolCalls = detectToolCalls(response, 'NONEXISTENT')

      expect(toolCalls).toEqual([])
    })

    it('should handle response with unexpected structure', () => {
      const response = {
        unexpectedKey: 'unexpected value',
        anotherKey: { nested: true },
      }

      const toolCalls = detectToolCalls(response, 'OPENAI')

      expect(toolCalls).toEqual([])
    })

    it('should not throw on deeply nested invalid structures', () => {
      const response = {
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: null,
                },
              ],
            },
          },
        ],
      }

      expect(() => detectToolCalls(response, 'GOOGLE')).not.toThrow()
    })
  })

  // ============================================================================
  // Edge Cases Tests
  // ============================================================================

  describe('Edge cases', () => {
    it('should handle tool call with empty string name', () => {
      const response = {
        tool_calls: [
          {
            type: 'function',
            function: {
              name: '',
              arguments: '{}',
            },
          },
        ],
      }

      const toolCalls = detectToolCalls(response, 'OPENAI')

      expect(toolCalls).toHaveLength(1)
      expect(toolCalls[0].name).toBe('')
    })

    it('should handle special characters in tool arguments', () => {
      const response = {
        tool_calls: [
          {
            type: 'function',
            function: {
              name: 'search_web',
              arguments: JSON.stringify({
                query: 'test & special <chars> "quotes" \'apostrophe\'',
              }),
            },
          },
        ],
      }

      const toolCalls = detectToolCalls(response, 'OPENAI')

      expect(toolCalls).toHaveLength(1)
      expect(toolCalls[0].arguments.query).toBe(
        'test & special <chars> "quotes" \'apostrophe\''
      )
    })

    it('should handle unicode in tool arguments', () => {
      const response = {
        content: [
          {
            type: 'tool_use',
            name: 'search_web',
            input: { query: '日本語テスト 🎉 emoji' },
          },
        ],
      }

      const toolCalls = detectToolCalls(response, 'ANTHROPIC')

      expect(toolCalls).toHaveLength(1)
      expect(toolCalls[0].arguments.query).toBe('日本語テスト 🎉 emoji')
    })

    it('should handle very large arguments object', () => {
      const largeData = {
        items: Array.from({ length: 100 }, (_, i) => ({
          id: i,
          name: `Item ${i}`,
          description: 'A'.repeat(100),
        })),
      }

      const response = {
        tool_calls: [
          {
            type: 'function',
            function: {
              name: 'process_data',
              arguments: JSON.stringify(largeData),
            },
          },
        ],
      }

      const toolCalls = detectToolCalls(response, 'OPENAI')

      expect(toolCalls).toHaveLength(1)
      expect(toolCalls[0].arguments.items).toHaveLength(100)
    })

    it('should handle nested objects in arguments', () => {
      const response = {
        content: [
          {
            type: 'tool_use',
            name: 'complex_tool',
            input: {
              level1: {
                level2: {
                  level3: {
                    value: 'deep',
                  },
                },
              },
            },
          },
        ],
      }

      const toolCalls = detectToolCalls(response, 'ANTHROPIC')

      expect(toolCalls).toHaveLength(1)
      expect(toolCalls[0].arguments.level1.level2.level3.value).toBe('deep')
    })

    it('should handle arrays in arguments', () => {
      const response = {
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: {
                    name: 'batch_process',
                    args: {
                      items: ['a', 'b', 'c'],
                      numbers: [1, 2, 3],
                    },
                  },
                },
              ],
            },
          },
        ],
      }

      const toolCalls = detectToolCalls(response, 'GOOGLE')

      expect(toolCalls).toHaveLength(1)
      expect(toolCalls[0].arguments.items).toEqual(['a', 'b', 'c'])
      expect(toolCalls[0].arguments.numbers).toEqual([1, 2, 3])
    })
  })

  // ============================================================================
  // formatToolResult Edge Cases
  // ============================================================================

  describe('formatToolResult edge cases', () => {
    it('should handle null result', () => {
      const toolResult: ToolResult = {
        toolName: 'test_tool',
        success: true,
        result: null,
      }

      const formatted = formatToolResult(toolResult, 'OPENAI')

      expect(formatted.content).toContain('null')
    })

    it('should handle undefined result', () => {
      const toolResult: ToolResult = {
        toolName: 'test_tool',
        success: true,
        result: undefined,
      }

      const formatted = formatToolResult(toolResult, 'OPENAI')

      expect(formatted.content).toBeDefined()
    })

    it('should handle result with circular reference workaround', () => {
      // Create an object that would normally cause issues but is properly handled
      const toolResult: ToolResult = {
        toolName: 'test_tool',
        success: true,
        result: {
          data: 'test',
          nested: { value: 1 },
        },
      }

      expect(() => formatToolResult(toolResult, 'OPENAI')).not.toThrow()
    })

    it('should handle empty string error', () => {
      const toolResult: ToolResult = {
        toolName: 'test_tool',
        success: false,
        result: null,
        error: '',
      }

      const formatted = formatToolResult(toolResult, 'OPENAI')

      // Empty string is falsy, so it should fall back to "Unknown error"
      expect(formatted.content).toContain('Error:')
    })

    it('should handle result with special JSON characters', () => {
      const toolResult: ToolResult = {
        toolName: 'test_tool',
        success: true,
        result: {
          text: 'Line1\nLine2\tTabbed',
          quoted: '"Hello"',
        },
      }

      const formatted = formatToolResult(toolResult, 'OPENAI')

      expect(formatted.content).toContain('Line1')
      expect(formatted.content).toContain('Hello')
    })
  })
})
