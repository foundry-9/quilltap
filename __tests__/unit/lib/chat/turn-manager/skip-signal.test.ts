import { describe, it, expect } from '@jest/globals'
import {
  NOTHING_TO_ADD_SENTINEL,
  TURN_PASS_SYSTEM_KIND,
  isTurnPassMessage,
  detectSkipSentinel,
  findSkippedSinceLastSubstantive,
  isFirstCharacterTurn,
  isRecentlyAddressed,
  qualifiesForTurnSkipping,
  computeSkipEligibility,
  calculateTurnStateFromHistory,
} from '@/lib/chat/turn-manager'
import type { ChatEvent, ChatParticipantBase, Character, MessageEvent } from '@/lib/schemas/types'

const now = new Date().toISOString()

const makeChar = (id: string, overrides: Partial<Character> = {}): Character => ({
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
  talkativeness: 0.5,
  partnerLinks: [],
  tags: [],
  avatarOverrides: [],
  physicalDescriptions: [],
  aliases: [],
  createdAt: now,
  updatedAt: now,
  ...overrides,
})

const makeParticipant = (
  id: string,
  characterId: string,
  overrides: Partial<ChatParticipantBase> = {},
): ChatParticipantBase => ({
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

const msg = (
  role: 'USER' | 'ASSISTANT',
  participantId: string | null,
  overrides: Partial<MessageEvent> = {},
): MessageEvent => ({
  type: 'message',
  id: `m-${Math.random().toString(36).slice(2)}`,
  role,
  content: `${role} content`,
  attachments: [],
  createdAt: now,
  participantId,
  ...overrides,
})

const pass = (participantId: string): MessageEvent => ({
  type: 'message',
  id: `pass-${participantId}-${Math.random().toString(36).slice(2)}`,
  role: 'ASSISTANT',
  content: 'The Host inclines his head as someone waves the turn graciously by.',
  attachments: [],
  createdAt: now,
  participantId: null,
  systemSender: 'host',
  systemKind: TURN_PASS_SYSTEM_KIND,
  hostEvent: { participantId },
})

describe('detectSkipSentinel', () => {
  it('detects a bare sentinel', () => {
    expect(detectSkipSentinel(NOTHING_TO_ADD_SENTINEL)).toEqual({ skip: true })
  })

  it('detects the sentinel wrapped in markdown bold', () => {
    expect(detectSkipSentinel('**[NOTHING TO ADD]**')).toEqual({ skip: true })
  })

  it('detects the sentinel wrapped in quotes and underscores', () => {
    expect(detectSkipSentinel('"_[nothing to add]_"')).toEqual({ skip: true })
  })

  it('detects a lowercase, bracket-less sentinel with trailing punctuation', () => {
    expect(detectSkipSentinel('nothing to add.')).toEqual({ skip: true })
  })

  it('strips a leading own-name prefix before matching', () => {
    expect(detectSkipSentinel('[Alice] [NOTHING TO ADD]', 'Alice')).toEqual({ skip: true })
  })

  it('treats sentinel + trailing prose as NOT a skip and returns cleaned prose', () => {
    const res = detectSkipSentinel('[NOTHING TO ADD]\nActually, wait — I do have a thought.')
    expect(res.skip).toBe(false)
    expect((res as { cleaned?: string }).cleaned).toBe('Actually, wait — I do have a thought.')
  })

  it('treats narration ending with a lone sentinel line as NOT a skip and strips the trailing line', () => {
    const res = detectSkipSentinel(
      '*I stay where I am, my hand on his arm.*\n\n*There is nothing I need to add.*\n\n[NOTHING TO ADD]',
    )
    expect(res.skip).toBe(false)
    expect((res as { cleaned?: string }).cleaned).toBe(
      '*I stay where I am, my hand on his arm.*\n\n*There is nothing I need to add.*',
    )
  })

  it('strips a trailing sentinel even when wrapped in markdown', () => {
    const res = detectSkipSentinel('*She nods once and says nothing more.*\n\n**[nothing to add]**')
    expect(res.skip).toBe(false)
    expect((res as { cleaned?: string }).cleaned).toBe('*She nods once and says nothing more.*')
  })

  it('does not treat a mid-reply mention of the phrase as a skip', () => {
    const res = detectSkipSentinel('I have plenty to say. Nothing to add would be a lie.')
    expect(res).toEqual({ skip: false })
  })

  it('does not strip a sentinel-looking phrase that is not on its own final line', () => {
    const res = detectSkipSentinel('There is nothing to add here, but I will speak anyway.')
    expect(res).toEqual({ skip: false })
  })

  it('returns not-a-skip for empty input', () => {
    expect(detectSkipSentinel('')).toEqual({ skip: false })
    expect(detectSkipSentinel('   ')).toEqual({ skip: false })
  })
})

describe('isTurnPassMessage', () => {
  it('recognizes a turn-pass record', () => {
    expect(isTurnPassMessage(pass('p1'))).toBe(true)
  })
  it('rejects a normal assistant message', () => {
    expect(isTurnPassMessage(msg('ASSISTANT', 'p1'))).toBe(false)
  })
  it('rejects other Host kinds', () => {
    expect(isTurnPassMessage({ ...pass('p1'), systemKind: 'add' })).toBe(false)
  })
})

describe('findSkippedSinceLastSubstantive', () => {
  it('collects passes back to the last substantive message', () => {
    const events: ChatEvent[] = [
      msg('ASSISTANT', 'p1'), // substantive boundary
      pass('p2'),
      pass('p3'),
    ]
    const skipped = findSkippedSinceLastSubstantive(events)
    expect(skipped).toEqual(new Set(['p2', 'p3']))
  })

  it('stops at the most recent substantive message', () => {
    const events: ChatEvent[] = [
      pass('p2'), // older, before the substantive boundary — excluded
      msg('ASSISTANT', 'p1'),
      pass('p3'),
    ]
    expect(findSkippedSinceLastSubstantive(events)).toEqual(new Set(['p3']))
  })
})

describe('isFirstCharacterTurn', () => {
  it('is true when no character has taken an ASSISTANT turn', () => {
    expect(isFirstCharacterTurn([msg('USER', null)])).toBe(true)
  })
  it('is false once a character has spoken (greeting counts)', () => {
    expect(isFirstCharacterTurn([msg('ASSISTANT', 'p1')])).toBe(false)
  })
  it('ignores Staff messages (null participantId)', () => {
    const staff: MessageEvent = { ...msg('ASSISTANT', null), systemSender: 'host', systemKind: 'scenario' }
    expect(isFirstCharacterTurn([staff])).toBe(true)
  })
})

describe('isRecentlyAddressed', () => {
  const alice = makeChar('c-alice', { name: 'Alice', aliases: ['Al'] })

  it('flags a mention by name after the responder last spoke', () => {
    const events: ChatEvent[] = [
      msg('ASSISTANT', 'p-alice'),
      msg('USER', 'p-user', { content: 'Alice, what do you think?' }),
    ]
    expect(isRecentlyAddressed(events, 'p-alice', alice)).toBe(true)
  })

  it('flags a mention by alias', () => {
    const events: ChatEvent[] = [
      msg('ASSISTANT', 'p-alice'),
      msg('USER', 'p-user', { content: 'Hey Al, over here.' }),
    ]
    expect(isRecentlyAddressed(events, 'p-alice', alice)).toBe(true)
  })

  it('flags a whisper targeted at the responder', () => {
    const events: ChatEvent[] = [
      msg('ASSISTANT', 'p-alice'),
      msg('USER', 'p-user', { content: 'psst', targetParticipantIds: ['p-alice'] }),
    ]
    expect(isRecentlyAddressed(events, 'p-alice', alice)).toBe(true)
  })

  it('is false when nobody addressed the responder since they spoke', () => {
    const events: ChatEvent[] = [
      msg('USER', 'p-user', { content: 'Alice, hi' }),
      msg('ASSISTANT', 'p-alice'),
      msg('USER', 'p-user', { content: 'Bob, your turn.' }),
    ]
    expect(isRecentlyAddressed(events, 'p-alice', alice)).toBe(false)
  })
})

describe('qualifiesForTurnSkipping', () => {
  const llm = (id: string) => makeParticipant(id, `c-${id}`)
  const user = (id: string) => makeParticipant(id, `c-${id}`, { controlledBy: 'user' })

  it('excludes a one-on-one (1 user + 1 LLM)', () => {
    expect(qualifiesForTurnSkipping([user('u'), llm('a')])).toBe(false)
  })
  it('excludes a single character', () => {
    expect(qualifiesForTurnSkipping([llm('a')])).toBe(false)
  })
  it('includes two LLMs', () => {
    expect(qualifiesForTurnSkipping([llm('a'), llm('b')])).toBe(true)
  })
  it('includes three-plus participants even with one LLM', () => {
    expect(qualifiesForTurnSkipping([user('u'), user('v'), llm('a')])).toBe(true)
  })
  it('ignores absent/removed participants', () => {
    const absent = makeParticipant('x', 'c-x', { status: 'removed' })
    expect(qualifiesForTurnSkipping([user('u'), llm('a'), absent])).toBe(false)
  })
})

describe('computeSkipEligibility', () => {
  const pA = makeParticipant('pA', 'cA')
  const pB = makeParticipant('pB', 'cB')
  const pC = makeParticipant('pC', 'cC')
  const charA = makeChar('cA', { name: 'Aaron' })

  it('withholds the skip on the very first character turn', () => {
    const res = computeSkipEligibility({
      events: [msg('USER', 'pU')],
      participants: [pA, pB],
      respondingParticipantId: 'pA',
      respondingCharacter: charA,
      turnSkippingEnabled: true,
    })
    expect(res.offerSkip).toBe(false)
    expect(res.mustSpeakReason).toBe('first-character-turn')
  })

  it('withholds the skip when summoned (nudge/queue)', () => {
    const res = computeSkipEligibility({
      events: [msg('ASSISTANT', 'pB')],
      participants: [pA, pB],
      respondingParticipantId: 'pA',
      respondingCharacter: charA,
      summoned: true,
      turnSkippingEnabled: true,
    })
    expect(res.mustSpeakReason).toBe('summoned')
  })

  it('withholds the skip when the feature is disabled', () => {
    const res = computeSkipEligibility({
      events: [msg('ASSISTANT', 'pB')],
      participants: [pA, pB],
      respondingParticipantId: 'pA',
      respondingCharacter: charA,
      turnSkippingEnabled: false,
    })
    expect(res.mustSpeakReason).toBe('feature-disabled')
  })

  it('offers the skip on a normal subsequent turn', () => {
    const res = computeSkipEligibility({
      events: [msg('ASSISTANT', 'pB'), msg('ASSISTANT', 'pC')],
      participants: [pA, pB, pC],
      respondingParticipantId: 'pA',
      respondingCharacter: charA,
      turnSkippingEnabled: true,
    })
    expect(res.offerSkip).toBe(true)
    expect(res.mustSpeakReason).toBeNull()
  })

  it('withholds the skip when the responder already skipped this window', () => {
    const res = computeSkipEligibility({
      events: [msg('ASSISTANT', 'pB'), pass('pA')],
      participants: [pA, pB, pC],
      respondingParticipantId: 'pA',
      respondingCharacter: charA,
      turnSkippingEnabled: true,
    })
    expect(res.mustSpeakReason).toBe('already-skipped')
  })

  it('forces a speak when every other active character has skipped (3-party wrap)', () => {
    // pC spoke substantively; pA and pB then both passed; back to pC's rotation
    // partner pA must be forced — but here we check pC after pA+pB pass.
    const res = computeSkipEligibility({
      events: [msg('ASSISTANT', 'pC'), pass('pA'), pass('pB')],
      participants: [pA, pB, pC],
      respondingParticipantId: 'pC',
      respondingCharacter: makeChar('cC', { name: 'Cara' }),
      turnSkippingEnabled: true,
    })
    expect(res.mustSpeakReason).toBe('all-others-skipped')
    expect(res.offerSkip).toBe(false)
  })

  it('forces a speak when the other LLM has skipped (2-LLM chat)', () => {
    const res = computeSkipEligibility({
      events: [msg('ASSISTANT', 'pA'), pass('pB')],
      participants: [pA, pB],
      respondingParticipantId: 'pA',
      respondingCharacter: charA,
      turnSkippingEnabled: true,
    })
    expect(res.mustSpeakReason).toBe('all-others-skipped')
  })

  it('is out of scope in a one-on-one (1 user + 1 LLM)', () => {
    const pUser = makeParticipant('pUser', 'cUser', { controlledBy: 'user' })
    const res = computeSkipEligibility({
      events: [msg('USER', 'pUser'), msg('ASSISTANT', 'pA')],
      participants: [pA, pUser],
      respondingParticipantId: 'pA',
      respondingCharacter: charA,
      turnSkippingEnabled: true,
    })
    expect(res.offerSkip).toBe(false)
    expect(res.mustSpeakReason).toBe('not-multi-character')
  })
})

describe('calculateTurnStateFromHistory with turn-pass records', () => {
  it('advances lastSpeakerId to the passing participant', () => {
    const participants = [makeParticipant('p1', 'c1'), makeParticipant('p2', 'c2')]
    const messages: MessageEvent[] = [
      msg('ASSISTANT', 'p1'),
      pass('p2'),
    ]
    const state = calculateTurnStateFromHistory({ messages, participants, userParticipantId: null })
    expect(state.lastSpeakerId).toBe('p2')
  })

  it('still ignores whispers and other Host kinds', () => {
    const participants = [makeParticipant('p1', 'c1'), makeParticipant('p2', 'c2')]
    const whisper = msg('ASSISTANT', 'p2', { targetParticipantIds: ['p1'] })
    const roster: MessageEvent = { ...msg('ASSISTANT', null), systemSender: 'host', systemKind: 'roster' }
    const messages: MessageEvent[] = [msg('ASSISTANT', 'p1'), roster, whisper]
    const state = calculateTurnStateFromHistory({ messages, participants, userParticipantId: null })
    expect(state.lastSpeakerId).toBe('p1')
  })
})
