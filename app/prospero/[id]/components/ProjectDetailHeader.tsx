'use client'

/**
 * Project Detail Header
 *
 * Header section with project info, edit mode, and actions.
 */

import Link from 'next/link'
import type { Project, EditForm } from '../types'
import { Icon } from '@/components/ui/icon'

interface ProjectDetailHeaderProps {
  project: Project
  isEditing: boolean
  editForm: EditForm
  onEditFormChange: (form: EditForm) => void
  onEditClick: () => void
  onCancelEdit: () => void
  onSave: () => void
  /** In-view back (workspace tab). When omitted, the route Link is used. */
  onBack?: () => void
}


export function ProjectDetailHeader({
  project,
  isEditing,
  editForm,
  onEditFormChange,
  onEditClick,
  onCancelEdit,
  onSave,
  onBack,
}: ProjectDetailHeaderProps) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 border-b qt-border-default/60 pb-6">
      <div className="flex items-center gap-4">
        {onBack ? (
          <button onClick={onBack} className="qt-text-primary hover:underline text-sm">
            &larr; Projects
          </button>
        ) : (
          <Link href="/prospero" className="qt-text-primary hover:underline text-sm">
            &larr; Projects
          </Link>
        )}
        <div
          className="w-12 h-12 rounded-lg flex items-center justify-center text-xl"
          style={{ backgroundColor: project.color || 'var(--muted)' }}
        >
          {project.icon || <Icon name="folder" className="w-6 h-6 qt-text-secondary" />}
        </div>
        <div>
          {isEditing ? (
            <input
              type="text"
              value={editForm.name}
              onChange={(e) => onEditFormChange({ ...editForm, name: e.target.value })}
              className="qt-heading-2 bg-transparent border-b qt-border-primary focus:outline-none"
            />
          ) : (
            <h1 className="qt-heading-2">{project.name}</h1>
          )}
          {isEditing ? (
            <input
              type="text"
              value={editForm.description}
              onChange={(e) => onEditFormChange({ ...editForm, description: e.target.value })}
              placeholder="Add a description..."
              className="qt-text-small bg-transparent border-b qt-border-default focus:outline-none w-full"
            />
          ) : (
            project.description && <p className="qt-text-small">{project.description}</p>
          )}
        </div>
      </div>
      <div className="flex gap-2">
        <Link
          href={`/salon/new?projectId=${project.id}`}
          className="inline-flex items-center gap-2 rounded-lg bg-success px-4 py-2 text-sm font-semibold qt-text-success-foreground shadow hover:qt-bg-success/90"
        >
          <Icon name="plus" className="w-4 h-4" />
          New Chat
        </Link>
        {isEditing ? (
          <>
            <button
              onClick={onCancelEdit}
              className="inline-flex items-center rounded-lg border qt-border-default qt-bg-card px-4 py-2 text-sm qt-shadow-sm hover:qt-bg-muted"
            >
              Cancel
            </button>
            <button
              onClick={onSave}
              className="inline-flex items-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow hover:qt-bg-primary/90"
            >
              Save
            </button>
          </>
        ) : (
          <button
            onClick={onEditClick}
            className="inline-flex items-center rounded-lg border qt-border-default qt-bg-card px-4 py-2 text-sm qt-shadow-sm hover:qt-bg-muted"
          >
            Edit
          </button>
        )}
      </div>
    </div>
  )
}
