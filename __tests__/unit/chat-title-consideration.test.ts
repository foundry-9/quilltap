/**
 * Unit tests for chat title consideration functionality
 */

import { calculateInterchangeCount, shouldCheckTitleAtInterchange } from '@/lib/chat/context-summary'

describe('calculateInterchangeCount', () => {
  it('should calculate interchanges correctly for balanced messages', () => {
    const messages = [
      { role: 'USER', type: 'message' },
      { role: 'ASSISTANT', type: 'message' },
      { role: 'USER', type: 'message' },
      { role: 'ASSISTANT', type: 'message' },
    ]
    expect(calculateInterchangeCount(messages)).toBe(2)
  })

  it('should handle unbalanced messages (more user messages)', () => {
    const messages = [
      { role: 'USER', type: 'message' },
      { role: 'ASSISTANT', type: 'message' },
      { role: 'USER', type: 'message' },
    ]
    expect(calculateInterchangeCount(messages)).toBe(1)
  })

  it('should handle unbalanced messages (more assistant messages)', () => {
    const messages = [
      { role: 'USER', type: 'message' },
      { role: 'ASSISTANT', type: 'message' },
      { role: 'ASSISTANT', type: 'message' },
    ]
    expect(calculateInterchangeCount(messages)).toBe(1)
  })

  it('should ignore non-message types', () => {
    const messages = [
      { role: 'USER', type: 'message' },
      { role: 'ASSISTANT', type: 'message' },
      { type: 'context-summary' },
      { type: 'tool-result' },
      { role: 'USER', type: 'message' },
      { role: 'ASSISTANT', type: 'message' },
    ]
    expect(calculateInterchangeCount(messages)).toBe(2)
  })

  it('should handle case-insensitive roles', () => {
    const messages = [
      { role: 'user', type: 'message' },
      { role: 'assistant', type: 'message' },
      { role: 'User', type: 'message' },
      { role: 'Assistant', type: 'message' },
    ]
    expect(calculateInterchangeCount(messages)).toBe(2)
  })

  it('should return 0 for empty messages', () => {
    expect(calculateInterchangeCount([])).toBe(0)
  })
})

describe('shouldCheckTitleAtInterchange', () => {
  it('should not check at interchange 0 or 1', () => {
    expect(shouldCheckTitleAtInterchange(0, 0)).toBe(false)
    expect(shouldCheckTitleAtInterchange(1, 0)).toBe(false)
  })

  it('should check at early checkpoints: 2, 3, 5, 7, 10', () => {
    expect(shouldCheckTitleAtInterchange(2, 0)).toBe(true)
    expect(shouldCheckTitleAtInterchange(3, 0)).toBe(true)
    expect(shouldCheckTitleAtInterchange(5, 0)).toBe(true)
    expect(shouldCheckTitleAtInterchange(7, 0)).toBe(true)
    expect(shouldCheckTitleAtInterchange(10, 0)).toBe(true)
  })

  it('should not check at non-checkpoint interchanges', () => {
    expect(shouldCheckTitleAtInterchange(4, 0)).toBe(false)
    expect(shouldCheckTitleAtInterchange(6, 0)).toBe(false)
    expect(shouldCheckTitleAtInterchange(8, 0)).toBe(false)
    expect(shouldCheckTitleAtInterchange(9, 0)).toBe(false)
  })

  it('should check every 10 interchanges after 10', () => {
    expect(shouldCheckTitleAtInterchange(20, 10)).toBe(true)
    expect(shouldCheckTitleAtInterchange(30, 20)).toBe(true)
    expect(shouldCheckTitleAtInterchange(40, 30)).toBe(true)
    expect(shouldCheckTitleAtInterchange(100, 90)).toBe(true)
  })

  it('should not check if already checked at this interchange', () => {
    expect(shouldCheckTitleAtInterchange(2, 2)).toBe(false)
    expect(shouldCheckTitleAtInterchange(5, 5)).toBe(false)
    expect(shouldCheckTitleAtInterchange(10, 10)).toBe(false)
    expect(shouldCheckTitleAtInterchange(20, 20)).toBe(false)
  })

  it('should not check if last check was at a higher interchange', () => {
    expect(shouldCheckTitleAtInterchange(3, 5)).toBe(false)
    expect(shouldCheckTitleAtInterchange(7, 10)).toBe(false)
  })

  it('should skip early checkpoints if already past them', () => {
    expect(shouldCheckTitleAtInterchange(2, 3)).toBe(false)
    expect(shouldCheckTitleAtInterchange(5, 7)).toBe(false)
  })
})
