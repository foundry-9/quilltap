import { describe, it, expect, jest } from '@jest/globals'
import {
  createInitialTurnState,
  calculateTurnStateFromHistory,
  selectNextSpeaker,
  updateTurnStateAfterMessage,
  addToQueue,
  removeFromQueue,
  popFromQueue,
  nudgeParticipant,
  resetCycleForUserSkip,
  getQueuePosition,
  getSelectionExplanation,
  findUserParticipant,
  findActiveUserParticipant,
  getActiveCharacterParticipants,
  isMultiCharacterChat,
  computeSpokenThisCycleAfterMessage,
  computeSpokenThisCycleAfterSkip,
} from '@/lib/chat/turn-manager'
import type { ChatParticipantBase, Character, MessageEvent } from '@/lib/schemas/types'

const now = new Date().toISOString()

const makeCharacter = (id: string, overrides: Partial<Character> = {}): Character => ({
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
  createdAt: now,
  updatedAt: now,
  ...overrides,
})

const makeCharacterParticipant = (participantId: string, characterId: string, overrides: Partial<ChatParticipantBase> = {}): ChatParticipantBase => ({
  id: participantId,
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

const makeUserControlledParticipant = (participantId: string, characterId: string, overrides: Partial<ChatParticipantBase> = {}): ChatParticipantBase => ({
  id: participantId,
  type: 'CHARACTER',
  characterId,
  controlledBy: 'user',
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

const makeMessage = (id: string, role: 'USER' | 'ASSISTANT', participantId?: string | null): MessageEvent => ({
  type: 'message',
  id,
  role,
  content: `${role} message` as string,
  attachments: [],
  createdAt: now,
  participantId: participantId ?? null,
})

describe('turn manager state', () => {
  it('derives lastSpeakerId from history and sources spokenSinceUserTurn from persisted state', () => {
    const participants = [
      makeCharacterParticipant('p1', 'char-1'),
      makeCharacterParticipant('p2', 'char-2'),
    ]
    const messages = [
      makeMessage('m-user', 'USER'),
      makeMessage('m-1', 'ASSISTANT', 'p1'),
      makeMessage('m-2', 'ASSISTANT', 'p2'),
    ]

    // No persisted field — spoken cycle defaults to empty regardless of history.
    const fresh = calculateTurnStateFromHistory({ messages, participants, userParticipantId: null })
    expect(fresh.spokenSinceUserTurn).toEqual([])
    expect(fresh.lastSpeakerId).toBe('p2')

    // With a persisted field — that's the authoritative source.
    const restored = calculateTurnStateFromHistory({
      messages,
      participants,
      userParticipantId: null,
      spokenThisCycleParticipantIds: JSON.stringify(['p1', 'p2']),
    })
    expect(restored.spokenSinceUserTurn).toEqual(['p1', 'p2'])
    expect(restored.lastSpeakerId).toBe('p2')
  })

  it('selects next speaker from queue before random selection', () => {
    const participants = [makeCharacterParticipant('p1', 'char-1'), makeCharacterParticipant('p2', 'char-2')]
    const characters = new Map<string, Character>([
      ['char-1', makeCharacter('char-1')],
      ['char-2', makeCharacter('char-2')],
    ])
    const turnState = { ...createInitialTurnState(), queue: ['p2'] }

    const selection = selectNextSpeaker(participants, characters, turnState, null)
    expect(selection).toMatchObject({ nextSpeakerId: 'p2', reason: 'queue', cycleComplete: false })
  })

  it('performs weighted random selection among eligible participants', () => {
    const participants = [
      makeCharacterParticipant('p1', 'char-1'),
      makeCharacterParticipant('p2', 'char-2'),
    ]
    const characters = new Map<string, Character>([
      ['char-1', makeCharacter('char-1', { talkativeness: 0.2 })],
      ['char-2', makeCharacter('char-2', { talkativeness: 0.8 })],
    ])
    const turnState = { ...createInitialTurnState(), spokenSinceUserTurn: [], lastSpeakerId: 'p1' }

    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.1)
    const selection = selectNextSpeaker(participants, characters, turnState, null)
    randomSpy.mockRestore()

    expect(selection.reason).toBe('weighted_selection')
    expect(selection.nextSpeakerId).toBe('p2')
    expect(selection.debug?.eligibleSpeakers).toEqual(['p2'])
  })

  it('wraps the cycle by picking a fresh weighted speaker once everyone has spoken', () => {
    // Phase 2: salon chats wrap (rather than bailing to user_turn) because
    // user-controlled CHARACTER participants now sit in the rotation
    // themselves; rotation continues weighted-randomly with the previous
    // speaker excluded.
    const participants = [makeCharacterParticipant('p1', 'char-1'), makeCharacterParticipant('p2', 'char-2')]
    const characters = new Map<string, Character>([
      ['char-1', makeCharacter('char-1')],
      ['char-2', makeCharacter('char-2')],
    ])
    const turnState = { ...createInitialTurnState(), spokenSinceUserTurn: ['p1', 'p2'], lastSpeakerId: 'p2' }

    const selection = selectNextSpeaker(participants, characters, turnState, 'user-1')
    expect(selection.nextSpeakerId).toBe('p1')
    expect(selection.reason).toBe('weighted_selection')
    expect(selection.cycleComplete).toBe(true)
  })

  it('auto-continues in all-LLM chat when all characters have spoken', () => {
    const participants = [makeCharacterParticipant('p1', 'char-1'), makeCharacterParticipant('p2', 'char-2')]
    const characters = new Map<string, Character>([
      ['char-1', makeCharacter('char-1')],
      ['char-2', makeCharacter('char-2')],
    ])
    const turnState = { ...createInitialTurnState(), spokenSinceUserTurn: ['p1', 'p2'], lastSpeakerId: 'p2' }

    // With no user participant (all-LLM), starts new cycle instead of user turn
    const selection = selectNextSpeaker(participants, characters, turnState, null)
    expect(selection.nextSpeakerId).toBe('p1') // Selects the other character (not last speaker)
    expect(selection.reason).toBe('weighted_selection')
    expect(selection.cycleComplete).toBe(true)
  })

  it('honors single-character monologue mode regardless of user participant', () => {
    // Phase 2: `selectNextSpeaker` no longer cares whether a user participant
    // exists in the chat — the only signal that pauses for a human is the
    // selection landing on a user-controlled CHARACTER participant. With only
    // one LLM character present, it speaks every turn.
    const participant = makeCharacterParticipant('p1', 'char-1')
    const characters = new Map<string, Character>([['char-1', makeCharacter('char-1')]])
    const state = { ...createInitialTurnState(), lastSpeakerId: null }

    const selection = selectNextSpeaker([participant], characters, state, 'user-1')
    expect(selection.nextSpeakerId).toBe('p1')
    expect(selection.reason).toBe('only_character')

    const repeat = selectNextSpeaker([participant], characters, { ...state, lastSpeakerId: 'p1' }, 'user-1')
    expect(repeat.nextSpeakerId).toBe('p1')
    expect(repeat.reason).toBe('only_character')
  })

  it('returns user_turn when the only character is user-controlled', () => {
    const userChar = makeUserControlledParticipant('u1', 'char-user')
    const characters = new Map<string, Character>([['char-user', makeCharacter('char-user')]])
    const state = createInitialTurnState()

    const selection = selectNextSpeaker([userChar], characters, state, 'u1')
    expect(selection.nextSpeakerId).toBe('u1')
    expect(selection.reason).toBe('user_turn')
  })

  it('treats an impersonated LLM seat as a user turn via the overlay (Bug 44)', () => {
    // The seat's controlledBy is 'llm'; only impersonatingParticipantIds marks it.
    const impersonated = makeCharacterParticipant('p1', 'char-1')
    const characters = new Map<string, Character>([['char-1', makeCharacter('char-1')]])
    const state = createInitialTurnState()

    // Without the overlay it is an ordinary LLM speaker.
    const llmTurn = selectNextSpeaker([impersonated], characters, state, null)
    expect(llmTurn.reason).toBe('only_character')

    // With the overlay it pauses for the human, without the column moving.
    const userTurn = selectNextSpeaker([impersonated], characters, state, null, ['p1'])
    expect(userTurn.nextSpeakerId).toBe('p1')
    expect(userTurn.reason).toBe('user_turn')
    expect(impersonated.controlledBy).toBe('llm')
  })

  it('single-character all-LLM chat continues in monologue mode', () => {
    const participant = makeCharacterParticipant('p1', 'char-1')
    const characters = new Map<string, Character>([['char-1', makeCharacter('char-1')]])
    const state = { ...createInitialTurnState(), lastSpeakerId: null }

    const selection = selectNextSpeaker([participant], characters, state, null)
    expect(selection.nextSpeakerId).toBe('p1')
    expect(selection.reason).toBe('only_character')

    // With no user participant (all-LLM), single character continues speaking.
    // The 'only_character' path doesn't set cycleComplete — monologue mode
    // never "completes" a rotation in the wrap sense.
    const continueMonologue = selectNextSpeaker([participant], characters, { ...state, lastSpeakerId: 'p1' }, null)
    expect(continueMonologue.nextSpeakerId).toBe('p1')
    expect(continueMonologue.reason).toBe('only_character')
    expect(continueMonologue.cycleComplete).toBe(false)
  })

  it('treats USER and ASSISTANT messages symmetrically when updating turn state', () => {
    // Phase 2: USER messages no longer reset the cycle. A USER message with a
    // participantId (i.e. typed as a user-controlled character) counts as
    // that participant taking their turn; a USER message with no
    // participantId is a no-op.
    const initial = { ...createInitialTurnState(), queue: ['p1'], spokenSinceUserTurn: ['p2'], lastSpeakerId: 'p2' }
    const afterUserNoParticipant = updateTurnStateAfterMessage(initial, makeMessage('m-user', 'USER'), 'persona-1')
    expect(afterUserNoParticipant.spokenSinceUserTurn).toEqual(['p2'])
    expect(afterUserNoParticipant.queue).toEqual(['p1'])

    const afterUserAsCharacter = updateTurnStateAfterMessage(initial, makeMessage('m-user', 'USER', 'u1'), 'u1')
    expect(afterUserAsCharacter.spokenSinceUserTurn).toEqual(['p2', 'u1'])
    expect(afterUserAsCharacter.lastSpeakerId).toBe('u1')

    const afterAssistant = updateTurnStateAfterMessage(afterUserAsCharacter, makeMessage('m-ai', 'ASSISTANT', 'p1'), 'u1')
    expect(afterAssistant.spokenSinceUserTurn).toContain('p1')
    expect(afterAssistant.queue).toEqual([])
    expect(afterAssistant.lastSpeakerId).toBe('p1')
  })

  it('manages queue helpers and exposes explanations', () => {
    const base = createInitialTurnState()
    const withQueue = addToQueue(base, 'p1')
    expect(withQueue.queue).toEqual(['p1'])

    const withoutDuplicate = addToQueue(withQueue, 'p1')
    expect(withoutDuplicate.queue).toEqual(['p1'])

    const removed = removeFromQueue(withQueue, 'p1')
    expect(removed.queue).toEqual([])

    const { state: poppedState, participantId } = popFromQueue({ ...withQueue, queue: ['p1', 'p2'] })
    expect(participantId).toBe('p1')
    expect(poppedState.queue).toEqual(['p2'])

    const nudged = nudgeParticipant({ ...withQueue, queue: ['p1', 'p2'] }, 'p2')
    expect(nudged.queue[0]).toBe('p2')
    expect(getQueuePosition(nudged, 'p2')).toBe(1)

    expect(getSelectionExplanation({ reason: 'queue', nextSpeakerId: 'p1', cycleComplete: false })).toContain('queue')
  })

  it('resets spoken state when user skips their turn without clearing the queue', () => {
    const state = {
      ...createInitialTurnState(),
      queue: ['p1', 'p2'],
      spokenSinceUserTurn: ['p1', 'p2'],
      lastSpeakerId: 'p2',
    }

    const reset = resetCycleForUserSkip(state)
    expect(reset.spokenSinceUserTurn).toEqual([])
    expect(reset.queue).toEqual(['p1', 'p2'])
    expect(reset.lastSpeakerId).toBe('p2')
  })

  it('finds user participant and active characters', () => {
    const userChar = makeUserControlledParticipant('u1', 'char-user')
    const char1 = makeCharacterParticipant('p1', 'char-1')
    const char2 = makeCharacterParticipant('p2', 'char-2', { isActive: false, status: 'absent' })

    expect(findUserParticipant([char1, userChar])).toBe(userChar)
    expect(getActiveCharacterParticipants([char1, char2])).toEqual([char1])
    expect(isMultiCharacterChat([char1, makeCharacterParticipant('p3', 'char-3')])).toBe(true)
  })
})

describe('findActiveUserParticipant (Speaking As)', () => {
  const jackie = makeUserControlledParticipant('u-jackie', 'char-jackie', { displayOrder: 0 })
  const abigail = makeCharacterParticipant('p-abigail', 'char-abigail', { displayOrder: 1 })
  const revenant = makeUserControlledParticipant('u-revenant', 'char-revenant', { displayOrder: 2 })
  const participants = [jackie, abigail, revenant]

  it('honors the active speaker when two characters are user-controlled', () => {
    expect(findActiveUserParticipant(participants, 'u-revenant')).toBe(revenant)
  })

  it('falls back to the first user-controlled participant when no selection', () => {
    expect(findActiveUserParticipant(participants, null)).toBe(jackie)
    expect(findActiveUserParticipant(participants)).toBe(jackie)
  })

  it('falls back when the selected id is not a user-controlled participant', () => {
    // Pointing at the LLM character (Abigail) is not a valid user speaker.
    expect(findActiveUserParticipant(participants, 'p-abigail')).toBe(jackie)
    // Unknown id also falls back.
    expect(findActiveUserParticipant(participants, 'does-not-exist')).toBe(jackie)
  })

  it('ignores a selected speaker who is no longer present', () => {
    const absentRevenant = makeUserControlledParticipant('u-revenant', 'char-revenant', {
      displayOrder: 2,
      status: 'absent',
      isActive: false,
    })
    expect(findActiveUserParticipant([jackie, abigail, absentRevenant], 'u-revenant')).toBe(jackie)
  })

  it('returns null when there are no user-controlled participants', () => {
    expect(findActiveUserParticipant([abigail], 'anything')).toBeNull()
  })

  // Bug 44: "Speak as an AI character" routes through impersonation, which is an
  // OVERLAY — the chosen seat's `controlledBy` stays 'llm'; only the chat's
  // `impersonatingParticipantIds` records it. Attribution must honour the
  // overlaid seat as the active speaker without the column ever moving.
  it('honours an impersonated LLM seat via the overlay, without moving controlledBy', () => {
    const abigailSeat = makeCharacterParticipant('p-abigail', 'char-abigail', { displayOrder: 1 })
    // Without the overlay, selecting the LLM character is not honoured.
    expect(findActiveUserParticipant([jackie, abigailSeat], 'p-abigail')).toBe(jackie)

    // With the seat listed in impersonatingParticipantIds, the SAME still-LLM
    // seat IS honoured as the active speaker.
    expect(findActiveUserParticipant([jackie, abigailSeat], 'p-abigail', ['p-abigail'])).toBe(abigailSeat)
    // The column was never touched.
    expect(abigailSeat.controlledBy).toBe('llm')
  })
})

describe('turn manager rapid sequential messages', () => {
  it('handles rapid sequential messages updating turn state correctly', () => {
    const participants = [
      makeCharacterParticipant('p1', 'char-1'),
      makeCharacterParticipant('p2', 'char-2'),
      makeCharacterParticipant('p3', 'char-3'),
    ]

    // Simulate rapid sequential messages from different participants
    let state = createInitialTurnState()

    // First message
    state = updateTurnStateAfterMessage(state, makeMessage('m1', 'ASSISTANT', 'p1'), null)
    expect(state.spokenSinceUserTurn).toEqual(['p1'])
    expect(state.lastSpeakerId).toBe('p1')

    // Second message immediately after
    state = updateTurnStateAfterMessage(state, makeMessage('m2', 'ASSISTANT', 'p2'), null)
    expect(state.spokenSinceUserTurn).toEqual(['p1', 'p2'])
    expect(state.lastSpeakerId).toBe('p2')

    // Third message immediately after
    state = updateTurnStateAfterMessage(state, makeMessage('m3', 'ASSISTANT', 'p3'), null)
    expect(state.spokenSinceUserTurn).toEqual(['p1', 'p2', 'p3'])
    expect(state.lastSpeakerId).toBe('p3')
  })

  it('does not duplicate participants in spokenSinceUserTurn when same participant speaks multiple times', () => {
    let state = createInitialTurnState()

    // Same participant speaks twice (e.g., via queue nudge)
    state = updateTurnStateAfterMessage(state, makeMessage('m1', 'ASSISTANT', 'p1'), null)
    state = updateTurnStateAfterMessage(state, makeMessage('m2', 'ASSISTANT', 'p1'), null)

    expect(state.spokenSinceUserTurn).toEqual(['p1'])
    expect(state.lastSpeakerId).toBe('p1')
  })

  it('keeps the cycle intact after a participantId-less user interrupt', () => {
    // Phase 2: a bare USER message (no participantId) doesn't disturb turn
    // state. The cycle is only advanced or reset by participant-attributed
    // turns and the cycle-wrap helper.
    let state = createInitialTurnState()

    state = updateTurnStateAfterMessage(state, makeMessage('m1', 'ASSISTANT', 'p1'), null)
    state = updateTurnStateAfterMessage(state, makeMessage('m2', 'ASSISTANT', 'p2'), null)
    state = updateTurnStateAfterMessage(state, makeMessage('m3', 'ASSISTANT', 'p3'), null)

    state = updateTurnStateAfterMessage(state, makeMessage('m-user', 'USER'), 'persona-1')

    expect(state.spokenSinceUserTurn).toEqual(['p1', 'p2', 'p3'])
    expect(state.lastSpeakerId).toBe('p3')
    expect(state.currentTurnParticipantId).toBeNull()
  })
})

describe('turn manager concurrent queue additions', () => {
  it('handles multiple addToQueue calls maintaining order', () => {
    let state = createInitialTurnState()

    // Simulate concurrent-like additions (in practice, these would be sequential)
    state = addToQueue(state, 'p1')
    state = addToQueue(state, 'p2')
    state = addToQueue(state, 'p3')

    expect(state.queue).toEqual(['p1', 'p2', 'p3'])
  })

  it('prevents duplicates when same participant is queued concurrently', () => {
    let state = createInitialTurnState()

    // Multiple attempts to queue same participant
    state = addToQueue(state, 'p1')
    state = addToQueue(state, 'p1')
    state = addToQueue(state, 'p1')

    expect(state.queue).toEqual(['p1'])
  })

  it('maintains queue integrity when mixing addToQueue and nudge operations', () => {
    let state = createInitialTurnState()

    state = addToQueue(state, 'p1')
    state = addToQueue(state, 'p2')
    state = nudgeParticipant(state, 'p3') // p3 goes to front
    state = addToQueue(state, 'p4')

    expect(state.queue).toEqual(['p3', 'p1', 'p2', 'p4'])
  })

  it('handles popFromQueue correctly after concurrent additions', () => {
    let state = createInitialTurnState()

    state = addToQueue(state, 'p1')
    state = addToQueue(state, 'p2')
    state = addToQueue(state, 'p3')

    const pop1 = popFromQueue(state)
    expect(pop1.participantId).toBe('p1')
    expect(pop1.state.queue).toEqual(['p2', 'p3'])

    const pop2 = popFromQueue(pop1.state)
    expect(pop2.participantId).toBe('p2')
    expect(pop2.state.queue).toEqual(['p3'])
  })
})

describe('turn manager participant removal during turn', () => {
  it('removes participant from queue when they are dequeued', () => {
    let state = createInitialTurnState()
    state = addToQueue(state, 'p1')
    state = addToQueue(state, 'p2')

    state = removeFromQueue(state, 'p1')

    expect(state.queue).toEqual(['p2'])
  })

  it('handles removal of participant who is not in queue gracefully', () => {
    let state = createInitialTurnState()
    state = addToQueue(state, 'p1')

    state = removeFromQueue(state, 'p-nonexistent')

    expect(state.queue).toEqual(['p1'])
  })

  it('correctly selects next speaker when active participant is removed mid-cycle', () => {
    const participants = [
      makeCharacterParticipant('p1', 'char-1'),
      makeCharacterParticipant('p2', 'char-2'),
      makeCharacterParticipant('p3', 'char-3', { isActive: false, status: 'absent' }), // Simulating removal by setting inactive
    ]
    const characters = new Map<string, Character>([
      ['char-1', makeCharacter('char-1')],
      ['char-2', makeCharacter('char-2')],
      ['char-3', makeCharacter('char-3')],
    ])
    const turnState = { ...createInitialTurnState(), spokenSinceUserTurn: ['p1'], lastSpeakerId: 'p1' }

    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5)
    const selection = selectNextSpeaker(participants, characters, turnState, null)
    randomSpy.mockRestore()

    // p3 is inactive, so only p2 is eligible
    expect(selection.nextSpeakerId).toBe('p2')
    expect(selection.debug?.eligibleSpeakers).toEqual(['p2'])
  })

  it('returns user turn when all remaining participants become inactive', () => {
    const participants = [
      makeCharacterParticipant('p1', 'char-1', { isActive: false, status: 'absent' }),
      makeCharacterParticipant('p2', 'char-2', { isActive: false, status: 'absent' }),
    ]
    const characters = new Map<string, Character>([
      ['char-1', makeCharacter('char-1')],
      ['char-2', makeCharacter('char-2')],
    ])
    const turnState = createInitialTurnState()

    const selection = selectNextSpeaker(participants, characters, turnState, null)

    expect(selection.nextSpeakerId).toBeNull()
    expect(selection.reason).toBe('user_turn')
    expect(selection.cycleComplete).toBe(true)
  })
})

describe('turn manager talkativeness extremes', () => {
  it('never selects character with talkativeness 0 through weighted selection', () => {
    const participants = [
      makeCharacterParticipant('p1', 'char-1'),
      makeCharacterParticipant('p2', 'char-2'),
    ]
    const characters = new Map<string, Character>([
      ['char-1', makeCharacter('char-1', { talkativeness: 0 })],
      ['char-2', makeCharacter('char-2', { talkativeness: 0.5 })],
    ])
    const turnState = createInitialTurnState()

    // Run multiple times to verify p1 (talkativeness 0) is never selected
    for (let i = 0; i < 10; i++) {
      const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(i / 10)
      const selection = selectNextSpeaker(participants, characters, turnState, null)
      randomSpy.mockRestore()

      expect(selection.nextSpeakerId).toBe('p2')
    }
  })

  it('always selects character with talkativeness 1 over lower values when eligible', () => {
    const participants = [
      makeCharacterParticipant('p1', 'char-1'),
      makeCharacterParticipant('p2', 'char-2'),
    ]
    const characters = new Map<string, Character>([
      ['char-1', makeCharacter('char-1', { talkativeness: 0.1 })],
      ['char-2', makeCharacter('char-2', { talkativeness: 1 })],
    ])
    const turnState = createInitialTurnState()

    // With random value high enough, p2 should be selected due to higher weight
    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5)
    const selection = selectNextSpeaker(participants, characters, turnState, null)
    randomSpy.mockRestore()

    // p2 has weight 1, p1 has weight 0.1, total = 1.1
    // Random 0.5 * 1.1 = 0.55, cumulative for p1 = 0.1, cumulative for p2 = 1.1
    // 0.55 > 0.1, so p2 is selected
    expect(selection.nextSpeakerId).toBe('p2')
  })

  it('uses equal weights when all participants have talkativeness 0', () => {
    const participants = [
      makeCharacterParticipant('p1', 'char-1'),
      makeCharacterParticipant('p2', 'char-2'),
    ]
    const characters = new Map<string, Character>([
      ['char-1', makeCharacter('char-1', { talkativeness: 0 })],
      ['char-2', makeCharacter('char-2', { talkativeness: 0 })],
    ])
    const turnState = createInitialTurnState()

    // When all weights are 0, the system falls back to equal weights (1 each)
    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.25)
    const selection = selectNextSpeaker(participants, characters, turnState, null)
    randomSpy.mockRestore()

    // With equal weights, random 0.25 * 2 = 0.5, cumulative p1 = 1
    // 0.5 < 1, so p1 is selected
    expect(selection.nextSpeakerId).toBe('p1')
    expect(selection.reason).toBe('weighted_selection')
  })

  it('can still queue character with talkativeness 0', () => {
    const participants = [
      makeCharacterParticipant('p1', 'char-1'),
      makeCharacterParticipant('p2', 'char-2'),
    ]
    const characters = new Map<string, Character>([
      ['char-1', makeCharacter('char-1', { talkativeness: 0 })],
      ['char-2', makeCharacter('char-2', { talkativeness: 0.5 })],
    ])
    const turnState = { ...createInitialTurnState(), queue: ['p1'] }

    const selection = selectNextSpeaker(participants, characters, turnState, null)

    // Queue bypasses talkativeness weighting
    expect(selection.nextSpeakerId).toBe('p1')
    expect(selection.reason).toBe('queue')
  })
})

describe('turn manager edge cases', () => {
  describe('empty queue', () => {
    it('returns null participantId when popping from empty queue', () => {
      const state = createInitialTurnState()
      const { participantId, state: newState } = popFromQueue(state)

      expect(participantId).toBeNull()
      expect(newState.queue).toEqual([])
      expect(newState).toBe(state) // Should return same reference when empty
    })

    it('getQueuePosition returns 0 for participant not in queue', () => {
      const state = createInitialTurnState()

      expect(getQueuePosition(state, 'p1')).toBe(0)
      expect(getQueuePosition(state, 'nonexistent')).toBe(0)
    })
  })

  describe('single participant', () => {
    it('a single LLM character runs monologue regardless of user-participant hint', () => {
      // Phase 2: with only one LLM CHARACTER participant in the chat, the
      // rotation degenerates into monologue mode. Whether or not a user
      // participant exists somewhere outside the participant list, the next
      // speaker is always that one character.
      const participant = makeCharacterParticipant('p1', 'char-1')
      const characters = new Map<string, Character>([['char-1', makeCharacter('char-1')]])

      let state = createInitialTurnState()
      let selection = selectNextSpeaker([participant], characters, state, 'user-1')
      expect(selection.nextSpeakerId).toBe('p1')
      expect(selection.reason).toBe('only_character')

      state = updateTurnStateAfterMessage(state, makeMessage('m1', 'ASSISTANT', 'p1'), 'user-1')
      selection = selectNextSpeaker([participant], characters, state, 'user-1')
      expect(selection.nextSpeakerId).toBe('p1')
      expect(selection.reason).toBe('only_character')
    })

    it('single inactive character results in user turn', () => {
      const participant = makeCharacterParticipant('p1', 'char-1', { isActive: false, status: 'absent' })
      const characters = new Map<string, Character>([['char-1', makeCharacter('char-1')]])
      const state = createInitialTurnState()

      const selection = selectNextSpeaker([participant], characters, state, null)

      expect(selection.nextSpeakerId).toBeNull()
      expect(selection.reason).toBe('user_turn')
    })
  })

  describe('all participants inactive', () => {
    it('returns user turn when all character participants are inactive', () => {
      const participants = [
        makeCharacterParticipant('p1', 'char-1', { isActive: false, status: 'absent' }),
        makeCharacterParticipant('p2', 'char-2', { isActive: false, status: 'absent' }),
        makeCharacterParticipant('p3', 'char-3', { isActive: false, status: 'absent' }),
      ]
      const characters = new Map<string, Character>([
        ['char-1', makeCharacter('char-1')],
        ['char-2', makeCharacter('char-2')],
        ['char-3', makeCharacter('char-3')],
      ])
      const state = createInitialTurnState()

      const selection = selectNextSpeaker(participants, characters, state, null)

      expect(selection.nextSpeakerId).toBeNull()
      expect(selection.reason).toBe('user_turn')
      expect(selection.cycleComplete).toBe(true)
    })

    it('handles mixed active/inactive with only user-controlled active', () => {
      // Phase 2: a single active user-controlled character is still the only
      // viable next speaker; the selection surfaces their participantId with
      // reason 'user_turn' so the UI can label the pause.
      const participants = [
        makeCharacterParticipant('p1', 'char-1', { isActive: false, status: 'absent' }),
        makeUserControlledParticipant('u1', 'char-user'),
      ]
      const characters = new Map<string, Character>([['char-1', makeCharacter('char-1')]])
      const state = createInitialTurnState()

      const selection = selectNextSpeaker(participants, characters, state, 'u1')

      expect(selection.nextSpeakerId).toBe('u1')
      expect(selection.reason).toBe('user_turn')
    })
  })

  describe('empty participants list', () => {
    it('returns user turn with no participants', () => {
      const characters = new Map<string, Character>()
      const state = createInitialTurnState()

      const selection = selectNextSpeaker([], characters, state, null)

      expect(selection.nextSpeakerId).toBeNull()
      expect(selection.reason).toBe('user_turn')
      expect(selection.cycleComplete).toBe(true)
    })

    it('calculateTurnStateFromHistory handles empty messages', () => {
      const state = calculateTurnStateFromHistory({
        messages: [],
        participants: [],
        userParticipantId: null,
      })

      expect(state.spokenSinceUserTurn).toEqual([])
      expect(state.lastSpeakerId).toBeNull()
      expect(state.queue).toEqual([])
    })
  })

  describe('missing character data', () => {
    it('uses default talkativeness when character not found in map', () => {
      const participants = [
        makeCharacterParticipant('p1', 'char-1'),
        makeCharacterParticipant('p2', 'char-2'),
      ]
      // Only one character in map, other is missing
      const characters = new Map<string, Character>([
        ['char-1', makeCharacter('char-1', { talkativeness: 0.8 })],
        // char-2 is missing - should use default 0.5
      ])
      const turnState = createInitialTurnState()

      const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.99)
      const selection = selectNextSpeaker(participants, characters, turnState, null)
      randomSpy.mockRestore()

      // Both should be eligible, using weights 0.8 and 0.5 (default)
      expect(selection.debug?.weights).toEqual({ 'p1': 0.8, 'p2': 0.5 })
    })
  })
})

describe('per-chat talkativeness override', () => {
  it('participant.talkativeness wins over character.talkativeness in weighted selection', () => {
    // Friday character has talkativeness 0.5; bump her participant override to 0.95.
    // Amy character has 0.5; leave her override null.
    // After enough trials, Friday should win the lion's share.
    const friday = makeCharacterParticipant('p1', 'char-1', { talkativeness: 0.95 })
    const amy = makeCharacterParticipant('p2', 'char-2')  // no override
    const participants = [friday, amy]
    const characters = new Map<string, Character>([
      ['char-1', makeCharacter('char-1', { talkativeness: 0.5 })],
      ['char-2', makeCharacter('char-2', { talkativeness: 0.5 })],
    ])
    const turnState = createInitialTurnState()

    let fridayWins = 0
    for (let i = 0; i < 200; i++) {
      const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(i / 200)
      const selection = selectNextSpeaker(participants, characters, turnState, null)
      randomSpy.mockRestore()
      if (selection.nextSpeakerId === 'p1') fridayWins++
    }
    // With weights 0.95 vs 0.5 (total 1.45), Friday's share is ~65.5%. Allow
    // ±5pp wiggle room for the deterministic random spy sweep.
    expect(fridayWins / 200).toBeGreaterThan(0.6)
    expect(fridayWins / 200).toBeLessThan(0.72)
  })

  it('null override falls through to the character value', () => {
    // Confirm the fallback chain: participant null → character 0.8.
    const participants = [
      makeCharacterParticipant('p1', 'char-1'),  // no override
      makeCharacterParticipant('p2', 'char-2'),  // no override
    ]
    const characters = new Map<string, Character>([
      ['char-1', makeCharacter('char-1', { talkativeness: 0.2 })],
      ['char-2', makeCharacter('char-2', { talkativeness: 0.8 })],
    ])
    const turnState = createInitialTurnState()

    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5)
    const selection = selectNextSpeaker(participants, characters, turnState, null)
    randomSpy.mockRestore()

    // 0.5 * (0.2 + 0.8) = 0.5; cumulative for p1 = 0.2 < 0.5, so p2 picked.
    expect(selection.nextSpeakerId).toBe('p2')
    expect(selection.debug?.weights).toEqual({ p1: 0.2, p2: 0.8 })
  })
})

describe('computeSpokenThisCycleAfterMessage', () => {
  const participants = [
    makeCharacterParticipant('p1', 'char-1'),
    makeCharacterParticipant('p2', 'char-2'),
    makeCharacterParticipant('p3', 'char-3'),
  ]

  it('returns null for non-turn messages', () => {
    const sys: MessageEvent = {
      type: 'message',
      id: 'm1',
      role: 'SYSTEM',
      content: 'system',
      attachments: [],
      createdAt: now,
      participantId: null,
    }
    expect(computeSpokenThisCycleAfterMessage(sys, participants, '[]')).toBeNull()
  })

  it('returns null for messages with no participantId', () => {
    const noPid = makeMessage('m', 'ASSISTANT', null)
    expect(computeSpokenThisCycleAfterMessage(noPid, participants, '[]')).toBeNull()
  })

  it('returns null for whisper messages', () => {
    const whisper: MessageEvent = {
      type: 'message',
      id: 'm1',
      role: 'ASSISTANT',
      content: 'hi',
      attachments: [],
      createdAt: now,
      participantId: 'p1',
      targetParticipantIds: ['p2'],
    }
    expect(computeSpokenThisCycleAfterMessage(whisper, participants, '[]')).toBeNull()
  })

  it('appends a new speaker to the cycle', () => {
    const msg = makeMessage('m', 'ASSISTANT', 'p1')
    const result = computeSpokenThisCycleAfterMessage(msg, participants, '[]')
    expect(result).not.toBeNull()
    expect(JSON.parse(result!)).toEqual(['p1'])
  })

  it('returns null when the speaker is already in the cycle and no wrap is triggered', () => {
    const msg = makeMessage('m', 'ASSISTANT', 'p1')
    const result = computeSpokenThisCycleAfterMessage(msg, participants, JSON.stringify(['p1']))
    expect(result).toBeNull()
  })

  it('wraps the cycle when every active participant has now spoken', () => {
    // 3 active participants, persisted spoken = [p1, p2]; this message is p3.
    // After append, [p1, p2, p3] equals the active set — wrap to [p3].
    const msg = makeMessage('m', 'ASSISTANT', 'p3')
    const result = computeSpokenThisCycleAfterMessage(msg, participants, JSON.stringify(['p1', 'p2']))
    expect(result).not.toBeNull()
    expect(JSON.parse(result!)).toEqual(['p3'])
  })

  it('tolerates malformed persisted JSON by treating the cycle as empty', () => {
    const msg = makeMessage('m', 'ASSISTANT', 'p1')
    const result = computeSpokenThisCycleAfterMessage(msg, participants, 'not-json')
    expect(result).not.toBeNull()
    expect(JSON.parse(result!)).toEqual(['p1'])
  })

  it('counts user-controlled participants when checking cycle completion', () => {
    const mixed = [
      makeCharacterParticipant('p1', 'char-1'),
      makeUserControlledParticipant('u1', 'char-user'),
    ]
    const msg = makeMessage('m', 'USER', 'u1')
    const result = computeSpokenThisCycleAfterMessage(msg, mixed, JSON.stringify(['p1']))
    // [p1, u1] = full active set → wrap to [u1].
    expect(JSON.parse(result!)).toEqual(['u1'])
  })
})

describe('computeSpokenThisCycleAfterSkip', () => {
  const participants = [
    makeCharacterParticipant('p1', 'char-1'),
    makeUserControlledParticipant('u1', 'char-user'),
  ]

  it('appends the skipped user participant to the cycle', () => {
    const result = computeSpokenThisCycleAfterSkip('u1', participants, '[]')
    expect(JSON.parse(result!)).toEqual(['u1'])
  })

  it('returns null when the user participant is already recorded', () => {
    const result = computeSpokenThisCycleAfterSkip('u1', participants, JSON.stringify(['u1']))
    expect(result).toBeNull()
  })

  it('wraps the cycle when the skip completes the active set', () => {
    const result = computeSpokenThisCycleAfterSkip('u1', participants, JSON.stringify(['p1']))
    expect(JSON.parse(result!)).toEqual(['u1'])
  })
})
