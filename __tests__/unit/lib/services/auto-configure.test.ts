/**
 * Unit Tests for Auto-Configure Service
 * Tests lib/services/auto-configure.service.ts
 *
 * Covers:
 * - Successful auto-configuration with web search + LLM analysis
 * - Value clamping to valid ranges
 * - Error when web search is not configured
 * - Fallback to cheap LLM when primary JSON parsing fails
 * - Search source collection from web search results
 * - Model class assignment validation
 */

import { autoConfigureProfile, type AutoConfigureResult } from '@/lib/services/auto-configure.service'
import { executeWebSearchTool, formatWebSearchResults, isWebSearchConfigured } from '@/lib/tools/handlers/web-search-handler'
import { createLLMProvider } from '@/lib/llm'
import { parseLLMJson } from '@/lib/services/ai-import.service'
import { getCheapLLMProvider } from '@/lib/llm/cheap-llm'
import { getUserRepositories } from '@/lib/repositories/user-scoped'
import { logLLMCall } from '@/lib/services/llm-logging.service'

// ============================================================================
// Mocks
// ============================================================================

jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

jest.mock('@/lib/tools/handlers/web-search-handler', () => ({
  executeWebSearchTool: jest.fn(),
  formatWebSearchResults: jest.fn(),
  isWebSearchConfigured: jest.fn(),
  WebSearchError: class extends Error {},
}))

jest.mock('@/lib/llm', () => ({
  createLLMProvider: jest.fn(),
}))

jest.mock('@/lib/services/ai-import.service', () => ({
  parseLLMJson: jest.fn(),
}))

jest.mock('@/lib/llm/cheap-llm', () => ({
  getCheapLLMProvider: jest.fn(),
  profileParams: (profile: { parameters?: unknown }) =>
    profile?.parameters && typeof profile.parameters === 'object'
      ? (profile.parameters as Record<string, unknown>)
      : undefined,
}))

jest.mock('@/lib/repositories/user-scoped', () => ({
  getUserRepositories: jest.fn(),
}))

jest.mock('@/lib/services/llm-logging.service', () => ({
  logLLMCall: jest.fn(),
}))

const mockExecuteWebSearchTool = jest.mocked(executeWebSearchTool)
const mockFormatWebSearchResults = jest.mocked(formatWebSearchResults)
const mockIsWebSearchConfigured = jest.mocked(isWebSearchConfigured)
const mockCreateLLMProvider = jest.mocked(createLLMProvider)
const mockParseLLMJson = jest.mocked(parseLLMJson)
const mockGetCheapLLMProvider = jest.mocked(getCheapLLMProvider)
const mockGetUserRepositories = jest.mocked(getUserRepositories)
const mockLogLLMCall = jest.mocked(logLLMCall)

// ============================================================================
// Fixtures
// ============================================================================

const TEST_USER_ID = 'user-123'
const TEST_PROVIDER = 'ANTHROPIC'
const TEST_MODEL = 'claude-sonnet-4-5-20250929'

function createMockDefaultProfile() {
  return {
    id: 'profile-1',
    name: 'Default Profile',
    provider: 'ANTHROPIC',
    modelName: 'claude-sonnet-4-5-20250929',
    apiKeyId: 'key-1',
    baseUrl: null,
    userId: TEST_USER_ID,
    isDefault: true,
    parameters: {},
  }
}

function createMockRepos(overrides?: {
  findDefault?: jest.Mock
  findById?: jest.Mock
  findApiKeyById?: jest.Mock
  findAll?: jest.Mock
}) {
  return {
    connections: {
      findDefault: overrides?.findDefault ?? jest.fn().mockResolvedValue(createMockDefaultProfile()),
      findById: overrides?.findById ?? jest.fn().mockResolvedValue(createMockDefaultProfile()),
      findApiKeyById: overrides?.findApiKeyById ?? jest.fn().mockResolvedValue({ key_value: 'sk-test-key' }),
      findAll: overrides?.findAll ?? jest.fn().mockResolvedValue([createMockDefaultProfile()]),
    },
    chatSettings: { findByUserId: jest.fn() },
  }
}

function createSuccessfulSearchResult(urls: string[]) {
  return {
    success: true,
    results: urls.map((url, i) => ({
      title: `Result ${i + 1}`,
      url,
      content: `Content for ${url}`,
    })),
  }
}

const VALID_LLM_RESPONSE = {
  maxContext: 200000,
  maxTokens: 8192,
  temperature: 0.85,
  topP: 0.95,
  isDangerousCompatible: false,
  modelClass: 'Extended',
}

// ============================================================================
// Tests
// ============================================================================

describe('autoConfigureProfile', () => {
  let mockSendMessage: jest.Mock

  beforeEach(() => {
    jest.clearAllMocks()

    mockIsWebSearchConfigured.mockReturnValue(true)

    const mockRepos = createMockRepos()
    mockGetUserRepositories.mockReturnValue(mockRepos)

    mockExecuteWebSearchTool.mockResolvedValue(
      createSuccessfulSearchResult(['https://docs.anthropic.com/specs', 'https://example.com/review'])
    )
    mockFormatWebSearchResults.mockReturnValue('Formatted search results')

    mockSendMessage = jest.fn().mockResolvedValue({
      content: JSON.stringify(VALID_LLM_RESPONSE),
      usage: { promptTokens: 500, completionTokens: 100 },
    })
    mockCreateLLMProvider.mockResolvedValue({ sendMessage: mockSendMessage })

    mockParseLLMJson.mockReturnValue(VALID_LLM_RESPONSE)

    mockLogLLMCall.mockResolvedValue(undefined)
  })

  // --------------------------------------------------------------------------
  // Successful auto-configuration
  // --------------------------------------------------------------------------

  it('should return valid auto-configure result with web search and LLM analysis', async () => {
    const result = await autoConfigureProfile(TEST_PROVIDER, TEST_MODEL, TEST_USER_ID)

    expect(result.maxContext).toBe(200000)
    expect(result.maxTokens).toBe(8192)
    expect(result.temperature).toBe(0.85)
    expect(result.topP).toBe(0.95)
    expect(result.isDangerousCompatible).toBe(false)
    expect(result.modelClass).toBe('Extended')
  })

  it('should run two parallel web searches for specs and settings', async () => {
    await autoConfigureProfile(TEST_PROVIDER, TEST_MODEL, TEST_USER_ID)

    expect(mockExecuteWebSearchTool).toHaveBeenCalledTimes(2)

    const [specsCall, settingsCall] = mockExecuteWebSearchTool.mock.calls
    expect((specsCall[0] as { query: string }).query).toContain('specifications')
    expect((specsCall[0] as { query: string }).query).toContain(TEST_MODEL)
    expect((settingsCall[0] as { query: string }).query).toContain('temperature')
    expect((settingsCall[0] as { query: string }).query).toContain('creative writing')
  })

  it('should send formatted search results to the default LLM for analysis', async () => {
    await autoConfigureProfile(TEST_PROVIDER, TEST_MODEL, TEST_USER_ID)

    expect(mockCreateLLMProvider).toHaveBeenCalledWith('ANTHROPIC', undefined)
    expect(mockSendMessage).toHaveBeenCalledTimes(1)

    const callArgs = mockSendMessage.mock.calls[0][0] as { messages: Array<{ role: string; content: string }>; temperature: number }
    expect(callArgs.messages).toHaveLength(2)
    expect(callArgs.messages[0].role).toBe('system')
    expect(callArgs.messages[1].role).toBe('user')
    expect(callArgs.temperature).toBe(0.2)
  })

  it('should log the LLM call for auditing', async () => {
    await autoConfigureProfile(TEST_PROVIDER, TEST_MODEL, TEST_USER_ID)

    expect(mockLogLLMCall).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: TEST_USER_ID,
        type: 'AUTO_CONFIGURE',
        provider: 'ANTHROPIC',
      })
    )
  })

  // --------------------------------------------------------------------------
  // Value clamping
  // --------------------------------------------------------------------------

  describe('validateResult clamping', () => {
    it('should clamp temperature to 0-2 range', async () => {
      mockParseLLMJson.mockReturnValue({ ...VALID_LLM_RESPONSE, temperature: 5.0 })

      const result = await autoConfigureProfile(TEST_PROVIDER, TEST_MODEL, TEST_USER_ID)
      expect(result.temperature).toBe(2)
    })

    it('should clamp negative temperature to 0', async () => {
      mockParseLLMJson.mockReturnValue({ ...VALID_LLM_RESPONSE, temperature: -1 })

      const result = await autoConfigureProfile(TEST_PROVIDER, TEST_MODEL, TEST_USER_ID)
      expect(result.temperature).toBe(0)
    })

    it('should clamp topP to 0-1 range', async () => {
      mockParseLLMJson.mockReturnValue({ ...VALID_LLM_RESPONSE, topP: 1.5 })

      const result = await autoConfigureProfile(TEST_PROVIDER, TEST_MODEL, TEST_USER_ID)
      expect(result.topP).toBe(1)
    })

    it('should clamp negative topP to 0', async () => {
      mockParseLLMJson.mockReturnValue({ ...VALID_LLM_RESPONSE, topP: -0.5 })

      const result = await autoConfigureProfile(TEST_PROVIDER, TEST_MODEL, TEST_USER_ID)
      expect(result.topP).toBe(0)
    })

    it('should enforce maxContext >= 1', async () => {
      mockParseLLMJson.mockReturnValue({ ...VALID_LLM_RESPONSE, maxContext: 0 })

      const result = await autoConfigureProfile(TEST_PROVIDER, TEST_MODEL, TEST_USER_ID)
      expect(result.maxContext).toBeGreaterThanOrEqual(1)
    })

    it('should enforce maxTokens >= 1', async () => {
      mockParseLLMJson.mockReturnValue({ ...VALID_LLM_RESPONSE, maxTokens: -100 })

      const result = await autoConfigureProfile(TEST_PROVIDER, TEST_MODEL, TEST_USER_ID)
      expect(result.maxTokens).toBeGreaterThanOrEqual(1)
    })

    it('should round maxContext to an integer', async () => {
      mockParseLLMJson.mockReturnValue({ ...VALID_LLM_RESPONSE, maxContext: 128000.7 })

      const result = await autoConfigureProfile(TEST_PROVIDER, TEST_MODEL, TEST_USER_ID)
      expect(result.maxContext).toBe(128001)
      expect(Number.isInteger(result.maxContext)).toBe(true)
    })

    it('should use default values for NaN inputs', async () => {
      mockParseLLMJson.mockReturnValue({
        ...VALID_LLM_RESPONSE,
        maxContext: 'not-a-number',
        temperature: undefined,
        topP: null,
      })

      const result = await autoConfigureProfile(TEST_PROVIDER, TEST_MODEL, TEST_USER_ID)
      // Defaults: maxContext=4096, temperature=0.7, topP=1
      expect(result.maxContext).toBe(4096)
      expect(result.temperature).toBe(0.7)
      expect(result.topP).toBe(1)
    })
  })

  // --------------------------------------------------------------------------
  // Web search not configured
  // --------------------------------------------------------------------------

  it('should throw when web search is not configured', async () => {
    mockIsWebSearchConfigured.mockReturnValue(false)

    await expect(autoConfigureProfile(TEST_PROVIDER, TEST_MODEL, TEST_USER_ID)).rejects.toThrow(
      'Web search is not configured'
    )
  })

  // --------------------------------------------------------------------------
  // No default profile
  // --------------------------------------------------------------------------

  it('should throw when no default connection profile is configured', async () => {
    const repos = createMockRepos({
      findDefault: jest.fn().mockResolvedValue(null),
    })
    mockGetUserRepositories.mockReturnValue(repos)

    await expect(autoConfigureProfile(TEST_PROVIDER, TEST_MODEL, TEST_USER_ID)).rejects.toThrow(
      'No default connection profile configured'
    )
  })

  // --------------------------------------------------------------------------
  // Cheap LLM fallback on parse failure
  // --------------------------------------------------------------------------

  it('should fall back to cheap LLM repair when primary JSON parsing fails', async () => {
    // First call to parseLLMJson throws (primary parse failure)
    mockParseLLMJson
      .mockImplementationOnce(() => {
        throw new Error('Invalid JSON')
      })
      // Second call succeeds (cheap LLM repair output)
      .mockReturnValueOnce(VALID_LLM_RESPONSE)

    const cheapSendMessage = jest.fn().mockResolvedValue({
      content: JSON.stringify(VALID_LLM_RESPONSE),
      usage: { promptTokens: 100, completionTokens: 50 },
    })

    // The cheap LLM provider is set up via getCheapLLMProvider
    mockGetCheapLLMProvider.mockReturnValue({
      provider: 'OPENAI',
      modelName: 'gpt-4o-mini',
      baseUrl: undefined,
      isLocal: false,
      connectionProfileId: 'profile-1',
    })

    // createLLMProvider is called twice: once for primary, once for cheap
    mockCreateLLMProvider
      .mockResolvedValueOnce({ sendMessage: mockSendMessage })
      .mockResolvedValueOnce({ sendMessage: cheapSendMessage })

    const result = await autoConfigureProfile(TEST_PROVIDER, TEST_MODEL, TEST_USER_ID)

    expect(mockGetCheapLLMProvider).toHaveBeenCalled()
    expect(cheapSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ temperature: 0.1, maxTokens: 500 }),
      'sk-test-key'
    )
    expect(result.maxContext).toBe(200000)
  })

  it('should throw when both primary and cheap LLM parsing fail', async () => {
    mockParseLLMJson.mockImplementation(() => {
      throw new Error('Invalid JSON')
    })

    mockGetCheapLLMProvider.mockReturnValue({
      provider: 'OPENAI',
      modelName: 'gpt-4o-mini',
      baseUrl: undefined,
      isLocal: false,
      connectionProfileId: 'profile-1',
    })

    const cheapSendMessage = jest.fn().mockResolvedValue({
      content: 'totally broken response',
      usage: { promptTokens: 100, completionTokens: 50 },
    })

    mockCreateLLMProvider
      .mockResolvedValueOnce({ sendMessage: mockSendMessage })
      .mockResolvedValueOnce({ sendMessage: cheapSendMessage })

    // With a single candidate (the default), the wrapper summarises the one attempt
    // and surfaces the underlying parse failure.
    await expect(autoConfigureProfile(TEST_PROVIDER, TEST_MODEL, TEST_USER_ID)).rejects.toThrow(
      'Auto-configure failed on all 1 candidate provider(s)'
    )
    await expect(autoConfigureProfile(TEST_PROVIDER, TEST_MODEL, TEST_USER_ID)).rejects.toThrow(
      'Failed to parse response from ANTHROPIC'
    )
  })

  // --------------------------------------------------------------------------
  // Cross-provider fallback
  // --------------------------------------------------------------------------

  it('should fall back to another provider when the default profile fails', async () => {
    const defaultProfile = createMockDefaultProfile()
    const fallbackProfile = {
      id: 'profile-2',
      name: 'OpenAI Fallback',
      provider: 'OPENAI',
      modelName: 'gpt-5',
      apiKeyId: 'key-2',
      baseUrl: null,
      userId: TEST_USER_ID,
      isDefault: false,
      modelClass: 'Deep',
      parameters: {},
    }

    const repos = createMockRepos({
      findApiKeyById: jest.fn().mockImplementation((id: string) =>
        Promise.resolve({ key_value: id === 'key-1' ? 'sk-default' : 'sk-fallback' })
      ),
      findAll: jest.fn().mockResolvedValue([defaultProfile, fallbackProfile]),
    })
    mockGetUserRepositories.mockReturnValue(repos)

    const failingSend = jest.fn().mockRejectedValue(new Error('429 rate_limit_exceeded'))
    const succeedingSend = jest.fn().mockResolvedValue({
      content: JSON.stringify(VALID_LLM_RESPONSE),
      usage: { promptTokens: 500, completionTokens: 100 },
    })

    mockCreateLLMProvider
      .mockResolvedValueOnce({ sendMessage: failingSend })
      .mockResolvedValueOnce({ sendMessage: succeedingSend })

    const result = await autoConfigureProfile(TEST_PROVIDER, TEST_MODEL, TEST_USER_ID)

    expect(failingSend).toHaveBeenCalledTimes(1)
    expect(succeedingSend).toHaveBeenCalledTimes(1)
    expect(mockCreateLLMProvider).toHaveBeenNthCalledWith(1, 'ANTHROPIC', undefined)
    expect(mockCreateLLMProvider).toHaveBeenNthCalledWith(2, 'OPENAI', undefined)
    expect(result.maxContext).toBe(200000)
  })

  // --------------------------------------------------------------------------
  // Search source collection
  // --------------------------------------------------------------------------

  it('should collect source URLs from both web search result sets', async () => {
    const specsUrls = ['https://docs.anthropic.com/specs', 'https://example.com/model-card']
    const settingsUrls = ['https://blog.example.com/settings-guide']

    mockExecuteWebSearchTool
      .mockResolvedValueOnce(createSuccessfulSearchResult(specsUrls))
      .mockResolvedValueOnce(createSuccessfulSearchResult(settingsUrls))

    const result = await autoConfigureProfile(TEST_PROVIDER, TEST_MODEL, TEST_USER_ID)

    expect(result.searchSources).toEqual(expect.arrayContaining(specsUrls))
    expect(result.searchSources).toEqual(expect.arrayContaining(settingsUrls))
    expect(result.searchSources).toHaveLength(3)
  })

  it('should return empty search sources when web searches fail', async () => {
    mockExecuteWebSearchTool.mockResolvedValue({ success: false, results: null })

    const result = await autoConfigureProfile(TEST_PROVIDER, TEST_MODEL, TEST_USER_ID)

    expect(result.searchSources).toEqual([])
  })

  // --------------------------------------------------------------------------
  // Model class validation
  // --------------------------------------------------------------------------

  describe('model class assignment', () => {
    it('should accept valid model class names', async () => {
      for (const validClass of ['Compact', 'Standard', 'Extended', 'Deep']) {
        mockParseLLMJson.mockReturnValue({ ...VALID_LLM_RESPONSE, modelClass: validClass })

        const result = await autoConfigureProfile(TEST_PROVIDER, TEST_MODEL, TEST_USER_ID)
        expect(result.modelClass).toBe(validClass)
      }
    })

    it('should default to Standard for invalid model class names', async () => {
      mockParseLLMJson.mockReturnValue({ ...VALID_LLM_RESPONSE, modelClass: 'SuperUltraMegaMax' })

      const result = await autoConfigureProfile(TEST_PROVIDER, TEST_MODEL, TEST_USER_ID)
      expect(result.modelClass).toBe('Standard')
    })

    it('should default to Standard when modelClass is missing', async () => {
      const { modelClass: _, ...withoutModelClass } = VALID_LLM_RESPONSE
      mockParseLLMJson.mockReturnValue(withoutModelClass)

      const result = await autoConfigureProfile(TEST_PROVIDER, TEST_MODEL, TEST_USER_ID)
      expect(result.modelClass).toBe('Standard')
    })
  })
})
