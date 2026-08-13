'use client'

/**
 * EmojiPickerPopover
 *
 * The toolbar's emoji picker: `CharPickerPanel` bound to the emoji profile.
 * Everything except the profile is shared with `UnicodePickerPopover`.
 *
 * @module components/chat/EmojiPickerPopover
 */

import type { LexicalEditor } from 'lexical'

import { EMOJI_PROFILE } from '@/lib/char-insert/profiles/emoji'
import { CharPickerPanel } from './char-insert/CharPickerPanel'

export interface EmojiPickerPopoverProps {
  onClose: () => void
  /** Editor the pick is inserted into. */
  editor: LexicalEditor
  /** Ref of the toggling button, so clicking it again closes rather than reopens. */
  toggleRef?: React.RefObject<HTMLElement | null>
}

export function EmojiPickerPopover(props: Readonly<EmojiPickerPopoverProps>) {
  return <CharPickerPanel profile={EMOJI_PROFILE} {...props} />
}

export default EmojiPickerPopover
