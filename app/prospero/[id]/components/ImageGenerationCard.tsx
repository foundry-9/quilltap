'use client'

/**
 * Image Generation Card
 *
 * Card displaying avatar generation, default image profile, and story background
 * settings for a project. Spans the full grid width because it hosts the Lexical
 * aesthetic editors, which need room rather than a cramped single column.
 */

import type { Project, BackgroundDisplayMode } from '../types'
import { ChevronIcon } from '@/components/ui/ChevronIcon'
import { AestheticEditorField } from '@/components/settings/AestheticEditorField'
import { Icon } from '@/components/ui/icon'

interface ImageProfile {
  id: string
  name: string
  provider: string
  modelName: string
}

interface ImageGenerationCardProps {
  project: Project
  imageProfiles: ImageProfile[]
  onAvatarGenerationChange: (enabled: boolean | null) => void
  onDefaultImageProfileChange: (profileId: string | null) => void
  onBackgroundDisplayModeChange: (mode: BackgroundDisplayMode) => void
  onAlertCharactersOfLanternImagesChange: (enabled: boolean | null) => void
  expanded: boolean
  onToggle: () => void
}


export function ImageGenerationCard({
  project,
  imageProfiles,
  onAvatarGenerationChange,
  onDefaultImageProfileChange,
  onBackgroundDisplayModeChange,
  onAlertCharactersOfLanternImagesChange,
  expanded,
  onToggle,
}: ImageGenerationCardProps) {
  return (
    <div className="qt-card qt-bg-card qt-border rounded-lg overflow-hidden col-span-full">
      {/* Header - always visible */}
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-4 hover:qt-bg-muted transition-colors"
      >
        <div className="flex items-center gap-3">
          <Icon name="image" className="w-5 h-5 qt-text-primary" />
          <div className="text-left">
            <h3 className="qt-heading-4 text-foreground">Image Generation</h3>
            <p className="qt-text-small qt-text-secondary">
              Avatars, image profiles &amp; story backgrounds
            </p>
          </div>
        </div>
        <ChevronIcon className="w-5 h-5 qt-text-secondary" expanded={expanded} />
      </button>

      {/* Content - expandable */}
      {expanded && (
        <div className="border-t qt-border-default p-4 space-y-4">
          {/* Avatar Generation Setting */}
          <div className="p-3 rounded-lg qt-border qt-bg-surface">
            <h4 className="qt-label text-foreground mb-1">Avatar Generation</h4>
            <p className="qt-text-xs qt-text-secondary mb-2">
              Auto-generate character avatars when outfits change in new chats.
            </p>
            <select
              value={project.defaultAvatarGenerationEnabled === null || project.defaultAvatarGenerationEnabled === undefined ? 'inherit' : project.defaultAvatarGenerationEnabled ? 'enabled' : 'disabled'}
              onChange={(e) => {
                const value = e.target.value
                onAvatarGenerationChange(value === 'inherit' ? null : value === 'enabled')
              }}
              className="qt-input w-full max-w-xs"
            >
              <option value="inherit">Inherit from global</option>
              <option value="enabled">Enabled by default</option>
              <option value="disabled">Disabled by default</option>
            </select>
          </div>

          {/* Default Image Profile Setting */}
          <div className="p-3 rounded-lg qt-border qt-bg-surface">
            <h4 className="qt-label text-foreground mb-1">Default Image Profile</h4>
            <p className="qt-text-xs qt-text-secondary mb-2">
              Image generation profile for new chats in this project. Overrides both the global default and character defaults.
            </p>
            <select
              value={project.defaultImageProfileId || ''}
              onChange={(e) => {
                const value = e.target.value
                onDefaultImageProfileChange(value || null)
              }}
              className="qt-input w-full max-w-xs"
            >
              <option value="">Inherit from global default</option>
              {imageProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name} ({profile.provider} / {profile.modelName})
                </option>
              ))}
            </select>
          </div>

          {/* Alert Characters of Lantern Images Setting */}
          <div className="p-3 rounded-lg qt-border qt-bg-surface">
            <h4 className="qt-label text-foreground mb-1">Announce Lantern Images to Characters</h4>
            <p className="qt-text-xs qt-text-secondary mb-2">
              When the Lantern produces a background, an avatar, or any generated picture, post an announcement in the chat so every character may behold it on their next turn.
            </p>
            <select
              value={project.defaultAlertCharactersOfLanternImages === null || project.defaultAlertCharactersOfLanternImages === undefined ? 'inherit' : project.defaultAlertCharactersOfLanternImages ? 'enabled' : 'disabled'}
              onChange={(e) => {
                const value = e.target.value
                onAlertCharactersOfLanternImagesChange(value === 'inherit' ? null : value === 'enabled')
              }}
              className="qt-input w-full max-w-xs"
            >
              <option value="inherit">Inherit from global</option>
              <option value="enabled">Announce to characters</option>
              <option value="disabled">Keep silent</option>
            </select>
          </div>

          {/* Story Backgrounds Setting */}
          <div className="p-3 rounded-lg qt-border qt-bg-surface">
            <h4 className="qt-label text-foreground mb-1">Story Backgrounds</h4>
            <p className="qt-text-xs qt-text-secondary mb-2">
              Choose how the project background is displayed. Backgrounds are generated from chat titles and characters.
            </p>
            <select
              value={project.backgroundDisplayMode || 'theme'}
              onChange={(e) => onBackgroundDisplayModeChange(e.target.value as BackgroundDisplayMode)}
              className="qt-input w-full max-w-xs"
            >
              <option value="theme">Use theme background (no image)</option>
              <option value="latest_chat">Latest chat background</option>
            </select>
            <p className="qt-text-xs qt-text-secondary mt-2">
              {project.backgroundDisplayMode === 'latest_chat' && 'Shows the most recent background from any chat in this project.'}
              {(!project.backgroundDisplayMode || project.backgroundDisplayMode === 'theme') && 'No background image, uses your theme colors.'}
            </p>
          </div>

          {/* Default Aesthetics — project override of the global house style. */}
          <div className="p-3 rounded-lg qt-border qt-bg-surface space-y-6">
            <div>
              <h4 className="qt-label text-foreground mb-1">Default Aesthetics</h4>
              <p className="qt-text-xs qt-text-secondary">
                Override the global house style for images in this project. Leave a field empty to inherit the global default.
              </p>
            </div>
            <AestheticEditorField
              label="Default Image Aesthetic"
              description="Overall look for scenes and backgrounds in this project."
              loadUrl={`/api/v1/projects/${project.id}?action=aesthetic&kind=lantern`}
              namespace={`ProjectImageAesthetic-${project.id}`}
            />
            <AestheticEditorField
              label="Default Character Aesthetic"
              description="How people and outfits are depicted in this project's images."
              loadUrl={`/api/v1/projects/${project.id}?action=aesthetic&kind=aurora`}
              namespace={`ProjectCharacterAesthetic-${project.id}`}
            />
          </div>
        </div>
      )}
    </div>
  )
}
