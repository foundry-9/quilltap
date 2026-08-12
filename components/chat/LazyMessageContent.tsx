'use client'

import { memo } from 'react'
import MessageContent from './MessageContent'
import type { RenderingPattern, DialogueDetection } from '@/lib/schemas/template.types'

interface LazyMessageContentProps {
  content: string
  className?: string
  renderingPatterns?: RenderingPattern[]
  dialogueDetection?: DialogueDetection | null
  /**
   * Historically forced immediate (non-lazy) rendering. Lazy rendering has been
   * removed because the preview→full swap changed each row's height after the
   * virtualizer had already measured it, making scroll jerky. The prop is kept
   * for call-site compatibility but no longer affects output.
   */
  forceRender?: boolean
  /** Server-side pre-rendered HTML for simple messages */
  renderedHtml?: string | null
}

/**
 * Wrapper for MessageContent. Renders message content eagerly so that every
 * row has a single, deterministic height the virtualizer can cache by key.
 *
 * Previously this component deferred the expensive markdown / roleplay render
 * behind an IntersectionObserver, showing a short plain-text preview until a
 * row had been visible for 500ms. With virtualization that backfired: rows
 * unmount/remount constantly while scrolling, so the preview→full swap
 * re-measured each row to a taller height mid-scroll and shifted everything
 * below it. Rendering eagerly keeps heights stable; virtualization already
 * bounds the work to the visible window plus overscan.
 */
function LazyMessageContentInner({
  content,
  className = '',
  renderingPatterns,
  dialogueDetection,
  renderedHtml,
}: LazyMessageContentProps) {
  const hasQtapUri = content.includes('qtap://')

  // Fast path: server pre-rendered HTML for simple messages. Cheap and already
  // height-stable, so render it directly. Messages mentioning qtap:// must use
  // MessageContent so links are interactive via QtapLink (server-rendered HTML
  // anchors have no React click handler for in-app open behavior).
  if (renderedHtml && !hasQtapUri) {
    return (
      <div
        className={`qt-chat-message-content qt-prose prose prose-sm qt-prose-auto ${className}`}
        dangerouslySetInnerHTML={{ __html: renderedHtml }}
      />
    )
  }

  // Full render with markdown and roleplay processing.
  return (
    <MessageContent
      content={content}
      className={className}
      renderingPatterns={renderingPatterns}
      dialogueDetection={dialogueDetection}
    />
  )
}

/**
 * Memoized LazyMessageContent to prevent re-renders when parent changes.
 * Only re-renders when content or rendering configuration actually changes.
 */
const LazyMessageContent = memo(LazyMessageContentInner, (prev, next) => {
  // Return true if props are equal (skip re-render)
  return (
    prev.content === next.content &&
    prev.className === next.className &&
    prev.renderingPatterns === next.renderingPatterns &&
    prev.dialogueDetection === next.dialogueDetection &&
    prev.renderedHtml === next.renderedHtml
  )
})

export default LazyMessageContent
