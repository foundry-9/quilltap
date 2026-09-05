/**
 * Bug 93: a provider that refuses on content grounds says so in its finish
 * reason and returns empty content. Quilltap had no branch for any of those
 * strings, so the Salon showed a blank message under "try resending" copy —
 * advice that cannot work for a moderation stop.
 */

import {
  isModerationFinishReason,
  describeModerationRefusal,
} from '@/lib/llm/moderation-finish-reason'

describe('isModerationFinishReason', () => {
  it('recognises each provider dialect', () => {
    // The one observed in the wild: Z.AI glm-5v-turbo on an image it declined.
    expect(isModerationFinishReason('sensitive')).toBe(true)
    expect(isModerationFinishReason('content_filter')).toBe(true)
    expect(isModerationFinishReason('refusal')).toBe(true)
    expect(isModerationFinishReason('SAFETY')).toBe(true)
    expect(isModerationFinishReason('PROHIBITED_CONTENT')).toBe(true)
    expect(isModerationFinishReason('RECITATION')).toBe(true)
  })

  it('is case- and whitespace-insensitive', () => {
    expect(isModerationFinishReason('  Sensitive  ')).toBe(true)
  })

  it('leaves ordinary stops alone', () => {
    expect(isModerationFinishReason('stop')).toBe(false)
    expect(isModerationFinishReason('length')).toBe(false)
    expect(isModerationFinishReason('tool_calls')).toBe(false)
    expect(isModerationFinishReason(null)).toBe(false)
    expect(isModerationFinishReason(undefined)).toBe(false)
    expect(isModerationFinishReason('')).toBe(false)
  })

  it('does not guess from substrings', () => {
    // A false positive tells the user their content was refused when it
    // wasn't, so matching is literal rather than fuzzy.
    expect(isModerationFinishReason('insensitive_stop')).toBe(false)
    expect(isModerationFinishReason('no_content_filter_applied')).toBe(false)
  })
})

describe('describeModerationRefusal', () => {
  it('names the provider, the model and the reason', () => {
    const text = describeModerationRefusal('sensitive', 'Z_AI', 'glm-5v-turbo')
    expect(text).toContain('Z_AI')
    expect(text).toContain('glm-5v-turbo')
    expect(text).toContain('sensitive')
  })

  it('contradicts the generic retry advice', () => {
    const text = describeModerationRefusal('content_filter', 'OPENAI', 'gpt-5')!
    expect(text).toContain('refused')
    expect(text).toContain('will be refused again')
  })

  it('returns null for a non-moderation stop so callers fall through', () => {
    expect(describeModerationRefusal('stop', 'OPENAI', 'gpt-5')).toBeNull()
    expect(describeModerationRefusal(null, 'OPENAI', 'gpt-5')).toBeNull()
  })
})
