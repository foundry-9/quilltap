'use client'

import { useState, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { triggerDownload } from '@/lib/download-utils'
import type { GalleryImage, EntityType } from '../types'

interface CharacterGalleryEntry {
  linkId: string
  mountPointId: string
  relativePath: string
  fileName: string
  blobUrl: string
  mimeType: string | null
  sha256: string
  fileSizeBytes: number
  keptAt: string
  caption: string | null
  tags: string[]
}

interface CharacterGalleryListResponse {
  entries: CharacterGalleryEntry[]
  total: number
  hasMore: boolean
}

function toGalleryImage(entry: CharacterGalleryEntry): GalleryImage {
  return {
    id: entry.linkId,
    filename: entry.fileName,
    filepath: entry.blobUrl,
    mimeType: entry.mimeType,
    size: entry.fileSizeBytes,
    createdAt: entry.keptAt,
    caption: entry.caption,
    tags: entry.tags,
  }
}

export function useGalleryData(entityId: string, _entityType: EntityType) {
  const [missingImages, setMissingImages] = useState<Set<string>>(new Set())
  const queryClient = useQueryClient()

  const { data, isLoading: loading, refetch } = useQuery({
    queryKey: queryKeys.characters.photos(entityId),
    queryFn: ({ signal }) =>
      apiFetch<CharacterGalleryListResponse>(`/api/v1/characters/${entityId}/photos?limit=200`, { signal }),
  })

  const allImages: GalleryImage[] = (data?.entries ?? []).map(toGalleryImage)

  const fetchImages = useCallback(async () => {
    await refetch()
  }, [refetch])

  const setAllImages = useCallback(
    (update: ((prev: GalleryImage[]) => GalleryImage[]) | GalleryImage[]) => {
      // Optimistic, no-revalidate local edit (was SWR `mutate(updater, false)`).
      queryClient.setQueryData<CharacterGalleryListResponse>(
        queryKeys.characters.photos(entityId),
        prev => {
          if (!prev) return prev
          const next = typeof update === 'function'
            ? update(prev.entries.map(toGalleryImage))
            : update
          // We don't round-trip back to entries; the next fetch repopulates.
          // Just bump the version to trigger re-renders downstream.
          return {
            ...prev,
            entries: prev.entries.filter(e =>
              next.some(n => n.id === e.linkId)
            ),
          }
        }
      )
    },
    [queryClient, entityId]
  )

  const handleImageError = (imageId: string) => {
    setMissingImages(prev => new Set(prev).add(imageId))
    console.warn('Image failed to load', { imageId })
  }

  const handleSetAvatar = async (
    image: GalleryImage,
    _currentAvatarId: string | undefined,
    onAvatarChange?: (imageId: string | null) => void
  ) => {
    if (!onAvatarChange) return
    try {
      const res = await fetch(`/api/v1/characters/${entityId}?action=avatar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageId: image.id }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Failed to set avatar (${res.status})`)
      }

      onAvatarChange(image.id)
      showSuccessToast('Avatar updated!')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      showErrorToast(message || 'Failed to set avatar')
      console.error('Error setting avatar:', { error: message, entityId, imageId: image.id })
    }
  }

  const handleClearAvatar = async (
    currentAvatarId: string | undefined,
    onAvatarChange?: (imageId: string | null) => void
  ) => {
    if (!currentAvatarId || !onAvatarChange) return

    try {
      const res = await fetch(`/api/v1/characters/${entityId}?action=avatar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageId: null }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Failed to clear avatar (${res.status})`)
      }

      onAvatarChange(null)
      showSuccessToast('Avatar cleared!')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      showErrorToast(message || 'Failed to clear avatar')
      console.error('Error clearing avatar:', { error: message, entityId })
    }
  }

  /**
   * Fetch the picture's bytes and hand them to `triggerDownload`, which uses
   * Electron's native save dialog when the shell is present (there is no
   * right-click Save Image there) and an anchor click in the browser.
   */
  const handleDownloadImage = async (image: GalleryImage) => {
    const src = image.url || (image.filepath.startsWith('/') ? image.filepath : `/${image.filepath}`)
    try {
      const res = await fetch(src)
      if (!res.ok) throw new Error(`Failed to fetch image (${res.status})`)
      const blob = await res.blob()
      await triggerDownload(blob, image.filename)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      showErrorToast('Failed to download image')
      console.error('Error downloading image:', { error: message, entityId, imageId: image.id })
    }
  }

  const handleDeleteImage = async (
    image: GalleryImage,
    currentAvatarId: string | undefined,
    onAvatarChange?: (imageId: string | null) => void
  ) => {
    try {
      const isCurrentAvatar = currentAvatarId === image.id
      const res = await fetch(`/api/v1/characters/${entityId}/photos/${image.id}`, {
        method: 'DELETE',
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to delete image')
      }

      // Server has already nulled defaultImageId / avatarOverrides when the
      // deleted link was the current avatar; reflect that locally.
      if (isCurrentAvatar && onAvatarChange) {
        onAvatarChange(null)
      }

      await refetch()
      showSuccessToast('Image deleted')
    } catch (error) {
      showErrorToast(error instanceof Error ? error.message : 'Failed to delete image')
      console.error('Error deleting image:', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const handleUpload = async (
    file: File,
    options?: { caption?: string | null; tags?: string[] }
  ): Promise<boolean> => {
    try {
      const formData = new FormData()
      formData.append('file', file)
      if (options?.caption) formData.append('caption', options.caption)
      for (const tag of options?.tags ?? []) formData.append('tags', tag)

      const res = await fetch(`/api/v1/characters/${entityId}/photos`, {
        method: 'POST',
        body: formData,
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Upload failed (${res.status})`)
      }

      await refetch()
      showSuccessToast('Image uploaded')
      return true
    } catch (error) {
      showErrorToast(error instanceof Error ? error.message : 'Failed to upload image')
      console.error('Error uploading image:', {
        error: error instanceof Error ? error.message : String(error),
      })
      return false
    }
  }

  return {
    allImages,
    setAllImages,
    loading,
    missingImages,
    setMissingImages,
    fetchImages,
    handleImageError,
    handleSetAvatar,
    handleClearAvatar,
    handleDeleteImage,
    handleDownloadImage,
    handleUpload,
  }
}
