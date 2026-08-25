'use client'

import { GalleryImage } from './GalleryImage'
import type { GalleryImage as GalleryImageType } from './types'

interface GalleryGridProps {
  images: GalleryImageType[]
  thumbnailSize: number
  currentAvatarId?: string
  missingImages: Set<string>
  settingAvatar: string | null
  deletingImage: string | null
  confirmDelete: string | null
  onImageClick: (index: number) => void
  onImageError: (imageId: string) => void
  onSetAvatar: (e: React.MouseEvent, image: GalleryImageType) => void
  onDownloadImage: (e: React.MouseEvent, image: GalleryImageType) => void
  onDeleteImage: (e: React.MouseEvent, image: GalleryImageType) => void
  entityName: string
}

export function GalleryGrid({
  images,
  thumbnailSize,
  currentAvatarId,
  missingImages,
  settingAvatar,
  deletingImage,
  confirmDelete,
  onImageClick,
  onImageError,
  onSetAvatar,
  onDownloadImage,
  onDeleteImage,
  entityName,
}: GalleryGridProps) {
  return (
    <div
      className="grid gap-2"
      style={{
        gridTemplateColumns: `repeat(auto-fill, minmax(${thumbnailSize}px, 1fr))`,
      }}
    >
      {images.map((image, index) => {
        const isAvatar = currentAvatarId === image.id
        const isUpdating = settingAvatar === image.id

        return (
          <GalleryImage
            key={image.id}
            image={image}
            index={index}
            isAvatar={isAvatar}
            isUpdating={isUpdating}
            isDeletingImage={deletingImage === image.id}
            isConfirmingDelete={confirmDelete === image.id}
            isMissingImage={missingImages.has(image.id)}
            thumbnailSize={thumbnailSize}
            onImageClick={() => onImageClick(index)}
            onImageError={() => onImageError(image.id)}
            onSetAvatar={(e) => onSetAvatar(e, image)}
            onDownloadImage={(e) => onDownloadImage(e, image)}
            onDeleteImage={(e) => onDeleteImage(e, image)}
            entityName={entityName}
          />
        )
      })}
    </div>
  )
}
