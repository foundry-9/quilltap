/**
 * Regression coverage for bug 94 — the Salon's stream hook received the
 * `attachmentResults` ledger on every `done` event and displayed none of it.
 * An image the provider plugin could not put on the wire therefore looked
 * exactly like a model that had seen the image and chosen to say nothing,
 * which is also why bug 91 (image attachments silently dropped) went
 * unnoticed for months.
 *
 * The turn itself succeeds and its content is worth keeping, so the failure is
 * surfaced as a warning about the turn rather than a replacement for it. This
 * pins the sentence that warning is built from.
 */

import { buildFailedAttachmentWarning } from '@/app/salon/[id]/hooks/useSSEStreaming'

describe('buildFailedAttachmentWarning', () => {
  it('names the single failure and the plugin\'s own error text', () => {
    expect(
      buildFailedAttachmentWarning([{ id: 'f1', error: 'model does not accept images' }])
    ).toBe('An attachment was not sent to the model: model does not accept images')
  })

  it('pluralises and collapses the extras into "(and N more)"', () => {
    expect(
      buildFailedAttachmentWarning([
        { id: 'f1', error: 'too large' },
        { id: 'f2', error: 'unsupported type' },
        { id: 'f3', error: 'unsupported type' },
      ])
    ).toBe('3 attachments were not sent to the model (and 2 more): too large')
  })

  it('says "unknown reason" rather than "undefined" when the plugin gave no text', () => {
    expect(
      buildFailedAttachmentWarning([{ id: 'f1' } as unknown as { id: string; error: string }])
    ).toBe('An attachment was not sent to the model: unknown reason')
  })

  it('stays silent when nothing failed — the ledger is present on every done event', () => {
    expect(buildFailedAttachmentWarning([])).toBeNull()
    expect(buildFailedAttachmentWarning(undefined)).toBeNull()
    expect(buildFailedAttachmentWarning(null)).toBeNull()
  })

  it('stays silent on a malformed ledger instead of throwing mid-stream', () => {
    expect(
      buildFailedAttachmentWarning('nope' as unknown as Array<{ id: string; error: string }>)
    ).toBeNull()
  })
})
