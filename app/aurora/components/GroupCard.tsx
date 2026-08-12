'use client'

/**
 * Group Card
 *
 * Displays a single group with member count and actions.
 */

import Link from 'next/link'
import type { Group } from '../types'
import { Icon } from '@/components/ui/icon'

interface GroupCardProps {
  group: Group
  onClick: (e: React.MouseEvent) => void
  onDelete: () => void
  /** When provided (workspace tab), the Edit action opens in place instead of routing. */
  onOpen?: (groupId: string) => void
}


export function GroupCard({ group, onClick, onDelete, onOpen }: GroupCardProps) {
  return (
    <div
      className="qt-entity-card cursor-pointer hover:qt-border-primary/50 transition-colors"
      onClick={onClick}
    >
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center text-lg"
            style={{ backgroundColor: group.color || 'var(--muted)' }}
          >
            {group.icon || <Icon name="users" className="w-5 h-5 qt-text-secondary" />}
          </div>
          <div>
            <h2 className="text-xl font-semibold text-foreground">{group.name}</h2>
            <p className="qt-text-small">
              {group.memberCount ?? 0} member{group.memberCount !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
      </div>

      {group.description && (
        <p className="line-clamp-2 qt-text-small mb-4">{group.description}</p>
      )}

      <div className="qt-entity-card-actions flex gap-2">
        {onOpen ? (
          <button
            onClick={(e) => { e.stopPropagation(); onOpen(group.id) }}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground qt-shadow-sm transition hover:qt-bg-primary/90"
            title="Edit group"
          >
            Edit
          </button>
        ) : (
          <Link
            href={`/aurora/groups/${group.id}`}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground qt-shadow-sm transition hover:qt-bg-primary/90"
            title="Edit group"
          >
            Edit
          </Link>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          className="qt-button-destructive qt-shadow-sm"
          title="Delete group"
        >
          <Icon name="trash" className="w-5 h-5" />
        </button>
      </div>
    </div>
  )
}
