/**
 * Unit tests for parseHrefToIntent — maps in-app hrefs to workspace tab intents
 * (used so in-workspace link clicks open tabs instead of navigating away).
 */

import { parseHrefToIntent } from '@/lib/navigation/route-to-intent'

describe('parseHrefToIntent', () => {
  it('maps a specific conversation to a salon tab with its chatId', () => {
    expect(parseHrefToIntent('/salon/abc123')).toEqual({
      kind: 'salon',
      payload: { chatId: 'abc123' },
    })
  })

  it('maps the salon list (and legacy /chats) to the salon-list tab', () => {
    expect(parseHrefToIntent('/salon')).toEqual({ kind: 'salon-list' })
    expect(parseHrefToIntent('/chats')).toEqual({ kind: 'salon-list' })
  })

  it('does not map new-chat (the interceptor opens the modal instead)', () => {
    expect(parseHrefToIntent('/salon/new')).toBeNull()
  })

  it('maps detail routes to their list tab drilled into the target', () => {
    expect(parseHrefToIntent('/prospero/p1')).toEqual({
      kind: 'prospero',
      payload: { projectId: 'p1' },
    })
    expect(parseHrefToIntent('/projects/p1')).toEqual({
      kind: 'prospero',
      payload: { projectId: 'p1' },
    })
    expect(parseHrefToIntent('/scriptorium/s1')).toEqual({
      kind: 'scriptorium',
      payload: { storeId: 's1' },
    })
    expect(parseHrefToIntent('/aurora/groups/g1')).toEqual({
      kind: 'aurora',
      payload: { groupId: 'g1' },
    })
  })

  it('maps the singleton surfaces', () => {
    expect(parseHrefToIntent('/')).toEqual({ kind: 'home' })
    expect(parseHrefToIntent('/aurora')).toEqual({ kind: 'aurora' })
    expect(parseHrefToIntent('/prospero')).toEqual({ kind: 'prospero' })
    expect(parseHrefToIntent('/scriptorium')).toEqual({ kind: 'scriptorium' })
    expect(parseHrefToIntent('/files')).toEqual({ kind: 'files' })
    expect(parseHrefToIntent('/photos')).toEqual({ kind: 'photos' })
    expect(parseHrefToIntent('/scenarios')).toEqual({ kind: 'scenarios' })
  })

  it('preserves settings deep-link params', () => {
    expect(parseHrefToIntent('/settings?tab=system&section=memory')).toEqual({
      kind: 'settings',
      payload: { tab: 'system', section: 'memory' },
    })
    expect(parseHrefToIntent('/settings')).toEqual({
      kind: 'settings',
      payload: { tab: undefined, section: undefined },
    })
  })

  it('tolerates trailing slashes and hash fragments', () => {
    expect(parseHrefToIntent('/aurora/')).toEqual({ kind: 'aurora' })
    expect(parseHrefToIntent('/aurora#x')).toEqual({ kind: 'aurora' })
  })

  it('maps the standalone page surfaces', () => {
    expect(parseHrefToIntent('/profile')).toEqual({ kind: 'profile' })
    expect(parseHrefToIntent('/about')).toEqual({ kind: 'about' })
    expect(parseHrefToIntent('/generate-image')).toEqual({ kind: 'generate-image' })
    expect(parseHrefToIntent('/aurora/new')).toEqual({ kind: 'character-new' })
    expect(parseHrefToIntent('/settings/wizard')).toEqual({ kind: 'settings-wizard' })
  })

  it('maps the character editor (aurora + legacy /characters paths) with its sub-tab', () => {
    expect(parseHrefToIntent('/aurora/abc/edit')).toEqual({
      kind: 'character-edit',
      payload: { characterId: 'abc', tab: undefined },
    })
    expect(parseHrefToIntent('/characters/abc/edit?tab=system-prompts')).toEqual({
      kind: 'character-edit',
      payload: { characterId: 'abc', tab: 'system-prompts' },
    })
  })

  it('does NOT map a bare character detail (it renders in-place in Aurora)', () => {
    expect(parseHrefToIntent('/aurora/abc')).toBeNull()
  })

  it('maps the character detail view (aurora + legacy /characters paths) with its sub-tab', () => {
    expect(parseHrefToIntent('/aurora/abc/view')).toEqual({
      kind: 'character-view',
      payload: { characterId: 'abc', tab: undefined },
    })
    expect(parseHrefToIntent('/characters/abc/view?tab=conversations')).toEqual({
      kind: 'character-view',
      payload: { characterId: 'abc', tab: 'conversations' },
    })
  })

  it('returns null for unknown or external hrefs', () => {
    expect(parseHrefToIntent('/unlock')).toBeNull()
    expect(parseHrefToIntent('https://example.com')).toBeNull()
    expect(parseHrefToIntent('')).toBeNull()
  })
})
