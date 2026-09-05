'use client'

/**
 * useProjects Hook
 *
 * Manages projects data and CRUD operations.
 *
 * @module app/prospero/hooks/useProjects
 */

import { useCallback, useState } from 'react'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import type { Project, UseProjectsReturn } from '../types'

export function useProjects(): UseProjectsReturn {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchProjects = useCallback(async (opts?: { silent?: boolean }) => {
    try {
      // A silent refresh (workspace tab re-activation) keeps the current list
      // on screen instead of flipping the whole view back to its loading state.
      if (!opts?.silent) setLoading(true)
      setError(null)

      const res = await fetch('/api/v1/projects')
      if (!res.ok) throw new Error('Failed to fetch projects')

      const data = await res.json()
      // Map API response to expected format (API returns _count, UI expects chatCount/fileCount)
      const mappedProjects = data.projects.map((p: Project & { _count?: { chats: number; files: number; characters: number } }) => ({
        ...p,
        chatCount: p._count?.chats ?? 0,
        fileCount: p._count?.files ?? 0,
        characterCount: p._count?.characters ?? 0,
      }))
      setProjects(mappedProjects)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'An error occurred'
      console.error('useProjects: fetch error', { error: errorMsg })
      setError(errorMsg)
    } finally {
      setLoading(false)
    }
  }, [])

  const createProject = useCallback(async (name: string, description: string | null): Promise<Project | null> => {
    try {
      const res = await fetch('/api/v1/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description }),
      })

      if (!res.ok) throw new Error('Failed to create project')

      const data = await res.json()
      // New projects have 0 chats/files/characters
      const newProject: Project = {
        ...data.project,
        chatCount: 0,
        fileCount: 0,
        characterCount: data.project.characterRoster?.length ?? 0,
      }
      setProjects(prev => [newProject, ...prev])
      showSuccessToast('Project created successfully!')

      return newProject
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to create project'
      console.error('useProjects: create error', { error: errorMsg })
      showErrorToast(errorMsg)
      return null
    }
  }, [])

  const deleteProject = useCallback(async (id: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/v1/projects/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete project')

      setProjects(prev => prev.filter(p => p.id !== id))
      showSuccessToast('Project deleted successfully!')

      return true
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to delete project'
      console.error('useProjects: delete error', { error: errorMsg, projectId: id })
      showErrorToast(errorMsg)
      return false
    }
  }, [])

  return {
    projects,
    loading,
    error,
    fetchProjects,
    createProject,
    deleteProject,
  }
}
