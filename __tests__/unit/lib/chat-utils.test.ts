/**
 * The two ChatCard transforms.
 *
 * Both list surfaces receive different chat shapes from the API and both must
 * hand the card the *derived* Concierge state rather than the raw danger label
 * — the card's mark and Quick-hide's rule both read it, and reading the label
 * would put a red asterisk on a chat the operator vouched safe.
 */

import {
  transformSalonChatToCardData,
  transformCharacterChatToCardData,
  type SalonChatShape,
  type CharacterChatShape,
} from '@/lib/chat-utils'
import type { ConciergeState } from '@/lib/services/dangerous-content/chat-override'

const ALL_STATES: ConciergeState[] = ['monitored', 'flagged', 'vouched', 'uncensored']

function salonChat(over: Partial<SalonChatShape> = {}): SalonChatShape {
  return {
    id: 'chat-1',
    title: 'A Conversation',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    participants: [],
    tags: [],
    project: null,
    storyBackground: null,
    _count: { messages: 4 },
    ...over,
  }
}

function characterChat(over: Partial<CharacterChatShape> = {}): CharacterChatShape {
  return {
    id: 'chat-1',
    title: 'A Conversation',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    messages: [],
    ...over,
  }
}

describe('transformSalonChatToCardData', () => {
  it.each(ALL_STATES)('passes the %s state straight through', (conciergeState) => {
    expect(transformSalonChatToCardData(salonChat({ conciergeState })).conciergeState).toBe(conciergeState)
  })

  it("carries the classifier's categories for the mark's tooltip", () => {
    const card = transformSalonChatToCardData(salonChat({
      conciergeState: 'flagged',
      dangerCategories: ['NSFW', 'Violence'],
    }))

    expect(card.dangerCategories).toEqual(['NSFW', 'Violence'])
  })

  it('leaves both fields undefined when the payload omits them', () => {
    const card = transformSalonChatToCardData(salonChat())

    expect(card.conciergeState).toBeUndefined()
    expect(card.dangerCategories).toBeUndefined()
  })

  it('never puts a raw danger label on the card', () => {
    expect(transformSalonChatToCardData(salonChat({ conciergeState: 'vouched' })))
      .not.toHaveProperty('isDangerousChat')
  })
})

describe('transformCharacterChatToCardData', () => {
  it.each(ALL_STATES)('passes the %s state straight through', (conciergeState) => {
    expect(transformCharacterChatToCardData(characterChat({ conciergeState })).conciergeState).toBe(conciergeState)
  })

  it("carries the classifier's categories for the mark's tooltip", () => {
    const card = transformCharacterChatToCardData(characterChat({
      conciergeState: 'flagged',
      dangerCategories: ['Self-harm'],
    }))

    expect(card.dangerCategories).toEqual(['Self-harm'])
  })

  it('leaves both fields undefined when the payload omits them', () => {
    const card = transformCharacterChatToCardData(characterChat())

    expect(card.conciergeState).toBeUndefined()
    expect(card.dangerCategories).toBeUndefined()
  })

  it('never puts a raw danger label on the card', () => {
    expect(transformCharacterChatToCardData(characterChat({ conciergeState: 'uncensored' })))
      .not.toHaveProperty('isDangerousChat')
  })
})
