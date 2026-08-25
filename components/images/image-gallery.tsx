'use client';

/**
 * ImageGallery Component
 * Displays a grid of images with optional filtering and selection
 */

import { useState, useCallback } from 'react';
import { Icon } from '@/components/ui/icon';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/query/fetcher';
import { queryKeys } from '@/lib/query/keys';
import { showConfirmation } from '@/lib/alert';
import { showErrorToast } from '@/lib/toast';
import { triggerDownload } from '@/lib/download-utils';
import DeletedImagePlaceholder from './DeletedImagePlaceholder';

export interface ImageData {
  id: string;
  filename: string;
  filepath: string;
  url?: string;
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
  createdAt: string;
  tags?: Array<{
    id: string;
    tagType: string;
    tagId: string;
  }>;
}

interface ImageGalleryProps {
  tagType?: 'CHARACTER' | 'CHAT' | 'THEME';
  tagId?: string;
  onSelectImage?: (image: ImageData) => void;
  selectedImageId?: string;
  className?: string;
}

export function ImageGallery({ tagType, tagId, onSelectImage, selectedImageId, className = '' }: ImageGalleryProps) {
  const [missingImages, setMissingImages] = useState<Set<string>>(new Set());

  // Fetch images via TanStack Query. The URL is built inside the queryFn from
  // tagType/tagId so the key (which encodes both) is the source of cache identity.
  const { data: imageData, isLoading: loading, error: loadError, refetch: mutateImages } = useQuery({
    queryKey: queryKeys.images.list({ tagType: tagType ?? null, tagId: tagId ?? null }),
    queryFn: ({ signal }) => {
      const params = new URLSearchParams();
      if (tagType) params.append('tagType', tagType);
      if (tagId) params.append('tagId', tagId);
      const qs = params.toString();
      return apiFetch<{ data: ImageData[] }>(`/api/v1/images${qs ? '?' + qs : ''}`, { signal });
    },
  });

  const images = imageData?.data ?? [];
  const error = loadError ? (loadError instanceof Error ? loadError.message : 'Failed to load images') : null;

  const loadImages = useCallback(async () => {
    await mutateImages();
  }, [mutateImages]);

  async function handleDeleteImage(imageId: string) {
    if (!(await showConfirmation('Permanently delete this image? This cannot be undone.'))) {
      return;
    }

    try {
      const response = await fetch(`/api/v1/images/${imageId}`, {
        method: 'DELETE',
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to delete image');
      }

      // Reload images
      loadImages();
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to delete image');
    }
  }

  if (loading) {
    return (
      <div className={`flex items-center justify-center py-12 ${className}`}>
        <div className="qt-text-secondary">Loading images...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`flex items-center justify-center py-12 ${className}`}>
        <div className="qt-text-destructive">Error: {error}</div>
      </div>
    );
  }

  if (images.length === 0) {
    return (
      <div className={`flex items-center justify-center py-12 ${className}`}>
        <div className="qt-text-secondary">No images found</div>
      </div>
    );
  }

  const handleImageError = (imageId: string) => {
    setMissingImages((prev) => new Set(prev).add(imageId))
  }

  const handleDownloadImage = async (image: ImageData) => {
    const src = image.url || (image.filepath.startsWith('/') ? image.filepath : `/${image.filepath}`)
    try {
      const response = await fetch(src)
      if (!response.ok) throw new Error(`Failed to fetch image (${response.status})`)
      const blob = await response.blob()
      await triggerDownload(blob, image.filename)
    } catch (err) {
      console.error('Failed to download gallery image:', { error: err instanceof Error ? err.message : String(err) })
      showErrorToast('Failed to download image')
    }
  }

  const handleCleanupMissing = () => {
    loadImages()
  }

  return (
    <div className={`grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 ${className}`}>
      {images.map((image) => (
        <div
          key={image.id}
          className={`qt-card relative group overflow-hidden transition-all p-0 ${
            selectedImageId === image.id
              ? 'ring-2 ring-primary'
              : ''
          } ${onSelectImage ? 'cursor-pointer' : ''}`}
          onClick={() => onSelectImage?.(image)}
        >
          <div className="aspect-square relative qt-bg-muted">
            {missingImages.has(image.id) ? (
              <DeletedImagePlaceholder
                imageId={image.id}
                filename={image.filename}
                onCleanup={handleCleanupMissing}
                className="w-full h-full absolute inset-0"
              />
            ) : (
               
              <img
                src={image.url || (image.filepath.startsWith('/') ? image.filepath : `/${image.filepath}`)}
                alt={image.filename}
                className="w-full h-full object-cover"
                onError={() => {
                  handleImageError(image.id)
                }}
                onLoad={(e) => {
                  // Check if the image actually loaded or if it's a broken image icon
                  const img = e.target as HTMLImageElement
                  if (img.naturalWidth === 0 || img.naturalHeight === 0) {
                    handleImageError(image.id)
                  }
                }}
              />
            )}
          </div>

          {/* Overlay with actions */}
          {!missingImages.has(image.id) && (
            <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-50 transition-all opacity-0 group-hover:opacity-100">
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  handleDownloadImage(image)
                }}
                className="absolute bottom-2 left-2 qt-bg-overlay-btn hover:qt-bg-overlay-btn qt-text-overlay p-2 rounded-full transition-colors"
                title="Download image"
                aria-label="Download image"
              >
                <Icon name="download" className="w-5 h-5" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  handleDeleteImage(image.id)
                }}
                className="absolute bottom-2 right-2 bg-destructive qt-text-on-destructive p-2 rounded-full hover:qt-bg-destructive/90 transition-colors"
                title="Delete image"
                aria-label="Delete image"
              >
                <Icon name="trash" className="w-5 h-5" />
              </button>
            </div>
          )}

          {/* Selected indicator */}
          {selectedImageId === image.id && !missingImages.has(image.id) && (
            <div className="absolute top-2 right-2 bg-primary text-primary-foreground rounded-full p-1">
              <Icon name="check" className="w-4 h-4" />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
