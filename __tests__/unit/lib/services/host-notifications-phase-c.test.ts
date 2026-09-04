/**
 * Unit tests for Phase C / G / "no user character" pure-function helpers
 * in lib/services/host-notifications/writer.ts
 *
 * These content builders produce the Salon messages for scenario announcements,
 * user-character introductions, multi-character rosters, silent mode, join
 * scenarios, timestamps, and the "no user-controlled character" advisory.
 *
 * The idempotence check on postHostNoUserCharacterAnnouncement is also covered
 * here as a regression test for the memory-pipeline no-user-character whisper.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals'

jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}))

jest.mock('@/lib/database/manager', () => ({
  rawQuery: jest.fn(),
  registerBlobColumns: jest.fn(),
  getDatabase: jest.fn(),
  getCollection: jest.fn(),
  getDatabaseAsync: jest.fn(),
  ensureCollection: jest.fn(),
}))

jest.mock('@/lib/mount-index/database-store', () => ({
  readDatabaseDocument: jest.fn().mockRejectedValue(new Error('no vault')),
}))

const { getRepositories } = jest.requireMock('@/lib/repositories/factory') as {
  getRepositories: jest.Mock
}

import {
  buildScenarioContent,
  buildUserCharacterContent,
  buildSilentModeEntryContent,
  buildSilentModeExitContent,
  buildJoinScenarioContent,
  buildTimestampContent,
  buildOffSceneCharactersContent,
  findIntroducedOffSceneCharacterIds,
  postHostOffSceneCharactersAnnouncement,
  postHostNoUserCharacterAnnouncement,
} from '@/lib/services/host-notifications/writer'
import type { OtherParticipantInfo } from '@/lib/chat/context/system-prompt-builder'

// ---------------------------------------------------------------------------
// buildScenarioContent
// ---------------------------------------------------------------------------

describe('buildScenarioContent', () => {
  it('includes the scenario text', () => {
    const result = buildScenarioContent('The party gathers at the ancient keep.')
    expect(result).toContain('The party gathers at the ancient keep.')
  })

  it('begins with the Host setting the scene', () => {
    const result = buildScenarioContent('A dimly lit library.')
    expect(result).toMatch(/^The Host sets the scene/)
  })

  it('trims leading/trailing whitespace from the scenario text', () => {
    const result = buildScenarioContent('   A fog-bound harbour.   ')
    expect(result).toContain('A fog-bound harbour.')
    expect(result).not.toContain('   A fog')
  })
})

// ---------------------------------------------------------------------------
// buildUserCharacterContent
// ---------------------------------------------------------------------------

describe('buildUserCharacterContent', () => {
  it('introduces the user character by name', () => {
    const result = buildUserCharacterContent('Charlie', 'A wandering scholar.')
    expect(result).toContain('Charlie')
  })

  it('includes description when non-empty', () => {
    const result = buildUserCharacterContent('Charlie', 'A wandering scholar.')
    expect(result).toContain('A wandering scholar.')
  })

  it('uses the no-description fallback when description is null', () => {
    const result = buildUserCharacterContent('Charlie', null)
    expect(result).toContain('Charlie')
    expect(result).toContain("user's voice in this conversation")
  })

  it('uses the no-description fallback when description is undefined', () => {
    const result = buildUserCharacterContent('Charlie', undefined)
    expect(result).toContain("user's voice in this conversation")
  })

  it('uses the no-description fallback when description is only whitespace', () => {
    const result = buildUserCharacterContent('Charlie', '   ')
    expect(result).toContain("user's voice in this conversation")
  })
})

// ---------------------------------------------------------------------------
// buildSilentModeEntryContent
// ---------------------------------------------------------------------------

describe('buildSilentModeEntryContent', () => {
  it('addresses the character by name', () => {
    const result = buildSilentModeEntryContent('Viola')
    expect(result).toContain('Viola')
  })

  it('instructs not to speak aloud', () => {
    const result = buildSilentModeEntryContent('Viola')
    expect(result).toContain('MUST NOT speak out loud')
  })

  it('labels it as a private note from the Host', () => {
    const result = buildSilentModeEntryContent('Viola')
    expect(result).toContain('private note to Viola alone')
  })

  it('mentions that the rule remains until lifted', () => {
    const result = buildSilentModeEntryContent('Viola')
    expect(result).toContain('remains in force until the Host whispers')
  })
})

// ---------------------------------------------------------------------------
// buildSilentModeExitContent
// ---------------------------------------------------------------------------

describe('buildSilentModeExitContent', () => {
  it('addresses the character by name', () => {
    const result = buildSilentModeExitContent('Viola')
    expect(result).toContain('Viola')
  })

  it('lifts the silence', () => {
    const result = buildSilentModeExitContent('Viola')
    expect(result).toContain('silence is lifted')
  })

  it('confirms the character may speak again', () => {
    const result = buildSilentModeExitContent('Viola')
    expect(result).toContain('may speak aloud again')
  })
})

// ---------------------------------------------------------------------------
// buildJoinScenarioContent
// ---------------------------------------------------------------------------

describe('buildJoinScenarioContent', () => {
  it('addresses the character by name', () => {
    const result = buildJoinScenarioContent('Montague', 'He arrived by moonlit carriage.')
    expect(result).toContain('Montague')
  })

  it('includes the join scenario text', () => {
    const result = buildJoinScenarioContent('Montague', 'He arrived by moonlit carriage.')
    expect(result).toContain('He arrived by moonlit carriage.')
  })

  it('labels it as a private note from the Host', () => {
    const result = buildJoinScenarioContent('Montague', 'Anything here.')
    expect(result).toContain('private note to Montague alone')
  })

  it('trims leading/trailing whitespace from the join scenario', () => {
    const result = buildJoinScenarioContent('Montague', '  She swept in.  ')
    expect(result).toContain('She swept in.')
    expect(result).not.toContain('  She swept in')
  })
})

// ---------------------------------------------------------------------------
// buildTimestampContent
// ---------------------------------------------------------------------------

describe('buildTimestampContent', () => {
  it('includes the formatted time string', () => {
    const result = buildTimestampContent('Tuesday, 29 April 2026 at 18:00')
    expect(result).toContain('Tuesday, 29 April 2026 at 18:00')
  })

  it('begins with the Host marking the time', () => {
    const result = buildTimestampContent('noon')
    expect(result).toMatch(/^The Host marks the time/)
  })
})

// ---------------------------------------------------------------------------
// postHostNoUserCharacterAnnouncement — idempotence regression
// ---------------------------------------------------------------------------

describe('postHostNoUserCharacterAnnouncement', () => {
  const CHAT_ID = 'chat-idempotence-test'

  function makeAddMessage() {
    return jest.fn().mockResolvedValue(undefined)
  }

  function makeChatWithNoMessages(addMessage = makeAddMessage()) {
    return {
      id: CHAT_ID,
      messages: [],
      addMessage,
    }
  }

  function makeChatWithExistingWhisper(addMessage = makeAddMessage()) {
    return {
      id: CHAT_ID,
      messages: [
        {
          type: 'message',
          systemSender: 'host',
          systemKind: 'no-user-character',
        },
      ],
      addMessage,
    }
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('posts the whisper when none has been sent yet', async () => {
    const addMessage = makeAddMessage()
    getRepositories.mockReturnValue({
      chats: {
        findById: jest.fn().mockResolvedValue(makeChatWithNoMessages(addMessage)),
        addMessage,
      },
    } as unknown as ReturnType<typeof getRepositories>)

    const result = await postHostNoUserCharacterAnnouncement({ chatId: CHAT_ID })
    expect(addMessage).toHaveBeenCalledTimes(1)
    expect(result).not.toBeNull()
  })

  it('is idempotent — does NOT post a second whisper when one already exists', async () => {
    const addMessage = makeAddMessage()
    getRepositories.mockReturnValue({
      chats: {
        findById: jest.fn().mockResolvedValue(makeChatWithExistingWhisper(addMessage)),
        addMessage,
      },
    } as unknown as ReturnType<typeof getRepositories>)

    const result = await postHostNoUserCharacterAnnouncement({ chatId: CHAT_ID })
    expect(addMessage).not.toHaveBeenCalled()
    expect(result).toBeNull()
  })

  it('returns null and does not throw when the chat is not found', async () => {
    getRepositories.mockReturnValue({
      chats: {
        findById: jest.fn().mockResolvedValue(null),
        addMessage: makeAddMessage(),
      },
    } as unknown as ReturnType<typeof getRepositories>)

    const result = await postHostNoUserCharacterAnnouncement({ chatId: 'missing-chat' })
    expect(result).toBeNull()
  })

  it('returns null and does not throw when the repo call rejects', async () => {
    getRepositories.mockReturnValue({
      chats: {
        findById: jest.fn().mockRejectedValue(new Error('DB failure')),
        addMessage: makeAddMessage(),
      },
    } as unknown as ReturnType<typeof getRepositories>)

    const result = await postHostNoUserCharacterAnnouncement({ chatId: CHAT_ID })
    expect(result).toBeNull()
  })

  it('the posted message carries the host-no-user-character systemKind', async () => {
    const addMessage = makeAddMessage()
    getRepositories.mockReturnValue({
      chats: {
        findById: jest.fn().mockResolvedValue(makeChatWithNoMessages()),
        addMessage,
      },
    } as unknown as ReturnType<typeof getRepositories>)

    await postHostNoUserCharacterAnnouncement({ chatId: CHAT_ID })

    const [chatIdArg, message] = addMessage.mock.calls[0] as [string, Record<string, unknown>]
    expect(chatIdArg).toBe(CHAT_ID)
    expect(message.systemSender).toBe('host')
    expect(message.systemKind).toBe('no-user-character')
    expect(typeof message.content).toBe('string')
    expect((message.content as string).length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Off-scene character introductions
// ---------------------------------------------------------------------------

describe('buildOffSceneCharactersContent', () => {
  it('renders a single-character introduction with name, pronouns, and description', () => {
    const result = buildOffSceneCharactersContent([
      {
        id: 'c-1',
        name: 'Mochi',
        pronouns: { subject: 'he', object: 'him', possessive: 'his' },
        description: 'A grumpy gray cat.',
      },
    ])
    expect(result).toContain('### Mochi')
    expect(result).toContain('Pronouns: he/him/his')
    expect(result).toContain('A grumpy gray cat.')
    // Singular framing for one character.
    expect(result).toContain('a person spoken of in this conversation')
    expect(result).toContain('not presently in the Salon')
  })

  it('uses plural framing for multi-character introductions and sorts alphabetically', () => {
    const result = buildOffSceneCharactersContent([
      { id: 'c-2', name: 'Sunny', description: 'Engineer.' },
      { id: 'c-1', name: 'Gary', description: 'Gardener.' },
    ])
    expect(result).toContain('certain persons spoken of in this conversation')
    // Alphabetical ordering — Gary before Sunny.
    const garyIdx = result.indexOf('### Gary')
    const sunnyIdx = result.indexOf('### Sunny')
    expect(garyIdx).toBeGreaterThan(-1)
    expect(sunnyIdx).toBeGreaterThan(-1)
    expect(garyIdx).toBeLessThan(sunnyIdx)
  })

  it('includes aliases when present and omits the field otherwise', () => {
    const withAliases = buildOffSceneCharactersContent([
      { id: 'c-1', name: 'Lorian', aliases: ['Teacher', 'Scholar'] },
    ])
    expect(withAliases).toContain('Aliases: Teacher, Scholar')

    const noAliases = buildOffSceneCharactersContent([
      { id: 'c-2', name: 'Riya' },
    ])
    expect(noAliases).not.toContain('Aliases:')
  })

  it('skips empty descriptions cleanly', () => {
    const result = buildOffSceneCharactersContent([
      { id: 'c-1', name: 'Mystery', description: '   ' },
    ])
    expect(result).toContain('### Mystery')
    // Trimmed empty descriptions should not produce a stray newline-only block.
    expect(result).not.toMatch(/### Mystery\n\n\n/)
  })

  it('prefers identity over description when both are present', () => {
    const result = buildOffSceneCharactersContent([
      {
        id: 'c-1',
        name: 'Reginald',
        identity: 'A barrister of the Kings Bench.',
        description: 'Speaks in long, looping clauses.',
      },
    ])
    expect(result).toContain('A barrister of the Kings Bench.')
    expect(result).not.toContain('Speaks in long, looping clauses.')
  })

  it('falls back to description when identity is absent', () => {
    const result = buildOffSceneCharactersContent([
      { id: 'c-1', name: 'Gary', description: 'Gardener.' },
    ])
    expect(result).toContain('Gardener.')
  })

  it('falls back to description when identity is only whitespace', () => {
    const result = buildOffSceneCharactersContent([
      { id: 'c-1', name: 'Gary', identity: '   ', description: 'Gardener.' },
    ])
    expect(result).toContain('Gardener.')
  })

  it('produces byte-identical output across calls for the same character set (cache stability)', () => {
    const chars = [
      { id: 'c-1', name: 'Gary', description: 'Gardener.' },
      { id: 'c-2', name: 'Sunny', description: 'Engineer.' },
    ]
    const a = buildOffSceneCharactersContent(chars)
    const b = buildOffSceneCharactersContent([...chars].reverse())
    expect(a).toBe(b)
  })
})

describe('findIntroducedOffSceneCharacterIds', () => {
  it('returns empty for messages with no off-scene host announcements', () => {
    const result = findIntroducedOffSceneCharacterIds([
      { type: 'message', role: 'USER', content: 'hello' },
      { type: 'message', role: 'ASSISTANT', systemSender: 'host', systemKind: 'add', hostEvent: { participantId: 'p-1', toStatus: 'active' } },
    ])
    expect(result.size).toBe(0)
  })

  it('extracts character IDs from prior off-scene-characters host messages', () => {
    const result = findIntroducedOffSceneCharacterIds([
      {
        type: 'message',
        role: 'ASSISTANT',
        systemSender: 'host',
        systemKind: 'off-scene-characters',
        hostEvent: { introducedCharacterIds: ['c-1', 'c-2'] },
      },
      {
        type: 'message',
        role: 'ASSISTANT',
        systemSender: 'host',
        systemKind: 'off-scene-characters',
        hostEvent: { introducedCharacterIds: ['c-3'] },
      },
    ])
    expect([...result].sort()).toEqual(['c-1', 'c-2', 'c-3'])
  })

  it('ignores messages whose hostEvent lacks introducedCharacterIds', () => {
    const result = findIntroducedOffSceneCharacterIds([
      {
        type: 'message',
        role: 'ASSISTANT',
        systemSender: 'host',
        systemKind: 'off-scene-characters',
        hostEvent: { participantId: 'p-1', toStatus: 'active' }, // wrong shape
      },
      {
        type: 'message',
        role: 'ASSISTANT',
        systemSender: 'host',
        systemKind: 'off-scene-characters',
        // hostEvent missing entirely
      },
    ])
    expect(result.size).toBe(0)
  })

  it('tolerates malformed messages without throwing', () => {
    expect(() =>
      findIntroducedOffSceneCharacterIds([null, undefined, 'string', { type: 'message' }] as unknown[]),
    ).not.toThrow()
  })
})

describe('postHostOffSceneCharactersAnnouncement', () => {
  const CHAT_ID = 'chat-offscene-1'

  function makeAddMessage() {
    return jest.fn().mockResolvedValue(undefined)
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns null without persisting when characters is empty', async () => {
    const addMessage = makeAddMessage()
    getRepositories.mockReturnValue({
      chats: {
        findById: jest.fn().mockResolvedValue({ id: CHAT_ID, messages: [], addMessage }),
        addMessage,
      },
    } as unknown as ReturnType<typeof getRepositories>)

    const result = await postHostOffSceneCharactersAnnouncement({
      chatId: CHAT_ID,
      characters: [],
    })
    expect(result).toBeNull()
    expect(addMessage).not.toHaveBeenCalled()
  })

  it('persists a host message stamped with the introduced character IDs', async () => {
    const addMessage = makeAddMessage()
    getRepositories.mockReturnValue({
      chats: {
        findById: jest.fn().mockResolvedValue({ id: CHAT_ID, messages: [], addMessage }),
        addMessage,
      },
    } as unknown as ReturnType<typeof getRepositories>)

    const result = await postHostOffSceneCharactersAnnouncement({
      chatId: CHAT_ID,
      characters: [
        { id: 'c-1', name: 'Gary', description: 'Gardener.' },
        { id: 'c-2', name: 'Sunny', description: 'Engineer.' },
      ],
    })
    expect(result).not.toBeNull()
    expect(addMessage).toHaveBeenCalledTimes(1)
    const [chatIdArg, message] = addMessage.mock.calls[0] as [string, Record<string, unknown>]
    expect(chatIdArg).toBe(CHAT_ID)
    expect(message.systemSender).toBe('host')
    expect(message.systemKind).toBe('off-scene-characters')
    expect((message.hostEvent as { introducedCharacterIds: string[] }).introducedCharacterIds).toEqual(['c-1', 'c-2'])
    expect((message.content as string).length).toBeGreaterThan(0)
  })

  it('returns null gracefully when the chat is missing', async () => {
    getRepositories.mockReturnValue({
      chats: {
        findById: jest.fn().mockResolvedValue(null),
        addMessage: makeAddMessage(),
      },
    } as unknown as ReturnType<typeof getRepositories>)

    const result = await postHostOffSceneCharactersAnnouncement({
      chatId: 'missing-chat',
      characters: [{ id: 'c-1', name: 'Gary' }],
    })
    expect(result).toBeNull()
  })

  it('returns null and does not throw when the repo call rejects (non-fatal)', async () => {
    getRepositories.mockReturnValue({
      chats: {
        findById: jest.fn().mockRejectedValue(new Error('DB failure')),
        addMessage: makeAddMessage(),
      },
    } as unknown as ReturnType<typeof getRepositories>)

    const result = await postHostOffSceneCharactersAnnouncement({
      chatId: CHAT_ID,
      characters: [{ id: 'c-1', name: 'Gary' }],
    })
    expect(result).toBeNull()
  })

  it('round-trips with findIntroducedOffSceneCharacterIds — once persisted, the IDs become discoverable', async () => {
    let storedMessage: Record<string, unknown> | null = null
    const addMessage = jest.fn().mockImplementation(async (_chatId: string, msg: Record<string, unknown>) => {
      storedMessage = msg
    })
    getRepositories.mockReturnValue({
      chats: {
        findById: jest.fn().mockResolvedValue({ id: CHAT_ID, messages: [], addMessage }),
        addMessage,
      },
    } as unknown as ReturnType<typeof getRepositories>)

    await postHostOffSceneCharactersAnnouncement({
      chatId: CHAT_ID,
      characters: [
        { id: 'c-1', name: 'Gary' },
        { id: 'c-2', name: 'Sunny' },
      ],
    })

    expect(storedMessage).not.toBeNull()
    const introduced = findIntroducedOffSceneCharacterIds([storedMessage as unknown])
    expect([...introduced].sort()).toEqual(['c-1', 'c-2'])
  })
})

// ---------------------------------------------------------------------------
// Template-string replacement in Host announcements
//
// Character vault docs and character DB fields may contain {{char}} and
// {{user}} placeholders. When the Host quotes those fields, the placeholders
// must be substituted with the character's name and the chat's user-character
// name; unbound placeholders are left literal so they don't silently vanish.
// ---------------------------------------------------------------------------

describe('Host announcements: {{char}} / {{user}} template replacement', () => {
  it('replaces {{char}} and {{user}} in off-scene character descriptions', () => {
    const result = buildOffSceneCharactersContent(
      [{ id: 'c-1', name: 'Gary', description: '{{char}} is a friend of {{user}}.' }],
      'Charlie',
    )
    expect(result).toContain('Gary is a friend of Charlie.')
    expect(result).not.toContain('{{char}}')
    expect(result).not.toContain('{{user}}')
  })

  it('leaves {{user}} literal when no user-character name is supplied', () => {
    const result = buildOffSceneCharactersContent(
      [{ id: 'c-1', name: 'Gary', description: '{{char}} greets {{user}} warmly.' }],
      null,
    )
    expect(result).toContain('Gary greets {{user}} warmly.')
  })

  it('replaces {{char}} per-card in multi-character off-scene introductions', () => {
    const result = buildOffSceneCharactersContent(
      [
        { id: 'c-1', name: 'Gary', description: '{{char}} tends the garden.' },
        { id: 'c-2', name: 'Sunny', description: '{{char}} repairs the engine.' },
      ],
      'Charlie',
    )
    expect(result).toContain('Gary tends the garden.')
    expect(result).toContain('Sunny repairs the engine.')
  })

  it('replaces {{user}} in the user-character introduction description', () => {
    const result = buildUserCharacterContent(
      'Charlie',
      '{{user}} is a wandering scholar.',
    )
    expect(result).toContain('Charlie is a wandering scholar.')
    expect(result).not.toContain('{{user}}')
  })

  it('replaces {{char}} and {{user}} in join-scenario whispers', () => {
    const result = buildJoinScenarioContent(
      'Montague',
      '{{char}} arrives at the gate where {{user}} waits.',
      'Charlie',
    )
    expect(result).toContain('Montague arrives at the gate where Charlie waits.')
  })

  it('leaves unrelated double-brace tokens unchanged', () => {
    const result = buildOffSceneCharactersContent(
      [{ id: 'c-1', name: 'Gary', description: '{{char}} carries the {{lantern}}.' }],
      'Charlie',
    )
    expect(result).toContain('Gary carries the {{lantern}}.')
  })

  it('is a no-op for content with no template tokens (cache stability)', () => {
    const a = buildOffSceneCharactersContent(
      [{ id: 'c-1', name: 'Gary', description: 'A gardener.' }],
      'Charlie',
    )
    const b = buildOffSceneCharactersContent(
      [{ id: 'c-1', name: 'Gary', description: 'A gardener.' }],
      null,
    )
    expect(a).toBe(b)
  })
})
