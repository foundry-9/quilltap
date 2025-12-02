'use client'

import { useEffect, useCallback, useState } from 'react'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { showConfirmation } from '@/lib/alert'
import { clientLogger } from '@/lib/client-logger'
import { safeJsonParse } from '@/lib/fetch-helpers'
import DeletedImagePlaceholder from '@/components/images/DeletedImagePlaceholder'

interface ChatFile {
  id: string
  filename: string
  filepath: string
  mimeType: string
  size: number
  url: string
  createdAt: string
  type?: 'chatFile' | 'generatedImage'  // Added to distinguish between file types
}

interface ChatGalleryImageViewModalProps {
  isOpen: boolean
  onClose: () => void
  file: ChatFile
  onPrev?: () => void
  onNext?: () => void
  onDelete: () => void
  characterId?: string
  characterName?: string
  personaId?: string
  personaName?: string
}

export default function ChatGalleryImageViewModal({
  isOpen,
  onClose,
  file,
  onPrev,
  onNext,
  onDelete,
  characterId,
  characterName,
  personaId,
  personaName,
}: ChatGalleryImageViewModalProps) {
  const [isTaggedToCharacter, setIsTaggedToCharacter] = useState(false)
  const [isTaggedToPersona, setIsTaggedToPersona] = useState(false)
  const [isTagging, setIsTagging] = useState(false)
  const [checkingTags, setCheckingTags] = useState(true)
  const [imageMissing, setImageMissing] = useState(false)

  // Check existing tags when file changes
  useEffect(() => {
    const checkTags = async () => {
      if (!file.id) return
      setCheckingTags(true)
      try {
        // Check if image exists in gallery with these tags
        const params = new URLSearchParams()
        if (characterId) {
          const charRes = await fetch(`/api/images?tagType=CHARACTER&tagId=${characterId}`)
          if (charRes.ok) {
            const charData = await safeJsonParse<{ data?: Array<{ filepath: string }> }>(charRes)
            const found = (charData.data || []).some((img) => img.filepath === file.filepath)
            setIsTaggedToCharacter(found)
          }
        }
        if (personaId) {
          const personaRes = await fetch(`/api/images?tagType=PERSONA&tagId=${personaId}`)
          if (personaRes.ok) {
            const personaData = await safeJsonParse<{ data?: Array<{ filepath: string }> }>(personaRes)
            const found = (personaData.data || []).some((img) => img.filepath === file.filepath)
            setIsTaggedToPersona(found)
          }
        }
      } catch (error) {
        clientLogger.error('Failed to check tags:', { error: error instanceof Error ? error.message : String(error) })
      } finally {
        setCheckingTags(false)
      }
    }
    checkTags()
  }, [file.id, file.filepath, characterId, personaId])

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

  const handleDownload = async () => {
    try {
      const response = await fetch(file.url)
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = file.filename
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
    } catch (error) {
      clientLogger.error('Failed to download image:', { error: error instanceof Error ? error.message : String(error) })
    }
  }

  const handleToggleCharacterTag = async () => {
    if (!characterId || isTagging) return

    setIsTagging(true)
    try {
      if (isTaggedToCharacter) {
        // Find the image in gallery first
        const imagesRes = await fetch(`/api/images?tagType=CHARACTER&tagId=${characterId}`)
        const imagesData = await safeJsonParse<{ data?: Array<{ id: string; filepath: string }>; error?: string }>(imagesRes)
        if (!imagesRes.ok) throw new Error(imagesData.error || 'Failed to find image')
        const galleryImage = (imagesData.data || []).find((img) => img.filepath === file.filepath)

        if (galleryImage) {
          // Remove tag
          const params = new URLSearchParams({
            tagType: 'CHARACTER',
            tagId: characterId,
          })
          const res = await fetch(`/api/images/${galleryImage.id}/tags?${params.toString()}`, {
            method: 'DELETE',
          })
          if (!res.ok) {
            const data = await safeJsonParse<{ error?: string }>(res)
            throw new Error(data.error || 'Failed to remove tag')
          }
          setIsTaggedToCharacter(false)
          showSuccessToast(`Removed from ${characterName || 'character'}'s gallery`)
        }
      } else {
        // Add tag using the appropriate endpoint based on file type
        const isGeneratedImage = file.type === 'generatedImage'

        if (isGeneratedImage) {
          // For generated images, use /api/images/{id}/tags
          const res = await fetch(`/api/images/${file.id}/tags`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tagType: 'CHARACTER',
              tagId: characterId,
            }),
          })
          if (!res.ok) {
            const data = await safeJsonParse<{ error?: string }>(res)
            throw new Error(data.error || 'Failed to tag image')
          }
        } else {
          // For chat files, use /api/chat-files/{id} to copy to gallery and tag
          const res = await fetch(`/api/chat-files/${file.id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tagType: 'CHARACTER',
              tagId: characterId,
            }),
          })
          if (!res.ok) {
            const data = await safeJsonParse<{ error?: string }>(res)
            throw new Error(data.error || 'Failed to tag image')
          }
        }
        setIsTaggedToCharacter(true)
        showSuccessToast(`Added to ${characterName || 'character'}'s gallery`)
      }
    } catch (error) {
      clientLogger.error('Failed to toggle character tag:', { error: error instanceof Error ? error.message : String(error) })
      showErrorToast(error instanceof Error ? error.message : 'Failed to update tag')
    } finally {
      setIsTagging(false)
    }
  }

  const handleTogglePersonaTag = async () => {
    if (!personaId || isTagging) return

    setIsTagging(true)
    try {
      if (isTaggedToPersona) {
        // Find the image in gallery first
        const imagesRes = await fetch(`/api/images?tagType=PERSONA&tagId=${personaId}`)
        const imagesData = await safeJsonParse<{ data?: Array<{ id: string; filepath: string }>; error?: string }>(imagesRes)
        if (!imagesRes.ok) throw new Error(imagesData.error || 'Failed to find image')
        const galleryImage = (imagesData.data || []).find((img) => img.filepath === file.filepath)

        if (galleryImage) {
          // Remove tag
          const params = new URLSearchParams({
            tagType: 'PERSONA',
            tagId: personaId,
          })
          const res = await fetch(`/api/images/${galleryImage.id}/tags?${params.toString()}`, {
            method: 'DELETE',
          })
          if (!res.ok) {
            const data = await safeJsonParse<{ error?: string }>(res)
            throw new Error(data.error || 'Failed to remove tag')
          }
          setIsTaggedToPersona(false)
          showSuccessToast(`Removed from ${personaName || 'persona'}'s gallery`)
        }
      } else {
        // Add tag using the appropriate endpoint based on file type
        const isGeneratedImage = file.type === 'generatedImage'

        if (isGeneratedImage) {
          // For generated images, use /api/images/{id}/tags
          const res = await fetch(`/api/images/${file.id}/tags`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tagType: 'PERSONA',
              tagId: personaId,
            }),
          })
          if (!res.ok) {
            const data = await safeJsonParse<{ error?: string }>(res)
            throw new Error(data.error || 'Failed to tag image')
          }
        } else {
          // For chat files, use /api/chat-files/{id} to copy to gallery and tag
          const res = await fetch(`/api/chat-files/${file.id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tagType: 'PERSONA',
              tagId: personaId,
            }),
          })
          if (!res.ok) {
            const data = await safeJsonParse<{ error?: string }>(res)
            throw new Error(data.error || 'Failed to tag image')
          }
        }
        setIsTaggedToPersona(true)
        showSuccessToast(`Added to ${personaName || 'persona'}'s gallery`)
      }
    } catch (error) {
      clientLogger.error('Failed to toggle persona tag:', { error: error instanceof Error ? error.message : String(error) })
      showErrorToast(error instanceof Error ? error.message : 'Failed to update tag')
    } finally {
      setIsTagging(false)
    }
  }

  const handleDeleteClick = async () => {
    if (await showConfirmation('Permanently delete this photo? This cannot be undone.')) {
      onDelete()
    }
  }

  if (!isOpen) return null

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
          className="absolute left-4 top-1/2 -translate-y-1/2 p-3 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors z-10 cursor-pointer"
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
          className="absolute right-4 top-1/2 -translate-y-1/2 p-3 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors z-10 cursor-pointer"
          title="Next image (Right Arrow)"
        >
          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      )}

      {/* Top right control buttons */}
      {!imageMissing && (
      <div className="absolute top-4 right-4 flex gap-2 z-10">
        {/* Tag to Character button */}
        {characterId && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              handleToggleCharacterTag()
            }}
            disabled={isTagging || checkingTags}
            className={`p-2 rounded-full text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${
              isTaggedToCharacter
                ? 'bg-green-600/80 hover:bg-green-600'
                : 'bg-white/10 hover:bg-white/20'
            }`}
            title={isTaggedToCharacter ? `Remove from ${characterName || 'character'}'s gallery` : `Add to ${characterName || 'character'}'s gallery`}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </button>
        )}
        {/* Tag to Persona button */}
        {personaId && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              handleTogglePersonaTag()
            }}
            disabled={isTagging || checkingTags}
            className={`p-2 rounded-full text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${
              isTaggedToPersona
                ? 'bg-green-600/80 hover:bg-green-600'
                : 'bg-white/10 hover:bg-white/20'
            }`}
            title={isTaggedToPersona ? `Remove from ${personaName || 'persona'}'s gallery` : `Add to ${personaName || 'persona'}'s gallery`}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.121 17.804A13.937 13.937 0 0112 16c2.5 0 4.847.655 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0zm6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>
        )}
        {/* Download button */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            handleDownload()
          }}
          className="p-2 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors cursor-pointer"
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
          className="p-2 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors cursor-pointer"
          title="Close (Escape)"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      )}

      {/* Delete button - bottom right */}
      {!imageMissing && (
      <div className="absolute bottom-4 right-4 z-10">
        <button
          onClick={(e) => {
            e.stopPropagation()
            handleDeleteClick()
          }}
          className="p-2 bg-red-600/80 hover:bg-red-600 rounded-full text-white transition-colors cursor-pointer"
          title="Delete image permanently"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
            />
          </svg>
        </button>
      </div>
      )}

      {/* Image container */}
      <div
        className="relative max-w-[90vw] max-h-[90vh] flex items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        {imageMissing ? (
          <DeletedImagePlaceholder
            imageId={file.id}
            filename={file.filename}
            onCleanup={onClose}
            width={600}
            height={400}
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={file.url}
            alt={file.filename}
            className="max-w-full max-h-[90vh] w-auto h-auto object-contain"
            onError={() => setImageMissing(true)}
          />
        )}
      </div>

      {/* Filename at bottom */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/70 text-sm bg-black/50 px-3 py-1 rounded">
        {file.filename}
      </div>
    </div>
  )
}
