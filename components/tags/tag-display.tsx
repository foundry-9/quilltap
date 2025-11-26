'use client'

import { TagBadge } from '@/components/tags/tag-badge'

interface TagDisplayProps {
  tags: Array<{
    id: string
    name: string
  }>
  size?: 'sm' | 'md'
}

export function TagDisplay({ tags, size = 'md' }: TagDisplayProps) {
  if (!tags || tags.length === 0) {
    return null
  }

  return (
    <div className="flex flex-wrap gap-2">
      {tags.map((tag) => (
        <TagBadge key={tag.id} tag={tag} size={size} />
      ))}
    </div>
  )
}
