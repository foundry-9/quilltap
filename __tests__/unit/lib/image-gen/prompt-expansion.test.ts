/**
 * Tests for the image prompt expansion utilities that drive the new image tooling.
 * Validates placeholder parsing, repository lookups, context sizing, and final payload shaping.
 */

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}))

import {
  parsePlaceholders,
  resolvePlaceholders,
  getAllDescriptionTiers,
  buildExpansionContext,
  preparePromptExpansion,
} from '@/lib/image-gen/prompt-expansion'
import { getRepositories } from '@/lib/repositories/factory'

const mockGetRepositories = getRepositories as jest.MockedFunction<typeof getRepositories>

const now = new Date().toISOString()
const userId = '11111111-1111-1111-1111-111111111111'

const mockDescription = {
  id: 'desc-1',
  name: 'Mirel',
  usageContext: 'adventuring in the wilderness',
  shortPrompt: 'short desc',
  mediumPrompt: 'medium desc',
  longPrompt: 'long desc',
  completePrompt: 'complete desc',
  fullDescription: null,
  createdAt: now,
  updatedAt: now,
}

const mockCharacter = {
  id: 'char-1',
  userId,
  name: 'Mirel',
  title: 'Mage',
  description: 'A mage',
  personality: 'Curious',
  scenario: 'Adventure',
  firstMessage: '',
  exampleDialogues: null,
  systemPrompts: [],
  defaultImageId: null,
  partnerLinks: [],
  tags: [],
  isFavorite: false,
  createdAt: now,
  updatedAt: now,
  physicalDescription: mockDescription,
}

// User-controlled character (formerly persona) - after migration, personas become characters with controlledBy: 'user'
const mockUserCharacter = {
  id: 'user-char-1',
  userId,
  name: 'Aurora',
  description: 'User character description',
  controlledBy: 'user',
  tags: [],
  createdAt: now,
  updatedAt: now,
  physicalDescription: mockDescription,
}

const mockChat = {
  id: 'chat-1',
  userId,
  participants: [
    {
      id: 'participant-1',
      type: 'CHARACTER',
      characterId: mockUserCharacter.id,
      controlledBy: 'user',
      connectionProfileId: null,
      imageProfileId: null,

      displayOrder: 0,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'participant-2',
      type: 'CHARACTER',
      characterId: mockCharacter.id,
      controlledBy: 'llm',
      connectionProfileId: 'profile-1',
      imageProfileId: null,

      displayOrder: 1,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  ],
  title: 'Test Chat',
  contextSummary: null,
  sillyTavernMetadata: null,
  tags: [],
  messageCount: 0,
  lastMessageAt: null,
  lastRenameCheckInterchange: 0,
  createdAt: now,
  updatedAt: now,
}

const mockRepos = {
  chats: {
    findById: jest.fn(),
  },
  characters: {
    findByUserId: jest.fn(),
    findById: jest.fn(),
  },
}

describe('image prompt expansion utilities', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetRepositories.mockReturnValue(mockRepos as any)
    mockRepos.chats.findById.mockResolvedValue(mockChat)
    // All characters including user-controlled ones (formerly personas)
    mockRepos.characters.findByUserId.mockResolvedValue([mockCharacter, mockUserCharacter])
    // findById returns the appropriate character based on ID
    mockRepos.characters.findById.mockImplementation((id: string) => {
      if (id === mockCharacter.id) return Promise.resolve(mockCharacter)
      if (id === mockUserCharacter.id) return Promise.resolve(mockUserCharacter)
      return Promise.resolve(null)
    })
  })

  it('parses placeholder tokens from prompts', () => {
    const placeholders = parsePlaceholders('Draw {{Mirel}} and {{me}} under the {{Moon}}.')
    expect(placeholders).toEqual([
      { placeholder: '{{Mirel}}', name: 'Mirel' },
      { placeholder: '{{me}}', name: 'me' },
      { placeholder: '{{Moon}}', name: 'Moon' },
    ])
  })

  it('resolves "{{me}}" to the calling participant', async () => {
    const resolved = await resolvePlaceholders(
      [{ placeholder: '{{me}}', name: 'me' }],
      userId,
      mockChat.id,
      'participant-1'
    )

    // All participants are now CHARACTER type (personas migrated to characters with controlledBy: 'user')
    expect(resolved[0].type).toBe('character')
    expect(resolved[0].entityId).toBe(mockUserCharacter.id)
    expect(resolved[0].descriptions?.[0].shortPrompt).toBe('short desc')
  })

  it('matches characters by name (including user-controlled characters)', async () => {
    const resolved = await resolvePlaceholders(
      [
        { placeholder: '{{mirel}}', name: 'mirel' },
        { placeholder: '{{Aurora}}', name: 'Aurora' },
        { placeholder: '{{Unknown}}', name: 'Unknown' },
      ],
      userId,
      mockChat.id
    )

    // LLM-controlled character
    expect(resolved[0].type).toBe('character')
    expect(resolved[0].descriptions?.length).toBeGreaterThan(0)
    // User-controlled character (formerly persona)
    expect(resolved[1].type).toBe('character')
    expect(resolved[1].descriptions?.length).toBeGreaterThan(0)
    // Unknown placeholder
    expect(resolved[2].descriptions).toEqual([])
  })

  it('returns aggregated description tiers from the primary description', () => {
    const tiers = getAllDescriptionTiers([mockDescription])
    expect(tiers).toEqual({
      short: 'short desc',
      medium: 'medium desc',
      long: 'long desc',
      complete: 'complete desc',
      entityName: 'Mirel',
      usageContext: 'adventuring in the wilderness',
    })
  })

  it('builds expansion context payloads for the cheap LLM worker', () => {
    const context = buildExpansionContext(
      'Paint {{Mirel}}',
      [
        {
          placeholder: '{{Mirel}}',
          name: 'Mirel',
          descriptions: [mockDescription],
        },
      ],
      'OPENAI'
    )

    expect(context.originalPrompt).toBe('Paint {{Mirel}}')
    expect(context.placeholders[0].tiers.short).toBe('short desc')
    expect(context.targetLength).toBeGreaterThan(0)
  })

  it('returns passthrough context when no placeholders exist', async () => {
    const context = await preparePromptExpansion('Describe the sky', userId, 'OPENAI')
    expect(context.hasPlaceholders).toBe(false)
    expect(context.originalPrompt).toBe('Describe the sky')
    expect(context.targetLength).toBeGreaterThan(0)
  })

  it('prepares expansion data when placeholders are detected', async () => {
    const context = await preparePromptExpansion('Draw {{Mirel}} beside {{me}}', userId, 'OPENAI', mockChat.id, 'participant-1')
    expect(context.hasPlaceholders).toBe(true)
    expect(context.placeholders?.length).toBe(2)
    expect(context.placeholders?.[0].tiers.short).toBe('short desc')
  })
})
