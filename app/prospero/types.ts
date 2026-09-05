/**
 * Projects Page Types
 *
 * Shared types for the projects list page components.
 */

export interface Project {
  id: string
  name: string
  description?: string | null
  color?: string | null
  icon?: string | null
  chatCount: number
  fileCount: number
  characterCount: number
  createdAt: string
  updatedAt: string
}

export interface UseProjectsReturn {
  projects: Project[]
  loading: boolean
  error: string | null
  /** `silent` refreshes in place without flipping `loading` (tab re-activation). */
  fetchProjects: (opts?: { silent?: boolean }) => Promise<void>
  createProject: (name: string, description: string | null) => Promise<Project | null>
  deleteProject: (id: string) => Promise<boolean>
}
