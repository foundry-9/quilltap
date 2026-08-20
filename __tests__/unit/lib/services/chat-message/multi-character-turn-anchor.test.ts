/**
 * Unit tests for the multi-character turn anchor.
 *
 * Every reply in a multi-character chat is anchored to the character whose
 * turn it is, by one of two routes chosen per connection profile: the
 * assistant `[Name]` prefill, or a prose instruction appended to the system
 * message. Until 4.9 the route was hardcoded by provider (Anthropic prose,
 * everything else prefill); see bug 68 for why that was wrong for Ollama.
 */

import {
  applyMultiCharacterTurnAnchor,
  GROUP_SCENE_DISCIPLINE,
} from '@/lib/services/chat-message/context-builder.service'

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: jest.fn(() => ({
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}))

function baseMessages() {
  return [
    { role: 'system', content: 'You are Marie.' },
    { role: 'user', content: '[Charlie] *I nod and wait.*' },
  ]
}

describe('applyMultiCharacterTurnAnchor — prefill route', () => {
  it('appends an assistant message opening the turn with [Name]', () => {
    const messages = baseMessages()
    applyMultiCharacterTurnAnchor(messages, 'Marie', true)

    expect(messages).toHaveLength(3)
    expect(messages[2]).toEqual({
      role: 'assistant',
      content: '[Marie]',
      thoughtSignature: undefined,
      name: undefined,
    })
  })

  it('appends the group-scene discipline but not the identity instruction to the system message', () => {
    // Identity is anchored structurally by the [Name] prefill; the content
    // rules still have to ride in the system prompt.
    const messages = baseMessages()
    applyMultiCharacterTurnAnchor(messages, 'Marie', true)

    expect(messages[0].content).toMatch(/^You are Marie\./)
    expect(messages[0].content).toContain('GROUP-SCENE DISCIPLINE')
    expect(messages[0].content).not.toContain('Respond as Marie and ONLY Marie')
  })

  it('still pushes the prefill anchor when there is no system message', () => {
    const messages = [{ role: 'user', content: 'Hello' }]
    applyMultiCharacterTurnAnchor(messages, 'Marie', true)

    expect(messages).toHaveLength(2)
    expect(messages[1]).toMatchObject({ role: 'assistant', content: '[Marie]' })
  })
})

describe('applyMultiCharacterTurnAnchor — prose route', () => {
  it('adds no message, so the request still ends on the user turn', () => {
    // The load-bearing property for Anthropic 4.6+, which rejects a request
    // whose final message is role=assistant, and for Ollama, whose thinking
    // block is opened by the chat template at the start of the assistant turn.
    const messages = baseMessages()
    applyMultiCharacterTurnAnchor(messages, 'Marie', false)

    expect(messages).toHaveLength(2)
    expect(messages[messages.length - 1].role).toBe('user')
  })

  it('appends the identity instruction to the system message', () => {
    const messages = baseMessages()
    applyMultiCharacterTurnAnchor(messages, 'Marie', false)

    expect(messages[0].content).toMatch(/^You are Marie\./)
    expect(messages[0].content).toContain('multi-character scene')
    expect(messages[0].content).toContain('Respond as Marie and ONLY Marie')
  })

  it('appends the group-scene discipline after the identity instruction', () => {
    const messages = baseMessages()
    applyMultiCharacterTurnAnchor(messages, 'Marie', false)

    const content = messages[0].content
    expect(content).toContain('GROUP-SCENE DISCIPLINE')
    expect(content.indexOf('GROUP-SCENE DISCIPLINE')).toBeGreaterThan(
      content.indexOf('Respond as Marie and ONLY Marie')
    )
  })

  it('keeps the discipline block free of anything a weaker model could parrot as a speaker tag', () => {
    expect(GROUP_SCENE_DISCIPLINE).not.toMatch(/\[[A-Z][a-z]+\]/)
  })

  it('never teaches the model to emit a [Name] tag of its own', () => {
    // Telling it to emit "[Marie] …" would contradict the always-on Identity
    // Reminder and hand weaker models the screenplay format they run away
    // with, writing the whole cast's turns.
    const messages = baseMessages()
    applyMultiCharacterTurnAnchor(messages, 'Marie', false)

    expect(messages[0].content).not.toContain('[Marie]')
  })

  it('is a no-op when there is no system message to append to', () => {
    const messages = [{ role: 'user', content: 'Hello' }]
    applyMultiCharacterTurnAnchor(messages, 'Marie', false)

    expect(messages).toEqual([{ role: 'user', content: 'Hello' }])
  })
})
