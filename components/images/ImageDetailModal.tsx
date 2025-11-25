'use client'

import { useState, useEffect, useCallback } from 'react'
import Image from 'next/image'
import { showSuccessToast, showErrorToast } from '@/lib/toast'

interface ImageData {
  id: string
  filename: string
  filepath: string
  url?: string
  mimeType: string
  size: number
  width?: number
  height?: number
  createdAt: string
  tags?: Array<{
    id?: string
    tagType: string
    tagId: string
  }>
}

interface Character {
  id: string
  name: string
}

interface Persona {
  id: string
  name: string
}

interface ImageDetailModalProps {
  isOpen: boolean
  onClose: () => void
  image: ImageData
  onPrev?: () => void
  onNext?: () => void
}

export default function ImageDetailModal({
  isOpen,
  onClose,
  image,
  onPrev,
  onNext,
}: ImageDetailModalProps) {
  const [characters, setCharacters] = useState<Character[]>([])
  const [personas, setPersonas] = useState<Persona[]>([])
  const [loadingEntities, setLoadingEntities] = useState(true)
  const [taggedCharacterIds, setTaggedCharacterIds] = useState<Set<string>>(new Set())
  const [taggedPersonaIds, setTaggedPersonaIds] = useState<Set<string>>(new Set())
  const [taggingInProgress, setTaggingInProgress] = useState<Set<string>>(new Set())

  // Load characters and personas on mount
  useEffect(() => {
    const loadEntities = async () => {
      try {
        setLoadingEntities(true)
        const [charsRes, personasRes] = await Promise.all([
          fetch('/api/characters'),
          fetch('/api/personas'),
        ])

        if (charsRes.ok) {
          const charsData = await charsRes.json()
          setCharacters(charsData.characters || [])
        }
        if (personasRes.ok) {
          const personasData = await personasRes.json()
          setPersonas(personasData.personas || [])
        }
      } catch (error) {
        console.error('Failed to load entities:', error)
      } finally {
        setLoadingEntities(false)
      }
    }

    if (isOpen) {
      loadEntities()
    }
  }, [isOpen])

  // Update tagged entities when image changes
  useEffect(() => {
    if (image.tags) {
      const charIds = new Set<string>()
      const personaIds = new Set<string>()

      image.tags.forEach((tag) => {
        const tagId = tag.tagId
        if (characters.some((c) => c.id === tagId)) {
          charIds.add(tagId)
        }
        if (personas.some((p) => p.id === tagId)) {
          personaIds.add(tagId)
        }
      })

      setTaggedCharacterIds(charIds)
      setTaggedPersonaIds(personaIds)
    } else {
      setTaggedCharacterIds(new Set())
      setTaggedPersonaIds(new Set())
    }
  }, [image, characters, personas])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      } else if (e.key === 'ArrowLeft' && onPrev) {
        onPrev()
      } else if (e.key === 'ArrowRight' && onNext) {
        onNext()
      }
    },
    [onClose, onPrev, onNext]
  )

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown)
      document.body.style.overflow = 'hidden'
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = ''
    }
  }, [isOpen, handleKeyDown])

  const toggleCharacterTag = async (characterId: string) => {
    const isTagged = taggedCharacterIds.has(characterId)
    const key = `char-${characterId}`

    try {
      setTaggingInProgress((prev) => new Set(prev).add(key))

      if (isTagged) {
        // Remove tag
        const params = new URLSearchParams({
          tagType: 'CHARACTER',
          tagId: characterId,
        })
        const response = await fetch(`/api/images/${image.id}/tags?${params.toString()}`, {
          method: 'DELETE',
        })

        if (!response.ok) {
          const data = await response.json()
          throw new Error(data.error || 'Failed to remove tag')
        }

        setTaggedCharacterIds((prev) => {
          const newSet = new Set(prev)
          newSet.delete(characterId)
          return newSet
        })
        showSuccessToast('Removed from character gallery')
      } else {
        // Add tag
        const response = await fetch(`/api/images/${image.id}/tags`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tagType: 'CHARACTER',
            tagId: characterId,
          }),
        })

        if (!response.ok) {
          const data = await response.json()
          throw new Error(data.error || 'Failed to add tag')
        }

        setTaggedCharacterIds((prev) => new Set(prev).add(characterId))
        showSuccessToast('Added to character gallery')
      }
    } catch (error) {
      showErrorToast(error instanceof Error ? error.message : 'Failed to update tag')
    } finally {
      setTaggingInProgress((prev) => {
        const newSet = new Set(prev)
        newSet.delete(key)
        return newSet
      })
    }
  }

  const togglePersonaTag = async (personaId: string) => {
    const isTagged = taggedPersonaIds.has(personaId)
    const key = `persona-${personaId}`

    try {
      setTaggingInProgress((prev) => new Set(prev).add(key))

      if (isTagged) {
        // Remove tag
        const params = new URLSearchParams({
          tagType: 'PERSONA',
          tagId: personaId,
        })
        const response = await fetch(`/api/images/${image.id}/tags?${params.toString()}`, {
          method: 'DELETE',
        })

        if (!response.ok) {
          const data = await response.json()
          throw new Error(data.error || 'Failed to remove tag')
        }

        setTaggedPersonaIds((prev) => {
          const newSet = new Set(prev)
          newSet.delete(personaId)
          return newSet
        })
        showSuccessToast('Removed from persona gallery')
      } else {
        // Add tag
        const response = await fetch(`/api/images/${image.id}/tags`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tagType: 'PERSONA',
            tagId: personaId,
          }),
        })

        if (!response.ok) {
          const data = await response.json()
          throw new Error(data.error || 'Failed to add tag')
        }

        setTaggedPersonaIds((prev) => new Set(prev).add(personaId))
        showSuccessToast('Added to persona gallery')
      }
    } catch (error) {
      showErrorToast(error instanceof Error ? error.message : 'Failed to update tag')
    } finally {
      setTaggingInProgress((prev) => {
        const newSet = new Set(prev)
        newSet.delete(key)
        return newSet
      })
    }
  }

  const handleDownload = async () => {
    try {
      const src = image.url || `/${image.filepath}`
      const response = await fetch(src)
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = image.filename
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
    } catch (error) {
      console.error('Failed to download image:', error)
    }
  }

  if (!isOpen) return null

  const imageSrc = image.url || `/${image.filepath}`

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* Navigation buttons - left and right sides */}
      {onPrev && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onPrev()
          }}
          className="absolute left-4 top-1/2 -translate-y-1/2 p-3 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors z-10"
          title="Previous image (Left Arrow)"
        >
          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      )}

      {onNext && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onNext()
          }}
          className="absolute right-4 top-1/2 -translate-y-1/2 p-3 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors z-10"
          title="Next image (Right Arrow)"
        >
          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      )}

      {/* Top right control buttons */}
      <div className="absolute top-4 right-4 flex gap-2 z-10">
        {/* Download button */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            handleDownload()
          }}
          className="p-2 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors"
          title="Download"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
            />
          </svg>
        </button>
        {/* Close button */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            onClose()
          }}
          className="p-2 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors"
          title="Close (Escape)"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Image container */}
      <div
        className="relative max-w-[90vw] max-h-[90vh] flex flex-col items-center justify-center gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <Image
          src={imageSrc}
          alt={image.filename}
          width={1920}
          height={1080}
          className="max-w-full max-h-[70vh] w-auto h-auto object-contain"
          priority
        />

        {/* Tag buttons panel */}
        <div className="bg-black/70 backdrop-blur-sm rounded-lg p-6 w-full max-w-2xl">
          <div className="flex flex-col gap-4">
            {/* Character tags */}
            {!loadingEntities && characters.length > 0 && (
              <div>
                <h3 className="text-white font-semibold mb-3">Tag to Character</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {characters.map((character) => {
                    const isTagged = taggedCharacterIds.has(character.id)
                    const isLoading = taggingInProgress.has(`char-${character.id}`)

                    return (
                      <button
                        key={character.id}
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleCharacterTag(character.id)
                        }}
                        disabled={isLoading}
                        className={`px-4 py-2 rounded transition-all font-medium text-sm ${
                          isTagged
                            ? 'bg-blue-600 text-white hover:bg-blue-700 ring-2 ring-blue-400'
                            : 'bg-gray-600 text-gray-100 hover:bg-gray-700'
                        } ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                        {isLoading ? '...' : character.name}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Persona tags */}
            {!loadingEntities && personas.length > 0 && (
              <div>
                <h3 className="text-white font-semibold mb-3">Tag to Persona</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {personas.map((persona) => {
                    const isTagged = taggedPersonaIds.has(persona.id)
                    const isLoading = taggingInProgress.has(`persona-${persona.id}`)

                    return (
                      <button
                        key={persona.id}
                        onClick={(e) => {
                          e.stopPropagation()
                          togglePersonaTag(persona.id)
                        }}
                        disabled={isLoading}
                        className={`px-4 py-2 rounded transition-all font-medium text-sm ${
                          isTagged
                            ? 'bg-purple-600 text-white hover:bg-purple-700 ring-2 ring-purple-400'
                            : 'bg-gray-600 text-gray-100 hover:bg-gray-700'
                        } ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                        {isLoading ? '...' : persona.name}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {loadingEntities && <p className="text-gray-300 text-sm">Loading characters and personas...</p>}
          </div>
        </div>
      </div>

      {/* Filename at bottom */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/70 text-sm bg-black/50 px-3 py-1 rounded">
        {image.filename}
      </div>
    </div>
  )
}
