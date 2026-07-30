/**
 * @jest-environment node
 */

/**
 * Send-message request helpers.
 *
 * These builders exist for exactly one reason: two POST routes
 * (`/api/v1/messages?chatId=` and `/api/v1/chats/[id]/messages`) must forward
 * an identical field set to `handleSendMessage`. A field silently dropped here
 * is a feature that works from one entrance and not the other, which is why
 * these tests assert the whole forwarded shape rather than spot-checking keys.
 */

import {
  buildSendMessageOptions,
  buildContinueMessageOptions,
  sseStreamResponse,
} from '@/lib/services/chat-message/request-helpers'

describe('buildSendMessageOptions', () => {
  it('forwards every send field and pins continueMode off', () => {
    const parsed = {
      content: 'Good evening.',
      fileIds: ['file-1', 'file-2'],
      pendingToolResults: [{ toolCallId: 'tc-1', result: 'ok' }],
      targetParticipantIds: ['p-1'],
      speakingAsParticipantId: 'p-9',
    } as never

    expect(buildSendMessageOptions(parsed, { browserUserAgent: 'Firefox/1' })).toEqual({
      content: 'Good evening.',
      fileIds: ['file-1', 'file-2'],
      pendingToolResults: [{ toolCallId: 'tc-1', result: 'ok' }],
      targetParticipantIds: ['p-1'],
      speakingAsParticipantId: 'p-9',
      continueMode: false,
      browserUserAgent: 'Firefox/1',
    })
  })

  it('leaves the user agent undefined when no extras are supplied', () => {
    const options = buildSendMessageOptions({ content: 'hi' } as never)

    expect(options.browserUserAgent).toBeUndefined()
    expect(options.continueMode).toBe(false)
  })

  it('carries an explicitly empty targetParticipantIds through rather than dropping it', () => {
    // An empty array means "addressed to nobody in particular"; undefined means
    // "the route never said". Collapsing the two would change routing.
    const options = buildSendMessageOptions({ content: 'hi', targetParticipantIds: [] } as never)

    expect(options.targetParticipantIds).toEqual([])
  })
})

describe('buildContinueMessageOptions', () => {
  it('forwards every continue field and pins continueMode on', () => {
    const parsed = {
      respondingParticipantId: 'p-3',
      speakingAsParticipantId: 'p-4',
      nudge: 'Say more about the cellar.',
    } as never

    expect(buildContinueMessageOptions(parsed, { browserUserAgent: 'Safari/2' })).toEqual({
      continueMode: true,
      respondingParticipantId: 'p-3',
      speakingAsParticipantId: 'p-4',
      nudge: 'Say more about the cellar.',
      browserUserAgent: 'Safari/2',
    })
  })

  it('never carries send-only fields into a continue', () => {
    const options = buildContinueMessageOptions({ respondingParticipantId: 'p-3' } as never)

    expect(options).not.toHaveProperty('content')
    expect(options).not.toHaveProperty('fileIds')
    expect(options).not.toHaveProperty('targetParticipantIds')
  })
})

describe('sseStreamResponse', () => {
  it('sets the three headers an EventSource needs', () => {
    const response = sseStreamResponse(new ReadableStream<Uint8Array>())

    expect(response.headers.get('Content-Type')).toBe('text/event-stream')
    expect(response.headers.get('Cache-Control')).toBe('no-cache')
    expect(response.headers.get('Connection')).toBe('keep-alive')
  })

  it('gives each response its own header bag', () => {
    // The module holds SSE_HEADERS as a shared const; if it were passed by
    // reference, mutating one response's headers would poison the next.
    const first = sseStreamResponse(new ReadableStream<Uint8Array>())
    first.headers.set('Cache-Control', 'max-age=60')

    const second = sseStreamResponse(new ReadableStream<Uint8Array>())
    expect(second.headers.get('Cache-Control')).toBe('no-cache')
  })
})
