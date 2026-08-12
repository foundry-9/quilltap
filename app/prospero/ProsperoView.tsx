'use client'

/**
 * Projects List Page
 *
 * Displays all user projects with counts and actions.
 */

import { useEffect, useState } from 'react'
import { useProjects } from './hooks/useProjects'
import { ProjectsGrid, CreateProjectDialog, DeleteProjectDialog } from './components'
import { useSubsystemBackgroundStyle } from '@/components/providers/theme-provider'
import { useWorkspaceTabId } from '@/components/workspace/workspace-tab-context'
import dynamic from 'next/dynamic'

// Lazy so the list bundle doesn't pull in the detail (and its Lexical editors)
// until a project is actually opened in place.
const ProjectDetailView = dynamic(
  () => import('./[id]/ProjectDetailView').then((m) => m.ProjectDetailView),
  { ssr: false, loading: () => <p className="qt-section-title p-6">Loading project…</p> }
)

export interface ProsperoViewProps {
  /** Deep-link target: open with this project's detail shown (workspace tab only). */
  initialProjectId?: string
}

export function ProsperoView({ initialProjectId }: ProsperoViewProps = {}) {
  const { projects, loading, error, fetchProjects, createProject, deleteProject } = useProjects()
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [deleteProjectId, setDeleteProjectId] = useState<string | null>(null)
  // In a workspace tab, drilling into a project renders in place (keep-alive).
  const inTab = useWorkspaceTabId() != null
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(initialProjectId ?? null)
  const bgStyle = useSubsystemBackgroundStyle('prospero')

  useEffect(() => {
    fetchProjects()
  }, [fetchProjects])

  // A deep-link re-open refreshes the tab payload; follow it into the project.
  // Adjusting state during render is React's sanctioned derive-from-prop-change
  // pattern (re-renders immediately, nothing committed in between).
  const [prevInitialProjectId, setPrevInitialProjectId] = useState(initialProjectId)
  if (initialProjectId !== prevInitialProjectId) {
    setPrevInitialProjectId(initialProjectId)
    if (initialProjectId) setSelectedProjectId(initialProjectId)
  }

  const handleCreate = async (name: string, description: string | null) => {
    const result = await createProject(name, description)
    if (result) {
      setCreateDialogOpen(false)
    }
  }

  const handleDelete = async () => {
    if (deleteProjectId) {
      const success = await deleteProject(deleteProjectId)
      if (success) {
        setDeleteProjectId(null)
      }
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-lg text-foreground">Loading projects...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-lg qt-text-destructive">Error: {error}</p>
      </div>
    )
  }

  // Workspace tab, drilled into a project: render its detail in place.
  if (inTab && selectedProjectId) {
    return (
      <ProjectDetailView
        projectId={selectedProjectId}
        onBack={() => setSelectedProjectId(null)}
      />
    )
  }

  return (
    <div className="qt-page-container text-foreground" style={bgStyle}>
      <div className="flex flex-wrap items-center justify-between gap-4 border-b qt-border-default/60 pb-6">
        <h1 className="qt-heading-1 leading-tight">Projects</h1>
        <button
          onClick={() => setCreateDialogOpen(true)}
          className="qt-button inline-flex items-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground qt-shadow-md transition hover:qt-bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Create Project
        </button>
      </div>

      <ProjectsGrid
        projects={projects}
        onCreateClick={() => setCreateDialogOpen(true)}
        onDeleteClick={setDeleteProjectId}
        onOpenProject={inTab ? setSelectedProjectId : undefined}
      />

      <CreateProjectDialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        onSubmit={handleCreate}
      />

      <DeleteProjectDialog
        open={deleteProjectId !== null}
        onClose={() => setDeleteProjectId(null)}
        onConfirm={handleDelete}
      />
    </div>
  )
}
