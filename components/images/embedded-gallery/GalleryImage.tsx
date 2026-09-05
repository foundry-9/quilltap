'use client'

import { Icon } from '@/components/ui/icon'
import type { GalleryImageProps } from './types'

export function GalleryImage({
  image,
  index,
  isAvatar,
  isUpdating,
  isDeletingImage,
  isConfirmingDelete,
  isMissingImage,
  thumbnailSize: _thumbnailSize,
  onImageClick,
  onImageError,
  onSetAvatar,
  onDownloadImage,
  onDeleteImage,
  entityName: _entityName,
}: GalleryImageProps) {
  const getImageUrl = () => {
    if (image.url) return image.url
    return image.filepath.startsWith('/') ? image.filepath : `/${image.filepath}`
  }

  return (
    <div className="relative group">
      <button
        onClick={() => {
          onImageClick(index)
        }}
        className={`relative aspect-square w-full overflow-hidden rounded-lg qt-bg-muted hover:ring-2 hover:ring-primary focus:outline-none focus:ring-2 focus:ring-ring transition-all ${
          isAvatar ? 'ring-2 ring-success' : ''
        }`}
      >
        {isMissingImage ? (
          <div className="absolute inset-0 flex items-center justify-center qt-text-secondary">
            <Icon name="image" className="w-8 h-8" />
          </div>
        ) : (

          <img
            src={getImageUrl()}
            alt={image.filename}
            className="absolute inset-0 w-full h-full object-cover"
            onError={() => {
              console.warn('Image failed to load in gallery', { imageId: image.id })
              onImageError()
            }}
          />
        )}

        {/* Avatar Badge */}
        {isAvatar && (
          <div className="absolute top-1 left-1 qt-bg-success qt-text-on-success text-xs px-1.5 py-0.5 rounded font-medium">
            Avatar
          </div>
        )}
      </button>

      {/* Action buttons overlay */}
      <div className="absolute bottom-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {/* Set as Avatar button */}
        {!isAvatar && (
          <button
            onClick={(e) => {
              onSetAvatar(e)
            }}
            disabled={isUpdating}
            className={`p-1.5 rounded-full qt-shadow-md qt-bg-card qt-text-secondary hover:qt-bg-success hover:qt-text-on-success transition-colors ${isUpdating ? 'opacity-50' : ''}`}
            title="Set as avatar"
          >
            {isUpdating ? (
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            ) : (
              <Icon name="user" className="w-4 h-4" />
            )}
          </button>
        )}

        {/* Download button */}
        {!isMissingImage && (
          <button
            onClick={(e) => {
              onDownloadImage(e)
            }}
            className="p-1.5 rounded-full qt-shadow-md qt-bg-card qt-text-secondary hover:qt-bg-primary hover:qt-text-on-primary transition-colors"
            title="Download image"
            aria-label="Download image"
          >
            <Icon name="download" className="w-4 h-4" />
          </button>
        )}

        {/* Delete button — show for non-avatars, or for missing avatar images */}
        {(!isAvatar || isMissingImage) && (
          <button
            onClick={(e) => {
              onDeleteImage(e)
            }}
            disabled={isDeletingImage}
            className={`p-1.5 rounded-full qt-shadow-md transition-colors ${
              isConfirmingDelete
                ? 'qt-bg-destructive qt-text-on-destructive'
                : 'qt-bg-card qt-text-secondary hover:qt-bg-destructive hover:qt-text-on-destructive'
            } ${isDeletingImage ? 'opacity-50' : ''}`}
            title={isConfirmingDelete ? 'Click again to confirm delete' : 'Delete image'}
          >
            {isDeletingImage ? (
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            ) : (
              <Icon name="trash" className="w-4 h-4" />
            )}
          </button>
        )}
      </div>
    </div>
  )
}
