/**
 * Tests for `POST /api/v1/chats/[id]?action=scenario`.
 *
 * Changing the scene mid-conversation has to do three things together —
 * persist the text, recompile every identity stack (the text is baked into
 * them), and have the Host announce the revision. A change that does only some
 * of those leaves the room believing something the models can't see, so the
 * coupling is what these tests pin down.
 */

// Uses global jest (not @jest/globals) for proper SWC mock hoisting

jest.mock('@/lib/logger', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}))

jest.mock('@/lib/chat/scenario-selection', () => ({
  resolveScenarioSelection: jest.fn(),
}))

jest.mock('@/lib/services/host-notifications/writer', () => ({
  postHostScenarioRevisionAnnouncement: jest.fn().mockResolvedValue(null),
}))

jest.mock('@/lib/services/system-prompt-compiler/compiler', () => ({
  compileAllIdentityStacks: jest.fn().mockResolvedValue(undefined),
}))

const { handleSetScenario } = require('@/app/api/v1/chats/[id]/actions/scenario')
const { resolveScenarioSelection } = require('@/lib/chat/scenario-selection')
const { postHostScenarioRevisionAnnouncement } = require('@/lib/services/host-notifications/writer')
const { compileAllIdentityStacks } = require('@/lib/services/system-prompt-compiler/compiler')

const CHAT_ID = '3f1c9f4a-1111-4a2b-9c3d-000000000001'

function makeRequest(body: unknown): any {
  return { json: async () => body }
}

function makeChat(overrides: Record<string, unknown> = {}) {
  return {
    id: CHAT_ID,
    projectId: null,
    scenarioText: null,
    participants: [
      { id: 'p1', type: 'CHARACTER', characterId: 'char-1', status: 'active' },
    ],
    ...overrides,
  }
}

describe('chats [id] scenario action', () => {
  let ctx: any

  beforeEach(() => {
    jest.clearAllMocks()
    ctx = {
      user: { id: 'user-1' },
      repos: {
        chats: {
          findById: jest.fn().mockResolvedValue(makeChat()),
          update: jest.fn().mockImplementation(async (_id: string, patch: any) => ({
            ...makeChat(),
            ...patch,
          })),
        },
        characters: {
          findById: jest.fn().mockResolvedValue({ id: 'char-1', scenarios: [] }),
        },
      },
    }
  })

  it('404s when the chat is gone', async () => {
    ctx.repos.chats.findById.mockResolvedValue(null)
    const res = await handleSetScenario(makeRequest({}), CHAT_ID, ctx)
    expect(res.status).toBe(404)
    expect(ctx.repos.chats.update).not.toHaveBeenCalled()
  })

  it('persists, recompiles, and announces when the scene changes', async () => {
    resolveScenarioSelection.mockResolvedValue('A rooftop in the rain.')

    const res = await handleSetScenario(
      makeRequest({ generalScenarioPath: 'Scenarios/rooftop.md' }),
      CHAT_ID,
      ctx,
    )

    expect(res.status).toBe(200)
    expect(ctx.repos.chats.update).toHaveBeenCalledWith(CHAT_ID, {
      scenarioText: 'A rooftop in the rain.',
    })
    expect(compileAllIdentityStacks).toHaveBeenCalledTimes(1)
    expect(postHostScenarioRevisionAnnouncement).toHaveBeenCalledWith({
      chatId: CHAT_ID,
      scenarioText: 'A rooftop in the rain.',
    })
  })

  it('does nothing at all when the resolved scene matches the current one', async () => {
    ctx.repos.chats.findById.mockResolvedValue(makeChat({ scenarioText: 'A tavern at dusk.' }))
    resolveScenarioSelection.mockResolvedValue('A tavern at dusk.')

    const res = await handleSetScenario(
      makeRequest({ scenario: 'A tavern at dusk.' }),
      CHAT_ID,
      ctx,
    )
    const body = await res.json()

    expect(body.changed).toBe(false)
    expect(ctx.repos.chats.update).not.toHaveBeenCalled()
    expect(compileAllIdentityStacks).not.toHaveBeenCalled()
    expect(postHostScenarioRevisionAnnouncement).not.toHaveBeenCalled()
  })

  it('clears the scene when nothing is chosen and nothing is typed', async () => {
    ctx.repos.chats.findById.mockResolvedValue(makeChat({ scenarioText: 'A tavern at dusk.' }))
    resolveScenarioSelection.mockResolvedValue(undefined)

    const res = await handleSetScenario(makeRequest({ scenario: '' }), CHAT_ID, ctx)

    expect(res.status).toBe(200)
    expect(ctx.repos.chats.update).toHaveBeenCalledWith(CHAT_ID, { scenarioText: null })
    expect(postHostScenarioRevisionAnnouncement).toHaveBeenCalledWith({
      chatId: CHAT_ID,
      scenarioText: null,
    })
  })

  it('still announces when recompiling the identity stacks fails', async () => {
    resolveScenarioSelection.mockResolvedValue('A rooftop in the rain.')
    compileAllIdentityStacks.mockRejectedValueOnce(new Error('compiler down'))

    const res = await handleSetScenario(
      makeRequest({ generalScenarioPath: 'Scenarios/rooftop.md' }),
      CHAT_ID,
      ctx,
    )

    expect(res.status).toBe(200)
    expect(postHostScenarioRevisionAnnouncement).toHaveBeenCalled()
  })

  it('finds the character that owns a character scenario before resolving', async () => {
    const scenarioId = '9a7b1c22-2222-4a2b-9c3d-000000000002'
    ctx.repos.chats.findById.mockResolvedValue(
      makeChat({
        participants: [
          { id: 'p1', type: 'CHARACTER', characterId: 'char-1', status: 'active' },
          { id: 'p2', type: 'CHARACTER', characterId: 'char-2', status: 'active' },
        ],
      }),
    )
    ctx.repos.characters.findById.mockImplementation(async (id: string) =>
      id === 'char-2'
        ? { id: 'char-2', scenarios: [{ id: scenarioId, content: 'Her scene.' }] }
        : { id: 'char-1', scenarios: [] },
    )
    resolveScenarioSelection.mockResolvedValue('Her scene.')

    await handleSetScenario(makeRequest({ scenarioId }), CHAT_ID, ctx)

    expect(resolveScenarioSelection).toHaveBeenCalledWith(
      expect.objectContaining({ scenarioId }),
      expect.objectContaining({ character: expect.objectContaining({ id: 'char-2' }) }),
    )
  })

  it('skips a character whose vault refuses to open', async () => {
    const scenarioId = '9a7b1c22-2222-4a2b-9c3d-000000000002'
    ctx.repos.characters.findById.mockRejectedValue(new Error('vault unavailable'))
    resolveScenarioSelection.mockResolvedValue(undefined)

    const res = await handleSetScenario(makeRequest({ scenarioId }), CHAT_ID, ctx)

    expect(res.status).toBe(200)
    expect(resolveScenarioSelection).toHaveBeenCalledWith(
      expect.objectContaining({ scenarioId }),
      expect.objectContaining({ character: null }),
    )
  })
})
