/**
 * Bug 95: image attachments were bolted to whatever the last `role: user`
 * message happened to be. Staff whispers format as role=user, so on a
 * regenerate the picture rode on a Prospero memorandum or a
 * "your response model is now X" bubble — several messages away from the
 * user's actual words, and directly contradicting the Librarian announcement
 * telling the model the bytes rode with the user's message.
 */

import { selectAttachmentAnchorIndex } from '@/lib/services/chat-message/context-builder.service'

type Msg = { role: string; metadata?: { messageId?: string; isUserTurn?: boolean } }

const USER_ROW = 'user-row-1'

describe('selectAttachmentAnchorIndex', () => {
  it('prefers this turn`s new user message', () => {
    const messages: Msg[] = [
      { role: 'system' },
      { role: 'user', metadata: { messageId: USER_ROW } },
      { role: 'assistant' },
      { role: 'user', metadata: { isUserTurn: true } },
    ]
    expect(selectAttachmentAnchorIndex(messages, new Set([USER_ROW]))).toBe(3)
  })

  it('anchors on the human`s historical turn, not the staff whispers after it', () => {
    // The exact shape observed in the failing chat: the user's message, then
    // a Librarian upload announcement, a Host off-scene introduction and a
    // connection-profile-change bubble — all re-roled to `user`.
    const messages: Msg[] = [
      { role: 'assistant' },
      { role: 'user', metadata: { messageId: USER_ROW } },
      { role: 'user', metadata: { messageId: 'librarian-whisper' } },
      { role: 'user', metadata: { messageId: 'host-whisper' } },
      { role: 'user', metadata: { messageId: 'profile-change-whisper' } },
    ]
    expect(selectAttachmentAnchorIndex(messages, new Set([USER_ROW]))).toBe(1)
  })

  it('anchors on the user turn even when a tool exchange trails it', () => {
    // After a tool call the tail is assistant/tool, so the old rule dropped
    // the attachments entirely.
    const messages: Msg[] = [
      { role: 'user', metadata: { messageId: USER_ROW } },
      { role: 'user', metadata: { messageId: 'profile-change-whisper' } },
      { role: 'assistant' },
      { role: 'user', metadata: { messageId: 'tool-result' } },
    ]
    expect(selectAttachmentAnchorIndex(messages, new Set([USER_ROW]))).toBe(0)
  })

  it('falls back to the last user-role message when nothing is identifiable', () => {
    // Floor behaviour: deliver the bytes somewhere rather than discard them.
    const messages: Msg[] = [
      { role: 'system' },
      { role: 'assistant' },
      { role: 'user' },
    ]
    expect(selectAttachmentAnchorIndex(messages, new Set())).toBe(2)
  })

  it('returns -1 when there is no user-role message to anchor to', () => {
    const messages: Msg[] = [{ role: 'system' }, { role: 'assistant' }]
    expect(selectAttachmentAnchorIndex(messages, new Set())).toBe(-1)
  })

  it('ignores a user-turn id that belongs to an assistant-role message', () => {
    const messages: Msg[] = [
      { role: 'assistant', metadata: { messageId: USER_ROW } },
      { role: 'user', metadata: { messageId: 'whisper' } },
    ]
    expect(selectAttachmentAnchorIndex(messages, new Set([USER_ROW]))).toBe(1)
  })
})
