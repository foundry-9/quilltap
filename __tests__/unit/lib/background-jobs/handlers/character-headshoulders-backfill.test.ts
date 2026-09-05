import { handleCharacterHeadShouldersBackfill } from '@/lib/background-jobs/handlers/character-headshoulders-backfill'
import { getRepositories } from '@/lib/repositories/factory'
import { getCheapLLMProvider, type CheapLLMSelection } from '@/lib/llm/cheap-llm'
import { getApiKeyForCheapLLMSelection } from '@/lib/services/api-key.service'
import { createLLMProvider } from '@/lib/llm/plugin-factory'
import { generateField } from '@/lib/services/character-wizard.service'

jest.mock('@/lib/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn() }))

jest.mock('@/lib/llm/cheap-llm', () => ({
  getCheapLLMProvider: jest.fn(),
  buildCheapLLMConfig: jest.fn(() => ({ strategy: 'PROVIDER_CHEAPEST', fallbackToLocal: true })),
  DEFAULT_CHEAP_LLM_CONFIG: { strategy: 'PROVIDER_CHEAPEST', fallbackToLocal: true },
}))

jest.mock('@/lib/services/api-key.service', () => ({
  getApiKeyForCheapLLMSelection: jest.fn(),
}))

jest.mock('@/lib/llm/plugin-factory', () => ({
  createLLMProvider: jest.fn(),
}))

jest.mock('@/lib/services/character-wizard.service', () => ({
  buildContextPrompt: jest.fn(() => 'CTX'),
  generateField: jest.fn(),
  HEAD_AND_SHOULDERS_PHYSICAL_PROMPT: 'HS_PROMPT',
}))

const mockGetRepositories = getRepositories as jest.MockedFunction<typeof getRepositories>
const mockGetCheapLLMProvider = getCheapLLMProvider as jest.MockedFunction<typeof getCheapLLMProvider>
const mockGetApiKey = getApiKeyForCheapLLMSelection as jest.MockedFunction<typeof getApiKeyForCheapLLMSelection>
const mockCreateLLMProvider = createLLMProvider as jest.MockedFunction<typeof createLLMProvider>
const mockGenerateField = generateField as jest.MockedFunction<typeof generateField>

const buildJob = (overrides: Record<string, unknown> = {}) => ({
  id: 'job-1',
  userId: 'user-1',
  type: 'CHARACTER_HEADSHOULDERS_BACKFILL' as const,
  status: 'PROCESSING' as const,
  payload: { characterId: 'char-1' },
  priority: -1,
  attempts: 0,
  maxAttempts: 3,
  lastError: null,
  scheduledAt: new Date().toISOString(),
  startedAt: new Date().toISOString(),
  completedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
})

const basePd = {
  id: 'pd-1',
  name: 'default',
  usageContext: null,
  headAndShouldersPrompt: null as string | null,
  shortPrompt: 'short text',
  mediumPrompt: 'medium full-body text',
  longPrompt: null,
  completePrompt: null,
  fullDescription: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const makeRepos = (charOverrides: Record<string, unknown> = {}) => {
  const update = jest.fn().mockResolvedValue(undefined)
  const findById = jest.fn().mockResolvedValue({
    id: 'char-1',
    name: 'Amy',
    physicalDescription: { ...basePd },
    ...charOverrides,
  })
  const repos = {
    characters: { findById, update },
    chatSettings: { findByUserId: jest.fn().mockResolvedValue(null) },
    connections: { findByUserId: jest.fn().mockResolvedValue([{ id: 'profile-1', isDefault: true }]) },
  }
  return { repos, update, findById }
}

describe('handleCharacterHeadShouldersBackfill', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetCheapLLMProvider.mockReturnValue({
      provider: 'OPENAI',
      modelName: 'gpt-x',
      isLocal: false,
      connectionProfileId: 'profile-1',
    } as unknown as CheapLLMSelection)
    mockGetApiKey.mockResolvedValue('api-key')
    mockCreateLLMProvider.mockResolvedValue({} as never)
    mockGenerateField.mockResolvedValue(
      'A tight head-and-shoulders portrait: warm smile, dark wavy hair, open collar.',
    )
  })

  it('generates and writes the head-and-shoulders prompt, preserving other tiers', async () => {
    const { repos, update } = makeRepos()
    mockGetRepositories.mockReturnValue(repos as never)

    await handleCharacterHeadShouldersBackfill(buildJob() as never)

    expect(mockGenerateField).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledTimes(1)
    const [charId, patch] = update.mock.calls[0] as [string, { physicalDescription: Record<string, unknown> }]
    expect(charId).toBe('char-1')
    expect(patch.physicalDescription.headAndShouldersPrompt).toMatch(/head-and-shoulders portrait/)
    // The pre-existing tiers must survive the merge (renderPhysicalPromptsJson
    // re-renders all keys, so a partial write would null them).
    expect(patch.physicalDescription.shortPrompt).toBe('short text')
    expect(patch.physicalDescription.mediumPrompt).toBe('medium full-body text')
  })

  it('truncates the generated prompt to 500 characters', async () => {
    const { repos, update } = makeRepos()
    mockGetRepositories.mockReturnValue(repos as never)
    mockGenerateField.mockResolvedValue('x'.repeat(900))

    await handleCharacterHeadShouldersBackfill(buildJob() as never)

    const [, patch] = update.mock.calls[0] as [string, { physicalDescription: { headAndShouldersPrompt: string } }]
    expect(patch.physicalDescription.headAndShouldersPrompt.length).toBe(500)
  })

  it('skips when headAndShouldersPrompt is already set', async () => {
    const { repos, update } = makeRepos({
      physicalDescription: { ...basePd, headAndShouldersPrompt: 'existing' },
    })
    mockGetRepositories.mockReturnValue(repos as never)

    await handleCharacterHeadShouldersBackfill(buildJob() as never)

    expect(mockGenerateField).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })

  it('skips when the character has no physical description', async () => {
    const { repos, update } = makeRepos({ physicalDescription: null })
    mockGetRepositories.mockReturnValue(repos as never)

    await handleCharacterHeadShouldersBackfill(buildJob() as never)

    expect(mockGenerateField).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })

  it('skips cleanly when no connection profile is configured', async () => {
    const { repos, update } = makeRepos()
    repos.connections.findByUserId = jest.fn().mockResolvedValue([])
    mockGetRepositories.mockReturnValue(repos as never)

    await handleCharacterHeadShouldersBackfill(buildJob() as never)

    expect(mockGenerateField).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })

  it('skips when no API key is available', async () => {
    const { repos, update } = makeRepos()
    mockGetRepositories.mockReturnValue(repos as never)
    mockGetApiKey.mockResolvedValue(null)

    await handleCharacterHeadShouldersBackfill(buildJob() as never)

    expect(mockGenerateField).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })
})
