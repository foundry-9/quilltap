import { describe, it, expect } from '@jest/globals'
import {
  buildNudgeContent,
  buildNudgeOpaqueContent,
} from '@/lib/services/host-notifications/writer'
import { getSystemKindDisplayLabel, getAnnouncementImportance } from '@/app/salon/[id]/components/system-message-labels'

describe('Host nudge content builders', () => {
  const name = 'Aurelia'

  it('names the summoned character', () => {
    expect(buildNudgeContent(name)).toContain(name)
    expect(buildNudgeOpaqueContent(name)).toContain(name)
  })

  it('persona content and opaque steering differ', () => {
    expect(buildNudgeContent(name)).not.toBe(buildNudgeOpaqueContent(name))
  })

  it('persona content is inference-recognisable as a nudge on legacy rows', () => {
    // A row persisted before the systemKind column (or by any writer that
    // forgets to set it) must still resolve to the nudge label from content.
    const legacyRow = { systemSender: 'host' as const, systemKind: null, content: buildNudgeContent(name) }
    expect(getSystemKindDisplayLabel(legacyRow)).toBe('invited to speak')
    expect(getAnnouncementImportance(legacyRow)).toBe('medium')
  })

  it('explicit systemKind resolves to the nudge label and tier', () => {
    const row = { systemSender: 'host' as const, systemKind: 'nudge', content: '' }
    expect(getSystemKindDisplayLabel(row)).toBe('invited to speak')
    expect(getAnnouncementImportance(row)).toBe('medium')
  })
})
