jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}))

jest.mock('@/lib/chat/connection-resolver', () => ({
  resolveConnectionProfile: jest.fn(() => 'conn-1'),
}))

import { resolveRespondingParticipant, getRoleplayTemplate } from '@/lib/services/chat-message/participant-resolver.service'
import { CharacterArchivedError } from '@/lib/database/repositories/characters.repository'
import type { ChatMetadataBase, ChatParticipantBase, Character } from '@/lib/schemas/types'

const now = new Date().toISOString()

const makeCharParticipant = (id: string, characterId: string, overrides: Partial<ChatParticipantBase> = {}): ChatParticipantBase => ({
  id,
  type: 'CHARACTER',
  characterId,
  controlledBy: 'llm',
  connectionProfileId: null,
  imageProfileId: null,
  displayOrder: 0,
  isActive: true,
  status: 'active',
  hasHistoryAccess: true,
  joinScenario: null,
  createdAt: now,
  updatedAt: now,
  ...overrides,
})

const makeChar = (id: string, talkativeness = 0.5, archivedAt: string | null = null): Character => ({
  id,
  userId: 'user-1',
  name: `Character ${id}`,
  title: null,
  description: null,
  personality: null,
  scenario: null,
  firstMessage: null,
  exampleDialogues: null,
  systemPrompts: [],
  avatarUrl: null,
  defaultImageId: null,
  defaultConnectionProfileId: null,
  sillyTavernData: null,
  isFavorite: false,
  talkativeness,
  partnerLinks: [],
  tags: [],
  avatarOverrides: [],
  physicalDescriptions: [],
  createdAt: now,
  updatedAt: now,
  archivedAt,
} as unknown as Character)

const buildChat = (participants: ChatParticipantBase[], spokenJson: string | null = null): ChatMetadataBase => ({
  id: 'chat-1',
  userId: 'user-1',
  participants,
  spokenThisCycleParticipantIds: spokenJson,
  imageProfileId: null,
} as unknown as ChatMetadataBase)

const buildRepos = (characters: Map<string, Character>, messages: unknown[] = []) => ({
  chats: {
    getMessages: jest.fn().mockResolvedValue(messages),
  },
  characters: {
    findById: jest.fn((id: string) => Promise.resolve(characters.get(id) ?? null)),
  },
  connections: {
    findById: jest.fn().mockResolvedValue({ id: 'conn-1', apiKeyId: null }),
    findApiKeyById: jest.fn().mockResolvedValue(null),
  },
}) as never

describe('resolveRespondingParticipant — first-responder selection', () => {
  it('picks the only LLM character when there is only one (and skips user-controlled chars)', async () => {
    const p1 = makeCharParticipant('p1', 'char-1', { controlledBy: 'user' })
    const p2 = makeCharParticipant('p2', 'char-2')
    const chat = buildChat([p1, p2])
    const repos = buildRepos(new Map([['char-1', makeChar('char-1')], ['char-2', makeChar('char-2')]]))

    const result = await resolveRespondingParticipant(repos, chat, 'user-1')
    expect(result.characterParticipant.id).toBe('p2')
  })

  it('honours an explicit requestedRespondingParticipantId', async () => {
    const p1 = makeCharParticipant('p1', 'char-1')
    const p2 = makeCharParticipant('p2', 'char-2')
    const chat = buildChat([p1, p2])
    const repos = buildRepos(new Map([['char-1', makeChar('char-1')], ['char-2', makeChar('char-2')]]))

    const result = await resolveRespondingParticipant(repos, chat, 'user-1', 'p2')
    expect(result.characterParticipant.id).toBe('p2')
  })

  it('refuses to resolve an archived character as a responder', async () => {
    const participant = makeCharParticipant('p1', 'char-1')
    const chat = buildChat([participant])
    const repos = buildRepos(new Map([['char-1', makeChar('char-1', 0.5, '2026-08-10T00:00:00.000Z')]]))

    await expect(resolveRespondingParticipant(repos, chat, 'user-1')).rejects.toThrow(CharacterArchivedError)
  })

  it('uses weighted selection for multiple LLM candidates and respects spokenThisCycle', async () => {
    const p1 = makeCharParticipant('p1', 'char-1')
    const p2 = makeCharParticipant('p2', 'char-2')
    const p3 = makeCharParticipant('p3', 'char-3')
    const chat = buildChat([p1, p2, p3], JSON.stringify(['p1']))
    const characters = new Map([
      ['char-1', makeChar('char-1', 0.5)],
      ['char-2', makeChar('char-2', 0.5)],
      ['char-3', makeChar('char-3', 0.5)],
    ])
    const repos = buildRepos(characters)

    // With p1 already in spoken-this-cycle, selection should land on p2 or p3
    // (never p1) across many trials.
    const picks = new Set<string>()
    for (let i = 0; i < 20; i++) {
      const result = await resolveRespondingParticipant(repos, chat, 'user-1')
      picks.add(result.characterParticipant.id)
    }
    expect(picks.has('p1')).toBe(false)
    expect(picks.size).toBeGreaterThan(0)
  })

  it('excludes user-controlled candidates from the first-responder pool', async () => {
    const userChar = makeCharParticipant('u1', 'char-user', { controlledBy: 'user' })
    const p2 = makeCharParticipant('p2', 'char-2')
    const p3 = makeCharParticipant('p3', 'char-3')
    const chat = buildChat([userChar, p2, p3])
    const repos = buildRepos(new Map([
      ['char-user', makeChar('char-user')],
      ['char-2', makeChar('char-2')],
      ['char-3', makeChar('char-3')],
    ]))

    for (let i = 0; i < 20; i++) {
      const result = await resolveRespondingParticipant(repos, chat, 'user-1')
      expect(result.characterParticipant.controlledBy).not.toBe('user')
    }
  })

  it('attributes userParticipantId to the active speaker, not the first user-controlled participant', async () => {
    // Two user-controlled characters (Jackie first, Revenant later) + one LLM.
    const jackie = makeCharParticipant('u-jackie', 'char-jackie', { controlledBy: 'user', displayOrder: 0 })
    const abigail = makeCharParticipant('p-abigail', 'char-abigail', { displayOrder: 1 })
    const revenant = makeCharParticipant('u-revenant', 'char-revenant', { controlledBy: 'user', displayOrder: 2 })
    const chat = buildChat([jackie, abigail, revenant])
    const repos = buildRepos(new Map([
      ['char-jackie', makeChar('char-jackie')],
      ['char-abigail', makeChar('char-abigail')],
      ['char-revenant', makeChar('char-revenant')],
    ]))

    // Speaking As Revenant → the saved user message is attributed to Revenant.
    const speakingAsRevenant = await resolveRespondingParticipant(repos, chat, 'user-1', undefined, false, 'u-revenant')
    expect(speakingAsRevenant.userParticipantId).toBe('u-revenant')
    // Abigail still responds (the LLM character).
    expect(speakingAsRevenant.characterParticipant.id).toBe('p-abigail')

    // No selection → falls back to the first user-controlled participant (Jackie).
    const noSelection = await resolveRespondingParticipant(repos, chat, 'user-1')
    expect(noSelection.userParticipantId).toBe('u-jackie')
  })
})

describe('getRoleplayTemplate — project/user default precedence', () => {
  const TEMPLATES: Record<string, { systemPrompt: string }> = {
    'tpl-chat': { systemPrompt: 'chat-own template' },
    'tpl-project': { systemPrompt: 'project default template' },
    'tpl-user': { systemPrompt: 'user default template' },
  }

  const buildTemplateRepos = (project: { defaultRoleplayTemplateId?: string | null } | null) => {
    const update = jest.fn().mockResolvedValue(undefined)
    const projectsFindById = jest.fn((_id: string) => Promise.resolve(project))
    const repos = {
      chats: { update },
      projects: { findById: projectsFindById },
      roleplayTemplates: {
        findById: jest.fn((id: string) => Promise.resolve(TEMPLATES[id] ?? null)),
      },
    } as never
    return { repos, update, projectsFindById }
  }

  const chatWith = (overrides: Partial<ChatMetadataBase>): ChatMetadataBase => ({
    id: 'chat-1',
    roleplayTemplateId: null,
    projectId: null,
    ...overrides,
  } as unknown as ChatMetadataBase)

  it("uses the chat's own template and never inherits", async () => {
    const { repos, update, projectsFindById } = buildTemplateRepos({ defaultRoleplayTemplateId: 'tpl-project' })
    const chat = chatWith({ roleplayTemplateId: 'tpl-chat', projectId: 'proj-1' })

    const result = await getRoleplayTemplate(repos, chat, { defaultRoleplayTemplateId: 'tpl-user' })

    expect(result).toEqual({ systemPrompt: 'chat-own template' })
    expect(projectsFindById).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })

  it('prefers the project default over the user default for a null-template project chat and auto-saves it', async () => {
    const { repos, update } = buildTemplateRepos({ defaultRoleplayTemplateId: 'tpl-project' })
    const chat = chatWith({ roleplayTemplateId: null, projectId: 'proj-1' })

    const result = await getRoleplayTemplate(repos, chat, { defaultRoleplayTemplateId: 'tpl-user' })

    expect(result).toEqual({ systemPrompt: 'project default template' })
    expect(update).toHaveBeenCalledWith('chat-1', { roleplayTemplateId: 'tpl-project' })
  })

  it('falls back to the user default when the project has no default', async () => {
    const { repos, update } = buildTemplateRepos({ defaultRoleplayTemplateId: null })
    const chat = chatWith({ roleplayTemplateId: null, projectId: 'proj-1' })

    const result = await getRoleplayTemplate(repos, chat, { defaultRoleplayTemplateId: 'tpl-user' })

    expect(result).toEqual({ systemPrompt: 'user default template' })
    expect(update).toHaveBeenCalledWith('chat-1', { roleplayTemplateId: 'tpl-user' })
  })

  it('uses the user default for a non-project chat without any project lookup', async () => {
    const { repos, projectsFindById, update } = buildTemplateRepos(null)
    const chat = chatWith({ roleplayTemplateId: null, projectId: null })

    const result = await getRoleplayTemplate(repos, chat, { defaultRoleplayTemplateId: 'tpl-user' })

    expect(result).toEqual({ systemPrompt: 'user default template' })
    expect(projectsFindById).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledWith('chat-1', { roleplayTemplateId: 'tpl-user' })
  })

  it('returns null when neither the project nor the user has a default', async () => {
    const { repos, update } = buildTemplateRepos({ defaultRoleplayTemplateId: null })
    const chat = chatWith({ roleplayTemplateId: null, projectId: 'proj-1' })

    const result = await getRoleplayTemplate(repos, chat, null)

    expect(result).toBeNull()
    expect(update).not.toHaveBeenCalled()
  })
})
