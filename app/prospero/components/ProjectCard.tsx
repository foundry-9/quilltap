'use client'

/**
 * Project Card
 *
 * Displays a single project with counts and actions.
 */

import Link from 'next/link'
import type { Project } from '../types'
import { Icon } from '@/components/ui/icon'

interface ProjectCardProps {
  project: Project
  onClick: (e: React.MouseEvent) => void
  onDelete: () => void
  /** When provided (workspace tab), the Open action selects in place instead of routing. */
  onOpen?: (projectId: string) => void
}


export function ProjectCard({ project, onClick, onDelete, onOpen }: ProjectCardProps) {
  return (
    <div
      className="qt-entity-card cursor-pointer hover:qt-border-primary/50 transition-colors"
      onClick={onClick}
    >
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center text-lg"
            style={{ backgroundColor: project.color || 'var(--muted)' }}
          >
            {project.icon || <Icon name="folder" className="w-5 h-5 qt-text-secondary" />}
          </div>
          <div>
            <h2 className="text-xl font-semibold text-foreground">{project.name}</h2>
            <p className="qt-text-small">
              {project.chatCount} chat{project.chatCount !== 1 ? 's' : ''} &bull; {project.fileCount} file{project.fileCount !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
      </div>

      {project.description && (
        <p className="line-clamp-2 qt-text-small mb-4">{project.description}</p>
      )}

      <div className="qt-entity-card-actions flex gap-2">
        {onOpen ? (
          <button
            onClick={(e) => { e.stopPropagation(); onOpen(project.id) }}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground qt-shadow-sm transition hover:qt-bg-primary/90"
          >
            Open
          </button>
        ) : (
          <Link
            href={`/projects/${project.id}`}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground qt-shadow-sm transition hover:qt-bg-primary/90"
          >
            Open
          </Link>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          className="qt-button-destructive qt-shadow-sm"
          title="Delete project"
        >
          <Icon name="trash" className="w-5 h-5" />
        </button>
      </div>
    </div>
  )
}
