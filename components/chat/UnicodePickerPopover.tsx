'use client'

/**
 * UnicodePickerPopover
 *
 * The toolbar's symbol picker: `CharPickerPanel` bound to the Unicode profile.
 * Sections are Unicode blocks, in block order — which is also the order that
 * makes ← ↑ → ↓ the first things a search for "arrow" turns up.
 *
 * @module components/chat/UnicodePickerPopover
 */

import type { LexicalEditor } from 'lexical'

import { UNICODE_PROFILE } from '@/lib/char-insert/profiles/unicode'
import { CharPickerPanel } from './char-insert/CharPickerPanel'

export interface UnicodePickerPopoverProps {
  onClose: () => void
  /** Editor the pick is inserted into. */
  editor: LexicalEditor
  /** Ref of the toggling button, so clicking it again closes rather than reopens. */
  toggleRef?: React.RefObject<HTMLElement | null>
}

export function UnicodePickerPopover(props: Readonly<UnicodePickerPopoverProps>) {
  return <CharPickerPanel profile={UNICODE_PROFILE} {...props} />
}

export default UnicodePickerPopover
