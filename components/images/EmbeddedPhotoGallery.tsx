'use client'

import { useState, useEffect, useCallback } from 'react'
import ImageDetailModal from './ImageDetailModal'
import { ImageUploadDialog } from './image-upload-dialog'
import { showSuccessToast, showErrorToast } from '@/lib/toast'

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

type EmbeddedPhotoGalleryProps = {
  entityType: 'character' | 'persona'
  entityId: string
  entityName: string
  currentAvatarId?: string
  onAvatarChange?: (imageId: string | null) => void
  onRefresh?: () => void // Callback to refresh parent data without calling API
}

const THUMBNAIL_SIZES = [80, 100, 120, 150, 180, 200]
const DEFAULT_THUMBNAIL_INDEX = 2 // 120px

export function EmbeddedPhotoGallery({
  entityType,
  entityId,
  entityName,
  currentAvatarId,
  onAvatarChange,
  onRefresh
}: EmbeddedPhotoGalleryProps) {
  const [allImages, setAllImages] = useState<GalleryImage[]>([])
  const [loading, setLoading] = useState(true)
  const [thumbnailSizeIndex, setThumbnailSizeIndex] = useState(DEFAULT_THUMBNAIL_INDEX)
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const [missingImages, setMissingImages] = useState<Set<string>>(new Set())
  const [showOnlyTagged, setShowOnlyTagged] = useState(true)
  const [updatingTag, setUpdatingTag] = useState<string | null>(null)
  const [settingAvatar, setSettingAvatar] = useState<string | null>(null)
  const [showUploadDialog, setShowUploadDialog] = useState(false)
  const [deletingImage, setDeletingImage] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const thumbnailSize = THUMBNAIL_SIZES[thumbnailSizeIndex]

  // Filter images based on showOnlyTagged setting
  const images = showOnlyTagged
    ? allImages.filter(img =>
        img.tags?.some(tag => tag.tagId === entityId && tag.tagType === entityType.toUpperCase())
      )
    : allImages

  const selectedImage = selectedIndex >= 0 ? images[selectedIndex] : null

  const fetchImages = useCallback(async () => {
    setLoading(true)
    try {
      // Fetch ALL images for the user, not filtered by tag
      const res = await fetch('/api/images')
      if (!res.ok) throw new Error('Failed to fetch images')
      const json = await res.json()
      setAllImages(json.data || [])
    } catch (error) {
      console.error('Error fetching images:', error)
      setAllImages([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchImages()
  }, [fetchImages])

  // Clear confirm delete after 3 seconds
  useEffect(() => {
    if (confirmDelete) {
      const timer = setTimeout(() => setConfirmDelete(null), 3000)
      return () => clearTimeout(timer)
    }
  }, [confirmDelete])

  const handleImageError = (imageId: string) => {
    setMissingImages(prev => new Set(prev).add(imageId))
  }

  const getImageUrl = (image: GalleryImage) => {
    return image.url || `/${image.filepath}`
  }

  const handlePrevious = () => {
    if (selectedIndex > 0) {
      setSelectedIndex(selectedIndex - 1)
    }
  }

  const handleNext = () => {
    if (selectedIndex < images.length - 1) {
      setSelectedIndex(selectedIndex + 1)
    }
  }

  const isImageTagged = (image: GalleryImage) => {
    return image.tags?.some(tag => tag.tagId === entityId && tag.tagType === entityType.toUpperCase()) ?? false
  }

  const handleToggleTag = async (e: React.MouseEvent, image: GalleryImage) => {
    e.stopPropagation()
    setUpdatingTag(image.id)

    const tagType = entityType === 'character' ? 'CHARACTER' : 'PERSONA'
    const isTagged = isImageTagged(image)

    try {
      if (isTagged) {
        // Remove tag
        const res = await fetch(`/api/images/${image.id}/tags?tagType=${tagType}&tagId=${entityId}`, {
          method: 'DELETE',
        })
        if (!res.ok) throw new Error('Failed to remove tag')
        showSuccessToast(`Removed from ${entityName}`)
      } else {
        // Add tag
        const res = await fetch(`/api/images/${image.id}/tags`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tagType, tagId: entityId }),
        })
        if (!res.ok) throw new Error('Failed to add tag')
        showSuccessToast(`Tagged to ${entityName}`)
      }

      // Update local state
      setAllImages(prev => prev.map(img => {
        if (img.id !== image.id) return img
        const currentTags = img.tags || []
        const newTag = { tagId: entityId, tagType: tagType }
        return {
          ...img,
          tags: isTagged
            ? currentTags.filter(t => t.tagId !== entityId || t.tagType !== tagType)
            : [...currentTags, newTag]
        }
      }))
    } catch (error) {
      showErrorToast(error instanceof Error ? error.message : 'Failed to update tag')
    } finally {
      setUpdatingTag(null)
    }
  }

  const handleSetAvatar = async (e: React.MouseEvent, image: GalleryImage) => {
    e.stopPropagation()
    if (!onAvatarChange) return

    setSettingAvatar(image.id)

    try {
      const endpoint = entityType === 'character'
        ? `/api/characters/${entityId}/avatar`
        : `/api/personas/${entityId}/avatar`

      const res = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageId: image.id }),
      })

      if (!res.ok) throw new Error('Failed to set avatar')

      onAvatarChange(image.id)
      showSuccessToast('Avatar updated!')
    } catch (error) {
      showErrorToast(error instanceof Error ? error.message : 'Failed to set avatar')
    } finally {
      setSettingAvatar(null)
    }
  }

  const handleClearAvatar = async () => {
    if (!onAvatarChange || !currentAvatarId) return

    try {
      const endpoint = entityType === 'character'
        ? `/api/characters/${entityId}/avatar`
        : `/api/personas/${entityId}/avatar`

      const res = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageId: null }),
      })

      if (!res.ok) throw new Error('Failed to clear avatar')

      onAvatarChange(null)
      showSuccessToast('Avatar cleared!')
    } catch (error) {
      showErrorToast(error instanceof Error ? error.message : 'Failed to clear avatar')
    }
  }

  const handleDeleteImage = async (e: React.MouseEvent, image: GalleryImage) => {
    e.stopPropagation()

    // If not confirmed yet, show confirmation
    if (confirmDelete !== image.id) {
      setConfirmDelete(image.id)
      return
    }

    setDeletingImage(image.id)
    setConfirmDelete(null)

    try {
      const res = await fetch(`/api/images/${image.id}`, {
        method: 'DELETE',
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to delete image')
      }

      // Remove from local state
      setAllImages(prev => prev.filter(img => img.id !== image.id))
      showSuccessToast('Image deleted')
    } catch (error) {
      showErrorToast(error instanceof Error ? error.message : 'Failed to delete image')
    } finally {
      setDeletingImage(null)
    }
  }

  const handleUploadSuccess = () => {
    setShowUploadDialog(false)
    fetchImages()
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  const taggedCount = allImages.filter(img =>
    img.tags?.some(tag => tag.tagId === entityId && tag.tagType === entityType.toUpperCase())
  ).length

  return (
    <div>
      {/* Controls Row */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {showOnlyTagged
              ? `${taggedCount} tagged photo${taggedCount !== 1 ? 's' : ''}`
              : `${images.length} photo${images.length !== 1 ? 's' : ''} (${taggedCount} tagged)`
            }
          </p>

          {/* Filter Toggle */}
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={showOnlyTagged}
              onChange={(e) => setShowOnlyTagged(e.target.checked)}
              className="rounded border-gray-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-gray-600 dark:text-gray-400">Show only tagged</span>
          </label>
        </div>

        <div className="flex items-center gap-2">
          {/* Upload Button */}
          <button
            onClick={() => setShowUploadDialog(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-800 rounded-md transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            Upload
          </button>

          {/* Clear Avatar Button */}
          {onAvatarChange && currentAvatarId && (
            <button
              onClick={handleClearAvatar}
              className="px-3 py-1 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md transition-colors"
            >
              Clear Avatar
            </button>
          )}

          {/* Zoom Controls */}
          <button
            onClick={() => setThumbnailSizeIndex(Math.max(0, thumbnailSizeIndex - 1))}
            disabled={thumbnailSizeIndex === 0}
            className="p-1 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 disabled:opacity-50"
            title="Smaller thumbnails"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM13 10H7" />
            </svg>
          </button>
          <span className="text-xs text-gray-500 dark:text-gray-400 w-12 text-center">
            {thumbnailSize}px
          </span>
          <button
            onClick={() => setThumbnailSizeIndex(Math.min(THUMBNAIL_SIZES.length - 1, thumbnailSizeIndex + 1))}
            disabled={thumbnailSizeIndex === THUMBNAIL_SIZES.length - 1}
            className="p-1 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 disabled:opacity-50"
            title="Larger thumbnails"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v6m3-3H7" />
            </svg>
          </button>
        </div>
      </div>

      {images.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-gray-300 dark:border-slate-600 rounded-lg">
          <svg
            className="mx-auto h-12 w-12 text-gray-400 dark:text-gray-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            {showOnlyTagged
              ? `No photos tagged to ${entityName}`
              : 'No photos in your library'
            }
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
            {showOnlyTagged
              ? 'Uncheck "Show only tagged" to see all photos and tag them'
              : `Generate or upload images to get started`
            }
          </p>
        </div>
      ) : (
        <>
          {/* Image Grid */}
          <div
            className="grid gap-2"
            style={{
              gridTemplateColumns: `repeat(auto-fill, minmax(${thumbnailSize}px, 1fr))`,
            }}
          >
            {images.map((image, index) => {
              const isTagged = isImageTagged(image)
              const isAvatar = currentAvatarId === image.id
              const isUpdating = updatingTag === image.id || settingAvatar === image.id

              return (
                <div
                  key={image.id}
                  className="relative group"
                >
                  <button
                    onClick={() => setSelectedIndex(index)}
                    className={`relative aspect-square w-full overflow-hidden rounded-lg bg-gray-100 dark:bg-slate-700 hover:ring-2 hover:ring-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all ${
                      isAvatar ? 'ring-2 ring-green-500' : ''
                    } ${!isTagged && showOnlyTagged === false ? 'opacity-60' : ''}`}
                  >
                    {missingImages.has(image.id) ? (
                      <div className="absolute inset-0 flex items-center justify-center text-gray-400 dark:text-gray-500">
                        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                      </div>
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={getImageUrl(image)}
                        alt={image.filename}
                        className="absolute inset-0 w-full h-full object-cover"
                        onError={() => handleImageError(image.id)}
                      />
                    )}

                    {/* Avatar Badge */}
                    {isAvatar && (
                      <div className="absolute top-1 left-1 bg-green-500 text-white text-xs px-1.5 py-0.5 rounded font-medium">
                        Avatar
                      </div>
                    )}

                    {/* Tagged indicator */}
                    {isTagged && !isAvatar && (
                      <div className="absolute top-1 left-1 bg-blue-500 rounded-full p-0.5">
                        <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      </div>
                    )}
                  </button>

                  {/* Action buttons overlay */}
                  <div className="absolute bottom-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {/* Tag/Untag button */}
                    <button
                      onClick={(e) => handleToggleTag(e, image)}
                      disabled={isUpdating}
                      className={`p-1.5 rounded-full shadow-md transition-colors ${
                        isTagged
                          ? 'bg-blue-500 text-white hover:bg-blue-600'
                          : 'bg-white dark:bg-slate-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-600'
                      } ${isUpdating ? 'opacity-50' : ''}`}
                      title={isTagged ? `Remove from ${entityName}` : `Tag to ${entityName}`}
                    >
                      {isUpdating && updatingTag === image.id ? (
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                      ) : isTagged ? (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                        </svg>
                      )}
                    </button>

                    {/* Set as Avatar button */}
                    {onAvatarChange && !isAvatar && (
                      <button
                        onClick={(e) => handleSetAvatar(e, image)}
                        disabled={isUpdating}
                        className={`p-1.5 rounded-full shadow-md bg-white dark:bg-slate-700 text-gray-600 dark:text-gray-300 hover:bg-green-500 hover:text-white transition-colors ${isUpdating ? 'opacity-50' : ''}`}
                        title="Set as avatar"
                      >
                        {settingAvatar === image.id ? (
                          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                        ) : (
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                          </svg>
                        )}
                      </button>
                    )}

                    {/* Delete button */}
                    {!isAvatar && (
                      <button
                        onClick={(e) => handleDeleteImage(e, image)}
                        disabled={deletingImage === image.id}
                        className={`p-1.5 rounded-full shadow-md transition-colors ${
                          confirmDelete === image.id
                            ? 'bg-red-500 text-white'
                            : 'bg-white dark:bg-slate-700 text-gray-600 dark:text-gray-300 hover:bg-red-500 hover:text-white'
                        } ${deletingImage === image.id ? 'opacity-50' : ''}`}
                        title={confirmDelete === image.id ? 'Click again to confirm delete' : 'Delete image'}
                      >
                        {deletingImage === image.id ? (
                          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                        ) : (
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* Image Detail Modal */}
      {selectedImage && (
        <ImageDetailModal
          isOpen={true}
          onClose={() => setSelectedIndex(-1)}
          image={selectedImage}
          onPrev={selectedIndex > 0 ? handlePrevious : undefined}
          onNext={selectedIndex < images.length - 1 ? handleNext : undefined}
          onAvatarSet={() => {
            fetchImages()
            if (onRefresh) {
              onRefresh()
            }
          }}
        />
      )}

      {/* Upload Dialog */}
      <ImageUploadDialog
        isOpen={showUploadDialog}
        onClose={() => setShowUploadDialog(false)}
        onSuccess={handleUploadSuccess}
        contextType={entityType === 'character' ? 'CHARACTER' : 'PERSONA'}
        contextId={entityId}
      />
    </div>
  )
}
