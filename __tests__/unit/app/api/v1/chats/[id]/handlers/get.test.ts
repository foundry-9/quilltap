import { describe, expect, it, jest, beforeEach } from '@jest/globals'

jest.mock('@/lib/logger', () => ({
  logger: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    child: jest.fn().mockReturnValue({
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      child: jest.fn(),
    }),
  },
}))

jest.mock('@/lib/sillytavern/chat', () => ({
  exportSTChatAsJSONL: jest.fn(),
}))

jest.mock('@/lib/services/cost-estimation.service', () => ({
  getChatCostBreakdown: jest.fn(),
  getDetailedChatCostBreakdown: jest.fn(),
}))

jest.mock('@/lib/services/chat-enrichment.service', () => ({
  enrichParticipantDetail: jest.fn(async (participant: unknown) => participant),
}))

jest.mock('@/lib/services/chat-message/agent-mode-resolver.service', () => ({
  resolveAgentModeSetting: jest.fn(() => ({
    enabled: false,
    enabledSource: 'global',
  })),
}))

jest.mock('@/app/api/v1/chats/[id]/actions', () => ({
  handleGetAvatars: jest.fn(),
  handleGetState: jest.fn(),
}))

jest.mock('@/lib/services/markdown-renderer.service', () => ({
  canPreRenderMessage: jest.fn(() => true),
  renderMarkdownToHtml: jest.fn(async (content: string) => {
    const withStrong = content.replace(/\*\*([^*]+)\*\*/g, '<strong class="font-bold">$1</strong>')
    const withEmphasis = withStrong.replace(/\*([^*]+)\*/g, '<em class="italic">$1</em>')
    return `<p>${withEmphasis}</p>`
  }),
}))

const { handleGet } = require('@/app/api/v1/chats/[id]/handlers/get')

describe('chats [id] GET handler', () => {
  const chatId = 'chat-1'

  const chatMetadata = {
    id: chatId,
    userId: 'user-1',
    title: 'Test Chat',
    contextSummary: null,
    roleplayTemplateId: null,
    imageProfileId: null,
    lastTurnParticipantId: null,
    isPaused: false,
    isManuallyRenamed: false,
    updatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    participants: [
      {
        id: 'part-1',
        type: 'CHARACTER',
        characterId: 'char-1',
      },
    ],
    projectId: null,
    disabledTools: [],
    disabledToolGroups: [],
    agentModeEnabled: false,
  }

  const assistantMessage = {
    type: 'message',
    id: 'msg-1',
    role: 'ASSISTANT',
    content: 'This is **important** and *noted*.',
    tokenCount: 12,
    promptTokens: 8,
    completionTokens: 4,
    createdAt: new Date().toISOString(),
    swipeGroupId: null,
    swipeIndex: null,
    participantId: 'part-1',
    debugMemoryLogs: null,
    provider: 'OPENAI',
    modelName: 'gpt-4.1',
    targetParticipantIds: null,
    isSilentMessage: null,
  }

  let ctx: any

  beforeEach(() => {
    jest.clearAllMocks()

    ctx = {
      user: {
        id: 'user-1',
        name: 'Test User',
        image: null,
      },
      repos: {
        chats: {
          findById: jest.fn().mockResolvedValue(chatMetadata),
          getMessages: jest.fn().mockResolvedValue([assistantMessage]),
        },
        files: {
          findByLinkedTo: jest.fn().mockResolvedValue([]),
        },
        roleplayTemplates: {
          findById: jest.fn(),
        },
        projects: {
          findById: jest.fn(),
        },
        characters: {
          findById: jest.fn().mockResolvedValue({
            id: 'char-1',
            name: 'Narrator',
            aliases: [],
          }),
        },
        chatSettings: {
          findByUserId: jest.fn().mockResolvedValue({}),
        },
      },
    }
  })

  it('pre-renders assistant markdown with emphasis classes in renderedHtml', async () => {
    const req = {
      nextUrl: new URL(`http://localhost:3000/api/v1/chats/${chatId}`),
    } as any

    const response = await handleGet(req, ctx, chatId)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.chat.messages).toHaveLength(1)
    expect(body.chat.messages[0].role).toBe('ASSISTANT')
    expect(body.chat.messages[0].renderedHtml).toContain('<strong class="font-bold">important</strong>')
    expect(body.chat.messages[0].renderedHtml).toContain('<em class="italic">noted</em>')
    expect(body.chat.documentMode).toBe('normal')
    expect(body.chat.dividerPosition).toBe(45)
  })

  it('returns persisted document mode and divider position when set', async () => {
    ctx.repos.chats.findById.mockResolvedValueOnce({
      ...chatMetadata,
      documentMode: 'focus',
      dividerPosition: 30,
    })

    const req = {
      nextUrl: new URL(`http://localhost:3000/api/v1/chats/${chatId}`),
    } as any

    const response = await handleGet(req, ctx, chatId)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.chat.documentMode).toBe('focus')
    expect(body.chat.dividerPosition).toBe(30)
  })

  // Bug 22: the four controlled-select fields must round-trip through the GET
  // projection so a reload shows the saved value instead of the default.
  it('projects the four controlled-select fields when set (Bug 22)', async () => {
    ctx.repos.chats.findById.mockResolvedValueOnce({
      ...chatMetadata,
      timelineMode: 'narrative',
      alertCharactersOfLanternImages: false,
      showThinking: true,
      answerConfirmationOverride: 'OFF',
    })

    const req = {
      nextUrl: new URL(`http://localhost:3000/api/v1/chats/${chatId}`),
    } as any

    const response = await handleGet(req, ctx, chatId)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.chat.timelineMode).toBe('narrative')
    expect(body.chat.alertCharactersOfLanternImages).toBe(false)
    expect(body.chat.showThinking).toBe(true)
    expect(body.chat.answerConfirmationOverride).toBe('OFF')
  })

  it('defaults the four controlled-select fields to null when unset (Bug 22)', async () => {
    const req = {
      nextUrl: new URL(`http://localhost:3000/api/v1/chats/${chatId}`),
    } as any

    const response = await handleGet(req, ctx, chatId)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.chat.timelineMode).toBeNull()
    expect(body.chat.alertCharactersOfLanternImages).toBeNull()
    expect(body.chat.showThinking).toBeNull()
    expect(body.chat.answerConfirmationOverride).toBeNull()
  })

  // Bug 37: the all-LLM pause bookkeeping must be projected so the client can
  // open AllLLMPauseModal instead of the room stopping silently.
  it('projects isPaused and allLLMPauseTurnCount for the pause modal (Bug 37)', async () => {
    ctx.repos.chats.findById.mockResolvedValueOnce({
      ...chatMetadata,
      isPaused: true,
      allLLMPauseTurnCount: 12,
    })

    const req = {
      nextUrl: new URL(`http://localhost:3000/api/v1/chats/${chatId}`),
    } as any

    const response = await handleGet(req, ctx, chatId)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.chat.isPaused).toBe(true)
    expect(body.chat.allLLMPauseTurnCount).toBe(12)
  })

  it('defaults allLLMPauseTurnCount to 0 when unset (Bug 37)', async () => {
    const req = {
      nextUrl: new URL(`http://localhost:3000/api/v1/chats/${chatId}`),
    } as any

    const response = await handleGet(req, ctx, chatId)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.chat.allLLMPauseTurnCount).toBe(0)
  })
})
