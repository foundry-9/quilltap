import { forwardRef } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ProfileCard as BaseProfileCard, ProfileCardBadge } from '@/components/ui/ProfileCard'
import { TagBadge } from '@/components/tags/tag-badge'
import { MissingApiKeyBadge } from '@/components/ui/MissingApiKeyBadge'
import { getProfileAttachmentSupportDescription } from '@/lib/llm/connection-profile-utils'
import { getModelClass } from '@/lib/llm/model-classes'
import { formatTokenCount } from '@/lib/utils/format-tokens'
import type { ConnectionProfile } from './types'

interface ProfileCardProps {
  profile: ConnectionProfile
  cheapDefaultProfileId: string | null
  /** Whether this profile's provider requires an API key */
  providerRequiresApiKey?: boolean
  onEdit: (profile: ConnectionProfile) => void
  onDelete: (profileId: string) => void
  deleteConfirming: string | null
  onDeleteConfirmChange: (profileId: string | null) => void
  isDeleting: boolean
  onAutoConfigure?: (profileId: string) => void
  isAutoConfiguring?: boolean
}

/**
 * Drag handle icon (6-dot grip)
 */
const DragHandle = forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
  function DragHandle(props, ref) {
    return (
      <button
        ref={ref}
        className="cursor-grab active:cursor-grabbing p-1 rounded hover:bg-accent/50 qt-text-secondary hover:text-foreground transition-colors touch-none"
        aria-label="Drag to reorder"
        {...props}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <circle cx="5" cy="3" r="1.5" />
          <circle cx="11" cy="3" r="1.5" />
          <circle cx="5" cy="8" r="1.5" />
          <circle cx="11" cy="8" r="1.5" />
          <circle cx="5" cy="13" r="1.5" />
          <circle cx="11" cy="13" r="1.5" />
        </svg>
      </button>
    )
  }
)

/**
 * Inner profile card content (shared between sortable and non-sortable versions)
 */
function ProfileCardContent({
  profile,
  cheapDefaultProfileId,
  providerRequiresApiKey = true,
  onEdit,
  onDelete,
  deleteConfirming,
  onDeleteConfirmChange,
  isDeleting,
  onAutoConfigure,
  isAutoConfiguring,
}: ProfileCardProps) {
  // Check if API key is missing when provider requires one
  const isMissingApiKey = providerRequiresApiKey && !profile.apiKey

  // Build badges array
  const badges: ProfileCardBadge[] = []
  if (profile.isDefault) {
    badges.push({ text: 'Default', variant: 'default' })
  }
  if (profile.id === cheapDefaultProfileId) {
    badges.push({ text: 'Default Cheap', variant: 'cheapDefault' })
  } else if (profile.isCheap) {
    badges.push({ text: 'Cheap', variant: 'cheap' })
  }
  if (profile.isDangerousCompatible) {
    badges.push({ text: 'Uncensored', variant: 'destructive' })
  }
  if (profile.allowToolUse === false) {
    badges.push({ text: 'No Tools', variant: 'destructive' })
  }
  if (profile.modelClass) {
    const mc = getModelClass(profile.modelClass)
    if (mc) {
      badges.push({ text: `${mc.name} (Tier ${mc.tier})`, variant: 'default' })
    }
  }

  return (
    <BaseProfileCard
      title={profile.name}
      subtitle={`${profile.provider} • ${profile.modelName}`}
      badges={badges}
      actions={[
        { label: 'Edit', onClick: () => onEdit(profile), variant: 'primary' },
        ...(onAutoConfigure ? [{
          label: 'Auto-Configure',
          onClick: () => onAutoConfigure(profile.id),
          variant: 'secondary' as const,
          loading: isAutoConfiguring,
          loadingLabel: 'Configuring...',
        }] : []),
      ]}
      deleteConfig={{
        isConfirming: deleteConfirming === profile.id,
        onConfirmChange: (confirming) => onDeleteConfirmChange(confirming ? profile.id : null),
        onConfirm: () => onDelete(profile.id),
        message: 'Delete this profile?',
        isDeleting: isDeleting,
      }}
    >
      {/* Missing API key warning */}
      {isMissingApiKey && (
        <div className="mt-1">
          <MissingApiKeyBadge />
        </div>
      )}

      {/* Attachment support description */}
      <p className="qt-text-xs mt-1">
        {getProfileAttachmentSupportDescription(profile as any)}
      </p>

      {/* Usage stats */}
      {(profile.messageCount !== undefined || profile.totalTokens !== undefined) && (
        <div className="text-sm text-primary mt-1 font-medium">
          {profile.messageCount !== undefined && (
            <span>{profile.messageCount} message{profile.messageCount === 1 ? '' : 's'}</span>
          )}
          {profile.messageCount !== undefined && profile.totalTokens !== undefined && (
            <span className="qt-text-secondary"> • </span>
          )}
          {profile.totalTokens !== undefined && profile.totalTokens > 0 && (
            <span>{formatTokenCount(profile.totalTokens)} tokens</span>
          )}
        </div>
      )}

      {/* API Key info */}
      {profile.apiKey && (
        <p className="qt-text-small">
          API Key: {profile.apiKey.label}
        </p>
      )}

      {/* Base URL */}
      {profile.baseUrl && (
        <p className="qt-text-small">
          Base URL: {profile.baseUrl}
        </p>
      )}

      {/* Model parameters */}
      <div className="qt-text-xs mt-2">
        Temperature: {profile.parameters?.temperature ?? 0.7} •
        Max Tokens: {profile.parameters?.max_tokens ?? 1000} •
        Top P: {profile.parameters?.top_p ?? 1}
      </div>

      {/* Tags */}
      {profile.tags && profile.tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {profile.tags.map(({ tagId, tag }) => (
            <TagBadge key={tagId} tag={tag} size="sm" />
          ))}
        </div>
      )}
    </BaseProfileCard>
  )
}

/**
 * Sortable profile card component
 * Wraps profile content with @dnd-kit sortable behavior and a drag handle
 */
export function ProfileCard(props: ProfileCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: props.profile.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
    zIndex: isDragging ? 10 : undefined,
  }

  return (
    <div ref={setNodeRef} style={style} {...attributes} className="relative">
      <div className="absolute left-0 top-3 -ml-1 z-10">
        <DragHandle ref={setActivatorNodeRef} {...listeners} />
      </div>
      <div className="pl-6">
        <ProfileCardContent {...props} />
      </div>
    </div>
  )
}
