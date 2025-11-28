'use client'

import { useCallback, useEffect, useState } from 'react'
import { PhysicalDescriptionCard, PhysicalDescription } from './physical-description-card'
import { PhysicalDescriptionEditor } from './physical-description-editor'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { showConfirmation } from '@/lib/alert'

interface PhysicalDescriptionListProps {
  entityType: 'character' | 'persona'
  entityId: string
}

export function PhysicalDescriptionList({ entityType, entityId }: PhysicalDescriptionListProps) {
  const [descriptions, setDescriptions] = useState<PhysicalDescription[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [editingDescription, setEditingDescription] = useState<PhysicalDescription | null>(null)
  const [showEditor, setShowEditor] = useState(false)

  const fetchDescriptions = useCallback(async () => {
    try {
      setLoading(true)
      const baseUrl = entityType === 'character'
        ? `/api/characters/${entityId}/descriptions`
        : `/api/personas/${entityId}/descriptions`

      const res = await fetch(baseUrl)
      if (!res.ok) throw new Error('Failed to fetch descriptions')
      const data = await res.json()
      setDescriptions(data.descriptions)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }, [entityType, entityId])

  useEffect(() => {
    fetchDescriptions()
  }, [fetchDescriptions])

  const handleDelete = async (descriptionId: string) => {
    const confirmed = await showConfirmation('Are you sure you want to delete this description?')
    if (!confirmed) return

    setDeletingId(descriptionId)
    try {
      const baseUrl = entityType === 'character'
        ? `/api/characters/${entityId}/descriptions`
        : `/api/personas/${entityId}/descriptions`

      const res = await fetch(`${baseUrl}/${descriptionId}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error('Failed to delete description')
      setDescriptions(descriptions.filter(d => d.id !== descriptionId))
      showSuccessToast('Description deleted')
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to delete')
    } finally {
      setDeletingId(null)
    }
  }

  const handleEdit = (description: PhysicalDescription) => {
    setEditingDescription(description)
    setShowEditor(true)
  }

  const handleCreate = () => {
    setEditingDescription(null)
    setShowEditor(true)
  }

  const handleEditorClose = () => {
    setShowEditor(false)
    setEditingDescription(null)
  }

  const handleEditorSave = () => {
    setShowEditor(false)
    setEditingDescription(null)
    fetchDescriptions()
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <p className="text-red-600 dark:text-red-400 mb-4">{error}</p>
        <button
          onClick={fetchDescriptions}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          Retry
        </button>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
          Physical Descriptions
        </h3>
        <button
          onClick={handleCreate}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Description
        </button>
      </div>

      {descriptions.length === 0 ? (
        <div className="text-center py-8 border border-dashed border-gray-300 dark:border-slate-600 rounded-lg">
          <svg
            className="mx-auto h-12 w-12 text-gray-400 dark:text-gray-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            No physical descriptions yet
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
            Add descriptions to use for image generation prompts
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {descriptions.map((description) => (
            <PhysicalDescriptionCard
              key={description.id}
              description={description}
              onEdit={handleEdit}
              onDelete={handleDelete}
              isDeleting={deletingId === description.id}
            />
          ))}
        </div>
      )}

      {showEditor && (
        <PhysicalDescriptionEditor
          entityType={entityType}
          entityId={entityId}
          description={editingDescription}
          onClose={handleEditorClose}
          onSave={handleEditorSave}
        />
      )}
    </div>
  )
}
