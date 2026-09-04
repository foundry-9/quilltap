'use client'

/**
 * ChatProjectModal Component
 *
 * Simple modal dialog for assigning or unassigning a chat to/from a project.
 * Moved out of ChatSettingsModal for easier access from the tool palette.
 */

import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch, apiErrorMessage } from '@/lib/query/fetcher'
import { patchChat } from '@/lib/chat/patch-chat'
import { queryKeys } from '@/lib/query/keys'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { BaseModal } from '@/components/ui/BaseModal'

interface Project {
  id: string
  name: string
  color?: string | null
}

interface ChatProjectModalProps {
  isOpen: boolean
  onClose: () => void
  chatId: string
  projectId?: string | null
  projectName?: string | null
  onSuccess?: () => void
}

export default function ChatProjectModal({
  isOpen,
  onClose,
  chatId,
  projectId: initialProjectId,
  projectName: initialProjectName,
  onSuccess,
}: Readonly<ChatProjectModalProps>) {
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    initialProjectId ?? null
  )
  const [saving, setSaving] = useState(false)

  // Sync local state when upstream prop changes
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- user-editable local state must re-sync when upstream <prop> changes (parent renders unconditionally)
    setSelectedProjectId(initialProjectId ?? null)
  }, [initialProjectId])

  const { data: projectsData, isLoading } = useQuery({
    queryKey: queryKeys.projects.list(),
    queryFn: ({ signal }) => apiFetch<{ projects: Project[] }>('/api/v1/projects', { signal }),
    enabled: isOpen,
  })
  const projects = projectsData?.projects || []

  const handleProjectChange = async (projectId: string | null) => {
    // If same as current, just close
    if (projectId === initialProjectId) {
      onClose()
      return
    }

    try {
      setSaving(true)

      await patchChat(chatId, { projectId })

      setSelectedProjectId(projectId)

      const projectName = projectId
        ? projects.find(p => p.id === projectId)?.name
        : null

      showSuccessToast(
        projectId
          ? `Chat moved to "${projectName}"`
          : 'Chat removed from project'
      )

      onSuccess?.()
      onClose()
    } catch (error) {
      const errorMessage = apiErrorMessage(error, 'Failed to update project')
      console.error('[ChatProjectModal] Failed to update project', {
        chatId,
        projectId,
        error: errorMessage,
      })
      showErrorToast(errorMessage || 'Failed to update project')
    } finally {
      setSaving(false)
    }
  }

  const handleSubmit = () => {
    handleProjectChange(selectedProjectId)
  }

  const footer = (
    <div className="flex justify-end gap-2">
      <button
        onClick={onClose}
        disabled={saving}
        className="qt-button qt-button-secondary"
      >
        Cancel
      </button>
      <button
        onClick={handleSubmit}
        disabled={saving || isLoading}
        className="qt-button qt-button-primary"
      >
        {saving ? 'Saving...' : 'Save'}
      </button>
    </div>
  )

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title="Assign to Project"
      footer={footer}
      closeOnClickOutside={!saving}
      closeOnEscape={!saving}
    >
      <div className="space-y-4">
        {initialProjectName && (
          <p className="qt-text-small">
            Currently in: <span className="font-medium">{initialProjectName}</span>
          </p>
        )}

        <div>
          <label htmlFor="chat-project" className="qt-label mb-2">
            Select Project
          </label>
          <select
            id="chat-project"
            value={selectedProjectId || ''}
            onChange={(e) => setSelectedProjectId(e.target.value || null)}
            disabled={saving || isLoading}
            className="qt-select w-full"
          >
            <option value="">No project</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          {isLoading && (
            <p className="qt-text-xs mt-2">Loading projects...</p>
          )}
        </div>

        <p className="qt-text-xs qt-text-secondary">
          Organize this chat by assigning it to a project, or remove it from its current project.
        </p>
      </div>
    </BaseModal>
  )
}
