'use client'

import { useState } from 'react'
import { TagBadge } from '@/components/tags/tag-badge'

interface Tag {
  id: string
  name: string
}

interface Memory {
  id: string
  characterId: string
  content: string
  summary: string
  keywords: string[]
  tags: string[]
  tagDetails?: Tag[]
  importance: number
  source: 'AUTO' | 'MANUAL'
  createdAt: string
  updatedAt: string
}

interface MemoryCardProps {
  memory: Memory
  onEdit?: (memory: Memory) => void
  onDelete?: (memoryId: string) => void
  isDeleting?: boolean
}

export function MemoryCard({ memory, onEdit, onDelete, isDeleting = false }: MemoryCardProps) {
  const [expanded, setExpanded] = useState(false)

  const importanceColor = memory.importance >= 0.7
    ? 'text-red-600 dark:text-red-400'
    : memory.importance >= 0.4
      ? 'text-yellow-600 dark:text-yellow-400'
      : 'text-gray-500 dark:text-gray-400'

  const importanceLabel = memory.importance >= 0.7
    ? 'High'
    : memory.importance >= 0.4
      ? 'Medium'
      : 'Low'

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  return (
    <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg p-4 shadow-sm hover:shadow-md transition-shadow">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm text-gray-900 dark:text-white font-medium line-clamp-2">
            {memory.summary}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className={`text-xs font-medium ${importanceColor}`} title={`Importance: ${(memory.importance * 100).toFixed(0)}%`}>
            {importanceLabel}
          </span>
          <span className={`text-xs px-2 py-0.5 rounded-full ${
            memory.source === 'AUTO'
              ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300'
              : 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300'
          }`}>
            {memory.source === 'AUTO' ? 'Auto' : 'Manual'}
          </span>
        </div>
      </div>

      {/* Content Preview / Full Content */}
      <div className="mb-3">
        <p className={`text-sm text-gray-600 dark:text-gray-300 ${expanded ? '' : 'line-clamp-3'}`}>
          {memory.content}
        </p>
        {memory.content.length > 150 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline mt-1"
          >
            {expanded ? 'Show less' : 'Show more'}
          </button>
        )}
      </div>

      {/* Keywords */}
      {memory.keywords.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {memory.keywords.map((keyword, index) => (
            <span
              key={index}
              className="text-xs px-2 py-0.5 bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-300 rounded"
            >
              {keyword}
            </span>
          ))}
        </div>
      )}

      {/* Tags */}
      {memory.tagDetails && memory.tagDetails.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {memory.tagDetails.map((tag) => (
            <TagBadge key={tag.id} tag={tag} size="sm" />
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-2 border-t border-gray-100 dark:border-slate-700">
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {formatDate(memory.createdAt)}
        </span>
        <div className="flex gap-2">
          {onEdit && (
            <button
              onClick={() => onEdit(memory)}
              className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
            >
              Edit
            </button>
          )}
          {onDelete && (
            <button
              onClick={() => onDelete(memory.id)}
              disabled={isDeleting}
              className="text-xs text-red-600 dark:text-red-400 hover:underline disabled:opacity-50"
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
