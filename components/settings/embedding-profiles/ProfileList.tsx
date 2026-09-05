'use client'

import { useState } from 'react'
import Link from 'next/link'
import { fetchJson } from '@/lib/fetch-helpers'
import { useAsyncOperation } from '@/hooks/useAsyncOperation'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorAlert } from '@/components/ui/ErrorAlert'
import { ProfileCard, ProfileCardBadge, ProfileCardMetadata } from '@/components/ui/ProfileCard'
import { ProviderBadge } from './ProviderBadge'
import { MissingApiKeyBadge } from '@/components/ui/MissingApiKeyBadge'
import { notifyQueueChange } from '@/components/layout/queue-status-badges'
import type { EmbeddingProfile } from './types'

interface ProfileListProps {
  profiles: EmbeddingProfile[]
  onEdit: (profile: EmbeddingProfile) => void
  onProfilesChange: () => Promise<void>
}

/**
 * List component for displaying embedding profiles with edit/delete actions
 */
export function ProfileList({
  profiles,
  onEdit,
  onProfilesChange,
}: ProfileListProps) {
  const [deleteConfirming, setDeleteConfirming] = useState<string | null>(null)
  const [refitSuccess, setRefitSuccess] = useState<string | null>(null)
  const [reapplyConfirming, setReapplyConfirming] = useState<string | null>(null)
  const [reapplySuccess, setReapplySuccess] = useState<string | null>(null)
  const [reindexMismatchedConfirming, setReindexMismatchedConfirming] = useState<string | null>(null)
  const [reindexMismatchedSuccess, setReindexMismatchedSuccess] = useState<string | null>(null)

  const {
    loading: deleteLoading,
    error: deleteError,
    execute: executeDelete,
    clearError: clearDeleteError,
  } = useAsyncOperation<void>()

  const {
    loading: refitLoading,
    error: refitError,
    execute: executeRefit,
    clearError: clearRefitError,
  } = useAsyncOperation<void>()

  const {
    loading: reapplyLoading,
    error: reapplyError,
    execute: executeReapply,
    clearError: clearReapplyError,
  } = useAsyncOperation<void>()

  const {
    loading: reindexMismatchedLoading,
    error: reindexMismatchedError,
    execute: executeReindexMismatched,
    clearError: clearReindexMismatchedError,
  } = useAsyncOperation<void>()

  const handleDelete = async (id: string) => {
    await executeDelete(async () => {
      const result = await fetchJson('/api/v1/embedding-profiles/' + id, { method: 'DELETE' })
      if (!result.ok) {
        throw new Error(result.error || 'Failed to delete profile')
      }
      await onProfilesChange()
      setDeleteConfirming(null)
    })
  }

  const handleRefit = async (profile: EmbeddingProfile) => {
    setRefitSuccess(null)
    await executeRefit(async () => {
      const action = profile.provider === 'BUILTIN' ? 'refit' : 'reindex'
      const result = await fetchJson(
        `/api/v1/embedding-profiles/${profile.id}?action=${action}`,
        { method: 'POST' }
      )
      if (!result.ok) {
        throw new Error(result.error || `Failed to trigger ${action}`)
      }
      notifyQueueChange()
      setRefitSuccess(profile.provider === 'BUILTIN'
        ? 'Vocabulary refit job queued. Help docs, memories, and conversations will be re-embedded. Track progress via the Emb badge.'
        : 'Re-embedding everything — help docs, memories, and conversations. Track progress via the Emb badge.'
      )
    })
  }

  const handleReapply = async (profile: EmbeddingProfile) => {
    setReapplySuccess(null)
    await executeReapply(async () => {
      const result = await fetchJson(
        `/api/v1/embedding-profiles/${profile.id}?action=reapply`,
        { method: 'POST' }
      )
      if (!result.ok) {
        throw new Error(result.error || 'Failed to trigger re-apply')
      }
      notifyQueueChange()
      setReapplyConfirming(null)
      setReapplySuccess(
        `Matryoshka re-apply queued. Stored vectors will be sliced to ${profile.truncateToDimensions}d and renormalized. ` +
        'A backup of each affected database is taken before any rewrite. Track progress via the Emb badge.'
      )
    })
  }

  const handleReindexMismatched = async (profile: EmbeddingProfile) => {
    setReindexMismatchedSuccess(null)
    const targetDim = profile.truncateToDimensions ?? profile.dimensions
    await executeReindexMismatched(async () => {
      const result = await fetchJson(
        `/api/v1/embedding-profiles/${profile.id}?action=reindex`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scope: 'mismatched-dim' }),
        }
      )
      if (!result.ok) {
        throw new Error(result.error || 'Failed to trigger partial reindex')
      }
      notifyQueueChange()
      setReindexMismatchedConfirming(null)
      setReindexMismatchedSuccess(
        `Partial re-embedding queued. Only rows whose stored vector dim differs from ${targetDim}d will be re-embedded against this profile. Track progress via the Emb badge.`
      )
    })
  }

  if (profiles.length === 0) {
    return (
      <EmptyState
        title="No embedding profiles yet"
        description="Embedding profiles are used for semantic search in memories"
        action={{
          label: 'Create First Profile',
          onClick: () => {
            onEdit({} as EmbeddingProfile)
          },
        }}
      />
    )
  }

  // Check if any provider needs an API key but doesn't have one
  const needsApiKey = (provider: string) => ['OPENAI', 'OPENROUTER', 'NANOGPT'].includes(provider)

  return (
    <div className="space-y-4">
      {deleteError && (
        <ErrorAlert
          message={deleteError}
          onRetry={clearDeleteError}
        />
      )}

      {refitError && (
        <ErrorAlert
          message={refitError}
          onRetry={clearRefitError}
        />
      )}

      {reapplyError && (
        <ErrorAlert
          message={reapplyError}
          onRetry={clearReapplyError}
        />
      )}

      {reindexMismatchedError && (
        <ErrorAlert
          message={reindexMismatchedError}
          onRetry={clearReindexMismatchedError}
        />
      )}

      {reindexMismatchedSuccess && (
        <div className="qt-alert-success">
          <div className="flex items-center justify-between gap-4">
            <p className="qt-label flex-1">{reindexMismatchedSuccess}</p>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Link href="/settings?tab=system" className="qt-button-ghost qt-button-sm">
                View Tasks Queue
              </Link>
              <button
                type="button"
                onClick={() => setReindexMismatchedSuccess(null)}
                className="qt-button-ghost qt-button-sm"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {reapplySuccess && (
        <div className="qt-alert-success">
          <div className="flex items-center justify-between gap-4">
            <p className="qt-label flex-1">{reapplySuccess}</p>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Link href="/settings?tab=system" className="qt-button-ghost qt-button-sm">
                View Tasks Queue
              </Link>
              <button
                type="button"
                onClick={() => setReapplySuccess(null)}
                className="qt-button-ghost qt-button-sm"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {refitSuccess && (
        <div className="qt-alert-success">
          <div className="flex items-center justify-between gap-4">
            <p className="qt-label flex-1">{refitSuccess}</p>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Link href="/settings?tab=system" className="qt-button-ghost qt-button-sm">
                View Tasks Queue
              </Link>
              <button
                type="button"
                onClick={() => setRefitSuccess(null)}
                className="qt-button-ghost qt-button-sm"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="qt-card-grid-auto">
        {profiles.slice().sort((a, b) => a.name.localeCompare(b.name)).map(profile => {
          // Build badges array
          const badges: ProfileCardBadge[] = []
          if (profile.isDefault) {
            badges.push({ text: 'Default', variant: 'default' })
          }

          // Build metadata array
          const metadata: ProfileCardMetadata[] = []

          // Model name (skip for BUILTIN - always tfidf-bm25-v1)
          if (profile.provider !== 'BUILTIN') {
            metadata.push({
              label: 'Model',
              value: <span className="font-mono text-sm text-foreground">{profile.modelName}</span>
            })
          }

          if (profile.dimensions) {
            metadata.push({ label: 'Dimensions', value: profile.dimensions.toString() })
          }
          if (profile.truncateToDimensions) {
            metadata.push({
              label: 'Truncate to',
              value: `${profile.truncateToDimensions} (Matryoshka)`,
            })
          }
          if (profile.apiKey) {
            metadata.push({ label: 'API Key', value: profile.apiKey.label })
          }
          if (profile.baseUrl) {
            metadata.push({ label: 'Base URL', value: profile.baseUrl })
          }

          // Vocabulary stats for BUILTIN profiles
          if (profile.provider === 'BUILTIN' && profile.vocabularyStats) {
            metadata.push({
              label: 'Vocabulary',
              value: `${profile.vocabularyStats.vocabularySize.toLocaleString()} terms`
            })
            metadata.push({
              label: 'Last Fit',
              value: new Date(profile.vocabularyStats.fittedAt).toLocaleString()
            })
          }

          // Build actions array
          const actions = [
            { label: 'Edit', onClick: () => onEdit(profile), variant: 'secondary' as const },
          ]

          // Add refit/reindex button for default profiles
          if (profile.isDefault) {
            actions.push({
              label: profile.provider === 'BUILTIN' ? 'Refit Vocabulary' : 'Re-embed Everything',
              onClick: () => handleRefit(profile),
              variant: 'secondary' as const,
            })
          }

          // Add Matryoshka re-apply button for default profiles with truncation set.
          // Two-step: first click asks for confirmation, second click runs the job.
          if (profile.isDefault && profile.truncateToDimensions) {
            const isConfirming = reapplyConfirming === profile.id
            actions.push({
              label: isConfirming
                ? (reapplyLoading ? 'Queuing…' : `Confirm: slice to ${profile.truncateToDimensions}d`)
                : 'Re-apply (Matryoshka)',
              onClick: isConfirming ? () => handleReapply(profile) : () => setReapplyConfirming(profile.id),
              variant: 'secondary' as const,
            })
          }

          // Add partial-reindex button for default non-BUILTIN profiles whose
          // target dim is determinable. Re-embeds only rows whose stored
          // vector dim differs from this profile's target — useful when an
          // earlier provider left orphans behind that the Matryoshka slicer
          // can't safely fix (different embedding space, not just dim).
          const partialReindexTargetDim =
            profile.truncateToDimensions ?? profile.dimensions
          if (
            profile.isDefault &&
            profile.provider !== 'BUILTIN' &&
            partialReindexTargetDim &&
            partialReindexTargetDim > 0
          ) {
            const isConfirming = reindexMismatchedConfirming === profile.id
            actions.push({
              label: isConfirming
                ? (reindexMismatchedLoading
                    ? 'Queuing…'
                    : `Confirm: re-embed misfits at ${partialReindexTargetDim}d`)
                : 'Re-embed Mismatched',
              onClick: isConfirming
                ? () => handleReindexMismatched(profile)
                : () => setReindexMismatchedConfirming(profile.id),
              variant: 'secondary' as const,
            })
          }

          return (
            <ProfileCard
              key={profile.id}
              title={profile.name}
              badges={badges}
              metadata={metadata}
              actions={actions}
              actionsPosition="footer"
              deleteConfig={{
                isConfirming: deleteConfirming === profile.id,
                onConfirmChange: (confirming) => setDeleteConfirming(confirming ? profile.id : null),
                onConfirm: () => handleDelete(profile.id),
                message: 'Delete this profile?',
                isDeleting: deleteLoading,
              }}
            >
              {/* Custom content: Provider badge, missing API key warning, and embedding stats */}
              <div className="flex flex-col gap-2 mt-1 mb-2">
                <div className="flex items-center gap-2">
                  <ProviderBadge provider={profile.provider} />
                  {needsApiKey(profile.provider) && !profile.apiKey && (
                    <MissingApiKeyBadge />
                  )}
                </div>

                {/* Embedding progress for BUILTIN profiles without vocabulary */}
                {profile.provider === 'BUILTIN' && !profile.vocabularyStats && (
                  <p className="qt-text-xs qt-text-secondary">
                    Vocabulary not yet fitted. Add some memories to get started.
                  </p>
                )}

                {/* Embedding stats if available */}
                {profile.embeddingStats && profile.embeddingStats.total > 0 && (
                  <div className="qt-text-xs qt-text-secondary">
                    Embedded: {profile.embeddingStats.embedded}/{profile.embeddingStats.total}
                    {profile.embeddingStats.pending > 0 && (
                      <span className="qt-text-warning ml-2">
                        ({profile.embeddingStats.pending} pending)
                      </span>
                    )}
                    {profile.embeddingStats.failed > 0 && (
                      <span className="qt-text-destructive ml-2">
                        ({profile.embeddingStats.failed} failed)
                      </span>
                    )}
                  </div>
                )}
              </div>
            </ProfileCard>
          )
        })}
      </div>
    </div>
  )
}
