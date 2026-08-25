'use client'

import { useMemo } from 'react'
import type { Character, CharacterGalleryLink } from './types'

interface ImageMetadataProps {
  imageId: string
  characters: Character[]
  loadingEntities: boolean
  characterGalleryLinks: CharacterGalleryLink[]
  savingToGalleryFor: Set<string>
  settingAvatar: Set<string>
  onAddToCharacterGallery: (characterId: string) => void
  onRemoveFromCharacterGallery: (characterId: string) => void
  onSetAsAvatar: (entityType: 'character', entityId: string) => void
}

export function ImageMetadata({
  imageId,
  characters,
  loadingEntities,
  characterGalleryLinks,
  savingToGalleryFor,
  settingAvatar,
  onAddToCharacterGallery,
  onRemoveFromCharacterGallery,
  onSetAsAvatar,
}: ImageMetadataProps) {
  const inGalleryCharacterIds = useMemo(
    () => new Set(characterGalleryLinks.map((l) => l.characterId)),
    [characterGalleryLinks]
  )

  const { galleryCharacters, availableCharacters } = useMemo(() => {
    const inGallery: Character[] = []
    const available: Character[] = []

    characters.forEach((character) => {
      if (inGalleryCharacterIds.has(character.id)) {
        inGallery.push(character)
      } else {
        available.push(character)
      }
    })

    inGallery.sort((a, b) => a.name.localeCompare(b.name))
    available.sort((a, b) => a.name.localeCompare(b.name))

    return { galleryCharacters: inGallery, availableCharacters: available }
  }, [characters, inGalleryCharacterIds])

  return (
    <div className="qt-panel qt-bg-overlay-medium backdrop-blur-sm w-full max-w-2xl">
      <div className="flex flex-col gap-4">
        {loadingEntities && (
          <p className="qt-text-secondary text-sm">Loading characters...</p>
        )}

        {/* Section 1: Characters whose gallery contains this photo */}
        {!loadingEntities && galleryCharacters.length > 0 && (
          <div>
            <h3 className="text-foreground font-semibold mb-3">In Photo Albums</h3>
            <div className="flex flex-col gap-2">
              {galleryCharacters.map((character) => {
                const isLoading = savingToGalleryFor.has(character.id)
                const isAvatar = character.defaultImageId === imageId
                const isSettingAvatar = settingAvatar.has(`character-${character.id}-avatar`)

                return (
                  <div
                    key={character.id}
                    className="flex items-center gap-2 px-3 py-2 qt-bg-muted/50 rounded"
                  >
                    <span className="flex-1 text-foreground font-medium text-sm">
                      {character.name}
                    </span>
                    {isAvatar ? (
                      <span className="text-xs bg-success qt-text-on-success px-2 py-0.5 rounded">
                        Avatar
                      </span>
                    ) : (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          onSetAsAvatar('character', character.id)
                        }}
                        disabled={isSettingAvatar}
                        className="qt-button-success qt-button-sm"
                        title="Set as avatar"
                      >
                        {isSettingAvatar ? '...' : 'Set Avatar'}
                      </button>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onRemoveFromCharacterGallery(character.id)
                      }}
                      disabled={isLoading}
                      className="w-6 h-6 flex items-center justify-center qt-text-secondary hover:qt-text-destructive hover:qt-bg-destructive/20 rounded transition-colors disabled:opacity-50"
                      title="Remove from photo album"
                    >
                      {isLoading ? '...' : '×'}
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Section 2: Save to character photo album */}
        {!loadingEntities && availableCharacters.length > 0 && (
          <div>
            <label
              htmlFor="add-to-character-gallery"
              className="block text-foreground font-semibold mb-2"
            >
              Save to photo album
            </label>
            <select
              id="add-to-character-gallery"
              className="qt-select w-full"
              value=""
              onChange={(e) => {
                if (e.target.value) {
                  onAddToCharacterGallery(e.target.value)
                }
              }}
            >
              <option value="" disabled>
                Select a character...
              </option>
              {availableCharacters.map((character) => (
                <option key={character.id} value={character.id}>
                  {character.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* No characters available message */}
        {!loadingEntities && characters.length === 0 && (
          <p className="qt-text-secondary text-sm">No characters available.</p>
        )}
      </div>
    </div>
  )
}
