/**
 * Regression coverage for bug 67 — a send made from the composer's raw-source
 * view discarded every source edit, because the submit read the hidden Lexical
 * handle unconditionally while the textarea was the surface being edited.
 */

import {
  resolveComposerSubmitText,
  resolveComposerHasContent,
} from '@/app/salon/[id]/composer-source-mode'

describe('resolveComposerSubmitText', () => {
  it('sends the editor handle text in rich mode', () => {
    expect(resolveComposerSubmitText(false, 'stale page state', 'live editor text')).toBe(
      'live editor text',
    )
  })

  it('falls back to page state in rich mode when the handle is not mounted', () => {
    expect(resolveComposerSubmitText(false, 'restored draft', undefined)).toBe('restored draft')
  })

  // The bug: in source view the editor's bridge is suspended, so its handle
  // still holds the pre-toggle document. Sending it discarded the source edits.
  it('sends the source textarea text in source mode, not the stale handle', () => {
    expect(resolveComposerSubmitText(true, 'edited in source view', 'pre-toggle document')).toBe(
      'edited in source view',
    )
  })

  it('sends text composed entirely in source mode over an empty editor', () => {
    expect(resolveComposerSubmitText(true, 'typed only here', '')).toBe('typed only here')
  })

  it('sends an emptied source buffer rather than resurrecting the handle text', () => {
    expect(resolveComposerSubmitText(true, '', 'pre-toggle document')).toBe('')
  })
})

describe('resolveComposerHasContent', () => {
  it('follows the editor presence flag in rich mode', () => {
    expect(resolveComposerHasContent(false, '', true)).toBe(true)
    expect(resolveComposerHasContent(false, 'stale page state', false)).toBe(false)
  })

  it('follows the textarea in source mode', () => {
    expect(resolveComposerHasContent(true, 'typed only here', false)).toBe(true)
    expect(resolveComposerHasContent(true, '', true)).toBe(false)
  })

  it('treats a whitespace-only source buffer as empty', () => {
    expect(resolveComposerHasContent(true, '   \n\t ', true)).toBe(false)
  })
})
