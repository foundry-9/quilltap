import {
  getAnnouncementAccentClasses,
  getAnnouncementImportance,
  getAnnouncementOutcomeState,
  getSystemKindDisplayLabel,
} from './system-message-labels'
import type { Message } from '../types'

function ann(
  systemSender: NonNullable<Message['systemSender']>,
  systemKind?: string,
  content = '',
): Pick<Message, 'systemSender' | 'systemKind' | 'content'> {
  return { systemSender, systemKind: systemKind ?? null, content }
}

describe('getAnnouncementImportance', () => {
  it('rates Librarian file changes high and incidental reads low', () => {
    expect(getAnnouncementImportance(ann('librarian', 'saved'))).toBe('high')
    expect(getAnnouncementImportance(ann('librarian', 'deleted'))).toBe('high')
    expect(getAnnouncementImportance(ann('librarian', 'folder-created'))).toBe('high')
    expect(getAnnouncementImportance(ann('librarian', 'opened'))).toBe('low')
    expect(getAnnouncementImportance(ann('librarian', 'summary'))).toBe('medium')
  })

  it('rates character-initiated doc changes high (explicit -by-* systemKinds)', () => {
    expect(getAnnouncementImportance(ann('librarian', 'created-by-character'))).toBe('high')
    expect(getAnnouncementImportance(ann('librarian', 'edited-by-character'))).toBe('high')
    expect(getAnnouncementImportance(ann('librarian', 'moved-by-character'))).toBe('high')
    expect(getAnnouncementImportance(ann('librarian', 'copied-by-character'))).toBe('high')
    expect(getAnnouncementImportance(ann('librarian', 'blob-written-by-character'))).toBe('high')
  })

  it('labels the new doc-change kinds for the collapsed system bar', () => {
    expect(getSystemKindDisplayLabel(ann('librarian', 'created-by-character'))).toBe('created by character')
    expect(getSystemKindDisplayLabel(ann('librarian', 'edited-by-character'))).toBe('edited by character')
    expect(getSystemKindDisplayLabel(ann('librarian', 'moved-by-character'))).toBe('moved by character')
    expect(getSystemKindDisplayLabel(ann('librarian', 'copied-by-character'))).toBe('copied by character')
    expect(getSystemKindDisplayLabel(ann('librarian', 'blob-written-by-character'))).toBe('asset added by character')
  })

  describe('a roll outcome names the tool, not the machinery', () => {
    const roll = (pascalMeta: Partial<NonNullable<Message['pascalMeta']>> | null) =>
      ({
        systemSender: 'pascal',
        systemKind: 'custom-tool-result',
        content: '',
        pascalMeta: pascalMeta as Message['pascalMeta'],
      }) as Pick<Message, 'systemSender' | 'systemKind' | 'content' | 'pascalMeta'>

    it('prefers the display title recorded with the roll', () => {
      expect(getSystemKindDisplayLabel(roll({ tool: 'scan_hawking_radiation', toolTitle: 'Scan Hawking Radiation' })))
        .toBe('Scan Hawking Radiation')
    })

    it('falls back to the tool name on a roll recorded before toolTitle existed', () => {
      expect(getSystemKindDisplayLabel(roll({ tool: 'scan_hawking_radiation' }))).toBe('scan_hawking_radiation')
    })

    it('ignores a blank title rather than showing an empty chip', () => {
      expect(getSystemKindDisplayLabel(roll({ tool: 'unlock', toolTitle: '   ' }))).toBe('unlock')
    })

    it('falls back to the generic label when there is no roll record at all', () => {
      expect(getSystemKindDisplayLabel(roll(null))).toBe('roll outcome')
    })

    it('leaves the error chip alone — it is Prospero\'s, and names no tool', () => {
      expect(getSystemKindDisplayLabel(ann('prospero', 'custom-tool-error'))).toBe("the table couldn't deal")
    })
  })

  it('rates Host arrivals/status high and time calls low', () => {
    expect(getAnnouncementImportance(ann('host', 'add'))).toBe('high')
    expect(getAnnouncementImportance(ann('host', 'remove'))).toBe('high')
    expect(getAnnouncementImportance(ann('host', 'status-change'))).toBe('high')
    expect(getAnnouncementImportance(ann('host', 'timestamp'))).toBe('low')
  })

  it('rates Concierge danger high', () => {
    expect(getAnnouncementImportance(ann('concierge', 'danger'))).toBe('high')
  })

  it('rates Lantern, Aurora and Ariel medium', () => {
    expect(getAnnouncementImportance(ann('lantern', 'background'))).toBe('medium')
    expect(getAnnouncementImportance(ann('aurora', 'avatar'))).toBe('medium')
    expect(getAnnouncementImportance(ann('ariel', 'session-opened'))).toBe('medium')
  })

  it('rates Prospero context and Commonplace recalls low', () => {
    expect(getAnnouncementImportance(ann('prospero', 'project-context'))).toBe('low')
    expect(getAnnouncementImportance(ann('prospero', 'general-context'))).toBe('low')
    expect(getAnnouncementImportance(ann('commonplaceBook', 'memory-recap'))).toBe('low')
    // Prospero connection changes are the medium exception within a low sender.
    expect(getAnnouncementImportance(ann('prospero', 'connection-profile-change'))).toBe('medium')
  })

  it('falls back to the per-sender "*" tier for unknown kinds', () => {
    expect(getAnnouncementImportance(ann('prospero', 'some-future-kind'))).toBe('low')
    expect(getAnnouncementImportance(ann('lantern', 'some-future-kind'))).toBe('medium')
  })

  it('infers the kind from content when systemKind is absent', () => {
    // Host time-call phrasing → timestamp → low
    expect(
      getAnnouncementImportance(ann('host', undefined, 'The Host marks the time at half past three.')),
    ).toBe('low')
    // Host arrival phrasing → add → high
    expect(
      getAnnouncementImportance(ann('host', undefined, 'The Host welcomes Beatrice to the table.')),
    ).toBe('high')
    // Librarian doc-change phrasings (legacy rows without systemKind) → high
    expect(
      getAnnouncementImportance(ann('librarian', undefined, 'The Librarian has set down a new volume, "Notes".')),
    ).toBe('high')
    expect(
      getAnnouncementImportance(ann('librarian', undefined, 'The Librarian has filed fresh alterations to "Notes".')),
    ).toBe('high')
    expect(
      getAnnouncementImportance(ann('librarian', undefined, 'The Librarian has relocated the volume "a.md".')),
    ).toBe('high')
  })

  it('defaults to medium when there is no systemSender', () => {
    expect(getAnnouncementImportance({ systemSender: null, systemKind: null, content: '' })).toBe('medium')
  })
})

describe('getAnnouncementOutcomeState / getAnnouncementAccentClasses', () => {
  const roll = (pascalMeta: Partial<NonNullable<Message['pascalMeta']>> | null) =>
    ({
      systemSender: 'pascal',
      pascalMeta: pascalMeta as Message['pascalMeta'],
    }) as Pick<Message, 'systemSender' | 'pascalMeta'>

  it('reports the state the roll landed on', () => {
    for (const state of ['success', 'partial', 'failure', 'info'] as const) {
      expect(getAnnouncementOutcomeState(roll({ state }))).toBe(state)
      expect(getAnnouncementAccentClasses(roll({ state }))).toBe(`qt-pascal-result qt-pascal-result--${state}`)
    }
  })

  it('leaves every other Staff sender unaccented', () => {
    expect(getAnnouncementOutcomeState({ systemSender: 'librarian', pascalMeta: null })).toBeNull()
    expect(getAnnouncementAccentClasses({ systemSender: 'host', pascalMeta: null })).toBe('')
    // Prospero authors the custom-tool ERROR chip, and it carries no roll record.
    expect(getAnnouncementAccentClasses({ systemSender: 'prospero', pascalMeta: null })).toBe('')
  })

  it('falls back to the importance dot on a roll record with no usable state', () => {
    expect(getAnnouncementOutcomeState(roll(null))).toBeNull()
    expect(getAnnouncementOutcomeState(roll({}))).toBeNull()
    // A state from a future build this one doesn't know how to colour.
    expect(getAnnouncementOutcomeState(roll({ state: 'triumph' as 'success' }))).toBeNull()
    expect(getAnnouncementAccentClasses(roll({ state: 'triumph' as 'success' }))).toBe('')
  })
})
