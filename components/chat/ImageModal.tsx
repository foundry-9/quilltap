'use client'

import { useEffect, useCallback, useState } from 'react'
import Image from 'next/image'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { showConfirmation } from '@/lib/alert'
import { clientLogger } from '@/lib/client-logger'

interface ImageModalProps {
  isOpen: boolean
  onClose: () => void
  src: string
  filename: string
  // Optional props for tagging/deletion functionality
  fileId?: string
  characterId?: string
  characterName?: string
  personaId?: string
  personaName?: string
  onDelete?: () => void
}

export default function ImageModal({
  isOpen,
  onClose,
  src,
  filename,
  fileId,
  characterId,
  characterName,
  personaId,
  personaName,
  onDelete,
}: ImageModalProps) {
  const [isTagging, setIsTagging] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose()
    }
  }, [onClose])

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
      const response = await fetch(src)
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
    } catch (error) {
      clientLogger.error('Failed to download image:', { error: error instanceof Error ? error.message : String(error) })
    }
  }

  const handleTagCharacter = async () => {
    if (!fileId || !characterId) return

    setIsTagging(true)
    try {
      const res = await fetch(`/api/chat-files/${fileId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tagType: 'CHARACTER',
          tagId: characterId,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to tag image')
      }

      showSuccessToast(`Image added to ${characterName || 'character'}'s gallery`)
    } catch (error) {
      clientLogger.error('Failed to tag image:', { error: error instanceof Error ? error.message : String(error) })
      showErrorToast(error instanceof Error ? error.message : 'Failed to tag image')
    } finally {
      setIsTagging(false)
    }
  }

  const handleTagPersona = async () => {
    if (!fileId || !personaId) return

    setIsTagging(true)
    try {
      const res = await fetch(`/api/chat-files/${fileId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tagType: 'PERSONA',
          tagId: personaId,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to tag image')
      }

      showSuccessToast(`Image added to ${personaName || 'persona'}'s gallery`)
    } catch (error) {
      clientLogger.error('Failed to tag image:', { error: error instanceof Error ? error.message : String(error) })
      showErrorToast(error instanceof Error ? error.message : 'Failed to tag image')
    } finally {
      setIsTagging(false)
    }
  }

  const handleDelete = async () => {
    if (!fileId) return

    if (!(await showConfirmation('Permanently delete this photo? This cannot be undone.'))) {
      return
    }

    setIsDeleting(true)
    try {
      const res = await fetch(`/api/chat-files/${fileId}`, {
        method: 'DELETE',
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to delete image')
      }

      showSuccessToast('Image deleted')
      onDelete?.()
      onClose()
    } catch (error) {
      clientLogger.error('Failed to delete image:', { error: error instanceof Error ? error.message : String(error) })
      showErrorToast(error instanceof Error ? error.message : 'Failed to delete image')
    } finally {
      setIsDeleting(false)
    }
  }

  if (!isOpen) return null

  const canTag = fileId && (characterId || personaId)
  const canDelete = fileId

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* Control buttons - top right */}
      <div className="absolute top-4 right-4 flex gap-2 z-10">
        {/* Tag to character button */}
        {canTag && characterId && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              handleTagCharacter()
            }}
            disabled={isTagging}
            className="p-2 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors disabled:opacity-50"
            title={`Add to ${characterName || 'character'}'s gallery`}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </button>
        )}
        {/* Tag to persona button */}
        {canTag && personaId && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              handleTagPersona()
            }}
            disabled={isTagging}
            className="p-2 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors disabled:opacity-50"
            title={`Add to ${personaName || 'persona'}'s gallery`}
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
          className="p-2 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors"
          title="Download"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
        </button>
        {/* Close button */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            onClose()
          }}
          className="p-2 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors"
          title="Close"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Delete button - bottom right */}
      {canDelete && (
        <div className="absolute bottom-4 right-4 z-10">
          <button
            onClick={(e) => {
              e.stopPropagation()
              handleDelete()
            }}
            disabled={isDeleting}
            className="p-2 bg-red-600/80 hover:bg-red-600 rounded-full text-white transition-colors disabled:opacity-50"
            title="Delete image"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      )}

      {/* Image container */}
      <div
        className="relative max-w-[90vw] max-h-[90vh] flex items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        <Image
          src={src}
          alt={filename}
          width={1920}
          height={1080}
          className="max-w-full max-h-[90vh] w-auto h-auto object-contain"
          priority
        />
      </div>

      {/* Filename at bottom */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/70 text-sm bg-black/50 px-3 py-1 rounded">
        {filename}
      </div>
    </div>
  )
}
