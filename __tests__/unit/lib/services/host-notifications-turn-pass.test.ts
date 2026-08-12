import { describe, it, expect } from '@jest/globals'
import {
  buildTurnPassContent,
  buildUserTurnPassContent,
  buildTurnPassOpaqueContent,
} from '@/lib/services/host-notifications/writer'
import { NOTHING_TO_ADD_SENTINEL } from '@/lib/chat/turn-manager'

describe('Host turn-pass content builders', () => {
  const name = 'Aurelia'

  it('names the passing character', () => {
    expect(buildTurnPassContent(name)).toContain(name)
    expect(buildUserTurnPassContent(name)).toContain(name)
    expect(buildTurnPassOpaqueContent(name)).toContain(name)
  })

  it('never contains the sentinel (so history cannot teach the phrase)', () => {
    const sentinelBody = NOTHING_TO_ADD_SENTINEL.toLowerCase()
    for (const text of [
      buildTurnPassContent(name),
      buildUserTurnPassContent(name),
      buildTurnPassOpaqueContent(name),
    ]) {
      expect(text.toLowerCase()).not.toContain(sentinelBody)
      expect(text.toLowerCase()).not.toContain('[nothing to add]')
    }
  })

  it('the LLM (user) pass uses distinct phrasing from the character pass', () => {
    expect(buildUserTurnPassContent(name)).not.toBe(buildTurnPassContent(name))
  })
})
