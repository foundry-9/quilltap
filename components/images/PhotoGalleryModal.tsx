'use client'

import { useState, useEffect, useCallback } from 'react'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import ChatGalleryImageViewModal from '@/components/chat/ChatGalleryImageViewModal'
import ImageDetailModal from './ImageDetailModal'
import DeletedImagePlaceholder from './DeletedImagePlaceholder'

interface ChatFile {
  id: string
  filename: string
  filepath: string
  mimeType: string
  size: number
  url: string
  createdAt: string
  type?: 'chatFile' | 'generatedImage'
}

interface GalleryImage {
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

type BaseGalleryProps = {
  isOpen: boolean
  onClose: () => void
}

type ChatGalleryProps = BaseGalleryProps & {
  mode: 'chat'
  chatId: string
  characterId?: string
  characterName?: string
  personaId?: string
  personaName?: string
  onImageDeleted?: (fileId: string) => void
}

type CharacterGalleryProps = BaseGalleryProps & {
  mode: 'character'
  characterId: string
  characterName: string
}

type PersonaGalleryProps = BaseGalleryProps & {
  mode: 'persona'
  personaId: string
  personaName: string
}

type PhotoGalleryModalProps = ChatGalleryProps | CharacterGalleryProps | PersonaGalleryProps

type GalleryItem =
  | { kind: 'chat'; data: ChatFile }
  | { kind: 'image'; data: GalleryImage }

const THUMBNAIL_SIZES = [80, 100, 120, 150, 180, 200]
const DEFAULT_THUMBNAIL_INDEX = 2 // 120px

export default function PhotoGalleryModal(props: PhotoGalleryModalProps) {
  const [items, setItems] = useState<GalleryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [thumbnailSizeIndex, setThumbnailSizeIndex] = useState(DEFAULT_THUMBNAIL_INDEX)
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const [missingImages, setMissingImages] = useState<Set<string>>(new Set())

  const { mode, isOpen, onClose } = props
  const chatId = mode === 'chat' ? props.chatId : undefined
  const characterId = mode === 'character' ? props.characterId : undefined
  const personaId = mode === 'persona' ? props.personaId : undefined

  const thumbnailSize = THUMBNAIL_SIZES[thumbnailSizeIndex]
  const selectedItem = selectedIndex >= 0 ? items[selectedIndex] : null

  const title =
    mode === 'chat'
      ? 'Chat Photos'
      : mode === 'character'
      ? `${props.characterName}'s Photos`
      : `${props.personaName}'s Photos`

  const emptyStateText =
    mode === 'chat'
      ? 'No photos in this chat'
      : mode === 'character'
      ? 'No photos tagged to this character'
      : 'No photos tagged to this persona'

  const loadItems = useCallback(async () => {
    if (!isOpen) return

    try {
      setLoading(true)
      if (mode === 'chat' && chatId) {
        const response = await fetch(`/api/chats/${chatId}/files`)
        const data = await response.json()

        if (!response.ok) {
          throw new Error(data.error || 'Failed to load files')
        }

        const imageFiles = (data.files || []).filter((f: ChatFile) => f.mimeType.startsWith('image/'))
        setItems(imageFiles.map((file: ChatFile) => ({ kind: 'chat', data: file })))
      } else if (mode !== 'chat' && (characterId || personaId)) {
        const params = new URLSearchParams({
          tagType: mode === 'character' ? 'CHARACTER' : 'PERSONA',
          tagId: mode === 'character' ? (characterId as string) : (personaId as string),
        })
        const response = await fetch(`/api/images?${params.toString()}`)
        const data = await response.json()

        if (!response.ok) {
          throw new Error(data.error || 'Failed to load images')
        }

        setItems((data.data || []).map((image: GalleryImage) => ({ kind: 'image', data: image })))
      }
    } catch (error) {
      console.error('Failed to load gallery items:', error)
      showErrorToast(error instanceof Error ? error.message : 'Failed to load gallery items')
    } finally {
      setLoading(false)
    }
  }, [isOpen, mode, chatId, characterId, personaId])

  useEffect(() => {
    if (isOpen) {
      loadItems()
    }
  }, [isOpen, loadItems])

  useEffect(() => {
    if (!isOpen) {
      setSelectedIndex(-1)
      return
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedIndex === -1) {
        onClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = ''
    }
  }, [isOpen, onClose, selectedIndex])

  const handleZoomIn = () => {
    if (thumbnailSizeIndex < THUMBNAIL_SIZES.length - 1) {
      setThumbnailSizeIndex((prev) => prev + 1)
    }
  }

  const handleZoomOut = () => {
    if (thumbnailSizeIndex > 0) {
      setThumbnailSizeIndex((prev) => prev - 1)
    }
  }

  const handlePrev = () => {
    setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev))
  }

  const handleNext = () => {
    setSelectedIndex((prev) => (prev < items.length - 1 ? prev + 1 : prev))
  }

  const handleDeleteChatFile = async (fileId: string) => {
    try {
      const response = await fetch(`/api/chat-files/${fileId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to delete image')
      }

      showSuccessToast('Image deleted')
      setItems((prev) => prev.filter((item) => item.kind !== 'chat' || item.data.id !== fileId))
      setSelectedIndex(-1)
      if (mode === 'chat') {
        props.onImageDeleted?.(fileId)
      }
    } catch (error) {
      console.error('Failed to delete image:', error)
      showErrorToast(error instanceof Error ? error.message : 'Failed to delete image')
    }
  }

  const handleCloseDetail = () => {
    setSelectedIndex(-1)
  }

  if (!isOpen) return null

  const maxColumns = Math.floor(800 / (thumbnailSize + 8)) || 1
  const visibleColumns = Math.min(items.length || 1, maxColumns)
  const containerWidth = visibleColumns * (thumbnailSize + 8)

  const renderItems = () => {
    if (loading) {
      return (
        <div className="flex items-center justify-center py-12">
          <p className="text-gray-500 dark:text-gray-400">Loading images...</p>
        </div>
      )
    }

    if (items.length === 0) {
      return (
        <div className="flex items-center justify-center py-12">
          <p className="text-gray-500 dark:text-gray-400">{emptyStateText}</p>
        </div>
      )
    }

    return (
      <div className="flex flex-wrap gap-2 justify-center" style={{ maxWidth: `${containerWidth}px` }}>
        {items.map((item, index) => {
          const id = item.kind === 'chat' ? item.data.id : item.data.id
          let src = item.data.url || item.data.filepath;
          // filepath already includes leading slash from API
          if (!src.startsWith('/') && item.kind !== 'chat') {
            src = `/${src}`;
          }
          const alt = item.kind === 'chat' ? item.data.filename : item.data.filename
          const isMissing = missingImages.has(id)

          // Use div for missing images (contains button), button for valid images
          const Container = isMissing ? 'div' : 'button'
          const containerProps = isMissing
            ? {}
            : {
                onClick: () => setSelectedIndex(index),
                type: 'button' as const,
              }

          return (
            <Container
              key={id}
              {...containerProps}
              className="relative rounded overflow-hidden hover:ring-2 hover:ring-blue-500 focus:ring-2 focus:ring-blue-500 focus:outline-none transition-all"
              style={{ width: thumbnailSize, height: thumbnailSize }}
            >
              {isMissing ? (
                <DeletedImagePlaceholder
                  imageId={id}
                  filename={alt}
                  onCleanup={loadItems}
                  className="w-full h-full absolute inset-0 !p-2"
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={src}
                  alt={alt}
                  className="w-full h-full object-cover"
                  onError={() => setMissingImages((prev) => new Set(prev).add(id))}
                />
              )}
            </Container>
          )
        })}
      </div>
    )
  }

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={onClose}>
        <div
          className="bg-white dark:bg-slate-800 rounded-lg flex flex-col max-h-[90vh] max-w-[90vw]"
          style={{ minWidth: '300px' }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-slate-700">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{title}</h2>
            <div className="flex items-center gap-2">
              <button
                onClick={handleZoomOut}
                disabled={thumbnailSizeIndex === 0}
                className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 disabled:opacity-30 disabled:cursor-not-allowed"
                title="Smaller thumbnails"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM13 10H7" />
                </svg>
              </button>
              <button
                onClick={handleZoomIn}
                disabled={thumbnailSizeIndex === THUMBNAIL_SIZES.length - 1}
                className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 disabled:opacity-30 disabled:cursor-not-allowed"
                title="Larger thumbnails"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v6m3-3H7" />
                </svg>
              </button>
              <button
                onClick={onClose}
                className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                title="Close"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4">{renderItems()}</div>
        </div>
      </div>

      {selectedItem?.kind === 'chat' && (
        <ChatGalleryImageViewModal
          isOpen={true}
          onClose={handleCloseDetail}
          file={selectedItem.data}
          onPrev={selectedIndex > 0 ? handlePrev : undefined}
          onNext={selectedIndex < items.length - 1 ? handleNext : undefined}
          onDelete={() => handleDeleteChatFile(selectedItem.data.id)}
          characterId={mode === 'chat' ? props.characterId : undefined}
          characterName={mode === 'chat' ? props.characterName : undefined}
          personaId={mode === 'chat' ? props.personaId : undefined}
          personaName={mode === 'chat' ? props.personaName : undefined}
        />
      )}

      {selectedItem?.kind === 'image' && (
        <ImageDetailModal
          isOpen={true}
          onClose={handleCloseDetail}
          image={selectedItem.data}
          onPrev={selectedIndex > 0 ? handlePrev : undefined}
          onNext={selectedIndex < items.length - 1 ? handleNext : undefined}
        />
      )}
    </>
  )
}
