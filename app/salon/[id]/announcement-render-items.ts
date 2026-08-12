import type { Message } from './types'

/**
 * A single entry in the virtualized Salon message list. Either an ordinary
 * message row (regular turn, expanded announcement, standalone TOOL row) or a
 * group of consecutive *collapsed* announcements that the UI packs into one
 * flex-wrapping row of chips.
 *
 * `messageIndex` is the index into the flat `renderMessages` array (the
 * post-tool-grouping list). It is preserved through this transform because the
 * TOOL-row backward participant-walk and the near-end `forceRender` heuristic
 * in VirtualizedMessageList both reason about that flat index, not the
 * render-item index.
 */
export type RenderItem =
  | { kind: 'message'; id: string; message: Message; messageIndex: number }
  | {
      kind: 'announcement-group'
      id: string
      members: { message: Message; messageIndex: number }[]
    }

/**
 * Whether a message is a *collapsed* Staff-authored announcement — i.e. one
 * that should render as a packed chip rather than a full message row. A
 * systemSender message the user has explicitly expanded is NOT collapsed and
 * therefore breaks out of any surrounding chip group.
 *
 * Carina (inline LLM queries) reference answers are exempt: although they carry
 * `systemSender: 'carina'`, they are real reference answers that must always
 * render as a full row (with the answerer character's own avatar and the answer
 * text), not as a collapsed chip.
 *
 * Suparṇā mail-delivery whispers are likewise exempt: a letter the operator can
 * see is one addressed to their own character (the visibility filter only shows
 * a targeted whisper when it targets a user-controlled participant), and those
 * are significant enough to read in full rather than pack into a chip.
 *
 * Pascal's roll outcomes are exempt on the same grounds: a `custom-tool-result`
 * is the table's binding verdict on the scene — the roll, the value, and the
 * outcome it landed on — and it must be legible in full rather than reduced to
 * a chip the reader has to unpack.
 */
function isCollapsedAnnouncement(message: Message, expandedSystemMessageIds: Set<string>): boolean {
  if (message.systemSender === 'carina') return false
  if (message.systemSender === 'suparna' && message.systemKind === 'mail-delivery') return false
  if (message.systemSender === 'pascal' && message.systemKind === 'custom-tool-result') return false
  return !!message.systemSender && !expandedSystemMessageIds.has(message.id)
}

/**
 * Layer render-items on top of the flat (post-tool-grouping) message list.
 *
 * Consecutive collapsed announcements coalesce into a single
 * `announcement-group`; every other row — including an *expanded* announcement —
 * flushes the current group and is emitted as its own `message` item. Expanding
 * one announcement inside a run therefore splits it naturally into
 * chips-before / expanded-message / chips-after.
 *
 * A lone collapsed announcement still becomes a one-member group so the chip
 * styling lives in exactly one place. Group ids are prefixed with `group:` so
 * they never collide with a raw message id used as a `message` item's id.
 *
 * Pure transform: no React, no side effects.
 */
export function buildRenderItems(
  messages: Message[],
  expandedSystemMessageIds: Set<string>,
): RenderItem[] {
  const items: RenderItem[] = []
  let group: { message: Message; messageIndex: number }[] | null = null

  const flushGroup = () => {
    if (group && group.length > 0) {
      items.push({
        kind: 'announcement-group',
        id: `group:${group[0].message.id}`,
        members: group,
      })
    }
    group = null
  }

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]
    if (isCollapsedAnnouncement(message, expandedSystemMessageIds)) {
      if (!group) group = []
      group.push({ message, messageIndex: i })
      continue
    }
    flushGroup()
    items.push({ kind: 'message', id: message.id, message, messageIndex: i })
  }
  flushGroup()

  return items
}
