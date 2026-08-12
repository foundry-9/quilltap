'use client'

/**
 * useProjectDetail Hook
 *
 * Manages project data and update operations.
 *
 * @module app/prospero/[id]/hooks/useProjectDetail
 */

import { useCallback, useState } from 'react'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import type { Project, EditForm, BackgroundDisplayMode } from '../types'

interface UseProjectDetailReturn {
  project: Project | null
  loading: boolean
  error: string | null
  editForm: EditForm
  setEditForm: React.Dispatch<React.SetStateAction<EditForm>>
  isEditing: boolean
  setIsEditing: React.Dispatch<React.SetStateAction<boolean>>
  fetchProject: () => Promise<void>
  handleSave: () => Promise<void>
  handleToggleAllowAnyCharacter: () => Promise<void>
  handleSaveAgentMode: (enabled: boolean | null) => Promise<void>
  handleSaveAnswerConfirmationOverride: (value: 'ON' | 'OFF' | null) => Promise<void>
  handleSaveAvatarGeneration: (enabled: boolean | null) => Promise<void>
  handleSaveDefaultImageProfile: (profileId: string | null) => Promise<void>
  handleSaveDefaultRoleplayTemplate: (templateId: string | null) => Promise<void>
  handleSaveBackgroundDisplayMode: (mode: BackgroundDisplayMode) => Promise<void>
  handleSaveAlertCharactersOfLanternImages: (enabled: boolean | null) => Promise<void>
  handleRemoveCharacter: (characterId: string) => Promise<void>
}

export function useProjectDetail(projectId: string): UseProjectDetailReturn {
  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [editForm, setEditForm] = useState<EditForm>({ name: '', description: '', instructions: '' })

  const fetchProject = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/projects/${projectId}`)
      if (!res.ok) throw new Error('Project not found')
      const data = await res.json()
      setProject(data.project)
      setEditForm({
        name: data.project.name,
        description: data.project.description || '',
        instructions: data.project.instructions || '',
      })
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to load project'
      console.error('useProjectDetail: fetch error', errorMsg)
      setError(errorMsg)
    } finally {
      setLoading(false)
    }
  }, [projectId])

  const handleSave = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/projects/${projectId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editForm.name,
          description: editForm.description || null,
          instructions: editForm.instructions || null,
        }),
      })

      if (!res.ok) throw new Error('Failed to update project')
      const data = await res.json()
      setProject(data.project)
      setIsEditing(false)
      showSuccessToast('Project updated!')
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to update project'
      console.error('useProjectDetail: save error', errorMsg)
      showErrorToast(errorMsg)
    }
  }, [projectId, editForm])

  const handleToggleAllowAnyCharacter = useCallback(async () => {
    if (!project) return
    try {
      const res = await fetch(`/api/v1/projects/${projectId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowAnyCharacter: !project.allowAnyCharacter }),
      })

      if (!res.ok) throw new Error('Failed to update project')
      const data = await res.json()
      setProject(data.project)
      showSuccessToast(data.project.allowAnyCharacter ? 'Any character can now participate' : 'Only roster characters can participate')
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to update setting'
      console.error('useProjectDetail: toggle error', errorMsg)
      showErrorToast(errorMsg)
    }
  }, [project, projectId])

  const handleSaveAgentMode = useCallback(async (enabled: boolean | null) => {
    try {
      const res = await fetch(`/api/v1/projects/${projectId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultAgentModeEnabled: enabled }),
      })

      if (!res.ok) throw new Error('Failed to update agent mode setting')
      const data = await res.json()
      setProject(data.project)
      const message = enabled === null
        ? 'Agent mode set to inherit from global/character'
        : enabled
          ? 'Agent mode enabled by default for project'
          : 'Agent mode disabled by default for project'
      showSuccessToast(message)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to update agent mode'
      console.error('useProjectDetail: save agent mode error', errorMsg)
      showErrorToast(errorMsg)
    }
  }, [projectId])

  const handleSaveAnswerConfirmationOverride = useCallback(async (value: 'ON' | 'OFF' | null) => {
    try {
      const res = await fetch(`/api/v1/projects/${projectId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answerConfirmationOverride: value }),
      })

      if (!res.ok) throw new Error('Failed to update answer confirmation setting')
      const data = await res.json()
      setProject(data.project)
      const message = value === null
        ? 'Answer confirmation set to inherit from global'
        : value === 'ON'
          ? 'Answer confirmation enabled by default for project'
          : 'Answer confirmation disabled by default for project'
      showSuccessToast(message)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to update answer confirmation'
      console.error('useProjectDetail: save answer confirmation error', errorMsg)
      showErrorToast(errorMsg)
    }
  }, [projectId])

  const handleSaveAvatarGeneration = useCallback(async (enabled: boolean | null) => {
    try {
      const res = await fetch(`/api/v1/projects/${projectId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultAvatarGenerationEnabled: enabled }),
      })

      if (!res.ok) throw new Error('Failed to update avatar generation setting')
      const data = await res.json()
      setProject(data.project)
      const message = enabled === null
        ? 'Avatar generation set to inherit from global'
        : enabled
          ? 'Avatar generation enabled by default for project'
          : 'Avatar generation disabled by default for project'
      showSuccessToast(message)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to update avatar generation'
      console.error('useProjectDetail: save avatar generation error', errorMsg)
      showErrorToast(errorMsg)
    }
  }, [projectId])

  const handleSaveDefaultImageProfile = useCallback(async (profileId: string | null) => {
    try {
      const res = await fetch(`/api/v1/projects/${projectId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultImageProfileId: profileId }),
      })

      if (!res.ok) throw new Error('Failed to update default image profile')
      const data = await res.json()
      setProject(data.project)
      showSuccessToast(profileId
        ? 'Default image profile set for project'
        : 'Image profile set to inherit from global')
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to update image profile'
      console.error('useProjectDetail: save default image profile error', errorMsg)
      showErrorToast(errorMsg)
    }
  }, [projectId])

  const handleSaveDefaultRoleplayTemplate = useCallback(async (templateId: string | null) => {
    try {
      const res = await fetch(`/api/v1/projects/${projectId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultRoleplayTemplateId: templateId }),
      })

      if (!res.ok) throw new Error('Failed to update default roleplay template')
      const data = await res.json()
      setProject(data.project)
      showSuccessToast(templateId
        ? 'Default roleplay template set for project'
        : 'Roleplay template set to inherit from global')
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to update roleplay template'
      console.error('useProjectDetail: save default roleplay template error', errorMsg)
      showErrorToast(errorMsg)
    }
  }, [projectId])

  const handleSaveAlertCharactersOfLanternImages = useCallback(async (enabled: boolean | null) => {
    try {
      const res = await fetch(`/api/v1/projects/${projectId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultAlertCharactersOfLanternImages: enabled }),
      })

      if (!res.ok) throw new Error('Failed to update Lantern image announcement setting')
      const data = await res.json()
      setProject(data.project)
      const message = enabled === null
        ? 'Lantern image announcements set to inherit from global'
        : enabled
          ? 'Lantern image announcements enabled by default for project'
          : 'Lantern image announcements disabled by default for project'
      showSuccessToast(message)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to update Lantern image announcement setting'
      console.error('useProjectDetail: save alertCharactersOfLanternImages error', errorMsg)
      showErrorToast(errorMsg)
    }
  }, [projectId])

  const handleSaveBackgroundDisplayMode = useCallback(async (mode: BackgroundDisplayMode) => {
    try {
      const res = await fetch(`/api/v1/projects/${projectId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backgroundDisplayMode: mode }),
      })

      if (!res.ok) throw new Error('Failed to update background display mode')
      const data = await res.json()
      setProject(data.project)
      const modeLabels: Record<BackgroundDisplayMode, string> = {
        theme: 'theme background',
        latest_chat: 'latest chat background',
        project: 'project background',
        static: 'static background',
      }
      showSuccessToast(`Background set to ${modeLabels[mode]}`)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to update background mode'
      console.error('useProjectDetail: save background mode error', errorMsg)
      showErrorToast(errorMsg)
    }
  }, [projectId])

  const handleRemoveCharacter = useCallback(async (characterId: string) => {
    try {
      const res = await fetch(`/api/v1/projects/${projectId}?action=remove-character`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ characterId }),
      })

      if (!res.ok) throw new Error('Failed to remove character')
      await fetchProject()
      showSuccessToast('Character removed from project')
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to remove character'
      console.error('useProjectDetail: remove character error', errorMsg)
      showErrorToast(errorMsg)
    }
  }, [projectId, fetchProject])

  return {
    project,
    loading,
    error,
    editForm,
    setEditForm,
    isEditing,
    setIsEditing,
    fetchProject,
    handleSave,
    handleToggleAllowAnyCharacter,
    handleSaveAgentMode,
    handleSaveAnswerConfirmationOverride,
    handleSaveAvatarGeneration,
    handleSaveDefaultImageProfile,
    handleSaveDefaultRoleplayTemplate,
    handleSaveBackgroundDisplayMode,
    handleSaveAlertCharactersOfLanternImages,
    handleRemoveCharacter,
  }
}
