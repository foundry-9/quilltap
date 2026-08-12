'use client'

/**
 * CopyChatIdButton
 *
 * A small button that drops a conversation's UUID onto the clipboard at the
 * push of a button — for the times when one must whisper an identifier to the
 * CLI or a colleague across the wire. Two liveries:
 *
 *  - `variant="inline"`  — a compact, icon-only affair for the Salon header,
 *                          tucked in beside the conversation's title.
 *  - `variant="palette"` — a full-width tool-palette button (icon + label) for
 *                          the Chat Sidebar's Organize drawer.
 *
 * The icon flips to a reassuring check-mark for a moment once the deed is done.
 */

import { Icon } from '@/components/ui/icon'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'

interface CopyChatIdButtonProps {
  chatId: string
  variant?: 'inline' | 'palette'
}

export function CopyChatIdButton({ chatId, variant = 'inline' }: CopyChatIdButtonProps) {
  const { copied, copy } = useCopyToClipboard()

  const handleCopy = () => {
    void copy(chatId)
  }

  if (variant === 'palette') {
    return (
      <button
        type="button"
        onClick={handleCopy}
        className="qt-tool-palette-button"
        title={`Copy this conversation's ID (${chatId}) to the clipboard`}
      >
        <Icon name={copied ? 'check' : 'copy'} className="w-4 h-4" />
        <span>{copied ? 'ID Copied' : 'Copy ID'}</span>
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="flex-shrink-0 inline-flex items-center justify-center qt-text-muted hover:text-foreground transition-colors"
      title={copied ? 'Copied!' : `Copy this conversation's ID (${chatId}) to the clipboard`}
      aria-label="Copy conversation ID"
    >
      <Icon name={copied ? 'check' : 'copy'} className="w-4 h-4" />
    </button>
  )
}
