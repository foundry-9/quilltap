'use client'

import { useState, useEffect, useCallback } from 'react'
import Image from 'next/image'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import ChatGalleryImageViewModal from './ChatGalleryImageViewModal'

interface ChatFile {
  id: string
  filename: string
  filepath: string
  mimeType: string
  size: number
  url: string
  createdAt: string
}

interface ChatPhotoGalleryModalProps {
  isOpen: boolean
  onClose: () => void
  chatId: string
  characterId?: string
  characterName?: string
  personaId?: string
  personaName?: string
  onImageDeleted?: (fileId: string) => void
}

const THUMBNAIL_SIZES = [80, 100, 120, 150, 180, 200]
const DEFAULT_THUMBNAIL_INDEX = 2 // 120px

export default function ChatPhotoGalleryModal({
  isOpen,
  onClose,
  chatId,
  characterId,
  characterName,
  personaId,
  personaName,
  onImageDeleted,
}: ChatPhotoGalleryModalProps) {
  const [files, setFiles] = useState<ChatFile[]>([])
  const [loading, setLoading] = useState(true)
  const [thumbnailSizeIndex, setThumbnailSizeIndex] = useState(DEFAULT_THUMBNAIL_INDEX)
  const [selectedFile, setSelectedFile] = useState<ChatFile | null>(null)
  const [selectedFileIndex, setSelectedFileIndex] = useState<number>(-1)

  const thumbnailSize = THUMBNAIL_SIZES[thumbnailSizeIndex]

  const loadFiles = useCallback(async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/chats/${chatId}/files`)
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to load files')
      }

      // Filter only image files
      const imageFiles = (data.files || []).filter((f: ChatFile) => f.mimeType.startsWith('image/'))
      setFiles(imageFiles)
    } catch (error) {
      console.error('Failed to load files:', error)
      showErrorToast(error instanceof Error ? error.message : 'Failed to load files')
    } finally {
      setLoading(false)
    }
  }, [chatId])

  useEffect(() => {
    if (isOpen) {
      loadFiles()
      document.body.style.overflow = 'hidden'
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen, loadFiles])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !selectedFile) {
        onClose()
      }
    },
    [onClose, selectedFile]
  )

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown)
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, handleKeyDown])

  const handleZoomIn = () => {
    if (thumbnailSizeIndex < THUMBNAIL_SIZES.length - 1) {
      setThumbnailSizeIndex(thumbnailSizeIndex + 1)
    }
  }

  const handleZoomOut = () => {
    if (thumbnailSizeIndex > 0) {
      setThumbnailSizeIndex(thumbnailSizeIndex - 1)
    }
  }

  const handleFileClick = (file: ChatFile, index: number) => {
    setSelectedFile(file)
    setSelectedFileIndex(index)
  }

  const handlePrevFile = () => {
    if (selectedFileIndex > 0) {
      const newIndex = selectedFileIndex - 1
      setSelectedFile(files[newIndex])
      setSelectedFileIndex(newIndex)
    }
  }

  const handleNextFile = () => {
    if (selectedFileIndex < files.length - 1) {
      const newIndex = selectedFileIndex + 1
      setSelectedFile(files[newIndex])
      setSelectedFileIndex(newIndex)
    }
  }

  const handleDelete = async (fileId: string) => {
    try {
      const response = await fetch(`/api/chat-files/${fileId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to delete image')
      }

      showSuccessToast('Image deleted')
      // Remove the file from the list
      setFiles((prev) => prev.filter((f) => f.id !== fileId))
      // Close the file view modal
      setSelectedFile(null)
      setSelectedFileIndex(-1)
      // Notify parent to update message display
      onImageDeleted?.(fileId)
    } catch (error) {
      console.error('Failed to delete image:', error)
      showErrorToast(error instanceof Error ? error.message : 'Failed to delete image')
    }
  }

  const handleCloseFileView = () => {
    setSelectedFile(null)
    setSelectedFileIndex(-1)
  }

  if (!isOpen) return null

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
        onClick={onClose}
      >
        <div
          className="bg-white dark:bg-slate-800 rounded-lg flex flex-col max-h-[90vh] max-w-[90vw]"
          style={{ minWidth: '300px' }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-slate-700">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Chat Photos
            </h2>
            <div className="flex items-center gap-2">
              {/* Zoom Out */}
              <button
                onClick={handleZoomOut}
                disabled={thumbnailSizeIndex === 0}
                className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 disabled:opacity-30 disabled:cursor-not-allowed"
                title="Smaller thumbnails"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM13 10H7"
                  />
                </svg>
              </button>
              {/* Zoom In */}
              <button
                onClick={handleZoomIn}
                disabled={thumbnailSizeIndex === THUMBNAIL_SIZES.length - 1}
                className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 disabled:opacity-30 disabled:cursor-not-allowed"
                title="Larger thumbnails"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v6m3-3H7"
                  />
                </svg>
              </button>
              {/* Close */}
              <button
                onClick={onClose}
                className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                title="Close"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-4">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <p className="text-gray-500 dark:text-gray-400">Loading images...</p>
              </div>
            ) : files.length === 0 ? (
              <div className="flex items-center justify-center py-12">
                <p className="text-gray-500 dark:text-gray-400">No photos in this chat</p>
              </div>
            ) : (
              <div
                className="flex flex-wrap gap-2 justify-center"
                style={{
                  maxWidth: `${Math.min(files.length, Math.floor(800 / (thumbnailSize + 8))) * (thumbnailSize + 8)}px`,
                }}
              >
                {files.map((file, index) => (
                  <button
                    key={file.id}
                    onClick={() => handleFileClick(file, index)}
                    className="relative rounded overflow-hidden hover:ring-2 hover:ring-blue-500 focus:ring-2 focus:ring-blue-500 focus:outline-none transition-all"
                    style={{ width: thumbnailSize, height: thumbnailSize }}
                  >
                    <Image
                      src={file.url}
                      alt={file.filename}
                      fill
                      className="object-cover"
                      sizes={`${thumbnailSize}px`}
                    />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* File View Modal */}
      {selectedFile && (
        <ChatGalleryImageViewModal
          isOpen={true}
          onClose={handleCloseFileView}
          file={selectedFile}
          onPrev={selectedFileIndex > 0 ? handlePrevFile : undefined}
          onNext={selectedFileIndex < files.length - 1 ? handleNextFile : undefined}
          onDelete={() => handleDelete(selectedFile.id)}
          characterId={characterId}
          characterName={characterName}
          personaId={personaId}
          personaName={personaName}
        />
      )}
    </>
  )
}
