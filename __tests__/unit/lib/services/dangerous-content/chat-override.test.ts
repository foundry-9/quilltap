/**
 * Tests for lib/services/dangerous-content/chat-override.ts
 *
 * Covers the full 4-state truth table across both stored fields, including
 * both operator overrides with the preserved isDangerousChat label in each
 * position (the label must not leak into any predicate).
 */

import {
  getConciergeState,
  shouldUseUncensoredRoute,
  shouldShowDangerStyling,
  isClassifierOnDuty,
} from '@/lib/services/dangerous-content/chat-override'

type Case = {
  conciergeOverride: 'OFF' | 'UNCENSORED' | null
  isDangerousChat: boolean | null
}

// The full stored-field truth table and the expected derivations.
const TABLE: Array<{
  chat: Case
  state: 'monitored' | 'flagged' | 'vouched' | 'uncensored'
  uncensoredRoute: boolean
  dangerStyling: boolean
  classifierOnDuty: boolean
}> = [
  { chat: { conciergeOverride: null, isDangerousChat: false }, state: 'monitored', uncensoredRoute: false, dangerStyling: false, classifierOnDuty: true },
  { chat: { conciergeOverride: null, isDangerousChat: null }, state: 'monitored', uncensoredRoute: false, dangerStyling: false, classifierOnDuty: true },
  { chat: { conciergeOverride: null, isDangerousChat: true }, state: 'flagged', uncensoredRoute: true, dangerStyling: true, classifierOnDuty: true },
  { chat: { conciergeOverride: 'OFF', isDangerousChat: false }, state: 'vouched', uncensoredRoute: false, dangerStyling: false, classifierOnDuty: false },
  { chat: { conciergeOverride: 'OFF', isDangerousChat: true }, state: 'vouched', uncensoredRoute: false, dangerStyling: false, classifierOnDuty: false },
  { chat: { conciergeOverride: 'UNCENSORED', isDangerousChat: false }, state: 'uncensored', uncensoredRoute: true, dangerStyling: false, classifierOnDuty: false },
  { chat: { conciergeOverride: 'UNCENSORED', isDangerousChat: true }, state: 'uncensored', uncensoredRoute: true, dangerStyling: false, classifierOnDuty: false },
]

describe('getConciergeState', () => {
  it("returns 'monitored' for null/undefined chat", () => {
    expect(getConciergeState(null)).toBe('monitored')
    expect(getConciergeState(undefined)).toBe('monitored')
  })

  it("returns 'monitored' when both fields are absent", () => {
    expect(getConciergeState({})).toBe('monitored')
  })

  it.each(TABLE)('derives $state from (override=$chat.conciergeOverride, dangerous=$chat.isDangerousChat)', ({ chat, state }) => {
    expect(getConciergeState(chat)).toBe(state)
  })
})

describe('shouldUseUncensoredRoute', () => {
  it('returns false for null/undefined chat', () => {
    expect(shouldUseUncensoredRoute(null)).toBe(false)
    expect(shouldUseUncensoredRoute(undefined)).toBe(false)
  })

  it.each(TABLE)('returns $uncensoredRoute for $state (override=$chat.conciergeOverride, dangerous=$chat.isDangerousChat)', ({ chat, uncensoredRoute }) => {
    expect(shouldUseUncensoredRoute(chat)).toBe(uncensoredRoute)
  })
})

describe('shouldShowDangerStyling', () => {
  it('returns false for null/undefined chat', () => {
    expect(shouldShowDangerStyling(null)).toBe(false)
    expect(shouldShowDangerStyling(undefined)).toBe(false)
  })

  it.each(TABLE)('returns $dangerStyling for $state (override=$chat.conciergeOverride, dangerous=$chat.isDangerousChat)', ({ chat, dangerStyling }) => {
    expect(shouldShowDangerStyling(chat)).toBe(dangerStyling)
  })

  it('paints danger styling only when the Concierge himself flagged the chat', () => {
    // The two predicates diverge exactly on 'uncensored': routed uncensored,
    // never painted as a hazard.
    for (const { chat, state } of TABLE) {
      if (state === 'uncensored') {
        expect(shouldUseUncensoredRoute(chat)).toBe(true)
        expect(shouldShowDangerStyling(chat)).toBe(false)
      }
    }
  })
})

describe('isClassifierOnDuty', () => {
  it('returns true for null/undefined chat (nothing has taken the classifier off the case)', () => {
    expect(isClassifierOnDuty(null)).toBe(true)
    expect(isClassifierOnDuty(undefined)).toBe(true)
  })

  it.each(TABLE)('returns $classifierOnDuty for $state (override=$chat.conciergeOverride, dangerous=$chat.isDangerousChat)', ({ chat, classifierOnDuty }) => {
    expect(isClassifierOnDuty(chat)).toBe(classifierOnDuty)
  })
})
