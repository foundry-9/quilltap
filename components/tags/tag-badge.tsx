'use client'

import { MouseEvent } from 'react'
import { useTagStyles } from '@/components/providers/tag-style-provider'
import type { TagVisualStyle } from '@/lib/json-store/schemas/types'
import { mergeWithDefaultTagStyle } from '@/lib/tags/styles'

interface TagBadgeProps {
  tag: { id: string; name: string }
  onRemove?: () => void
  disabled?: boolean
  size?: 'sm' | 'md'
  className?: string
  styleOverride?: Partial<TagVisualStyle>
}

export function TagBadge({ tag, onRemove, disabled = false, size = 'md', className = '', styleOverride }: TagBadgeProps) {
  const { getStyleForTag } = useTagStyles()
  const computedStyle = styleOverride
    ? mergeWithDefaultTagStyle(styleOverride)
    : getStyleForTag(tag.id)

  const sizeClasses = size === 'sm'
    ? 'text-xs px-2 py-0.5'
    : 'text-sm px-3 py-1'

  const baseClasses = `inline-flex items-center gap-1 rounded-full font-medium border-2 transition-colors ${sizeClasses} ${className}`

  const handleRemove = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    onRemove?.()
  }

  const showEmojiOnly = computedStyle.emojiOnly && computedStyle.emoji

  const textClasses = [
    computedStyle.bold && 'font-bold',
    computedStyle.italic && 'italic',
    computedStyle.strikethrough && 'line-through',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <span
      className={`${baseClasses} ${textClasses}`}
      style={{
        color: computedStyle.foregroundColor,
        borderColor: computedStyle.foregroundColor,
        backgroundColor: computedStyle.backgroundColor,
      }}
      title={showEmojiOnly ? tag.name : undefined}
    >
      {computedStyle.emoji && (
        <span aria-hidden="true" className="text-base leading-none">
          {computedStyle.emoji}
        </span>
      )}
      {!showEmojiOnly && <span>{tag.name}</span>}
      {onRemove && (
        <button
          type="button"
          onClick={handleRemove}
          disabled={disabled}
          className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full border border-current bg-transparent focus:outline-none disabled:opacity-50"
          aria-label={`Remove ${tag.name} tag`}
        >
          <svg
            className="h-3 w-3"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      )}
    </span>
  )
}
