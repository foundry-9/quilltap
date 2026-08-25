'use client'

import { useState, useEffect, useRef } from 'react'
import ImageDetailModal from '../ImageDetailModal'
import { GalleryControls } from './GalleryControls'
import { GalleryEmpty } from './GalleryEmpty'
import { GalleryGrid } from './GalleryGrid'
import { useGalleryData } from './hooks/useGalleryData'
import type { EmbeddedPhotoGalleryProps, GalleryImage } from './types'

const THUMBNAIL_SIZES = [80, 100, 120, 150, 180, 200]
const DEFAULT_THUMBNAIL_INDEX = 2

export function EmbeddedPhotoGallery({
  entityType,
  entityId,
  entityName,
  currentAvatarId,
  onAvatarChange,
  onRefresh
}: EmbeddedPhotoGalleryProps) {
  const [thumbnailSizeIndex, setThumbnailSizeIndex] = useState(DEFAULT_THUMBNAIL_INDEX)
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const [settingAvatar, setSettingAvatar] = useState<string | null>(null)
  const [deletingImage, setDeletingImage] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const {
    allImages,
    setAllImages,
    loading,
    missingImages,
    fetchImages,
    handleImageError,
    handleSetAvatar,
    handleClearAvatar,
    handleDeleteImage,
    handleDownloadImage,
    handleUpload,
  } = useGalleryData(entityId, entityType)

  const thumbnailSize = THUMBNAIL_SIZES[thumbnailSizeIndex]
  const images = allImages
  const selectedImage = selectedIndex >= 0 ? images[selectedIndex] : null

  useEffect(() => {
    if (confirmDelete) {
      const timer = setTimeout(() => setConfirmDelete(null), 3000)
      return () => clearTimeout(timer)
    }
  }, [confirmDelete])

  const handlePrevious = () => {
    if (selectedIndex > 0) setSelectedIndex(selectedIndex - 1)
  }

  const handleNext = () => {
    if (selectedIndex < images.length - 1) setSelectedIndex(selectedIndex + 1)
  }

  const handleSetAvatarClick = async (e: React.MouseEvent, image: GalleryImage) => {
    e.stopPropagation()
    if (!onAvatarChange) return
    setSettingAvatar(image.id)
    try {
      await handleSetAvatar(image, currentAvatarId, onAvatarChange)
    } finally {
      setSettingAvatar(null)
    }
  }

  const handleClearAvatarClick = async () => {
    if (!onAvatarChange) return
    try {
      await handleClearAvatar(currentAvatarId, onAvatarChange)
    } catch (error) {
      console.error('Error clearing avatar:', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const handleDownloadImageClick = async (e: React.MouseEvent, image: GalleryImage) => {
    e.stopPropagation()
    await handleDownloadImage(image)
  }

  const handleDeleteImageClick = async (e: React.MouseEvent, image: GalleryImage) => {
    e.stopPropagation()
    if (confirmDelete !== image.id) {
      setConfirmDelete(image.id)
      return
    }
    setDeletingImage(image.id)
    setConfirmDelete(null)
    try {
      await handleDeleteImage(image, currentAvatarId, onAvatarChange)
      setAllImages((prev: GalleryImage[]) => prev.filter((img: GalleryImage) => img.id !== image.id))
    } finally {
      setDeletingImage(null)
    }
  }

  const handleUploadButtonClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const ok = await handleUpload(file)
      if (ok && onRefresh) {
        await onRefresh()
      }
    } finally {
      setUploading(false)
      // Reset so the same file can be re-selected.
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 qt-border-primary"></div>
      </div>
    )
  }

  return (
    <div>
      <GalleryControls
        totalCount={images.length}
        onUploadClick={handleUploadButtonClick}
        onClearAvatarClick={handleClearAvatarClick}
        thumbnailSize={thumbnailSize}
        thumbnailSizeIndex={thumbnailSizeIndex}
        maxThumbnailIndex={THUMBNAIL_SIZES.length - 1}
        onZoomOut={() => setThumbnailSizeIndex(Math.max(0, thumbnailSizeIndex - 1))}
        onZoomIn={() => setThumbnailSizeIndex(Math.min(THUMBNAIL_SIZES.length - 1, thumbnailSizeIndex + 1))}
        hasAvatarSet={!!(onAvatarChange && currentAvatarId)}
      />

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileSelected}
        disabled={uploading}
        className="hidden"
      />

      {images.length === 0 ? (
        <GalleryEmpty showOnlyTagged={false} entityName={entityName} />
      ) : (
        <GalleryGrid
          images={images}
          thumbnailSize={thumbnailSize}
          currentAvatarId={currentAvatarId}
          missingImages={missingImages}
          settingAvatar={settingAvatar}
          deletingImage={deletingImage}
          confirmDelete={confirmDelete}
          onImageClick={(index) => setSelectedIndex(index)}
          onImageError={handleImageError}
          onSetAvatar={handleSetAvatarClick}
          onDownloadImage={handleDownloadImageClick}
          onDeleteImage={handleDeleteImageClick}
          entityName={entityName}
        />
      )}

      {selectedImage && (
        <ImageDetailModal
          isOpen={true}
          onClose={() => setSelectedIndex(-1)}
          image={{
            id: selectedImage.id,
            linkId: selectedImage.id,
            filename: selectedImage.filename,
            filepath: selectedImage.filepath,
            url: selectedImage.url,
            mimeType: selectedImage.mimeType ?? 'image/webp',
            size: selectedImage.size,
            width: selectedImage.width,
            height: selectedImage.height,
            createdAt: selectedImage.createdAt,
            tags: [],
          }}
          onPrev={selectedIndex > 0 ? handlePrevious : undefined}
          onNext={selectedIndex < images.length - 1 ? handleNext : undefined}
          onAvatarSet={() => {
            fetchImages()
            if (onRefresh) onRefresh()
          }}
        />
      )}
    </div>
  )
}
