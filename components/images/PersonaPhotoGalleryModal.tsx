'use client'

import { useState, useEffect, useCallback } from 'react'
import Image from 'next/image'
import { showErrorToast } from '@/lib/toast'
import ImageDetailModal from './ImageDetailModal'

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
    id: string
    tagType: string
    tagId: string
  }>
}

interface PersonaPhotoGalleryModalProps {
  isOpen: boolean
  onClose: () => void
  personaId: string
  personaName: string
}

const THUMBNAIL_SIZES = [80, 100, 120, 150, 180, 200]
const DEFAULT_THUMBNAIL_INDEX = 2 // 120px

export default function PersonaPhotoGalleryModal({
  isOpen,
  onClose,
  personaId,
  personaName,
}: PersonaPhotoGalleryModalProps) {
  const [images, setImages] = useState<ImageData[]>([])
  const [loading, setLoading] = useState(true)
  const [thumbnailSizeIndex, setThumbnailSizeIndex] = useState(DEFAULT_THUMBNAIL_INDEX)
  const [selectedImage, setSelectedImage] = useState<ImageData | null>(null)
  const [selectedImageIndex, setSelectedImageIndex] = useState<number>(-1)

  const thumbnailSize = THUMBNAIL_SIZES[thumbnailSizeIndex]

  const loadImages = useCallback(async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams({
        tagType: 'PERSONA',
        tagId: personaId,
      })
      const response = await fetch(`/api/images?${params.toString()}`)
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to load images')
      }

      setImages(data.data || [])
    } catch (error) {
      console.error('Failed to load images:', error)
      showErrorToast(error instanceof Error ? error.message : 'Failed to load images')
    } finally {
      setLoading(false)
    }
  }, [personaId])

  useEffect(() => {
    if (isOpen) {
      loadImages()
      document.body.style.overflow = 'hidden'
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen, loadImages])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !selectedImage) {
        onClose()
      }
    },
    [onClose, selectedImage]
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

  const handleImageClick = (image: ImageData, index: number) => {
    setSelectedImage(image)
    setSelectedImageIndex(index)
  }

  const handlePrevImage = () => {
    if (selectedImageIndex > 0) {
      const newIndex = selectedImageIndex - 1
      setSelectedImage(images[newIndex])
      setSelectedImageIndex(newIndex)
    }
  }

  const handleNextImage = () => {
    if (selectedImageIndex < images.length - 1) {
      const newIndex = selectedImageIndex + 1
      setSelectedImage(images[newIndex])
      setSelectedImageIndex(newIndex)
    }
  }


  const handleCloseImageView = () => {
    setSelectedImage(null)
    setSelectedImageIndex(-1)
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
              {personaName}&apos;s Photos
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
            ) : images.length === 0 ? (
              <div className="flex items-center justify-center py-12">
                <p className="text-gray-500 dark:text-gray-400">No photos tagged to this persona</p>
              </div>
            ) : (
              <div
                className="flex flex-wrap gap-2 justify-center"
                style={{
                  maxWidth: `${Math.min(images.length, Math.floor(800 / (thumbnailSize + 8))) * (thumbnailSize + 8)}px`,
                }}
              >
                {images.map((image, index) => (
                  <button
                    key={image.id}
                    onClick={() => handleImageClick(image, index)}
                    className="relative rounded overflow-hidden hover:ring-2 hover:ring-blue-500 focus:ring-2 focus:ring-blue-500 focus:outline-none transition-all"
                    style={{ width: thumbnailSize, height: thumbnailSize }}
                  >
                    <Image
                      src={image.url || `/${image.filepath}`}
                      alt={image.filename}
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

      {/* Image View Modal */}
      {selectedImage && (
        <ImageDetailModal
          isOpen={true}
          onClose={handleCloseImageView}
          image={selectedImage}
          onPrev={selectedImageIndex > 0 ? handlePrevImage : undefined}
          onNext={selectedImageIndex < images.length - 1 ? handleNextImage : undefined}
        />
      )}
    </>
  )
}
