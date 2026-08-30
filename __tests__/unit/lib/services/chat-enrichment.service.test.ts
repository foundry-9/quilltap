/**
 * Unit tests for chat-enrichment.service.ts
 * Tests chat filtering, enrichment, and cleaning functions
 */

import {
  enrichParticipantSummary,
  enrichParticipantDetail,
  enrichTags,
  enrichChatForList,
  enrichChatsForList,
  filterChatsByExcludedTags,
  cleanEnrichedChats,
  getCharacterSummary,
  getCharacterDetail,
  getConnectionProfile,
  getImageProfile,
} from '@/lib/services/chat-enrichment.service'
import type {
  EnrichedChatSummary,
  EnrichedParticipantSummary,
  EnrichedTag,
} from '@/lib/services/chat-enrichment.service'
import { createMockChat, createMockCharacter, createMockTag, createMockChatParticipant } from '../fixtures/test-factories'
import type { RepositoryContainer } from '@/lib/repositories/factory'

jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

jest.mock('@/lib/api/middleware/file-path', () => ({
  getFilePath: jest.fn((file) => `/files/${file.id}`),
}))

function createMockRepositories(): RepositoryContainer {
  return {
    characters: {
      findById: jest.fn(),
      findAll: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    files: {
      findById: jest.fn(),
      findByLinkedTo: jest.fn(),
    },
    docMountFileLinks: {
      findByIdWithContent: jest.fn().mockResolvedValue(null),
      findByIdsWithContent: jest.fn().mockResolvedValue([]),
    },
    tags: {
      findByIds: jest.fn(),
      findById: jest.fn(),
      findAll: jest.fn(),
    },
    connections: {
      findById: jest.fn(),
      findApiKeyById: jest.fn(),
    },
    imageProfiles: {
      findById: jest.fn(),
    },
    chats: {
      getMessageCount: jest.fn(),
      findById: jest.fn(),
    },
    projects: {
      findById: jest.fn(),
    },
    memories: {
      countByChatId: jest.fn().mockResolvedValue(0),
      countByChatIds: jest.fn().mockResolvedValue(new Map()),
    },
    conversationChunks: {
      findByChatId: jest.fn().mockResolvedValue([]),
      countByChatIds: jest.fn().mockResolvedValue(new Map()),
    },
  } as any
}

describe('chat-enrichment.service', () => {
  let mockRepos: ReturnType<typeof createMockRepositories>

  beforeEach(() => {
    mockRepos = createMockRepositories()
    jest.clearAllMocks()
  })

  describe('getCharacterSummary', () => {
    it('should enrich character with tags and default image', async () => {
      const character = createMockCharacter({
        id: 'char-1',
        name: 'Alice',
        tags: ['tag-1', 'tag-2'],
        defaultImageId: 'img-1',
      })

      const mockFile = {
        id: 'img-1',
        originalFilename: 'alice.png',
      }

      mockRepos.characters.findById.mockResolvedValue(character)
      mockRepos.files.findById.mockResolvedValue(mockFile)

      const result = await getCharacterSummary('char-1', mockRepos)

      expect(result).toEqual({
        id: 'char-1',
        name: 'Alice',
        title: null,
        avatarUrl: '/api/v1/files/img-1',
        defaultImageId: 'img-1',
        defaultImage: {
          id: 'img-1',
          filepath: '/api/v1/files/img-1',
          url: null,
        },
        talkativeness: 0.5,
        tags: ['tag-1', 'tag-2'],
      })
    })

    it('should handle character without default image', async () => {
      const character = createMockCharacter({
        id: 'char-1',
        defaultImageId: null,
      })

      mockRepos.characters.findById.mockResolvedValue(character)

      const result = await getCharacterSummary('char-1', mockRepos)

      expect(result?.defaultImage).toBeNull()
    })

    it('should return null for non-existent character', async () => {
      mockRepos.characters.findById.mockResolvedValue(null)

      const result = await getCharacterSummary('char-999', mockRepos)

      expect(result).toBeNull()
    })
  })

  describe('getCharacterDetail', () => {
    it('should enrich character without tags', async () => {
      const character = createMockCharacter({
        id: 'char-1',
        name: 'Alice',
        tags: ['tag-1', 'tag-2'],
      })

      mockRepos.characters.findById.mockResolvedValue(character)

      const result = await getCharacterDetail('char-1', mockRepos)

      expect(result).toEqual({
        id: 'char-1',
        name: 'Alice',
        title: null,
        avatarUrl: null,
        defaultImageId: null,
        defaultImage: null,
        talkativeness: 0.5,
        systemPrompts: [],
        archivedAt: null,
      })
      expect(result).not.toHaveProperty('tags')
    })

    // Bug 66: the sidebar renders from the chat GET, which enriches through
    // this function — without the projection the Archived badge cannot light
    // on a fresh load, only after a participants action + refetch.
    it('should project archivedAt for an archived character', async () => {
      const character = createMockCharacter({
        id: 'char-1',
        name: 'Alice',
        archivedAt: '2026-08-11T12:00:00.000Z',
      })

      mockRepos.characters.findById.mockResolvedValue(character)

      const result = await getCharacterDetail('char-1', mockRepos)

      expect(result?.archivedAt).toBe('2026-08-11T12:00:00.000Z')
    })

    it('should project archivedAt on the chat avatar-override path too', async () => {
      const character = createMockCharacter({
        id: 'char-1',
        name: 'Alice',
        archivedAt: '2026-08-11T12:00:00.000Z',
        avatarOverrides: [{ chatId: 'chat-1', imageId: 'img-9' }],
      })

      mockRepos.characters.findById.mockResolvedValue(character)
      mockRepos.files.findById.mockResolvedValue({ id: 'img-9', originalFilename: 'alice-alt.png' })

      const result = await getCharacterDetail('char-1', mockRepos, 'chat-1')

      expect(result?.defaultImageId).toBe('img-9')
      expect(result?.archivedAt).toBe('2026-08-11T12:00:00.000Z')
    })
  })

  describe('getConnectionProfile', () => {
    it('should enrich connection profile with API key info', async () => {
      const profile = {
        id: 'conn-1',
        name: 'OpenAI Profile',
        provider: 'openai',
        modelName: 'gpt-4',
        apiKeyId: 'key-1',
      }

      const apiKey = {
        id: 'key-1',
        provider: 'openai',
        label: 'My OpenAI Key',
      }

      mockRepos.connections.findById.mockResolvedValue(profile)
      mockRepos.connections.findApiKeyById.mockResolvedValue(apiKey)

      const result = await getConnectionProfile('conn-1', mockRepos)

      expect(result).toEqual({
        id: 'conn-1',
        name: 'OpenAI Profile',
        provider: 'openai',
        modelName: 'gpt-4',
        // allowToolUse defaults to true when the profile omits it.
        allowToolUse: true,
        apiKey: {
          id: 'key-1',
          provider: 'openai',
          label: 'My OpenAI Key',
        },
      })
    })

    // Bug 36: allowToolUse must be projected so the "tools disabled by profile"
    // warning box can actually fire (previously always undefined === false).
    it('projects allowToolUse when the profile forbids tools (Bug 36)', async () => {
      const profile = {
        id: 'conn-1',
        name: 'No-Tools Profile',
        provider: 'openai',
        modelName: 'gpt-4',
        apiKeyId: null,
        allowToolUse: false,
      }

      mockRepos.connections.findById.mockResolvedValue(profile)

      const result = await getConnectionProfile('conn-1', mockRepos)

      expect(result?.allowToolUse).toBe(false)
    })

    it('should handle profile without API key', async () => {
      const profile = {
        id: 'conn-1',
        name: 'Profile',
        provider: 'openai',
        modelName: 'gpt-4',
        apiKeyId: null,
      }

      mockRepos.connections.findById.mockResolvedValue(profile)

      const result = await getConnectionProfile('conn-1', mockRepos)

      expect(result?.apiKey).toBeNull()
    })

    it('should return null for non-existent profile', async () => {
      mockRepos.connections.findById.mockResolvedValue(null)

      const result = await getConnectionProfile('conn-999', mockRepos)

      expect(result).toBeNull()
    })
  })

  describe('getImageProfile', () => {
    it('should enrich image profile', async () => {
      const profile = {
        id: 'img-1',
        name: 'DALL-E Profile',
        provider: 'openai',
        modelName: 'dall-e-3',
      }

      mockRepos.imageProfiles.findById.mockResolvedValue(profile)

      const result = await getImageProfile('img-1', mockRepos)

      expect(result).toEqual({
        id: 'img-1',
        name: 'DALL-E Profile',
        provider: 'openai',
        modelName: 'dall-e-3',
      })
    })

    it('should return null for non-existent profile', async () => {
      mockRepos.imageProfiles.findById.mockResolvedValue(null)

      const result = await getImageProfile('img-999', mockRepos)

      expect(result).toBeNull()
    })
  })

  describe('enrichParticipantSummary', () => {
    it('should enrich CHARACTER participant', async () => {
      const participant = createMockChatParticipant({
        id: 'part-1',
        type: 'CHARACTER',
        characterId: 'char-1',
        displayOrder: 0,
        isActive: true,
      })

      const character = createMockCharacter({
        id: 'char-1',
        name: 'Alice',
        tags: ['tag-1'],
      })

      mockRepos.characters.findById.mockResolvedValue(character)

      const result = await enrichParticipantSummary(participant, mockRepos)

      expect(result).toEqual({
        id: 'part-1',
        type: 'CHARACTER',
        displayOrder: 0,
        isActive: true,
        status: 'active',
        removedAt: null,
        character: expect.objectContaining({
          id: 'char-1',
          name: 'Alice',
          tags: ['tag-1'],
        }),
      })
    })

    it('should handle participant with missing character', async () => {
      const participant = createMockChatParticipant({
        type: 'CHARACTER',
        characterId: 'char-999',
      })

      mockRepos.characters.findById.mockResolvedValue(null)

      const result = await enrichParticipantSummary(participant, mockRepos)

      expect(result.character).toBeNull()
    })
  })

  describe('enrichParticipantDetail', () => {
    it('should enrich participant with full details', async () => {
      const participant = createMockChatParticipant({
        id: 'part-1',
        type: 'CHARACTER',
        characterId: 'char-1',
        connectionProfileId: 'conn-1',
        imageProfileId: 'img-1',
        controlledBy: 'llm',
      })

      const character = createMockCharacter({ id: 'char-1', name: 'Alice' })
      const connProfile = { id: 'conn-1', name: 'Profile', provider: 'openai', modelName: 'gpt-4', apiKey: null }
      const imgProfile = { id: 'img-1', name: 'Image Profile', provider: 'openai', modelName: 'dall-e-3' }

      mockRepos.characters.findById.mockResolvedValue(character)
      mockRepos.connections.findById.mockResolvedValue(connProfile)
      mockRepos.imageProfiles.findById.mockResolvedValue(imgProfile)

      const result = await enrichParticipantDetail(participant, mockRepos)

      expect(result).toEqual({
        id: 'part-1',
        type: 'CHARACTER',
        controlledBy: 'llm',
        displayOrder: 0,
        isActive: true,
        status: 'active',
        removedAt: null,
        character: expect.objectContaining({ id: 'char-1', name: 'Alice' }),
        connectionProfile: expect.objectContaining({ id: 'conn-1' }),
        imageProfile: expect.objectContaining({ id: 'img-1' }),
        selectedSystemPromptId: null,
        talkativeness: null,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      })
    })
  })

  describe('enrichTags', () => {
    it('should enrich tag IDs to full tag objects', async () => {
      const tags = [
        createMockTag({ id: 'tag-1', name: 'Adventure' }),
        createMockTag({ id: 'tag-2', name: 'Fantasy' }),
      ]

      mockRepos.tags.findByIds.mockResolvedValue(tags)

      const result = await enrichTags(['tag-1', 'tag-2'], mockRepos)

      expect(result).toEqual([
        { tag: { id: 'tag-1', name: 'Adventure' } },
        { tag: { id: 'tag-2', name: 'Fantasy' } },
      ])
    })

    it('should handle empty tag IDs array', async () => {
      const result = await enrichTags([], mockRepos)

      expect(result).toEqual([])
      expect(mockRepos.tags.findByIds).not.toHaveBeenCalled()
    })

    it('should skip missing tags', async () => {
      const tags = [createMockTag({ id: 'tag-1', name: 'Adventure' })]

      mockRepos.tags.findByIds.mockResolvedValue(tags)

      const result = await enrichTags(['tag-1', 'tag-999'], mockRepos)

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({ tag: { id: 'tag-1', name: 'Adventure' } })
    })
  })

  describe('enrichChatForList', () => {
    it('should enrich chat with participants, tags, and message count', async () => {
      const chat = createMockChat({
        id: 'chat-1',
        title: 'Test Chat',
        tags: ['tag-1'],
        participants: [
          createMockChatParticipant({
            type: 'CHARACTER',
            characterId: 'char-1',
          }),
        ],
      })

      const character = createMockCharacter({ id: 'char-1', name: 'Alice', tags: ['tag-2'] })
      const tag = createMockTag({ id: 'tag-1', name: 'Adventure' })

      mockRepos.characters.findById.mockResolvedValue(character)
      mockRepos.tags.findByIds.mockResolvedValue([tag])
      mockRepos.chats.getMessageCount.mockResolvedValue(42)

      const result = await enrichChatForList(chat, mockRepos)

      expect(result).toMatchObject({
        id: 'chat-1',
        title: 'Test Chat',
        participants: expect.arrayContaining([
          expect.objectContaining({
            character: expect.objectContaining({ name: 'Alice' }),
          }),
        ]),
        tags: [{ tag: { id: 'tag-1', name: 'Adventure' } }],
        project: null,
        _count: { messages: 42 },
        _allTagIds: expect.arrayContaining(['tag-1', 'tag-2']),
      })
    })

    it('should include project info if chat belongs to a project', async () => {
      const chat = createMockChat({
        id: 'chat-1',
        projectId: 'proj-1',
        participants: [],
        tags: [],
      })

      const project = {
        id: 'proj-1',
        name: 'My Project',
        color: '#FF0000',
      }

      mockRepos.projects.findById.mockResolvedValue(project)
      mockRepos.chats.getMessageCount.mockResolvedValue(0)
      mockRepos.tags.findByIds.mockResolvedValue([])

      const result = await enrichChatForList(chat, mockRepos)

      expect(result.project).toEqual({
        id: 'proj-1',
        name: 'My Project',
        color: '#FF0000',
      })
    })

    it('should collect all tag IDs from chat and character participants', async () => {
      const chat = createMockChat({
        tags: ['tag-1'],
        participants: [
          createMockChatParticipant({
            type: 'CHARACTER',
            characterId: 'char-1',
          }),
        ],
      })

      const character = createMockCharacter({ id: 'char-1', tags: ['tag-2', 'tag-3'] })

      mockRepos.characters.findById.mockResolvedValue(character)
      mockRepos.tags.findByIds.mockResolvedValue([])
      mockRepos.chats.getMessageCount.mockResolvedValue(0)

      const result = await enrichChatForList(chat, mockRepos)

      expect(result._allTagIds).toEqual(expect.arrayContaining(['tag-1', 'tag-2', 'tag-3']))
    })
  })

  describe('enrichChatsForList', () => {
    it('should enrich and sort multiple chats by lastMessageAt descending', async () => {
      const chat1 = createMockChat({ id: 'chat-1', lastMessageAt: '2024-01-01T00:00:00Z', participants: [], tags: [] })
      const chat2 = createMockChat({ id: 'chat-2', lastMessageAt: '2024-01-03T00:00:00Z', participants: [], tags: [] })
      const chat3 = createMockChat({ id: 'chat-3', lastMessageAt: '2024-01-02T00:00:00Z', participants: [], tags: [] })

      mockRepos.tags.findByIds.mockResolvedValue([])
      mockRepos.chats.getMessageCount.mockResolvedValue(0)

      const result = await enrichChatsForList([chat1, chat2, chat3], mockRepos)

      expect(result).toHaveLength(3)
      expect(result[0].id).toBe('chat-2') // Most recent
      expect(result[1].id).toBe('chat-3')
      expect(result[2].id).toBe('chat-1') // Oldest
    })

    it('should ignore updatedAt — a background image or summary must not reorder the list', async () => {
      // chat-quiet was touched a year later than anything else (a story
      // background finishing its render, a summary folded, a cost tally), but
      // no character has spoken in it since 2024. It must stay at the bottom.
      const quiet = createMockChat({
        id: 'chat-quiet',
        lastMessageAt: '2024-01-01T00:00:00Z',
        updatedAt: '2025-12-31T00:00:00Z',
        participants: [],
        tags: [],
      })
      const spoken = createMockChat({
        id: 'chat-spoken',
        lastMessageAt: '2024-06-01T00:00:00Z',
        updatedAt: '2024-06-01T00:00:00Z',
        participants: [],
        tags: [],
      })

      mockRepos.tags.findByIds.mockResolvedValue([])
      mockRepos.chats.getMessageCount.mockResolvedValue(0)

      const result = await enrichChatsForList([quiet, spoken], mockRepos)

      expect(result.map((c) => c.id)).toEqual(['chat-spoken', 'chat-quiet'])
    })

    it('should fall back to createdAt — never updatedAt — when nobody has spoken', async () => {
      // No character has ever posted in either chat, so they sort by creation.
      // `never` carries a late updatedAt; if the fallback were updatedAt it
      // would sort first, which is the whole bug.
      const never = createMockChat({
        id: 'chat-never',
        lastMessageAt: null,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2025-12-31T00:00:00Z',
        participants: [],
        tags: [],
      })
      const newer = createMockChat({
        id: 'chat-newer',
        lastMessageAt: null,
        createdAt: '2024-02-01T00:00:00Z',
        updatedAt: '2024-02-01T00:00:00Z',
        participants: [],
        tags: [],
      })

      mockRepos.tags.findByIds.mockResolvedValue([])
      mockRepos.chats.getMessageCount.mockResolvedValue(0)

      const result = await enrichChatsForList([never, newer], mockRepos)

      expect(result.map((c) => c.id)).toEqual(['chat-newer', 'chat-never'])
    })
  })

  describe('filterChatsByExcludedTags', () => {
    it('should filter out chats with excluded tags', () => {
      const chats: EnrichedChatSummary[] = [
        {
          id: 'chat-1',
          title: 'Chat 1',
          contextSummary: null,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
          participants: [],
          tags: [],
          project: null,
          scriptoriumStatus: 'none',
          _count: { messages: 0, memories: 0 },
          _allTagIds: ['tag-1', 'tag-2'],
        },
        {
          id: 'chat-2',
          title: 'Chat 2',
          contextSummary: null,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
          participants: [],
          tags: [],
          project: null,
          scriptoriumStatus: 'none',
          _count: { messages: 0, memories: 0 },
          _allTagIds: ['tag-3'],
        },
        {
          id: 'chat-3',
          title: 'Chat 3',
          contextSummary: null,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
          participants: [],
          tags: [],
          project: null,
          scriptoriumStatus: 'none',
          _count: { messages: 0, memories: 0 },
          _allTagIds: ['tag-4', 'tag-5'],
        },
      ]

      const result = filterChatsByExcludedTags(chats, ['tag-2', 'tag-4'])

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('chat-2')
    })

    it('should return all chats when excludeTagIds is empty', () => {
      const chats: EnrichedChatSummary[] = [
        {
          id: 'chat-1',
          title: 'Chat 1',
          contextSummary: null,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
          participants: [],
          tags: [],
          project: null,
          scriptoriumStatus: 'none',
          _count: { messages: 0, memories: 0 },
          _allTagIds: ['tag-1'],
        },
      ]

      const result = filterChatsByExcludedTags(chats, [])

      expect(result).toEqual(chats)
    })

    it('should handle chats with no tags', () => {
      const chats: EnrichedChatSummary[] = [
        {
          id: 'chat-1',
          title: 'Chat 1',
          contextSummary: null,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
          participants: [],
          tags: [],
          project: null,
          scriptoriumStatus: 'none',
          _count: { messages: 0, memories: 0 },
          _allTagIds: [],
        },
      ]

      const result = filterChatsByExcludedTags(chats, ['tag-1'])

      expect(result).toHaveLength(1)
    })
  })

  describe('cleanEnrichedChats', () => {
    it('should remove _allTagIds from enriched chats', () => {
      const chats: EnrichedChatSummary[] = [
        {
          id: 'chat-1',
          title: 'Chat 1',
          contextSummary: null,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
          participants: [],
          tags: [],
          project: null,
          scriptoriumStatus: 'none',
          _count: { messages: 0, memories: 0 },
          _allTagIds: ['tag-1', 'tag-2'],
        },
      ]

      const result = cleanEnrichedChats(chats)

      expect(result).toHaveLength(1)
      expect(result[0]).not.toHaveProperty('_allTagIds')
      expect(result[0]).toHaveProperty('id', 'chat-1')
      expect(result[0]).toHaveProperty('title', 'Chat 1')
    })

    it('should handle empty array', () => {
      const result = cleanEnrichedChats([])

      expect(result).toEqual([])
    })
  })
})
