/**
 * Speaker attribution for ad-hoc announcements.
 *
 * The bug this pins: an announcement posted as a named off-scene character
 * reached the model as anonymous prose, because `customAnnouncer` was a
 * rendering field only. A character then attributed a whispered line to an
 * entirely different character and carried that mistake into the scene.
 */

import {
  attributeAdhocAnnouncements,
  collectAnnouncerCharacterIds,
  resolveAnnouncerName,
} from '@/lib/chat/context/announcement-attribution'

const ARIEL = '14710fac-c074-45f1-bc03-c19fa66fc18e'
const NAMES = new Map([[ARIEL, 'Ariel']])

describe('resolveAnnouncerName', () => {
  it('names a character announcer from the lookup', () => {
    expect(resolveAnnouncerName({ kind: 'character', characterId: ARIEL }, NAMES)).toBe('Ariel')
  })

  it('uses the display name for a custom announcer, no lookup needed', () => {
    expect(
      resolveAnnouncerName({ kind: 'custom', displayName: 'The Narrator' }, new Map()),
    ).toBe('The Narrator')
  })

  it('returns null for an unresolvable character rather than inventing one', () => {
    // A name the model receives is treated as fact; a wrong one is worse than none.
    expect(resolveAnnouncerName({ kind: 'character', characterId: 'gone' }, NAMES)).toBeNull()
    expect(resolveAnnouncerName({ kind: 'character', characterId: null }, NAMES)).toBeNull()
  })

  it('returns null for a blank or absent announcer', () => {
    expect(resolveAnnouncerName(null, NAMES)).toBeNull()
    expect(resolveAnnouncerName(undefined, NAMES)).toBeNull()
    expect(resolveAnnouncerName({ kind: 'custom', displayName: '   ' }, NAMES)).toBeNull()
  })

  it('falls back to the staff display name when only a systemSender is present', () => {
    // A `staff`-mode ad-hoc announcement carries no customAnnouncer — it must
    // still reach the model named, not as an anonymous user turn (Bug 28).
    expect(resolveAnnouncerName(null, NAMES, 'host')).toBe('The Host')
    expect(resolveAnnouncerName(null, NAMES, 'suparna')).toBe('Suparṇā')
    expect(resolveAnnouncerName(undefined, NAMES, 'prospero')).toBe('Prospero')
  })

  it('prefers customAnnouncer over systemSender when both are present', () => {
    expect(resolveAnnouncerName({ kind: 'custom', displayName: 'The Narrator' }, NAMES, 'host')).toBe(
      'The Narrator',
    )
  })
})

describe('collectAnnouncerCharacterIds', () => {
  it('gathers referenced character ids once each', () => {
    const ids = collectAnnouncerCharacterIds([
      { customAnnouncer: { kind: 'character', characterId: ARIEL } },
      { customAnnouncer: { kind: 'character', characterId: ARIEL } },
      { customAnnouncer: { kind: 'custom', displayName: 'The Narrator' } },
      { customAnnouncer: null },
      {},
    ])
    expect(ids).toEqual([ARIEL])
  })
})

describe('attributeAdhocAnnouncements', () => {
  it('tags a character announcement with the speaker', () => {
    const [msg] = attributeAdhocAnnouncements(
      [{ content: '*She drifts closer.*', customAnnouncer: { kind: 'character', characterId: ARIEL } }],
      NAMES,
    )
    expect(msg.content).toBe('[Ariel] *She drifts closer.*')
  })

  it('tags a custom announcement with its display name', () => {
    const [msg] = attributeAdhocAnnouncements(
      [{ content: 'A bell tolls.', customAnnouncer: { kind: 'custom', displayName: 'The Narrator' } }],
      new Map(),
    )
    expect(msg.content).toBe('[The Narrator] A bell tolls.')
  })

  it('leaves messages without an announcer untouched', () => {
    // Participants are tagged elsewhere; a bare message has no speaker to name.
    const input = [{ content: 'Prospero opens his ledger.' }, { content: 'hi', customAnnouncer: null }]
    expect(attributeAdhocAnnouncements(input, NAMES)).toEqual(input)
  })

  it('tags a staff-signed ad-hoc announcement with the staff display name', () => {
    const out = attributeAdhocAnnouncements(
      [
        { content: 'The house lights dim.', systemSender: 'host', systemKind: 'announcement' },
        { content: 'A letter arrives.', systemSender: 'suparna', systemKind: 'announcement' },
      ],
      NAMES,
    )
    expect(out[0].content).toBe('[The Host] The house lights dim.')
    expect(out[1].content).toBe('[Suparṇā] A letter arrives.')
  })

  it('does not tag ordinary staff whispers that merely carry a systemSender', () => {
    // Only systemKind === 'announcement' takes the systemSender fallback; a
    // Host nudge or image notice names itself in its own prose.
    const input = [
      { content: 'The Host summons Ariel.', systemSender: 'host', systemKind: 'nudge' },
      { content: 'An image is ready.', systemSender: 'lantern', systemKind: 'image-generated' },
    ]
    expect(attributeAdhocAnnouncements(input, NAMES)).toEqual(input)
  })

  it('prefixes opaqueContent alongside content so the opaque-anywhere LLM copy is named too', () => {
    const [msg] = attributeAdhocAnnouncements(
      [
        {
          content: 'The Host, resplendent, raises a glass.',
          opaqueContent: 'raises a glass.',
          systemSender: 'host',
          systemKind: 'announcement',
        },
      ],
      NAMES,
    )
    expect(msg.content).toBe('[The Host] The Host, resplendent, raises a glass.')
    expect(msg.opaqueContent).toBe('[The Host] raises a glass.')
  })

  it('leaves an unresolvable character announcement exactly as it was', () => {
    const input = [{ content: 'x', customAnnouncer: { kind: 'character' as const, characterId: 'gone' } }]
    expect(attributeAdhocAnnouncements(input, NAMES)[0].content).toBe('x')
  })

  it('does not stack tags when run twice', () => {
    // Retries and regenerates re-enter the context builder on the same rows.
    const once = attributeAdhocAnnouncements(
      [{ content: 'hello', customAnnouncer: { kind: 'character', characterId: ARIEL } }],
      NAMES,
    )
    const twice = attributeAdhocAnnouncements(once, NAMES)
    expect(twice[0].content).toBe('[Ariel] hello')
  })

  it('preserves every other field on the message', () => {
    const [msg] = attributeAdhocAnnouncements(
      [
        {
          content: 'hi',
          customAnnouncer: { kind: 'character' as const, characterId: ARIEL },
          id: 'm1',
          role: 'ASSISTANT',
          targetParticipantIds: ['p1'],
        },
      ],
      NAMES,
    )
    expect(msg).toMatchObject({ id: 'm1', role: 'ASSISTANT', targetParticipantIds: ['p1'] })
  })
})
