/**
 * QuillAnimation — the "something is happening" quill.
 *
 * Shown while a reply is awaited, while tokens stream in, and while a tool call
 * is still outstanding. Both halves are theme-replaceable and independent:
 *
 *   - the GLYPH is the `thinking` icon, so a `.qtap-theme` bundle can swap it
 *     via the manifest `icons` map like any other icon;
 *   - the MOTION is `.qt-thinking-indicator` (see `_chat.css`), which a theme
 *     can retune through its `--qt-thinking-*` custom properties or replace
 *     outright with a different animation.
 *
 * Nothing here drives the animation frame by frame — React decides only whether
 * the indicator is mounted.
 *
 * @module components/chat/QuillAnimation
 */

import { Icon } from '@/components/ui/icon'

interface QuillAnimationProps {
  size?: 'lg' | 'sm'
  className?: string
  /**
   * Accessible label. Defaults to "Writing…"; pass `null` where the indicator
   * sits inside an already-labelled live region (the composer status strip) and
   * would otherwise be announced twice.
   */
  label?: string | null
}

export function QuillAnimation({ size = 'lg', className = '', label = 'Writing…' }: QuillAnimationProps) {
  const sizeClasses = size === 'lg' ? 'w-12 h-12' : 'w-4 h-4'

  return (
    <span className={`inline-flex items-center justify-center ${sizeClasses} ${className}`}>
      <Icon
        name="thinking"
        title={label ?? undefined}
        className={`qt-thinking-indicator ${sizeClasses}`}
      />
    </span>
  )
}
