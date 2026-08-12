'use client'

/**
 * Groups Grid
 *
 * Displays a grid of group cards or empty state.
 */

import { useRouter } from 'next/navigation'
import { GroupCard } from './GroupCard'
import type { Group } from '../types'

interface GroupsGridProps {
  groups: Group[]
  onCreateClick: () => void
  onDeleteClick: (groupId: string) => void
  /** When provided (workspace tab), open the group in place instead of routing. */
  onOpenGroup?: (groupId: string) => void
}

export function GroupsGrid({ groups, onCreateClick, onDeleteClick, onOpenGroup }: GroupsGridProps) {
  const router = useRouter()

  const handleCardClick = (e: React.MouseEvent, groupId: string) => {
    const target = e.target as HTMLElement
    if (target.closest('button') || target.closest('a')) {
      return
    }
    if (onOpenGroup) onOpenGroup(groupId)
    else router.push(`/aurora/groups/${groupId}`)
  }

  if (groups.length === 0) {
    return (
      <div className="mt-12 rounded-2xl border border-dashed qt-border-default/70 qt-bg-card/80 px-8 py-12 text-center qt-shadow-sm">
        <p className="mb-4 text-lg qt-text-secondary">No groups yet</p>
        <button
          onClick={onCreateClick}
          className="qt-text-primary hover:text-primary/80"
        >
          Create your first group
        </button>
      </div>
    )
  }

  return (
    <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
      {groups.map((group) => (
        <GroupCard
          key={group.id}
          group={group}
          onClick={(e) => handleCardClick(e, group.id)}
          onDelete={() => onDeleteClick(group.id)}
          onOpen={onOpenGroup}
        />
      ))}
    </div>
  )
}
