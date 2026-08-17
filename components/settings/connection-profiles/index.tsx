'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { LoadingState } from '@/components/ui/LoadingState'
import { ErrorAlert } from '@/components/ui/ErrorAlert'
import { ProfileList } from './ProfileList'
import { ProfileModal } from './ProfileModal'
import { useConnectionProfiles } from './hooks/useConnectionProfiles'
import { useProfileForm } from './hooks/useProfileForm'
import { fetchJson } from '@/lib/fetch-helpers'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { normalizeProfileName } from '@/lib/llm/connection-profile-names'
import type { ConnectionProfile } from './types'

/**
 * Main connection profiles component
 * Orchestrates profile list, modal, and all operations
 */
export default function ConnectionProfilesTab() {
  // Profile and UI state management
  const {
    profiles,
    apiKeys,
    providers,
    cheapDefaultProfileId,
    fetchOp,
    deleteOp,
    fetchProfiles,
    fetchApiKeys,
    fetchProviders,
    fetchChatSettings,
    handleDelete,
    triggerAutoAssociate,
    reorderProfiles,
    resetSort,
  } = useConnectionProfiles()

  // Form state and operations
  const {
    form,
    saveOp,
    connectOp,
    fetchModelsOp,
    testMessageOp,
    autoConfigureOp,
    getProviderRequirements,
    resetForm,
    loadProfileIntoForm,
    handleConnect,
    handleFetchModels,
    handleTestMessage,
    handleAutoConfigure,
    handleSubmit,
  } = useProfileForm(providers, apiKeys)

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingProfile, setEditingProfile] = useState<ConnectionProfile | null>(null)
  const [deleteConfirming, setDeleteConfirming] = useState<string | null>(null)
  const [autoConfiguringId, setAutoConfiguringId] = useState<string | null>(null)

  // Trigger auto-association on mount (fire and forget)
  useEffect(() => {
    triggerAutoAssociate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Initialize data on mount - only run once
  useEffect(() => {
    fetchProfiles()
    fetchApiKeys()
    fetchProviders()
    fetchChatSettings()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleEdit = useCallback(
    (profile: ConnectionProfile) => {
      loadProfileIntoForm(profile)
      setEditingProfile(profile)
      setIsModalOpen(true)
    },
    [loadProfileIntoForm]
  )

  const handleOpenModal = useCallback(() => {
    resetForm()
    setEditingProfile(null)
    setIsModalOpen(true)
  }, [resetForm])

  const handleCloseModal = useCallback(() => {
    setIsModalOpen(false)
    setEditingProfile(null)
    resetForm()
  }, [resetForm])

  const handleModalSuccess = useCallback(() => {
    fetchProfiles()
    fetchApiKeys()
  }, [fetchProfiles, fetchApiKeys])

  const handleDeleteClick = useCallback(
    async (profileId: string) => {
      await handleDelete(profileId)
      setDeleteConfirming(null)
    },
    [handleDelete]
  )

  // Normalized names already in use, excluding the profile being edited — feeds
  // the modal's inline duplicate-name validation and unique auto-name suggestion.
  const takenNames = useMemo(
    () =>
      new Set(
        profiles
          .filter((p) => p.id !== editingProfile?.id)
          .map((p) => normalizeProfileName(p.name))
      ),
    [profiles, editingProfile]
  )

  const handleAutoConfigureCard = useCallback(async (profileId: string) => {
    setAutoConfiguringId(profileId)
    try {
      const result = await fetchJson<any>(
        `/api/v1/connection-profiles/${profileId}?action=auto-configure`,
        { method: 'POST' }
      )
      if (!result.ok) {
        showErrorToast(result.error || 'Auto-configure failed')
      } else {
        showSuccessToast('Profile auto-configured successfully')
        fetchProfiles()
      }
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Auto-configure failed')
    } finally {
      setAutoConfiguringId(null)
    }
  }, [fetchProfiles])

  if (fetchOp.loading) {
    return <LoadingState message="Loading connection profiles..." />
  }

  return (
    <div>
      {fetchOp.error && (
        <ErrorAlert
          message={fetchOp.error}
          onRetry={() => fetchProfiles()}
          className="mb-4"
        />
      )}

      {apiKeys.length === 0 && (
        <div className="qt-alert-warning mb-6">
          <p className="font-medium">No API keys found</p>
          <p className="qt-text-small">
            Add an API key in the &quot;API Keys&quot; tab before creating a connection profile.
          </p>
        </div>
      )}

      {/* Profiles List - always visible */}
      <ProfileList
        profiles={profiles}
        cheapDefaultProfileId={cheapDefaultProfileId}
        providers={providers}
        showForm={false}
        deleteConfirming={deleteConfirming}
        isDeleting={deleteOp.loading}
        onEdit={handleEdit}
        onDelete={handleDeleteClick}
        onDeleteConfirmChange={setDeleteConfirming}
        onAddClick={handleOpenModal}
        onReorder={reorderProfiles}
        onResetSort={resetSort}
        onAutoConfigure={handleAutoConfigureCard}
        autoConfiguringId={autoConfiguringId}
      />

      {/* Profile Modal - key ensures remount when switching profiles */}
      <ProfileModal
        key={editingProfile?.id || 'new'}
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        onSuccess={handleModalSuccess}
        profile={editingProfile}
        apiKeys={apiKeys}
        providers={providers}
        takenNames={takenNames}
        form={{
          formData: form.formData,
          setField: form.setField,
          handleChange: form.handleChange,
          resetForm: resetForm,
        }}
        operations={{
          saveLoading: saveOp.loading,
          connectLoading: connectOp.loading,
          connectError: connectOp.error,
          fetchModelsLoading: fetchModelsOp.loading,
          testMessageLoading: testMessageOp.loading,
          autoConfigureLoading: autoConfigureOp.loading,
          handleConnect,
          handleFetchModels,
          handleTestMessage,
          handleAutoConfigure,
          handleSubmit,
          getProviderRequirements,
        }}
      />
    </div>
  )
}
